"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDateOnly } from "@/lib/format";
import type { Expense, PaymentMethod } from "@/lib/types";
import { useToast } from "@/components/Toast";

// ─── Types ───────────────────────────────────────────────────────────────────

type BankRow = {
  id: string;
  date: string; // ISO date string yyyy-mm-dd
  description: string;
  amount: number; // positive = debit (saída), negative = credit (entrada)
};

type Match = { bankId: string; systemId: string };

type NewExpense = {
  description: string;
  category: string;
  amount: number;
  paid_at: string;
  payment_method_id: string | null;
  notes: string;
};

const CATEGORIES = [
  "Fornecedor",
  "Combustível",
  "Gelo",
  "Embalagem",
  "Salário",
  "Aluguel",
  "Outros",
];

// ─── Excel parser ─────────────────────────────────────────────────────────────

function parseExcel(buffer: ArrayBuffer): BankRow[] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  if (rows.length < 2) return [];

  const header = (rows[0] as string[]).map((h) =>
    String(h).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  );

  // Detect columns by common bank export headers (pt-BR)
  const dateIdx = header.findIndex((h) =>
    /data|date|dt/.test(h)
  );
  const descIdx = header.findIndex((h) =>
    /descri|histor|memo|lançamento|lancamento|detail/.test(h)
  );
  // Debit column (saída)
  const debitIdx = header.findIndex((h) =>
    /debito|debito|saida|saída|valor.*deb|deb/.test(h)
  );
  // Credit column (entrada)
  const creditIdx = header.findIndex((h) =>
    /credito|crédito|entrada|valor.*cred|cred/.test(h)
  );
  // Single value column
  const valorIdx = header.findIndex((h) =>
    /^valor$|^value$|^amount$/.test(h)
  );

  const results: BankRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (row.every((c) => c === "" || c == null)) continue;

    // Parse date
    let dateStr = "";
    const rawDate = dateIdx >= 0 ? row[dateIdx] : row[0];
    if (rawDate instanceof Date) {
      dateStr = rawDate.toISOString().slice(0, 10);
    } else if (typeof rawDate === "string" && rawDate.trim()) {
      // Try dd/mm/yyyy or yyyy-mm-dd
      const m = rawDate.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) dateStr = `${m[3]}-${m[2]}-${m[1]}`;
      else dateStr = rawDate.trim().slice(0, 10);
    } else if (typeof rawDate === "number") {
      // Excel serial date
      const d = XLSX.SSF.parse_date_code(rawDate);
      dateStr = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
    if (!dateStr) continue;

    const description = String(descIdx >= 0 ? row[descIdx] : row[1] ?? "").trim();

    // Parse amount
    let amount = 0;
    const parseBR = (v: unknown): number => {
      if (v == null || v === "") return 0;
      const s = String(v).replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
      return parseFloat(s) || 0;
    };

    if (debitIdx >= 0 && creditIdx >= 0) {
      const deb = parseBR(row[debitIdx]);
      const cre = parseBR(row[creditIdx]);
      amount = deb > 0 ? deb : -cre;
    } else if (valorIdx >= 0) {
      amount = parseBR(row[valorIdx]);
    } else {
      // fallback: last numeric column
      for (let j = row.length - 1; j >= 0; j--) {
        const v = parseBR(row[j]);
        if (v !== 0) { amount = v; break; }
      }
    }

    results.push({
      id: `bank-${i}`,
      date: dateStr,
      description,
      amount,
    });
  }

  return results;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ConciliacaoPage() {
  const supabase = createClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const [bankRows, setBankRows] = useState<BankRow[]>([]);
  const [systemExpenses, setSystemExpenses] = useState<Expense[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());

  // Selection state for matching
  const [selectedBank, setSelectedBank] = useState<string | null>(null);
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null);

  // New expense modal
  const [newExpense, setNewExpense] = useState<NewExpense | null>(null);
  const [saving, setSaving] = useState(false);

  // Filter: show only debits (saídas) by default
  const [showCredits, setShowCredits] = useState(false);

  async function loadSystem() {
    const [e, m] = await Promise.all([
      supabase
        .from("expenses")
        .select("*")
        .gte("paid_at", new Date(from + "T00:00:00").toISOString())
        .lte("paid_at", new Date(to + "T23:59:59.999").toISOString())
        .order("paid_at", { ascending: true }),
      supabase.from("payment_methods").select("*").eq("active", true).order("name"),
    ]);
    setSystemExpenses((e.data as Expense[]) ?? []);
    setMethods((m.data as PaymentMethod[]) ?? []);
  }

  useEffect(() => {
    loadSystem();
    // Reset matches when period changes
    setMatches([]);
    setIgnored(new Set());
    setSelectedBank(null);
    setSelectedSystem(null);
  }, [from, to]);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseExcel(ev.target!.result as ArrayBuffer);
        setBankRows(rows);
        setMatches([]);
        setIgnored(new Set());
        setSelectedBank(null);
        setSelectedSystem(null);
        toast.success(`${rows.length} lançamentos importados do banco.`);
      } catch {
        toast.error("Erro ao ler o arquivo. Verifique o formato.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // Click bank row: select it, or match if system row already selected
  function clickBank(id: string) {
    if (selectedSystem) {
      // Create match
      setMatches((prev) => [...prev, { bankId: id, systemId: selectedSystem }]);
      setSelectedSystem(null);
      setSelectedBank(null);
      toast.success("Conciliado!");
      return;
    }
    setSelectedBank((prev) => (prev === id ? null : id));
  }

  // Click system row: select it, or match if bank row already selected
  function clickSystem(id: string) {
    if (selectedBank) {
      setMatches((prev) => [...prev, { bankId: selectedBank, systemId: id }]);
      setSelectedBank(null);
      setSelectedSystem(null);
      toast.success("Conciliado!");
      return;
    }
    setSelectedSystem((prev) => (prev === id ? null : id));
  }

  function unmatch(bankId: string) {
    setMatches((prev) => prev.filter((m) => m.bankId !== bankId));
  }

  function toggleIgnore(id: string) {
    setIgnored((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function openNewExpense(row: BankRow) {
    setNewExpense({
      description: row.description,
      category: "",
      amount: Math.abs(row.amount),
      paid_at: row.date,
      payment_method_id: null,
      notes: "",
    });
    setSelectedBank(row.id);
  }

  async function saveExpense() {
    if (!newExpense) return;
    if (!newExpense.description.trim()) return toast.error("Descrição obrigatória.");
    if (!newExpense.amount || newExpense.amount <= 0) return toast.error("Valor inválido.");
    setSaving(true);
    const { error, data } = await supabase
      .from("expenses")
      .insert({
        description: newExpense.description.trim(),
        category: newExpense.category || null,
        amount: newExpense.amount,
        paid_at: new Date(newExpense.paid_at + "T12:00:00").toISOString(),
        payment_method_id: newExpense.payment_method_id || null,
        notes: newExpense.notes || null,
      })
      .select()
      .single();
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Despesa criada e conciliada.");
    // Auto-match the new expense with the selected bank row
    if (selectedBank && data) {
      setMatches((prev) => [...prev, { bankId: selectedBank, systemId: data.id }]);
      setSelectedBank(null);
    }
    setNewExpense(null);
    loadSystem();
  }

  // Derived state
  const matchedBankIds = useMemo(() => new Set(matches.map((m) => m.bankId)), [matches]);
  const matchedSystemIds = useMemo(() => new Set(matches.map((m) => m.systemId)), [matches]);

  const visibleBankRows = useMemo(
    () => bankRows.filter((r) => showCredits || r.amount > 0),
    [bankRows, showCredits]
  );

  const unmatchedBank = useMemo(
    () => visibleBankRows.filter((r) => !matchedBankIds.has(r.id) && !ignored.has(r.id)),
    [visibleBankRows, matchedBankIds, ignored]
  );

  const unmatchedSystem = useMemo(
    () => systemExpenses.filter((e) => !matchedSystemIds.has(e.id)),
    [systemExpenses, matchedSystemIds]
  );

  const totalBank = useMemo(
    () => visibleBankRows.filter((r) => !ignored.has(r.id)).reduce((s, r) => s + r.amount, 0),
    [visibleBankRows, ignored]
  );

  const totalSystem = useMemo(
    () => systemExpenses.reduce((s, e) => s + Number(e.amount), 0),
    [systemExpenses]
  );

  const diff = totalBank - totalSystem;

  const methodName = (id: string | null) =>
    methods.find((m) => m.id === id)?.name ?? "—";

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">Conciliação Bancária</h1>
          <p className="text-coco-600">Compare o extrato do banco com as despesas lançadas.</p>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          className="btn-primary"
        >
          📂 Importar Excel / CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv,.ods"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </header>

      {/* Period + toggle */}
      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">De</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
        </div>
        <div>
          <label className="label">Até</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" />
        </div>
        <label className="flex items-center gap-2 text-sm text-coco-700 cursor-pointer">
          <input
            type="checkbox"
            checked={showCredits}
            onChange={(e) => setShowCredits(e.target.checked)}
            className="rounded"
          />
          Mostrar entradas (créditos)
        </label>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card text-center">
          <div className="text-xs text-coco-600">Extrato banco</div>
          <div className="text-xl font-bold text-red-700">{brl(totalBank)}</div>
        </div>
        <div className="card text-center">
          <div className="text-xs text-coco-600">Sistema (despesas)</div>
          <div className="text-xl font-bold text-red-700">{brl(totalSystem)}</div>
        </div>
        <div className="card text-center">
          <div className="text-xs text-coco-600">Diferença</div>
          <div className={`text-xl font-bold ${Math.abs(diff) < 0.01 ? "text-green-700" : "text-orange-600"}`}>
            {brl(diff)}
          </div>
        </div>
        <div className="card text-center">
          <div className="text-xs text-coco-600">Conciliados</div>
          <div className="text-xl font-bold text-green-700">{matches.length}</div>
        </div>
      </div>

      {bankRows.length === 0 ? (
        <div className="card text-center py-16 text-coco-500">
          <div className="text-5xl mb-4">🏦</div>
          <p className="font-medium">Nenhum extrato carregado.</p>
          <p className="text-sm mt-1">
            Exporte o extrato do seu banco em Excel (.xlsx) ou CSV e clique em{" "}
            <strong>Importar Excel / CSV</strong>.
          </p>
          <p className="text-xs mt-3 text-coco-400">
            Colunas esperadas: Data · Descrição · Débito ou Valor
          </p>
        </div>
      ) : (
        <>
          {/* Instruction */}
          <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-800">
            <strong>Como usar:</strong> Clique em um lançamento do banco e depois em uma despesa do sistema para conciliá-los.
            Para lançamentos sem correspondência, clique em <strong>Criar despesa</strong>.
          </div>

          {/* Side-by-side */}
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Bank column */}
            <div>
              <h2 className="font-bold text-coco-800 mb-2">
                🏦 Extrato do Banco
                <span className="ml-2 text-sm font-normal text-coco-500">
                  ({visibleBankRows.length} lançamentos)
                </span>
              </h2>

              {/* Matched */}
              {matches.map((m) => {
                const row = bankRows.find((r) => r.id === m.bankId);
                if (!row) return null;
                return (
                  <div
                    key={m.bankId}
                    className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 mb-1 bg-green-50 border border-green-200 opacity-70"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-coco-500">{fmtDateOnly(row.date)}</div>
                      <div className="text-sm truncate">{row.description}</div>
                    </div>
                    <div className="font-semibold text-sm text-green-700 whitespace-nowrap">
                      {brl(row.amount)}
                    </div>
                    <span className="text-green-600 text-xs">✔ conciliado</span>
                    <button
                      onClick={() => unmatch(m.bankId)}
                      className="text-xs text-coco-400 hover:text-red-600"
                      title="Desfazer"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}

              {/* Unmatched */}
              {unmatchedBank.map((row) => (
                <div
                  key={row.id}
                  onClick={() => clickBank(row.id)}
                  className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 mb-1 border cursor-pointer transition ${
                    selectedBank === row.id
                      ? "border-blue-500 bg-blue-50 ring-1 ring-blue-400"
                      : "border-coco-200 bg-white hover:border-coco-400"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-coco-500">{fmtDateOnly(row.date)}</div>
                    <div className="text-sm truncate">{row.description}</div>
                  </div>
                  <div className="font-semibold text-sm text-red-700 whitespace-nowrap">
                    {brl(row.amount)}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); openNewExpense(row); }}
                      className="btn-ghost text-xs text-blue-700 whitespace-nowrap"
                      title="Criar despesa"
                    >
                      + despesa
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleIgnore(row.id); }}
                      className="btn-ghost text-xs text-coco-400"
                      title="Ignorar"
                    >
                      –
                    </button>
                  </div>
                </div>
              ))}

              {/* Ignored */}
              {[...ignored].map((id) => {
                const row = bankRows.find((r) => r.id === id);
                if (!row) return null;
                return (
                  <div
                    key={id}
                    className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 mb-1 bg-gray-50 border border-gray-200 opacity-50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-coco-500">{fmtDateOnly(row.date)}</div>
                      <div className="text-sm truncate line-through">{row.description}</div>
                    </div>
                    <div className="font-semibold text-sm text-gray-500 whitespace-nowrap">
                      {brl(row.amount)}
                    </div>
                    <button
                      onClick={() => toggleIgnore(id)}
                      className="text-xs text-coco-400 hover:text-coco-700"
                    >
                      restaurar
                    </button>
                  </div>
                );
              })}

              {unmatchedBank.length === 0 && matches.length > 0 && (
                <div className="text-center py-4 text-green-700 font-medium text-sm">
                  ✅ Todos os lançamentos do banco foram conciliados!
                </div>
              )}
            </div>

            {/* System column */}
            <div>
              <h2 className="font-bold text-coco-800 mb-2">
                💸 Despesas no Sistema
                <span className="ml-2 text-sm font-normal text-coco-500">
                  ({systemExpenses.length} despesas)
                </span>
              </h2>

              {systemExpenses.length === 0 && (
                <div className="card text-center text-coco-500 text-sm py-8">
                  Nenhuma despesa lançada no período.
                </div>
              )}

              {/* Matched system entries */}
              {matches.map((m) => {
                const exp = systemExpenses.find((e) => e.id === m.systemId);
                if (!exp) return null;
                return (
                  <div
                    key={m.systemId}
                    className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 mb-1 bg-green-50 border border-green-200 opacity-70"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-coco-500">{fmtDateOnly(exp.paid_at)}</div>
                      <div className="text-sm truncate">{exp.description}</div>
                      <div className="text-xs text-coco-400">{exp.category || "—"}</div>
                    </div>
                    <div className="font-semibold text-sm text-red-700 whitespace-nowrap">
                      {brl(Number(exp.amount))}
                    </div>
                    <span className="text-green-600 text-xs">✔</span>
                  </div>
                );
              })}

              {/* Unmatched system entries */}
              {unmatchedSystem.map((exp) => (
                <div
                  key={exp.id}
                  onClick={() => clickSystem(exp.id)}
                  className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 mb-1 border cursor-pointer transition ${
                    selectedSystem === exp.id
                      ? "border-blue-500 bg-blue-50 ring-1 ring-blue-400"
                      : "border-coco-200 bg-white hover:border-coco-400"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-coco-500">{fmtDateOnly(exp.paid_at)}</div>
                    <div className="text-sm truncate">{exp.description}</div>
                    <div className="text-xs text-coco-400">{exp.category || "—"} · {methodName(exp.payment_method_id)}</div>
                  </div>
                  <div className="font-semibold text-sm text-red-700 whitespace-nowrap">
                    {brl(Number(exp.amount))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* New expense modal */}
      {newExpense && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold mb-1">Nova Despesa</h2>
            <p className="text-sm text-coco-600 mb-4">
              Criada a partir do lançamento bancário. Será conciliada automaticamente.
            </p>
            <div className="space-y-3">
              <div>
                <label className="label">Descrição *</label>
                <input
                  className="input"
                  value={newExpense.description}
                  onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Valor (R$) *</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    value={newExpense.amount}
                    onChange={(e) => setNewExpense({ ...newExpense, amount: parseFloat(e.target.value || "0") })}
                  />
                </div>
                <div>
                  <label className="label">Data</label>
                  <input
                    type="date"
                    className="input"
                    value={newExpense.paid_at}
                    onChange={(e) => setNewExpense({ ...newExpense, paid_at: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Categoria</label>
                  <select
                    className="input"
                    value={newExpense.category}
                    onChange={(e) => setNewExpense({ ...newExpense, category: e.target.value })}
                  >
                    <option value="">—</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Forma de pagamento</label>
                  <select
                    className="input"
                    value={newExpense.payment_method_id ?? ""}
                    onChange={(e) => setNewExpense({ ...newExpense, payment_method_id: e.target.value || null })}
                  >
                    <option value="">—</option>
                    {methods.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Observação</label>
                <textarea
                  className="input"
                  rows={2}
                  value={newExpense.notes}
                  onChange={(e) => setNewExpense({ ...newExpense, notes: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setNewExpense(null)} className="btn-ghost">
                Cancelar
              </button>
              <button onClick={saveExpense} disabled={saving} className="btn-primary">
                {saving ? "Salvando..." : "Criar e Conciliar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
