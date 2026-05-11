"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl } from "@/lib/format";
import { useToast } from "@/components/Toast";
import type { Payable, Expense, Supplier } from "@/lib/types";

const CATEGORIES = [
  "Fornecedor de Coco",
  "Transporte / Frete",
  "Embalagem",
  "Salários",
  "Aluguel",
  "Utilities (Água/Luz/Internet)",
  "Impostos / Taxas",
  "Manutenção",
  "Marketing",
  "Outros",
];

const HORIZONS = [
  { label: "30 dias", days: 30 },
  { label: "60 dias", days: 60 },
  { label: "90 dias", days: 90 },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysUntilDue(dueDateStr: string) {
  const today = new Date(todayStr() + "T00:00:00");
  const due = new Date(dueDateStr + "T00:00:00");
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

type UnifiedItem =
  | { _kind: "payable"; _raw: Payable }
  | { _kind: "expense"; _raw: Expense };

function unifiedDueDate(item: UnifiedItem): string | null {
  return item._raw.due_date ?? null;
}

function unifiedAmount(item: UnifiedItem): number {
  return Number(item._raw.amount);
}

function unifiedIsPending(item: UnifiedItem): boolean {
  if (item._kind === "payable")
    return item._raw.status === "pendente" || item._raw.status === "vencido";
  return item._raw.status === "open";
}

function unifiedIsPaid(item: UnifiedItem): boolean {
  if (item._kind === "payable") return item._raw.status === "pago";
  return item._raw.status === "paid";
}

function statusLabel(item: UnifiedItem) {
  if (unifiedIsPaid(item))
    return { text: "Pago", cls: "bg-green-100 text-green-800" };
  if (item._kind === "payable" && item._raw.status === "cancelado")
    return { text: "Cancelado", cls: "bg-gray-100 text-gray-600" };
  const due = unifiedDueDate(item);
  if (!due) return { text: "Em Aberto", cls: "bg-yellow-100 text-yellow-800" };
  const d = daysUntilDue(due);
  if (d < 0) return { text: `Vencido há ${-d}d`, cls: "bg-red-100 text-red-800" };
  if (d === 0) return { text: "Vence hoje", cls: "bg-orange-100 text-orange-800" };
  if (d <= 7) return { text: `Vence em ${d}d`, cls: "bg-yellow-100 text-yellow-800" };
  return { text: `Em ${d} dias`, cls: "bg-blue-100 text-blue-700" };
}

function emptyPayable(): Partial<Payable> {
  return {
    supplier_name: "",
    supplier_id: null,
    description: "",
    amount: 0,
    expense_date: todayStr(),
    due_date: addDays(todayStr(), 30),
    document_number: "",
    category: "",
    notes: "",
  };
}

export default function PagarPage() {
  const supabase = createClient();
  const toast = useToast();

  const [payables, setPayables] = useState<Payable[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Payable> | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("pendente");

  const [horizon, setHorizon] = useState(30);
  const [receivables, setReceivables] = useState<{ amount: number }[]>([]);

  async function load() {
    setLoading(true);
    const [pRes, rRes, sRes, eRes] = await Promise.all([
      supabase.from("payables").select("*").order("due_date", { ascending: true }),
      supabase
        .from("sales")
        .select("total, paid_amount")
        .neq("status", "paga")
        .is("canceled_at", null),
      supabase.from("suppliers").select("*").eq("active", true).order("name"),
      supabase
        .from("expenses")
        .select("*")
        .is("carga_id", null)
        .order("due_date", { ascending: true }),
    ]);
    setPayables((pRes.data as Payable[]) ?? []);
    setReceivables(
      ((rRes.data ?? []) as { total: number; paid_amount: number }[]).map(
        (s) => ({ amount: s.total - s.paid_amount })
      )
    );
    setSuppliers((sRes.data as Supplier[]) ?? []);
    setExpenses((eRes.data as Expense[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const unified = useMemo<UnifiedItem[]>(() => {
    const p = payables.map((r) => ({ _kind: "payable" as const, _raw: r }));
    const e = expenses.map((r) => ({ _kind: "expense" as const, _raw: r }));
    return [...p, ...e].sort((a, b) => {
      const da = unifiedDueDate(a) ?? "9999-99-99";
      const db = unifiedDueDate(b) ?? "9999-99-99";
      return da.localeCompare(db);
    });
  }, [payables, expenses]);

  const filtered = useMemo(() => {
    return unified.filter((item) => {
      if (filterStatus === "pendente") return unifiedIsPending(item);
      if (filterStatus === "pago") return unifiedIsPaid(item);
      return true;
    });
  }, [unified, filterStatus]);

  const summary = useMemo(() => {
    const pending = unified.filter(unifiedIsPending);
    const overdue = pending.filter((item) => {
      const due = unifiedDueDate(item);
      return due && daysUntilDue(due) < 0;
    });
    const dueThisWeek = pending.filter((item) => {
      const due = unifiedDueDate(item);
      if (!due) return false;
      const d = daysUntilDue(due);
      return d >= 0 && d <= 7;
    });
    return {
      totalPending: pending.reduce((s, item) => s + unifiedAmount(item), 0),
      totalOverdue: overdue.reduce((s, item) => s + unifiedAmount(item), 0),
      totalDueThisWeek: dueThisWeek.reduce((s, item) => s + unifiedAmount(item), 0),
      countOverdue: overdue.length,
    };
  }, [unified]);

  const projection = useMemo(() => {
    const cutoff = addDays(todayStr(), horizon);
    const totalReceivables = receivables.reduce((s, r) => s + r.amount, 0);
    const payablesInHorizon = unified
      .filter((item) => {
        const due = unifiedDueDate(item);
        return unifiedIsPending(item) && due && due <= cutoff;
      })
      .reduce((s, item) => s + unifiedAmount(item), 0);
    return {
      receivables: totalReceivables,
      payables: payablesInHorizon,
      net: totalReceivables - payablesInHorizon,
    };
  }, [unified, receivables, horizon]);

  async function save() {
    if (!editing?.description?.trim()) return toast.error("Descrição obrigatória.");
    if (!editing.amount || Number(editing.amount) <= 0) return toast.error("Valor inválido.");
    if (!editing.due_date) return toast.error("Data de vencimento obrigatória.");

    const selectedSupplier = editing.supplier_id
      ? suppliers.find((s) => s.id === editing.supplier_id)
      : null;

    const payload = {
      supplier_name: selectedSupplier?.name ?? editing.supplier_name?.trim() ?? "",
      supplier_id: editing.supplier_id || null,
      description: editing.description!.trim(),
      amount: Number(editing.amount),
      expense_date: editing.expense_date || null,
      due_date: editing.due_date,
      document_number: editing.document_number?.trim() || null,
      category: editing.category || null,
      notes: editing.notes || null,
      status: editing.status || "pendente",
    };

    const op = editing.id
      ? supabase.from("payables").update(payload).eq("id", editing.id)
      : supabase.from("payables").insert(payload);
    const { error } = await op;
    if (error) return toast.error(error.message);
    toast.success("Conta salva.");
    setEditing(null);
    load();
  }

  async function markPayablePaid(p: Payable) {
    const { error } = await supabase
      .from("payables")
      .update({ status: "pago", paid_at: new Date().toISOString(), paid_amount: p.amount })
      .eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Marcada como paga.");
    load();
  }

  async function markExpensePaid(e: Expense) {
    const { error } = await supabase
      .from("expenses")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", e.id);
    if (error) return toast.error(error.message);
    toast.success("Despesa marcada como paga.");
    load();
  }

  async function cancelPayable(id: string) {
    if (!confirm("Cancelar esta conta?")) return;
    const { error } = await supabase
      .from("payables")
      .update({ status: "cancelado" })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Conta cancelada.");
    load();
  }

  async function deleteExpense(id: string) {
    if (!confirm("Apagar esta despesa?")) return;
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Despesa apagada.");
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-coco-800">Contas a Pagar</h1>
        <button onClick={() => setEditing(emptyPayable())} className="btn-primary">
          + Nova Conta
        </button>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Total Pendente</div>
          <div className="text-2xl font-bold text-coco-800 mt-1">{brl(summary.totalPending)}</div>
        </div>
        <div className={`bg-white rounded-xl p-4 border shadow-sm ${summary.totalOverdue > 0 ? "border-red-200" : "border-gray-100"}`}>
          <div className="text-xs text-gray-500 uppercase tracking-wide">Vencidos ({summary.countOverdue})</div>
          <div className={`text-2xl font-bold mt-1 ${summary.totalOverdue > 0 ? "text-red-700" : "text-gray-400"}`}>
            {brl(summary.totalOverdue)}
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-yellow-100 shadow-sm">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Vence esta semana</div>
          <div className="text-2xl font-bold text-yellow-700 mt-1">{brl(summary.totalDueThisWeek)}</div>
        </div>
      </div>

      {/* Projeção de caixa */}
      <div className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="font-semibold text-coco-800">Projeção de Caixa</h2>
          <div className="flex gap-1">
            {HORIZONS.map((h) => (
              <button
                key={h.days}
                onClick={() => setHorizon(h.days)}
                className={`px-3 py-1 rounded-lg text-sm font-medium transition ${
                  horizon === h.days
                    ? "bg-coco-700 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-xs text-gray-500 uppercase mb-1">A Receber</div>
            <div className="text-xl font-bold text-green-700">{brl(projection.receivables)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase mb-1">A Pagar ({horizon}d)</div>
            <div className="text-xl font-bold text-red-700">−{brl(projection.payables)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase mb-1">Saldo Projetado</div>
            <div className={`text-xl font-bold ${projection.net >= 0 ? "text-coco-700" : "text-red-700"}`}>
              {projection.net >= 0 ? "" : "−"}{brl(Math.abs(projection.net))}
            </div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: "pendente", label: "Pendentes / Vencidas" },
          { key: "pago", label: "Pagas" },
          { key: "todos", label: "Todas" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilterStatus(f.key)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              filterStatus === f.key
                ? "bg-coco-700 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-coco-700">Carregando…</div>
      ) : filtered.length === 0 ? (
        <div className="text-gray-400 text-center py-12">Nenhuma conta encontrada.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => {
            const s = statusLabel(item);
            const due = unifiedDueDate(item);
            const amount = unifiedAmount(item);
            const isPending = unifiedIsPending(item);

            if (item._kind === "expense") {
              const e = item._raw;
              return (
                <div
                  key={`exp-${e.id}`}
                  className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm flex flex-col sm:flex-row sm:items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-coco-900 truncate">{e.description}</span>
                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                        Despesa
                      </span>
                      {e.is_nf && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                          NF
                        </span>
                      )}
                      {e.category && (
                        <span className="text-xs bg-coco-100 text-coco-700 px-2 py-0.5 rounded-full">
                          {e.category}
                        </span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>
                        {s.text}
                      </span>
                    </div>
                    <div className="flex gap-3 mt-0.5 flex-wrap">
                      {e.doc_number && (
                        <span className="text-xs text-gray-400">Doc: {e.doc_number}</span>
                      )}
                      {e.payee && (
                        <span className="text-xs text-gray-400">Favorecido: {e.payee}</span>
                      )}
                      {e.notes && (
                        <span className="text-xs text-gray-400 truncate">{e.notes}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="font-bold text-coco-800">{brl(amount)}</div>
                      {due && (
                        <div className="text-xs text-gray-400">
                          Vence {new Date(due + "T12:00:00").toLocaleDateString("pt-BR")}
                        </div>
                      )}
                    </div>
                    {isPending && (
                      <>
                        <button
                          onClick={() => markExpensePaid(e)}
                          className="btn-primary text-xs px-3 py-1"
                        >
                          ✓ Pagar
                        </button>
                        <button
                          onClick={() => deleteExpense(e.id)}
                          className="text-gray-400 hover:text-red-600 text-xs"
                          title="Apagar despesa"
                        >
                          🗑
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            }

            const p = item._raw;
            return (
              <div
                key={`pay-${p.id}`}
                className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-coco-900 truncate">
                      {p.supplier_name || p.description}
                    </span>
                    {p.category && (
                      <span className="text-xs bg-coco-100 text-coco-700 px-2 py-0.5 rounded-full">
                        {p.category}
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>
                      {s.text}
                    </span>
                  </div>
                  {p.supplier_name && (
                    <div className="text-sm text-gray-600 truncate mt-0.5">{p.description}</div>
                  )}
                  <div className="flex gap-3 mt-0.5 flex-wrap">
                    {p.expense_date && (
                      <span className="text-xs text-gray-400">
                        Compra: {new Date(p.expense_date + "T12:00:00").toLocaleDateString("pt-BR")}
                      </span>
                    )}
                    {p.document_number && (
                      <span className="text-xs text-gray-400">Doc: {p.document_number}</span>
                    )}
                    {p.notes && (
                      <span className="text-xs text-gray-400 truncate">{p.notes}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="font-bold text-coco-800">{brl(amount)}</div>
                    {due && (
                      <div className="text-xs text-gray-400">
                        Vence {new Date(due + "T12:00:00").toLocaleDateString("pt-BR")}
                      </div>
                    )}
                  </div>
                  {isPending && (
                    <>
                      <button
                        onClick={() => markPayablePaid(p)}
                        className="btn-primary text-xs px-3 py-1"
                        title="Marcar como paga"
                      >
                        ✓ Pagar
                      </button>
                      <button
                        onClick={() => setEditing(p)}
                        className="btn-secondary text-xs px-3 py-1"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => cancelPayable(p.id)}
                        className="text-gray-400 hover:text-red-600 text-xs"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de edição de conta a pagar */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-coco-800">
              {editing.id ? "Editar Conta" : "Nova Conta a Pagar"}
            </h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fornecedor</label>
              {suppliers.length > 0 ? (
                <select
                  className="input-field"
                  value={editing.supplier_id ?? ""}
                  onChange={(e) => {
                    const s = suppliers.find((x) => x.id === e.target.value);
                    setEditing({
                      ...editing,
                      supplier_id: e.target.value || null,
                      supplier_name: s?.name ?? editing.supplier_name ?? "",
                    });
                  }}
                >
                  <option value="">— Sem fornecedor —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="input-field"
                  value={editing.supplier_name ?? ""}
                  onChange={(e) => setEditing({ ...editing, supplier_name: e.target.value })}
                  placeholder="Ex: Fazenda Boa Vista"
                />
              )}
              {suppliers.length > 0 && !editing.supplier_id && (
                <input
                  className="input-field mt-2"
                  value={editing.supplier_name ?? ""}
                  onChange={(e) => setEditing({ ...editing, supplier_name: e.target.value })}
                  placeholder="Ou digite o nome do fornecedor"
                />
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Descrição *</label>
              <input
                className="input-field"
                value={editing.description ?? ""}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                placeholder="Ex: Compra de 500 cocos - lote #12"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Valor *</label>
                <input
                  className="input-field"
                  type="number"
                  min="0"
                  step="0.01"
                  value={editing.amount ?? ""}
                  onChange={(e) => setEditing({ ...editing, amount: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vencimento *</label>
                <input
                  className="input-field"
                  type="date"
                  value={editing.due_date ?? ""}
                  onChange={(e) => setEditing({ ...editing, due_date: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Data da Despesa</label>
                <input
                  className="input-field"
                  type="date"
                  value={editing.expense_date ?? ""}
                  onChange={(e) => setEditing({ ...editing, expense_date: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nº Documento</label>
                <input
                  className="input-field"
                  value={editing.document_number ?? ""}
                  onChange={(e) => setEditing({ ...editing, document_number: e.target.value })}
                  placeholder="NF-e, boleto…"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
              <select
                className="input-field"
                value={editing.category ?? ""}
                onChange={(e) => setEditing({ ...editing, category: e.target.value })}
              >
                <option value="">Selecionar…</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
              <textarea
                className="input-field"
                rows={2}
                value={editing.notes ?? ""}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              />
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button className="btn-secondary" onClick={() => setEditing(null)}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={save}>
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
