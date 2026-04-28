"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import type { Expense, PaymentMethod } from "@/lib/types";
import { useToast } from "@/components/Toast";

const empty: Partial<Expense> = {
  description: "",
  category: "",
  amount: 0,
  notes: "",
  payment_method_id: null,
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

export default function DespesasPage() {
  const supabase = createClient();
  const toast = useToast();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [editing, setEditing] = useState<Partial<Expense> | null>(null);

  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  async function load() {
    const [e, m] = await Promise.all([
      supabase
        .from("expenses")
        .select("*")
        .gte("paid_at", new Date(from + "T00:00:00").toISOString())
        .lte("paid_at", new Date(to + "T23:59:59.999").toISOString())
        .order("paid_at", { ascending: false }),
      supabase
        .from("payment_methods")
        .select("*")
        .eq("active", true)
        .eq("is_credit", false)
        .order("name"),
    ]);
    setExpenses((e.data as Expense[]) ?? []);
    setMethods((m.data as PaymentMethod[]) ?? []);
  }

  useEffect(() => {
    load();
  }, [from, to]);

  const total = useMemo(
    () => expenses.reduce((s, e) => s + Number(e.amount), 0),
    [expenses]
  );

  const byCategory = useMemo(() => {
    const map: Record<string, number> = {};
    expenses.forEach((e) => {
      const k = e.category || "Outros";
      map[k] = (map[k] || 0) + Number(e.amount);
    });
    return map;
  }, [expenses]);

  async function save() {
    if (!editing?.description?.trim())
      return toast.error("Descrição obrigatória.");
    if (!editing.amount || editing.amount <= 0)
      return toast.error("Valor inválido.");

    const payload = {
      description: editing.description!.trim(),
      category: editing.category || null,
      amount: editing.amount,
      payment_method_id: editing.payment_method_id || null,
      notes: editing.notes || null,
      paid_at: editing.paid_at ?? new Date().toISOString(),
    };

    const op = editing.id
      ? supabase.from("expenses").update(payload).eq("id", editing.id)
      : supabase.from("expenses").insert(payload);
    const { error } = await op;
    if (error) return toast.error(error.message);
    toast.success("Despesa salva.");
    setEditing(null);
    load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Despesa apagada.");
    load();
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">Despesas</h1>
          <p className="text-coco-600">
            Custos do negócio para apurar o lucro real.
          </p>
        </div>
        <button onClick={() => setEditing({ ...empty })} className="btn-primary">
          + Nova despesa
        </button>
      </header>

      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">De</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="label">Até</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input"
          />
        </div>
        <div className="ml-auto text-right">
          <div className="text-xs text-coco-700">Total no período</div>
          <div className="text-3xl font-bold text-red-700">{brl(total)}</div>
        </div>
      </div>

      <div className="card">
        <h2 className="font-bold mb-3">Por categoria</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {Object.entries(byCategory)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, val]) => (
              <div
                key={cat}
                className="rounded-xl border border-coco-100 p-3"
              >
                <div className="text-xs text-coco-700">{cat}</div>
                <div className="font-bold">{brl(val)}</div>
              </div>
            ))}
        </div>
      </div>

      <div className="card">
        {expenses.length === 0 ? (
          <p className="text-coco-600">Sem despesas no período.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th className="text-right">Valor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td>{fmtDate(e.paid_at)}</td>
                  <td>{e.description}</td>
                  <td>{e.category || "—"}</td>
                  <td className="text-right font-semibold text-red-700">
                    {brl(Number(e.amount))}
                  </td>
                  <td className="text-right">
                    <button
                      onClick={() => setEditing(e)}
                      className="btn-ghost text-xs"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => remove(e.id)}
                      className="btn-ghost text-xs text-red-700"
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold mb-4">
              {editing.id ? "Editar despesa" : "Nova despesa"}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="label">Descrição *</label>
                <input
                  className="input"
                  value={editing.description ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Valor (R$) *</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    value={editing.amount ?? 0}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        amount: parseFloat(e.target.value || "0"),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="label">Categoria</label>
                  <select
                    className="input"
                    value={editing.category ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, category: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Pago em</label>
                <select
                  className="input"
                  value={editing.payment_method_id ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      payment_method_id: e.target.value || null,
                    })
                  }
                >
                  <option value="">—</option>
                  {methods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Observação</label>
                <textarea
                  className="input"
                  rows={2}
                  value={editing.notes ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, notes: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="btn-ghost">
                Cancelar
              </button>
              <button onClick={save} className="btn-primary">
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
