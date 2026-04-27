"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl } from "@/lib/format";
import type { Customer, Sale } from "@/lib/types";
import { useToast } from "./Toast";
import { useTenant } from "@/lib/useTenant";

export default function SaleEditor({
  sale,
  customers,
  onClose,
  onSaved,
}: {
  sale: Sale;
  customers: Customer[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const toast = useToast();
  const { tenant, isAdmin } = useTenant();
  const [quantity, setQuantity] = useState(sale.quantity);
  const [unitPrice, setUnitPrice] = useState(Number(sale.unit_price));
  const [discount, setDiscount] = useState(Number(sale.discount));
  const [customerId, setCustomerId] = useState(sale.customer_id ?? "");
  const [notes, setNotes] = useState(sale.notes ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const subtotal = quantity * unitPrice;
  const total = Math.max(0, +(subtotal - discount).toFixed(2));
  const isCanceled = !!sale.canceled_at;
  const minTotal = Number(sale.paid_amount);
  const editWindowH = tenant?.edit_window_hours ?? 24;
  const ageHours =
    (Date.now() - new Date(sale.created_at).getTime()) / 3_600_000;
  const outsideWindow = ageHours > editWindowH;
  const lockedForOperator = !isAdmin && outsideWindow;

  async function save() {
    if (lockedForOperator) {
      return toast.error(
        `Janela de edição (${editWindowH}h) expirou. Peça a um admin.`
      );
    }
    if (quantity <= 0) return toast.error("Quantidade inválida.");
    if (unitPrice <= 0) return toast.error("Valor unitário inválido.");
    if (total < minTotal) {
      return toast.error(
        `Total (${brl(total)}) menor que o já recebido (${brl(minTotal)}).`
      );
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("sales")
        .update({
          quantity,
          unit_price: unitPrice,
          discount,
          total,
          customer_id: customerId || null,
          notes: notes || null,
        })
        .eq("id", sale.id);
      if (error) throw error;
      // recalcular status (paid_amount não mudou, só total)
      await supabase.rpc("refresh_sale_status", { p_sale_id: sale.id });
      toast.success("Venda atualizada.");
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function cancelSale() {
    if (lockedForOperator) {
      return toast.error(
        `Janela de edição (${editWindowH}h) expirou. Peça a um admin.`
      );
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("sales")
        .update({
          canceled_at: new Date().toISOString(),
          cancel_reason: reason || null,
        })
        .eq("id", sale.id);
      if (error) throw error;
      await supabase.rpc("refresh_sale_status", { p_sale_id: sale.id });
      toast.success("Venda cancelada.");
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setSaving(false);
      setConfirmCancel(false);
    }
  }

  async function uncancelSale() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("sales")
        .update({ canceled_at: null, cancel_reason: null })
        .eq("id", sale.id);
      if (error) throw error;
      await supabase.rpc("refresh_sale_status", { p_sale_id: sale.id });
      toast.success("Cancelamento revertido.");
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 my-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-coco-900">
            {isCanceled ? "Venda cancelada" : "Editar venda"}
          </h2>
          <button onClick={onClose} className="btn-ghost">
            Fechar
          </button>
        </div>

        {isCanceled && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm mb-4">
            Esta venda está cancelada
            {sale.cancel_reason && <> · motivo: {sale.cancel_reason}</>}
          </div>
        )}

        {!isCanceled && lockedForOperator && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-800 text-sm mb-4">
            ⚠ Esta venda foi feita há {Math.floor(ageHours)}h. A janela de
            edição é de {editWindowH}h. Apenas um admin pode editar/cancelar.
          </div>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Quantidade</label>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value || "1"))}
                className="input"
                disabled={isCanceled}
              />
            </div>
            <div>
              <label className="label">Unitário</label>
              <input
                type="number"
                step="0.01"
                value={unitPrice}
                onChange={(e) =>
                  setUnitPrice(parseFloat(e.target.value || "0"))
                }
                className="input"
                disabled={isCanceled}
              />
            </div>
            <div>
              <label className="label">Desconto</label>
              <input
                type="number"
                step="0.01"
                value={discount}
                onChange={(e) =>
                  setDiscount(parseFloat(e.target.value || "0"))
                }
                className="input"
                disabled={isCanceled}
              />
            </div>
          </div>
          <div>
            <label className="label">Cliente</label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="input"
              disabled={isCanceled}
            >
              <option value="">— Consumidor —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Observação</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input"
              disabled={isCanceled}
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
          <div className="card !p-2">
            <div className="text-coco-700 text-xs">Subtotal</div>
            <div className="font-bold">{brl(subtotal)}</div>
          </div>
          <div className="card !p-2">
            <div className="text-coco-700 text-xs">Total</div>
            <div className="font-bold">{brl(total)}</div>
          </div>
          <div className="card !p-2">
            <div className="text-coco-700 text-xs">Já pago</div>
            <div className="font-bold">{brl(Number(sale.paid_amount))}</div>
          </div>
        </div>

        {!isCanceled ? (
          <>
            <div className="mt-4">
              <label className="label">Motivo (se for cancelar)</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="input"
                placeholder="Ex.: cliente desistiu, erro de digitação…"
              />
            </div>
            <div className="flex justify-between gap-2 mt-5">
              <button
                onClick={() => setConfirmCancel(true)}
                disabled={saving}
                className="btn-danger"
              >
                Cancelar venda
              </button>
              <div className="flex gap-2">
                <button onClick={onClose} className="btn-ghost" disabled={saving}>
                  Voltar
                </button>
                <button onClick={save} disabled={saving} className="btn-primary">
                  {saving ? "…" : "Salvar"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={uncancelSale} className="btn-secondary">
              Reverter cancelamento
            </button>
            <button onClick={onClose} className="btn-primary">
              Fechar
            </button>
          </div>
        )}

        {confirmCancel && (
          <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full">
              <h3 className="font-bold text-lg mb-2">Cancelar esta venda?</h3>
              <p className="text-sm text-coco-700 mb-4">
                Os pagamentos já lançados continuam no histórico, mas a venda
                não conta mais para o saldo do cliente nem para o financeiro
                como receita.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirmCancel(false)}
                  className="btn-ghost"
                >
                  Voltar
                </button>
                <button onClick={cancelSale} className="btn-danger">
                  Sim, cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
