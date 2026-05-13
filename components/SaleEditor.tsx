"use client";

import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "@/lib/ui";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import { isoToLocal, nowLocalIso } from "@/lib/datetime";
import type {
  Customer,
  PaymentMethod,
  Sale,
  SalePayment,
  SaleReturn,
  Seller,
} from "@/lib/types";
import { useToast } from "./Toast";
import { useTenant } from "@/lib/useTenant";
import PaymentEditor from "./PaymentEditor";
import SearchableSelect from "./SearchableSelect";

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
  const [confirmDeletePay, setConfirmDeletePay] = useState<SalePayment | null>(
    null
  );
  const [cargaStatus, setCargaStatus] = useState<string | null>(null);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [payments, setPayments] = useState<SalePayment[]>([]);
  const [returns, setReturns] = useState<SaleReturn[]>([]);
  const [showRefund, setShowRefund] = useState(false);
  const [refundQty, setRefundQty] = useState(0);
  const [refundReason, setRefundReason] = useState("");
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refundSaving, setRefundSaving] = useState(false);
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

  const loadPayments = useCallback(async () => {
    const { data } = await supabase
      .from("sale_payments")
      .select("*")
      .eq("sale_id", sale.id)
      .order("paid_at", { ascending: false });
    setPayments((data as SalePayment[]) ?? []);
  }, [sale.id, supabase]);
  const loadReturns = useCallback(async () => {
    const { data } = await supabase
      .from("sale_returns")
      .select("*")
      .eq("sale_id", sale.id)
      .order("returned_at", { ascending: false });
    setReturns((data as SaleReturn[]) ?? []);
  }, [sale.id, supabase]);
  useEffect(() => {
    loadPayments();
    loadReturns();
  }, [loadPayments, loadReturns]);

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
    const { error } = await supabase
      .from("sale_payments")
      .delete()
      .eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Pagamento removido.");
    setConfirmDeletePay(null);
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

  const totalReturnedQty = returns.reduce((s, r) => s + r.quantity, 0);
  const totalReturnedAmt = returns.reduce(
    (s, r) => s + Number(r.amount ?? 0),
    0
  );
  const remainingQty = sale.quantity - totalReturnedQty;

  async function confirmRefund() {
    setRefundError(null);
    if (refundQty <= 0)
      return setRefundError("Quantidade deve ser maior que zero.");
    if (refundQty > remainingQty)
      return setRefundError(
        `Devolução excede o saldo (${remainingQty} disponíveis).`
      );
    setRefundSaving(true);
    const { error } = await supabase.rpc("refund_sale", {
      p_sale_id: sale.id,
      p_quantity: refundQty,
      p_reason: refundReason.trim() || null,
    });
    setRefundSaving(false);
    if (error) return setRefundError(error.message);
    toast.success("Devolução registrada.");
    setShowRefund(false);
    setRefundQty(0);
    setRefundReason("");
    await loadReturns();
    onSaved();
  }

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
    } catch (e: unknown) {
      toast.error(errorMessage(e));
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
    } catch (e: unknown) {
      toast.error(errorMessage(e));
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
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card modal-card--lg modal-pad">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-coco-900">
            {isCanceled ? "Venda cancelada" : "Editar venda"}
          </h2>
          <button onClick={onClose} className="btn-ghost" aria-label="Fechar">
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
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                enterKeyHint="next"
                value={quantity}
                onChange={(e) =>
                  setQuantity(parseInt(e.target.value.replace(/[^0-9]/g, "") || "0"))
                }
                onFocus={(e) => e.target.select()}
                className="input"
                disabled={isCanceled}
              />
            </div>
            <div>
              <label className="label">Unitário</label>
              <input
                type="text"
                inputMode="decimal"
                enterKeyHint="next"
                value={unitPrice}
                onChange={(e) =>
                  setUnitPrice(parseFloat(e.target.value.replace(",", ".") || "0"))
                }
                onFocus={(e) => e.target.select()}
                className="input"
                disabled={isCanceled}
              />
            </div>
            <div>
              <label className="label">Desconto</label>
              <input
                type="text"
                inputMode="decimal"
                enterKeyHint="done"
                value={discount}
                onChange={(e) =>
                  setDiscount(parseFloat(e.target.value.replace(",", ".") || "0"))
                }
                onFocus={(e) => e.target.select()}
                className="input"
                disabled={isCanceled}
              />
            </div>
          </div>
          <div>
            <SearchableSelect
              label="Cliente"
              value={customerId}
              onChange={setCustomerId}
              items={customers.map((c) => ({
                id: c.id,
                label: c.name,
                sublabel: c.phone ?? undefined,
              }))}
              placeholder="— Consumidor —"
              disabled={isCanceled}
            />
          </div>
          <div>
            <SearchableSelect
              label={`Vendedor ${isAdmin ? "" : "(somente admin edita)"}`}
              value={sellerId}
              onChange={setSellerId}
              items={sellers.map((s) => ({
                id: s.id,
                label: s.name + (s.active ? "" : " (inativo)"),
              }))}
              placeholder="— Sem vendedor —"
              disabled={isCanceled || !isAdmin}
            />
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
                        {p.attachment_url && (
                          <a
                            href={p.attachment_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-coco-700 underline text-xs ml-2"
                            title="Comprovante anexado"
                          >
                            📎
                          </a>
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
                          onClick={() => setConfirmDeletePay(p)}
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

        {!isCanceled && isAdmin && (
          <div className="mt-4 border border-coco-100 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-coco-900 text-sm">
                Devoluções ({returns.length})
              </h3>
              {remainingQty > 0 && !lockedForOperator && (
                <button
                  onClick={() => {
                    setRefundQty(0);
                    setRefundReason("");
                    setRefundError(null);
                    setShowRefund(true);
                  }}
                  className="btn-secondary text-xs py-1"
                >
                  + Devolver
                </button>
              )}
            </div>
            {returns.length === 0 ? (
              <p className="text-xs text-coco-600">
                Nenhuma devolução. Saldo da venda: {sale.quantity} cocos.
              </p>
            ) : (
              <>
                <div className="space-y-1">
                  {returns.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between text-sm border-b border-coco-50 py-1"
                    >
                      <span>
                        <span className="text-coco-700">
                          {fmtDate(r.returned_at)} · {r.quantity} cocos
                        </span>
                        {r.reason && (
                          <span className="text-coco-500 text-xs ml-2">
                            {r.reason}
                          </span>
                        )}
                      </span>
                      <strong className="text-amber-700">
                        {brl(Number(r.amount))}
                      </strong>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-coco-600 mt-2">
                  Total devolvido: {totalReturnedQty} cocos ({brl(totalReturnedAmt)}).
                  Restante na venda: <strong>{remainingQty}</strong> cocos.
                  Cocos voltam pro estoque automaticamente; devolução de
                  dinheiro ao cliente é manual via /caixa.
                </p>
              </>
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
            <div className="flex flex-col sm:flex-row sm:justify-between gap-2 mt-5 sticky bottom-0 bg-white pt-2">
              <button
                onClick={() => setConfirmCancel(true)}
                disabled={saving}
                className="btn-danger btn-touch order-2 sm:order-1"
              >
                Cancelar venda
              </button>
              <div className="flex flex-col-reverse sm:flex-row gap-2 order-1 sm:order-2">
                <button
                  onClick={onClose}
                  className="btn-ghost btn-touch"
                  disabled={saving}
                >
                  Voltar
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="btn-primary btn-touch"
                >
                  {saving ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
            <button onClick={uncancelSale} className="btn-secondary btn-touch">
              Reverter cancelamento
            </button>
            <button onClick={onClose} className="btn-primary btn-touch">
              Fechar
            </button>
          </div>
        )}

        {showNewPayment && (
          <div className="modal-backdrop !z-[90]" role="dialog" aria-modal="true">
            <div className="modal-card modal-card--md modal-pad">
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
                    type="text"
                    inputMode="decimal"
                    enterKeyHint="done"
                    className="input text-2xl font-bold"
                    value={newPay.amount || ""}
                    onChange={(e) =>
                      setNewPay({
                        ...newPay,
                        amount: parseFloat(
                          e.target.value.replace(",", ".") || "0"
                        ),
                      })
                    }
                    onFocus={(e) => e.target.select()}
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
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-4">
                <button
                  onClick={() => setShowNewPayment(false)}
                  className="btn-ghost btn-touch"
                >
                  Cancelar
                </button>
                <button onClick={addPayment} className="btn-primary btn-touch">
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

        {showRefund && (
          <div className="modal-backdrop !z-[90]" role="dialog" aria-modal="true">
            <div className="modal-card modal-card--md modal-pad">
              <h3 className="font-bold text-lg mb-2">Devolver cocos</h3>
              <p className="text-sm text-coco-700 mb-3">
                Saldo disponível: <strong>{remainingQty}</strong> cocos.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="label">Quantidade a devolver</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    enterKeyHint="done"
                    className="input text-2xl font-bold text-center"
                    value={refundQty || ""}
                    onChange={(e) => {
                      const n = parseInt(
                        e.target.value.replace(/[^0-9]/g, "") || "0",
                        10
                      );
                      setRefundQty(Math.min(n, remainingQty));
                    }}
                    onFocus={(e) => e.target.select()}
                    autoFocus
                  />
                  {refundQty > 0 && (
                    <p className="text-xs text-coco-600 mt-1">
                      Valor proporcional: {brl(refundQty * Number(sale.unit_price))}
                    </p>
                  )}
                </div>
                <div>
                  <label className="label">Motivo (opcional)</label>
                  <input
                    className="input"
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    placeholder="Ex.: cocos quebrados, cliente não recebeu…"
                  />
                </div>
              </div>
              {refundError && (
                <p className="text-red-700 text-sm mt-3">{refundError}</p>
              )}
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
                <button
                  onClick={() => setShowRefund(false)}
                  className="btn-ghost btn-touch"
                  disabled={refundSaving}
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmRefund}
                  disabled={refundSaving || refundQty <= 0}
                  className="btn-primary btn-touch"
                >
                  {refundSaving ? "Salvando…" : "Confirmar devolução"}
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmCancel && (
          <div className="modal-backdrop !z-[90]" role="dialog" aria-modal="true">
            <div className="modal-card modal-card--md modal-pad">
              <h3 className="font-bold text-lg mb-2">Cancelar esta venda?</h3>
              <p className="text-sm text-coco-700 mb-4">
                Os pagamentos já lançados continuam no histórico, mas a venda
                não conta mais para o saldo do cliente nem para o financeiro
                como receita.
              </p>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <button
                  onClick={() => setConfirmCancel(false)}
                  className="btn-ghost btn-touch"
                >
                  Voltar
                </button>
                <button onClick={cancelSale} className="btn-danger btn-touch">
                  Sim, cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmDeletePay && (
          <div className="modal-backdrop !z-[90]" role="dialog" aria-modal="true">
            <div className="modal-card modal-card--md modal-pad">
              <h3 className="font-bold text-lg mb-2">Apagar pagamento?</h3>
              <p className="text-sm text-coco-700 mb-4">
                Pagamento de{" "}
                <strong>{brl(Number(confirmDeletePay.amount))}</strong> em{" "}
                {fmtDate(confirmDeletePay.paid_at)}. Esta ação não pode ser
                desfeita.
              </p>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <button
                  onClick={() => setConfirmDeletePay(null)}
                  className="btn-ghost btn-touch"
                >
                  Voltar
                </button>
                <button
                  onClick={() => deletePayment(confirmDeletePay)}
                  className="btn-danger btn-touch"
                >
                  Sim, apagar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
