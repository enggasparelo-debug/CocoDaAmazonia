"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDateOnly } from "@/lib/format";
import type {
  BankAccount,
  BankReconciliation,
  BankReconciliationItem,
  Expense,
  PaymentMethod,
} from "@/lib/types";
import { useToast } from "@/components/Toast";

// ─── Excel parser (same flexible parser as before) ───────────

type RawBankRow = {
  date: string;
  description: string;
  amount: number;
};

function parseExcel(buffer: ArrayBuffer): RawBankRow[] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (rows.length < 2) return [];

  const header = (rows[0] as string[]).map((h) =>
    String(h).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  );

  const dateIdx = header.findIndex((h) => /data|date|dt/.test(h));
  const descIdx = header.findIndex((h) => /descri|histor|memo|lancamento|detail/.test(h));
  const debitIdx = header.findIndex((h) => /debito|saida|valor.*deb|^deb$/.test(h));
  const creditIdx = header.findIndex((h) => /credito|entrada|valor.*cred|^cred$/.test(h));
  const valorIdx = header.findIndex((h) => /^valor$|^value$|^amount$/.test(h));

  const parseBR = (v: unknown): number => {
    if (v == null || v === "") return 0;
    const s = String(v).replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
    return parseFloat(s) || 0;
  };

  const results: RawBankRow[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (row.every((c) => c === "" || c == null)) continue;

    let dateStr = "";
    const rawDate = dateIdx >= 0 ? row[dateIdx] : row[0];
    if (rawDate instanceof Date) {
      dateStr = rawDate.toISOString().slice(0, 10);
    } else if (typeof rawDate === "string") {
      const m = rawDate.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) dateStr = `${m[3]}-${m[2]}-${m[1]}`;
      else dateStr = rawDate.trim().slice(0, 10);
    } else if (typeof rawDate === "number") {
      const d = XLSX.SSF.parse_date_code(rawDate);
      dateStr = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
    if (!dateStr) continue;

    const description = String(descIdx >= 0 ? row[descIdx] : row[1] ?? "").trim();

    let amount = 0;
    if (debitIdx >= 0 && creditIdx >= 0) {
      const deb = parseBR(row[debitIdx]);
      const cre = parseBR(row[creditIdx]);
      amount = deb > 0 ? deb : -cre;
    } else if (valorIdx >= 0) {
      amount = parseBR(row[valorIdx]);
    } else {
      for (let j = row.length - 1; j >= 0; j--) {
        const v = parseBR(row[j]);
        if (v !== 0) { amount = v; break; }
      }
    }

    results.push({ date: dateStr, description, amount });
  }

  return results;
}

// ─── Component ────────────────────────────────────────────────

const CATEGORIES = [
  "Fornecedor", "Combustível", "Gelo", "Embalagem",
  "Salário", "Aluguel", "Outros",
];

