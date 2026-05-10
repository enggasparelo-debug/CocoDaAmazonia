"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl } from "@/lib/format";
import { useToast } from "@/components/Toast";
import type { Payable } from "@/lib/types";

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

function statusLabel(p: Payable) {
  if (p.status === "pago") return { text: "Pago", cls: "bg-green-100 text-green-800" };
  if (p.status === "cancelado") return { text: "Cancelado", cls: "bg-gray-100 text-gray-600" };
  const d = daysUntilDue(p.due_date);
  if (d < 0) return { text: `Vencido há ${-d}d`, cls: "bg-red-100 text-red-800" };
  if (d === 0) return { text: "Vence hoje", cls: "bg-orange-100 text-orange-800" };
  if (d <= 7) return { text: `Vence em ${d}d`, cls: "bg-yellow-100 text-yellow-800" };
  return { text: `Em ${d} dias`, cls: "bg-blue-100 text-blue-700" };
}

const emptyPayable: Partial<Payable> = {
  supplier_name: "",
  description: "",
  amount: 0,
  due_date: addDays(todayStr(), 30),
  category: "",
  notes: "",
};

export default function PagarPage() {
  const supabase = createClient();
  const toast = useToast();

  const [payables, setPayables] = useState<Payable[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Payable> | null>(null);
  const [showPaid, setShowPaid] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("pendente");

  // projeção de caixa
  const [horizon, setHorizon] = useState(30);
  const [receivables, setReceivables] = useState<{ amount: number }[]>([]);

  async function load() {
    setLoading(true);
    const [pRes, rRes] = await Promise.all([
      supabase
        .from("payables")
        .select("*")
        .order("due_date", { ascending: true }),
      supabase
        .from("sales")
        .select("total, paid_amount")
        .neq("status", "paga")
        .is("canceled_at", null),
    ]);
    setPayables((pRes.data as Payable[]) ?? []);
    setReceivables(
      ((rRes.data ?? []) as { total: number; paid_amount: number }[]).map(
        (s) => ({ amount: s.total - s.paid_amount })
      )
    );
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return payables.filter((p) => {
      if (filterStatus === "pendente") return p.status === "pendente" || p.status === "vencido";
      if (filterStatus === "pago") return p.status === "pago";
      return true;
    });
  }, [payables, filterStatus]);

  // Resumos
  const summary = useMemo(() => {
    const pending = payables.filter((p) => p.status === "pendente" || p.status === "vencido");
    const overdue = pending.filter((p) => daysUntilDue(p.due_date) < 0);
    const dueThisWeek = pending.filter((p) => {
      const d = daysUntilDue(p.due_date);
      return d >= 0 && d <= 7;
    });
    return {
      totalPending: pending.reduce((s, p) => s + Number(p.amount), 0),
      totalOverdue: overdue.reduce((s, p) => s + Number(p.amount), 0),
      totalDueThisWeek: dueThisWeek.reduce((s, p) => s + Number(p.amount), 0),
      countOverdue: overdue.length,
    };
  }, [payables]);

  // Projeção de caixa
  const projection = useMemo(() => {
    const cutoff = addDays(todayStr(), horizon);
    const totalReceivables = receivables.reduce((s, r) => s + r.amount, 0);
    const payablesInHorizon = payables
      .filter(
        (p) =>
          (p.status === "pendente" || p.status === "vencido") &&
          p.due_date <= cutoff
      )
      .reduce((s, p) => s + Number(p.amount), 0);
    return {
      receivables: totalReceivables,
      payables: payablesInHorizon,
      net: totalReceivables - payablesInHorizon,
    };
  }, [payables, receivables, horizon]);

  async function save() {
    if (!editing?.supplier_name?.trim()) return toast.error("Fornecedor obrigatório.");
    if (!editing?.description?.trim()) return toast.error("Descrição obrigatória.");
    if (!editing.amount || Number(editing.amount) <= 0) return toast.error("Valor inválido.");
    if (!editing.due_date) return toast.error("Data de vencimento obrigatória.");

    const payload = {
      supplier_name: editing.supplier_name!.trim(),
      description: editing.description!.trim(),
      amount: Number(editing.amount),
      due_date: editing.due_date,
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

  async function markPaid(p: Payable) {
    const { error } = await supabase
      .from("payables")
      .update({ status: "pago", paid_at: new Date().toISOString(), paid_amount: p.amount })
      .eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Marcada como paga.");
    load();
  }

  async function cancel(id: string) {
    if (!confirm("Cancelar esta conta?")) return;
    const { error } = await supabase
      .from("payables")
      .update({ status: "cancelado" })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Conta cancelada.");
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-coco-800">Contas a Pagar</h1>
        <button
          onClick={() => setEditing({ ...emptyPayable })}
          className="btn-primary"
        >
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
        <div className="text-gray-400 text-center py-12">
          Nenhuma conta encontrada.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const s = statusLabel(p);
            return (
              <div
                key={p.id}
                className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-coco-900 truncate">{p.supplier_name}</span>
                    {p.category && (
                      <span className="text-xs bg-coco-100 text-coco-700 px-2 py-0.5 rounded-full">
                        {p.category}
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>
                      {s.text}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600 truncate mt-0.5">{p.description}</div>
                  {p.notes && (
                    <div className="text-xs text-gray-400 truncate">{p.notes}</div>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="font-bold text-coco-800">{brl(Number(p.amount))}</div>
                    <div className="text-xs text-gray-400">
                      Vence {new Date(p.due_date + "T12:00:00").toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                  {(p.status === "pendente" || p.status === "vencido") && (
                    <>
                      <button
                        onClick={() => markPaid(p)}
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
                        onClick={() => cancel(p.id)}
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

      {/* Modal de edição */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-coco-800">
              {editing.id ? "Editar Conta" : "Nova Conta a Pagar"}
            </h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fornecedor *</label>
              <input
                className="input-field"
                value={editing.supplier_name ?? ""}
                onChange={(e) => setEditing({ ...editing, supplier_name: e.target.value })}
                placeholder="Ex: Fazenda Boa Vista"
              />
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
