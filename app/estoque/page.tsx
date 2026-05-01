"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import type { InventoryMovement } from "@/lib/types";
import { useToast } from "@/components/Toast";
import ConfirmModal from "@/components/ConfirmModal";

type ManualKind = "entrada" | "perda" | "ajuste";
const MANUAL_KINDS: ManualKind[] = ["entrada", "perda", "ajuste"];

function isManual(k: string): k is ManualKind {
  return (MANUAL_KINDS as string[]).includes(k);
}

function nowLocalIso(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function isoToLocal(iso: string): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function EstoquePage() {
  const supabase = createClient();
  const toast = useToast();
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [onHand, setOnHand] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    kind: "entrada" as ManualKind,
    quantity: 0,
    unit_cost: 0,
    notes: "",
  });
  const [editing, setEditing] = useState<InventoryMovement | null>(null);
  const [editForm, setEditForm] = useState({
    quantity: 0,
    unit_cost: 0,
    notes: "",
    created_at: nowLocalIso(),
  });
  const [confirmDelete, setConfirmDelete] = useState<InventoryMovement | null>(
    null
  );

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

  function openEdit(m: InventoryMovement) {
    setEditing(m);
    setEditForm({
      quantity: m.quantity,
      unit_cost: Number(m.unit_cost ?? 0),
      notes: m.notes ?? "",
      created_at: isoToLocal(m.created_at),
    });
  }

  async function saveEdit() {
    if (!editing) return;
    if (editForm.quantity <= 0)
      return toast.error("Quantidade deve ser positiva.");
    const { error } = await supabase
      .from("inventory_movements")
      .update({
        quantity: editForm.quantity,
        unit_cost:
          editing.kind === "entrada" && editForm.unit_cost > 0
            ? editForm.unit_cost
            : null,
        notes: editForm.notes || null,
        created_at: new Date(editForm.created_at).toISOString(),
      })
      .eq("id", editing.id);
    if (error) return toast.error(error.message);
    toast.success("Movimento atualizado.");
    setEditing(null);
    load();
  }

  async function deleteMovement(m: InventoryMovement) {
    const { error } = await supabase
      .from("inventory_movements")
      .delete()
      .eq("id", m.id);
    setConfirmDelete(null);
    if (error) return toast.error(error.message);
    toast.success("Movimento apagado.");
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const manual = isManual(m.kind);
                return (
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
                    <td className="text-right whitespace-nowrap">
                      {manual ? (
                        <>
                          <button
                            onClick={() => openEdit(m)}
                            className="btn-ghost text-xs px-2"
                            title="Editar"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => setConfirmDelete(m)}
                            className="btn-ghost text-xs px-2 text-red-700"
                            title="Apagar"
                          >
                            🗑
                          </button>
                        </>
                      ) : (
                        <span
                          className="text-xs text-coco-500"
                          title="Movimento gerado automaticamente pelo fechamento da carga. Edite/cancele a carga em vez disso."
                        >
                          🔒
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-coco-900">
                Editar movimento
              </h2>
              <button onClick={() => setEditing(null)} className="btn-ghost">
                Fechar
              </button>
            </div>
            <p className="text-xs text-coco-600 mb-3">
              Tipo: <strong>{editing.kind}</strong> (não pode ser alterado)
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Data</label>
                  <input
                    type="datetime-local"
                    className="input"
                    value={editForm.created_at}
                    onChange={(e) =>
                      setEditForm({ ...editForm, created_at: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="label">Quantidade</label>
                  <input
                    type="number"
                    min={1}
                    className="input"
                    value={editForm.quantity}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        quantity: parseInt(e.target.value || "0"),
                      })
                    }
                  />
                </div>
              </div>
              {editing.kind === "entrada" && (
                <div>
                  <label className="label">Custo unitário (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    value={editForm.unit_cost}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        unit_cost: parseFloat(e.target.value || "0"),
                      })
                    }
                  />
                </div>
              )}
              <div>
                <label className="label">Observação</label>
                <input
                  className="input"
                  value={editForm.notes}
                  onChange={(e) =>
                    setEditForm({ ...editForm, notes: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="btn-ghost">
                Cancelar
              </button>
              <button onClick={saveEdit} className="btn-primary">
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Apagar movimento?"
          danger
          confirmText="Apagar"
          message={
            <>
              Vai apagar o movimento de <strong>{confirmDelete.kind}</strong> de{" "}
              <strong>{confirmDelete.quantity}</strong> cocos em{" "}
              {fmtDate(confirmDelete.created_at)}. O saldo do estoque é
              recalculado automaticamente.
            </>
          }
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => deleteMovement(confirmDelete)}
        />
      )}
    </div>
  );
}