export default function AccountPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const router = useRouter();
  const supabase = createClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [account, setAccount] = useState<BankAccount | null>(null);
  const [reconciliations, setReconciliations] = useState<BankReconciliation[]>([]);
  const [showNew, setShowNew] = useState(false);

  // New reconciliation form
  const [newForm, setNewForm] = useState({
    period_start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
    period_end: new Date().toISOString().slice(0, 10),
    statement_ending_balance: "",
    notes: "",
  });
  const [rawRows, setRawRows] = useState<RawBankRow[]>([]);
  const [creating, setCreating] = useState(false);

  // Inline reconciliation workspace (for open reconciliations)
  const [activeRec, setActiveRec] = useState<BankReconciliation | null>(null);
  const [items, setItems] = useState<BankReconciliationItem[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);
  const [newExpense, setNewExpense] = useState<{
    description: string; category: string; amount: number;
    paid_at: string; payment_method_id: string | null; notes: string;
  } | null>(null);
  const [savingExpense, setSavingExpense] = useState(false);
  const [closing, setClosing] = useState(false);

  async function loadAccount() {
    const { data } = await supabase
      .from("bank_accounts")
      .select("*")
      .eq("id", accountId)
      .single();
    setAccount(data);
  }

  async function loadReconciliations() {
    const { data } = await supabase
      .from("bank_reconciliations")
      .select("*")
      .eq("bank_account_id", accountId)
      .order("created_at", { ascending: false });
    setReconciliations((data ?? []) as BankReconciliation[]);
  }

  async function loadWorkspace(rec: BankReconciliation) {
    setActiveRec(rec);
    const [itemsRes, expRes, methRes] = await Promise.all([
      supabase
        .from("bank_reconciliation_items")
        .select("*")
        .eq("reconciliation_id", rec.id)
        .order("bank_date"),
      supabase
        .from("expenses")
        .select("*")
        .gte("paid_at", new Date(rec.period_start + "T00:00:00").toISOString())
        .lte("paid_at", new Date(rec.period_end + "T23:59:59.999").toISOString())
        .order("paid_at"),
      supabase.from("payment_methods").select("*").eq("active", true).order("name"),
    ]);
    setItems((itemsRes.data ?? []) as BankReconciliationItem[]);
    setExpenses((expRes.data ?? []) as Expense[]);
    setMethods((methRes.data ?? []) as PaymentMethod[]);
    setSelectedItemId(null);
    setSelectedExpenseId(null);
  }

  useEffect(() => {
    loadAccount();
    loadReconciliations();
  }, [accountId]);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const rows = parseExcel(ev.target!.result as ArrayBuffer);
        setRawRows(rows);
        toast.success(`${rows.length} lançamentos lidos do extrato.`);
      } catch {
        toast.error("Erro ao ler o arquivo.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function createReconciliation() {
    if (!newForm.period_start || !newForm.period_end)
      return toast.error("Informe o período.");
    if (rawRows.length === 0)
      return toast.error("Importe o extrato bancário antes de criar a conciliação.");
    setCreating(true);

    const { data: rec, error } = await supabase
      .from("bank_reconciliations")
      .insert({
        bank_account_id: accountId,
        period_start: newForm.period_start,
        period_end: newForm.period_end,
        statement_ending_balance: newForm.statement_ending_balance
          ? parseFloat(newForm.statement_ending_balance)
          : null,
        notes: newForm.notes || null,
        status: "open",
      })
      .select()
      .single();

    if (error || !rec) {
      setCreating(false);
      return toast.error(error?.message ?? "Erro ao criar conciliação.");
    }

    // Insert all bank rows as items
    const itemsPayload = rawRows.map((r) => ({
      reconciliation_id: rec.id,
      bank_date: r.date,
      bank_description: r.description,
      bank_amount: r.amount,
      status: "pending",
    }));

    const { error: itemErr } = await supabase
      .from("bank_reconciliation_items")
      .insert(itemsPayload);

    setCreating(false);
    if (itemErr) return toast.error(itemErr.message);

    toast.success("Conciliação criada!");
    setShowNew(false);
    setRawRows([]);
    await loadReconciliations();
    await loadWorkspace(rec as BankReconciliation);
  }

  // ── Workspace actions ──────────────────────────────────────

  async function matchItem(itemId: string, expenseId: string) {
    await supabase
      .from("bank_reconciliation_items")
      .update({ status: "matched", expense_id: expenseId })
      .eq("id", itemId);
    // Mark expense visually by reloading
    await loadWorkspace(activeRec!);
    toast.success("Conciliado!");
    setSelectedItemId(null);
    setSelectedExpenseId(null);
  }

  async function unmatchItem(itemId: string) {
    await supabase
      .from("bank_reconciliation_items")
      .update({ status: "pending", expense_id: null })
      .eq("id", itemId);
    await loadWorkspace(activeRec!);
  }

  async function toggleIgnore(itemId: string, current: BankReconciliationItemStatus) {
    const next = current === "ignored" ? "pending" : "ignored";
    await supabase
      .from("bank_reconciliation_items")
      .update({ status: next })
      .eq("id", itemId);
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, status: next } : i)));
  }

  function openNewExpenseFromItem(item: BankReconciliationItem) {
    setNewExpense({
      description: item.bank_description,
      category: "",
      amount: Math.abs(item.bank_amount),
      paid_at: item.bank_date,
      payment_method_id: null,
      notes: "",
    });
    setSelectedItemId(item.id);
  }

  async function saveAndMatchExpense() {
    if (!newExpense || !selectedItemId) return;
    if (!newExpense.description.trim()) return toast.error("Descrição obrigatória.");
    if (!newExpense.amount || newExpense.amount <= 0) return toast.error("Valor inválido.");
    setSavingExpense(true);

    const { data: exp, error } = await supabase
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

    if (error || !exp) {
      setSavingExpense(false);
      return toast.error(error?.message ?? "Erro ao salvar despesa.");
    }

    await supabase
      .from("bank_reconciliation_items")
      .update({ status: "matched", expense_id: exp.id })
      .eq("id", selectedItemId);

    setSavingExpense(false);
    setNewExpense(null);
    setSelectedItemId(null);
    await loadWorkspace(activeRec!);
    toast.success("Despesa criada e conciliada!");
  }

  async function closeReconciliation() {
    if (!activeRec) return;
    const pendingCount = items.filter((i) => i.status === "pending").length;
    if (pendingCount > 0) {
      const ok = window.confirm(
        `Ainda há ${pendingCount} lançamento(s) pendente(s). Fechar assim mesmo?`
      );
      if (!ok) return;
    }
    setClosing(true);
    await supabase
      .from("bank_reconciliations")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", activeRec.id);
    setClosing(false);
    toast.success("Conciliação fechada!");
    setActiveRec(null);
    loadReconciliations();
  }

  // ── Derived data ──────────────────────────────────────────

  const matchedItems = items.filter((i) => i.status === "matched");
  const pendingItems = items.filter((i) => i.status === "pending" && i.bank_amount > 0);
  const ignoredItems = items.filter((i) => i.status === "ignored");
  const matchedExpenseIds = new Set(matchedItems.map((i) => i.expense_id).filter(Boolean));
  const unmatchedExpenses = expenses.filter((e) => !matchedExpenseIds.has(e.id));

  const totalBank = items
    .filter((i) => i.status !== "ignored" && i.bank_amount > 0)
    .reduce((s, i) => s + Number(i.bank_amount), 0);
  const totalMatched = matchedItems
    .filter((i) => i.bank_amount > 0)
    .reduce((s, i) => s + Number(i.bank_amount), 0);

  type BankReconciliationItemStatus = "pending" | "matched" | "ignored";

  if (!account) return <div className="p-8 text-coco-500">Carregando...</div>;

  return (
    <div className="space-y-6">
      {/* Breadcrumb + header */}
      <div>
        <Link href="/conciliacao" className="text-sm text-coco-500 hover:text-coco-700">
          ← Contas Bancárias
        </Link>
        <h1 className="text-3xl font-bold text-coco-900 mt-1">
          🏦 {account.name}
        </h1>
        <p className="text-coco-600 text-sm">
          {account.bank_name}
          {account.agency && ` · Ag. ${account.agency}`}
          {account.account_number && ` · CC ${account.account_number}`}
        </p>
      </div>

      {/* ── Workspace ativa ─────────────────────────────────── */}
      {activeRec && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-xl font-semibold text-coco-800">
                Conciliando: {fmtDateOnly(activeRec.period_start)} → {fmtDateOnly(activeRec.period_end)}
              </h2>
              {activeRec.statement_ending_balance != null && (
                <div className="text-sm text-coco-600">
                  Saldo final do extrato: <strong>{brl(activeRec.statement_ending_balance)}</strong>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setActiveRec(null)} className="btn-ghost text-sm">
                ← Voltar ao histórico
              </button>
              {activeRec.status === "open" && (
                <button
                  onClick={closeReconciliation}
                  disabled={closing}
                  className="btn-primary text-sm bg-green-700 hover:bg-green-800"
                >
                  {closing ? "Fechando..." : "✔ Fechar Conciliação"}
                </button>
              )}
            </div>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card text-center">
              <div className="text-xs text-coco-600">Total extrato</div>
              <div className="text-xl font-bold text-red-700">{brl(totalBank)}</div>
            </div>
            <div className="card text-center">
              <div className="text-xs text-coco-600">Conciliados</div>
              <div className="text-xl font-bold text-green-700">{matchedItems.filter(i => i.bank_amount > 0).length}</div>
            </div>
            <div className="card text-center">
              <div className="text-xs text-coco-600">Pendentes</div>
              <div className="text-xl font-bold text-orange-600">{pendingItems.length}</div>
            </div>
            <div className="card text-center">
              <div className="text-xs text-coco-600">Total conciliado</div>
              <div className="text-xl font-bold text-green-700">{brl(totalMatched)}</div>
            </div>
          </div>

          {activeRec.status === "open" && (
            <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-800">
              <strong>Como conciliar:</strong> Clique em um lançamento do banco e depois em uma despesa do sistema. Para lançamentos sem correspondência, use <strong>+ Despesa</strong>.
            </div>
          )}

          {/* Side-by-side */}
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Bank items */}
            <div>
              <h3 className="font-bold text-coco-800 mb-2">
                Extrato do banco
                <span className="ml-2 text-sm font-normal text-coco-500">
                  ({items.filter(i => i.bank_amount > 0).length} débitos)
                </span>
              </h3>

              {/* Matched */}
              {matchedItems.filter(i => i.bank_amount > 0).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-xl px-3 py-2 mb-1 bg-green-50 border border-green-200 opacity-75"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-coco-500">{fmtDateOnly(item.bank_date)}</div>
                    <div className="text-sm truncate">{item.bank_description}</div>
                  </div>
                  <div className="font-semibold text-sm text-green-700 whitespace-nowrap">{brl(item.bank_amount)}</div>
                  <span className="text-green-600 text-xs">✔</span>
                  {activeRec.status === "open" && (
                    <button onClick={() => unmatchItem(item.id)} className="text-xs text-coco-400 hover:text-red-600" title="Desfazer">✕</button>
                  )}
                </div>
              ))}

              {/* Pending */}
              {pendingItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => activeRec.status === "open" && setSelectedItemId(prev => prev === item.id ? null : item.id)}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2 mb-1 border transition ${
                    activeRec.status === "open" ? "cursor-pointer" : ""
                  } ${
                    selectedItemId === item.id
                      ? "border-blue-500 bg-blue-50 ring-1 ring-blue-400"
                      : "border-coco-200 bg-white hover:border-coco-400"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-coco-500">{fmtDateOnly(item.bank_date)}</div>
                    <div className="text-sm truncate">{item.bank_description}</div>
                  </div>
                  <div className="font-semibold text-sm text-red-700 whitespace-nowrap">{brl(item.bank_amount)}</div>
                  {activeRec.status === "open" && (
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); openNewExpenseFromItem(item); }}
                        className="btn-ghost text-xs text-blue-700"
                      >
                        + Despesa
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleIgnore(item.id, item.status); }}
                        className="btn-ghost text-xs text-coco-400"
                        title="Ignorar"
                      >–</button>
                    </div>
                  )}
                </div>
              ))}

              {/* Ignored */}
              {ignoredItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-xl px-3 py-2 mb-1 bg-gray-50 border border-gray-200 opacity-50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-coco-400">{fmtDateOnly(item.bank_date)}</div>
                    <div className="text-sm line-through truncate">{item.bank_description}</div>
                  </div>
                  <div className="text-sm text-gray-400 whitespace-nowrap">{brl(Math.abs(item.bank_amount))}</div>
                  {activeRec.status === "open" && (
                    <button onClick={() => toggleIgnore(item.id, item.status)} className="text-xs text-coco-400 hover:text-coco-700">restaurar</button>
                  )}
                </div>
              ))}
            </div>

            {/* System expenses */}
            <div>
              <h3 className="font-bold text-coco-800 mb-2">
                Despesas no sistema
                <span className="ml-2 text-sm font-normal text-coco-500">
                  ({expenses.length} no período)
                </span>
              </h3>

              {expenses.length === 0 && (
                <div className="card text-center text-coco-500 text-sm py-8">
                  Nenhuma despesa lançada no período.
                </div>
              )}

              {/* Matched */}
              {expenses.filter(e => matchedExpenseIds.has(e.id)).map((exp) => (
                <div
                  key={exp.id}
                  className="flex items-center gap-2 rounded-xl px-3 py-2 mb-1 bg-green-50 border border-green-200 opacity-75"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-coco-500">{exp.paid_at ? fmtDateOnly(exp.paid_at) : "—"}</div>
                    <div className="text-sm truncate">{exp.description}</div>
                    <div className="text-xs text-coco-400">{exp.category || "—"}</div>
                  </div>
                  <div className="font-semibold text-sm text-red-700 whitespace-nowrap">{brl(Number(exp.amount))}</div>
                  <span className="text-green-600 text-xs">✔</span>
                </div>
              ))}

              {/* Unmatched */}
              {unmatchedExpenses.map((exp) => (
                <div
                  key={exp.id}
                  onClick={() => {
                    if (activeRec.status !== "open") return;
                    if (selectedItemId) {
                      matchItem(selectedItemId, exp.id);
                    } else {
                      setSelectedExpenseId(prev => prev === exp.id ? null : exp.id);
                    }
                  }}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2 mb-1 border transition ${
                    activeRec.status === "open" ? "cursor-pointer" : ""
                  } ${
                    selectedExpenseId === exp.id
                      ? "border-blue-500 bg-blue-50 ring-1 ring-blue-400"
                      : "border-coco-200 bg-white hover:border-coco-400"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-coco-500">{exp.paid_at ? fmtDateOnly(exp.paid_at) : "—"}</div>
                    <div className="text-sm truncate">{exp.description}</div>
                    <div className="text-xs text-coco-400">{exp.category || "—"}</div>
                  </div>
                  <div className="font-semibold text-sm text-red-700 whitespace-nowrap">{brl(Number(exp.amount))}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Histórico de conciliações ─────────────────────── */}
      {!activeRec && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-coco-800">Histórico de Conciliações</h2>
            <button onClick={() => setShowNew(!showNew)} className="btn-primary text-sm">
              + Nova Conciliação
            </button>
          </div>

          {/* New reconciliation form */}
          {showNew && (
            <div className="card space-y-4">
              <h3 className="font-bold text-coco-800">Nova Conciliação</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Período — início</label>
                  <input type="date" className="input" value={newForm.period_start}
                    onChange={(e) => setNewForm({ ...newForm, period_start: e.target.value })} />
                </div>
                <div>
                  <label className="label">Período — fim</label>
                  <input type="date" className="input" value={newForm.period_end}
                    onChange={(e) => setNewForm({ ...newForm, period_end: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label">Saldo final do extrato (R$)</label>
                <input type="number" step="0.01" className="input" placeholder="0,00"
                  value={newForm.statement_ending_balance}
                  onChange={(e) => setNewForm({ ...newForm, statement_ending_balance: e.target.value })} />
              </div>
              <div>
                <label className="label">Extrato bancário *</label>
                {rawRows.length > 0 ? (
                  <div className="flex items-center gap-3">
                    <span className="text-green-700 text-sm font-medium">✔ {rawRows.length} lançamentos importados</span>
                    <button onClick={() => setRawRows([])} className="btn-ghost text-xs text-red-600">Remover</button>
                  </div>
                ) : (
                  <button onClick={() => fileRef.current?.click()} className="btn-ghost text-sm">
                    📂 Importar Excel / CSV
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.ods"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
              </div>
              <div>
                <label className="label">Observação</label>
                <input className="input" value={newForm.notes}
                  onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })} />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowNew(false)} className="btn-ghost">Cancelar</button>
                <button onClick={createReconciliation} disabled={creating} className="btn-primary">
                  {creating ? "Criando..." : "Criar e Iniciar"}
                </button>
              </div>
            </div>
          )}

          {reconciliations.length === 0 && !showNew && (
            <div className="card text-center py-12 text-coco-500">
              <p className="font-medium">Nenhuma conciliação ainda.</p>
              <p className="text-sm mt-1">Clique em <strong>+ Nova Conciliação</strong> para começar.</p>
            </div>
          )}

          {reconciliations.map((rec) => (
            <ReconciliationCard
              key={rec.id}
              rec={rec}
              onOpen={() => loadWorkspace(rec)}
            />
          ))}
        </>
      )}

      {/* ── New expense modal ─────────────────────────────── */}
      {newExpense && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold mb-1">Nova Despesa</h2>
            <p className="text-sm text-coco-600 mb-4">Será criada e conciliada automaticamente.</p>
            <div className="space-y-3">
              <div>
                <label className="label">Descrição *</label>
                <input className="input" value={newExpense.description}
                  onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Valor (R$) *</label>
                  <input type="number" step="0.01" className="input" value={newExpense.amount}
                    onChange={(e) => setNewExpense({ ...newExpense, amount: parseFloat(e.target.value || "0") })} />
                </div>
                <div>
                  <label className="label">Data</label>
                  <input type="date" className="input" value={newExpense.paid_at}
                    onChange={(e) => setNewExpense({ ...newExpense, paid_at: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Categoria</label>
                  <select className="input" value={newExpense.category}
                    onChange={(e) => setNewExpense({ ...newExpense, category: e.target.value })}>
                    <option value="">—</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Forma de pagamento</label>
                  <select className="input" value={newExpense.payment_method_id ?? ""}
                    onChange={(e) => setNewExpense({ ...newExpense, payment_method_id: e.target.value || null })}>
                    <option value="">—</option>
                    {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Observação</label>
                <textarea className="input" rows={2} value={newExpense.notes}
                  onChange={(e) => setNewExpense({ ...newExpense, notes: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setNewExpense(null)} className="btn-ghost">Cancelar</button>
              <button onClick={saveAndMatchExpense} disabled={savingExpense} className="btn-primary">
                {savingExpense ? "Salvando..." : "Criar e Conciliar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Reconciliation history card ──────────────────────────────

function ReconciliationCard({
  rec,
  onOpen,
}: {
  rec: BankReconciliation;
  onOpen: () => void;
}) {
  const supabase = createClient();
  const [stats, setStats] = useState<{ total: number; matched: number; pending: number } | null>(null);

  useEffect(() => {
    supabase
      .from("bank_reconciliation_items")
      .select("status, bank_amount")
      .eq("reconciliation_id", rec.id)
      .then(({ data }) => {
        if (!data) return;
        const debits = data.filter((i) => Number(i.bank_amount) > 0);
        setStats({
          total: debits.length,
          matched: debits.filter((i) => i.status === "matched").length,
          pending: debits.filter((i) => i.status === "pending").length,
        });
      });
  }, [rec.id]);

  return (
    <div className="card flex items-center justify-between gap-4 flex-wrap">
      <div>
        <div className="font-semibold text-coco-900">
          {fmtDateOnly(rec.period_start)} → {fmtDateOnly(rec.period_end)}
        </div>
        {rec.statement_ending_balance != null && (
          <div className="text-sm text-coco-600">
            Saldo do extrato: {brl(rec.statement_ending_balance)}
          </div>
        )}
        {stats && (
          <div className="text-xs text-coco-500 mt-0.5">
            {stats.matched}/{stats.total} lançamentos conciliados
            {stats.pending > 0 && (
              <span className="ml-2 text-orange-600">{stats.pending} pendentes</span>
            )}
          </div>
        )}
        {rec.notes && <div className="text-xs text-coco-400 mt-0.5">{rec.notes}</div>}
      </div>
      <div className="flex items-center gap-3">
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            rec.status === "closed"
              ? "bg-green-100 text-green-800"
              : "bg-yellow-100 text-yellow-800"
          }`}
        >
          {rec.status === "closed" ? "✔ Fechada" : "⏳ Em andamento"}
        </span>
        <button onClick={onOpen} className="btn-primary text-sm">
          {rec.status === "closed" ? "Ver" : "Continuar"}
        </button>
      </div>
    </div>
  );
}
