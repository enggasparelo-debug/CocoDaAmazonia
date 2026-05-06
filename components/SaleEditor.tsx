"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import { isoToLocal, nowLocalIso } from "@/lib/datetime";
import type {
  Customer,
  PaymentMethod,
  Sale,
  SalePayment,
  Seller,
} from "@/lib/types";
import { useToast } from "./Toast";
import { useTenant } from "@/lib/useTenant";
import PaymentEditor from "./PaymentEditor";

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
  const [sellerId, setSellerId] = useState<string>(sale.seller_id ?? "");
  const [notes, setNotes] = useState(sale.notes ?? "");
  const [createdAtLocal, setCreatedAtLocal] = useState<string>(
    isoToLocal(sale.created_at)
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cargaStatus, setCargaStatus] = useState<string | null>(null);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [payments, setPayments] = useState<SalePayment[]>([]);
  const [editingPayment, setEditingPayment] = useState<SalePayment | null>(
    null
  );
  const [showNewPayment, setShowNewPayment] = useState(false);
  const [newPay, setNewPay] = useState({
    methodId: "",
    amount: 0,
    paidAtLocal: nowLocalIso(),
    notes: "",
  });
  const [payErr, setPayErr] = useState<string | null>(null);

  useEffect(() => {
    if (!sale.carga_id) return;
    supabase
      .from("cargas")
      .select("status")
      .eq("id", sale.carga_id)
      .maybeSingle()
      .then(({ data }) => setCargaStatus((data?.status as string) ?? null));
  }, [sale.carga_id, supabase]);

  useEffect(() => {
    supabase
      .from("sellers")
      .select("*")
      .order("name")
      .then(({ data }) => setSellers((data as Seller[]) ?? []));
    supabase
      .from("payment_methods")
      .select("*")
      .eq("active", true)
      .eq("is_credit", false)
      .order("name")
      .then(({ data }) => {
        const list = (data as PaymentMethod[]) ?? [];
        setMethods(list);
        setNewPay((p) => ({ ...p, methodId: list[0]?.id ?? "" }));
      });
  }, [supabase]);

  async function loadPayments() {
    const { data } = await supabase
      .from("sale_payments")
      .select("*")
      .eq("sale_id", sale.id)
      .order("paid_at", { ascending: false });
    setPayments((data as SalePayment[]) ?? []);
  }
  useEffect(() => {
    loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale.id]);

  async function addPayment() {
    setPayErr(null);
    if (!newPay.methodId) return setPayErr("Escolha uma forma.");
    if (newPay.amount <= 0) return setPayErr("Valor inválido.");
    const paidAtIso = new Date(newPay.paidAtLocal).toISOString();
    if (new Date(paidAtIso).getTime() > Date.now() + 60_000)
      return setPayErr("Data não pode ser futura.");
    const { error } = await supabase.from("sale_payments").insert({
      sale_id: sale.id,
      payment_method_id: newPay.methodId,
      amount: newPay.amount,
      paid_at: paidAtIso,
      notes: newPay.notes || null,
    });
    if (error) return setPayErr(error.message);
    toast.success("Pagamento lançado.");
    setShowNewPayment(false);
    setNewPay({
      methodId: methods[0]?.id ?? "",
      amount: 0,
      paidAtLocal: nowLocalIso(),
      notes: "",
    });
    await loadPayments();
    onSaved(); // recarrega o saldo no caller (paid_amount)
  }

  async function deletePayment(p: SalePayment) {
    if (
      !confirm(
        `Apagar pagamento de ${brl(Number(p.amount))} de ${fmtDate(p.paid_at)}?`
      )
    )
      return;
    const { error } = await supabase
      .from("sale_payments")
      .delete()
      .eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Pagamento removido.");
    await loadPayments();
    onSaved();
  }

  const subtotal = quantity * unitPrice;
  const total = Math.max(0, +(subtotal - discount).toFixed(2));
  const isCanceled = !!sale.canceled_at;
  const isCargaConferida = cargaStatus === "conferida";
  const minTotal = Number(sale.paid_amount);
  const editWindowH = tenant?.edit_window_hours ?? 24;
  const ageHours =
    (Date.now() - new Date(sale.created_at).getTime()) / 3_600_000;
  const outsideWindow = ageHours > editWindowH;
  const lockedForOperator =
    isCargaConferida || (!isAdmin && outsideWindow);

  async function save() {
    if (isCargaConferida) {
      return toast.error(
        "Venda pertence a uma carga já conferida. Reabra a carga para editar."
      );
    }
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
    if (!createdAtLocal) return toast.error("Informe a data da venda.");
    const createdAtIso = new Date(createdAtLocal).toISOString();
    if (new Date(createdAtIso).getTime() > Date.now() + 60_000) {
      return toast.error("A data da venda não pode ser no futuro.");
    }
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        quantity,
        unit_price: unitPrice,
        discount,
        total,
        customer_id: customerId || null,
        notes: notes || null,
        created_at: createdAtIso,
      };
      // Apenas admin pode trocar o vendedor
      if (isAdmin) updates.seller_id = sellerId || null;
      const { error } = await supabase
        .from("sales")
        .update(updates)
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
          <div>
            <label className="label">Data da venda</label>
            <input
              type="datetime-local"
              className="input"
              value={createdAtLocal}
              onChange={(e) => setCreatedAtLocal(e.target.value)}
              disabled={isCanceled}
            />
          </div>
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
            <label className="label">
              Vendedor {isAdmin ? "" : "(somente admin edita)"}
            </label>
            <select
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
              className="input"
              disabled={isCanceled || !isAdmin}
            >
              <option value="">— Sem vendedor —</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.active ? "" : " (inativo)"}
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

        {!isCanceled && (
          <div className="mt-4 border border-coco-100 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-coco-900 text-sm">
                Pagamentos ({payments.length})
              </h3>
              <button
                onClick={() => {
                  const rest = +(total - Number(sale.paid_amount)).toFixed(2);
                  setNewPay({
                    methodId: methods[0]?.id ?? "",
                    amount: rest > 0 ? rest : 0,
                    paidAtLocal: nowLocalIso(),
                    notes: "",
                  });
                  setPayErr(null);
                  setShowNewPayment(true);
                }}
                className="btn-secondary text-xs py-1"
              >
                + Lançar
              </button>
            </div>
            {payments.length === 0 ? (
              <p className="text-xs text-coco-600">
                Nenhum pagamento lançado.
              </p>
            ) : (
              <div className="space-y-1">
                {payments.map((p) => {
                  const m = methods.find((x) => x.id === p.payment_method_id);
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between text-sm border-b border-coco-50 py-1"
                    >
                      <div>
                        <span className="text-coco-700">
                          {fmtDate(p.paid_at)} · {m?.name ?? "?"}
                        </span>
                        {p.notes && (
                          <span className="text-coco-500 text-xs ml-2">
                            {p.notes}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <strong className="text-green-700">
                          {brl(Number(p.amount))}
                        </strong>
                        <button
                          onClick={() => setEditingPayment(p)}
                          className="btn-ghost text-xs px-1.5"
                          title="Editar"
                          aria-label="Editar pagamento"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => deletePayment(p)}
                          className="btn-ghost text-xs px-1.5 text-red-700"
                          title="Apagar"
                          aria-label="Apagar pagamento"
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

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

        {showNewPayment && (
          <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full">
              <h3 className="font-bold text-lg mb-3">Lançar pagamento</h3>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Forma</label>
                    <select
                      className="input"
                      value={newPay.methodId}
                      onChange={(e) =>
                        setNewPay({ ...newPay, methodId: e.target.value })
                      }
                    >
                      {methods.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Data</label>
                    <input
                      type="datetime-local"
                      className="input"
                      value={newPay.paidAtLocal}
                      onChange={(e) =>
                        setNewPay({ ...newPay, paidAtLocal: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Valor</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input text-2xl font-bold"
                    value={newPay.amount}
                    onChange={(e) =>
                      setNewPay({
                        ...newPay,
                        amount: parseFloat(e.target.value || "0"),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="label">Observação</label>
                  <input
                    className="input"
                    value={newPay.notes}
                    onChange={(e) =>
                      setNewPay({ ...newPay, notes: e.target.value })
                    }
                  />
                </div>
              </div>
              {payErr && (
                <p className="text-red-700 text-sm mt-3">{payErr}</p>
              )}
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setShowNewPayment(false)}
                  className="btn-ghost"
                >
                  Cancelar
                </button>
                <button onClick={addPayment} className="btn-primary">
                  Lançar
                </button>
              </div>
            </div>
          </div>
        )}

        {editingPayment && (
          <PaymentEditor
            payment={editingPayment}
            methods={methods}
            onClose={() => setEditingPayment(null)}
            onSaved={() => {
              setEditingPayment(null);
              loadPayments();
              onSaved();
            }}
          />
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
