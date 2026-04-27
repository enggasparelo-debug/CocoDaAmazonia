"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import type { InventoryMovement } from "@/lib/types";
import { useToast } from "@/components/Toast";

export default function EstoquePage() {
  const supabase = createClient();
  const toast = useToast();
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [onHand, setOnHand] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    kind: "entrada" as "entrada" | "perda" | "ajuste",
    quantity: 0,
    unit_cost: 0,
    notes: "",
  });

  async function load() {
    setLoading(true);
    const [m, b] = await Promise.all([
      supabase
        .from("inventory_movements")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("inventory_balance").select("*").single(),
    ]);
    setMovements((m.data as InventoryMovement[]) ?? []);
    setOnHand((b.data as any)?.on_hand ?? 0);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const totalCost = useMemo(() => {
    return movements
      .filter((m) => m.kind === "entrada" && m.unit_cost)
      .reduce((s, m) => s + m.quantity * Number(m.unit_cost), 0);
  }, [movements]);

  async function save() {
    if (form.quantity <= 0) return toast.error("Quantidade deve ser positiva.");
    const { error } = await supabase.from("inventory_movements").insert({
      kind: form.kind,
      quantity: form.quantity,
      unit_cost:
        form.kind === "entrada" && form.unit_cost > 0 ? form.unit_cost : null,
      notes: form.notes || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Movimento registrado.");
    setForm({ kind: "entrada", quantity: 0, unit_cost: 0, notes: "" });
    load();
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-coco-900">Estoque</h1>
        <p className="text-coco-600">
          Controle de cocos. Vendas (não canceladas) baixam automaticamente.
        </p>
      </header>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card bg-coco-600 text-white border-coco-600">
          <div className="text-coco-100 text-xs uppercase">Saldo atual</div>
          <div className="text-4xl font-extrabold">{onHand}</div>
          <div className="text-coco-200 text-xs mt-1">cocos disponíveis</div>
        </div>
        <div className="card">
          <div className="text-coco-700 text-xs uppercase">
            Custo total das entradas
          </div>
          <div className="text-2xl font-bold">{brl(totalCost)}</div>
        </div>
        <div className="card">
          <div className="text-coco-700 text-xs uppercase">Movimentos</div>
          <div className="text-2xl font-bold">{movements.length}</div>
        </div>
      </div>

      <div className="card">
        <h2 className="font-bold mb-3">Novo movimento</h2>
        <div className="grid sm:grid-cols-4 gap-3">
          <div>
            <label className="label">Tipo</label>
            <select
              className="input"
              value={form.kind}
              onChange={(e) =>
                setForm({ ...form, kind: e.target.value as any })
              }
            >
              <option value="entrada">Entrada (compra)</option>
              <option value="perda">Perda</option>
              <option value="ajuste">Ajuste manual</option>
            </select>
          </div>
          <div>
            <label className="label">Quantidade</label>
            <input
              type="number"
              min={1}
              className="input"
              value={form.quantity}
              onChange={(e) =>
                setForm({ ...form, quantity: parseInt(e.target.value || "0") })
              }
            />
          </div>
          {form.kind === "entrada" && (
            <div>
              <label className="label">Custo unitário (R$)</label>
              <input
                type="number"
                step="0.01"
                className="input"
                value={form.unit_cost}
                onChange={(e) =>
                  setForm({
                    ...form,
                    unit_cost: parseFloat(e.target.value || "0"),
                  })
                }
              />
            </div>
          )}
          <div className={form.kind === "entrada" ? "" : "sm:col-span-2"}>
            <label className="label">Observação</label>
            <input
              className="input"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Ex.: nota fiscal #123"
            />
          </div>
        </div>
        <button onClick={save} className="btn-primary mt-3">
          Registrar movimento
        </button>
      </div>

      <div className="card">
        <h2 className="font-bold mb-3">Últimos movimentos</h2>
        {loading ? (
          <p className="text-coco-600">Carregando…</p>
        ) : movements.length === 0 ? (
          <p className="text-coco-600">Sem movimentos ainda.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th className="text-right">Qtd</th>
                <th className="text-right">Custo unit.</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td>{fmtDate(m.created_at)}</td>
                  <td>
                    <span
                      className={`badge ${
                        m.kind === "entrada"
                          ? "bg-green-100 text-green-800"
                          : m.kind === "perda"
                          ? "bg-red-100 text-red-800"
                          : "bg-gray-200 text-gray-700"
                      }`}
                    >
                      {m.kind}
                    </span>
                  </td>
                  <td className="text-right font-semibold">{m.quantity}</td>
                  <td className="text-right">
                    {m.unit_cost ? brl(Number(m.unit_cost)) : "—"}
                  </td>
                  <td className="text-coco-700 text-xs">{m.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
