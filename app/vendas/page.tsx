"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl } from "@/lib/format";
import type { Customer, PaymentMethod, ProductSettings } from "@/lib/types";
import PaymentModal from "@/components/PaymentModal";
import { useToast } from "@/components/Toast";
import { enqueueSale } from "@/lib/offlineQueue";

export default function VendasPage() {
  const supabase = createClient();
  const toast = useToast();
  const [settings, setSettings] = useState<ProductSettings | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);

  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [quantity, setQuantity] = useState<number>(1);
  const [discount, setDiscount] = useState<number>(0);
  const [customerId, setCustomerId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [savingSale, setSavingSale] = useState(false);

  const [openSaleId, setOpenSaleId] = useState<string | null>(null);
  const [openSaleTotal, setOpenSaleTotal] = useState<number>(0);
  const [openSaleHasCustomer, setOpenSaleHasCustomer] = useState<boolean>(false);
  const [customerBalance, setCustomerBalance] = useState<{
    open_balance: number;
    credit_limit: number | null;
  } | null>(null);

  const subtotal = useMemo(
    () => Number((unitPrice * quantity).toFixed(2)),
    [unitPrice, quantity]
  );
  const total = useMemo(
    () => Math.max(0, +(subtotal - (Number(discount) || 0)).toFixed(2)),
    [subtotal, discount]
  );

  async function loadData() {
    const [s, c, m] = await Promise.all([
      supabase.from("product_settings").select("*").limit(1).single(),
      supabase
        .from("customers")
        .select("*")
        .eq("active", true)
        .order("name"),
      supabase
        .from("payment_methods")
        .select("*")
        .eq("active", true)
        .order("name"),
    ]);
    if (s.data) {
      setSettings(s.data as ProductSettings);
      setUnitPrice(Number(s.data.unit_price));
    }
    setCustomers((c.data as Customer[]) ?? []);
    setMethods((m.data as PaymentMethod[]) ?? []);
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!customerId) {
      setCustomerBalance(null);
      return;
    }
    supabase
      .from("customer_balances")
      .select("open_balance, credit_limit")
      .eq("customer_id", customerId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setCustomerBalance(data as any);
      });
  }, [customerId, supabase]);

  async function finalizeSale() {
    if (quantity <= 0) return toast.error("Quantidade deve ser maior que zero.");
    if (unitPrice <= 0) return toast.error("Valor unitário inválido.");
    if (discount > subtotal) return toast.error("Desconto maior que o subtotal.");
    setSavingSale(true);
    try {
      const { data, error } = await supabase
        .from("sales")
        .insert({
          customer_id: customerId || null,
          quantity,
          unit_price: unitPrice,
          discount,
          total,
          notes: notes || null,
        })
        .select("*")
        .single();
      if (error) throw error;
      setOpenSaleId(data.id);
      setOpenSaleTotal(Number(data.total));
      setOpenSaleHasCustomer(!!data.customer_id);
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setSavingSale(false);
    }
  }

  async function lancarFiado() {
    if (!customerId) {
      return toast.error("Selecione um cliente para lançar como fiado.");
    }
    if (quantity <= 0) return toast.error("Quantidade deve ser maior que zero.");
    if (unitPrice <= 0) return toast.error("Valor unitário inválido.");
    setSavingSale(true);
    const payload = {
      customer_id: customerId,
      quantity,
      unit_price: unitPrice,
      discount,
      total,
      notes: notes ? `${notes} · fiado` : "fiado",
    };
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueueSale(payload);
        toast.warn(`Sem conexão — venda enfileirada (${brl(total)}).`);
        reset();
        return;
      }
      const { error } = await supabase.from("sales").insert(payload);
      if (error) throw error;
      toast.success(`Venda fiada de ${brl(total)} lançada.`);
      reset();
    } catch (e: any) {
      // tentou enviar mas falhou (provavelmente rede): enfileira
      try {
        await enqueueSale(payload);
        toast.warn(`Falhou online — venda enfileirada (${brl(total)}).`);
        reset();
      } catch {
        toast.error(e.message ?? String(e));
      }
    } finally {
      setSavingSale(false);
    }
  }

  function reset() {
    setQuantity(1);
    setDiscount(0);
    setCustomerId("");
    setNotes("");
    setOpenSaleId(null);
    setOpenSaleTotal(0);
    setOpenSaleHasCustomer(false);
    if (settings) setUnitPrice(Number(settings.unit_price));
  }

  function adjustQty(delta: number) {
    setQuantity((q) => Math.max(1, q + delta));
  }

  // Atalhos de teclado
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const isField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "+" && !isField) {
        adjustQty(1);
        e.preventDefault();
      } else if (e.key === "-" && !isField) {
        adjustQty(-1);
        e.preventDefault();
      } else if (e.key === "F2") {
        e.preventDefault();
        lancarFiado();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        finalizeSale();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantity, unitPrice, discount, customerId, notes]);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">Venda Rápida</h1>
          <p className="text-coco-600">
            {settings?.name ?? "Coco Verde"} · preço atual{" "}
            <strong>{brl(Number(settings?.unit_price ?? 0))}</strong>
          </p>
        </div>
        <div className="text-xs text-coco-600">
          Atalhos: + / − qtd · F2 fiado · Ctrl+Enter finalizar
        </div>
      </header>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-2 space-y-5">
          <div>
            <label className="label">Quantidade</label>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                className="btn-secondary text-2xl w-14 h-14"
                onClick={() => adjustQty(-1)}
                aria-label="Diminuir"
              >
                −
              </button>
              <input
                type="number"
                value={quantity}
                min={1}
                onChange={(e) => setQuantity(parseInt(e.target.value || "1"))}
                className="input text-3xl text-center font-bold h-14 w-32"
              />
              <button
                className="btn-secondary text-2xl w-14 h-14"
                onClick={() => adjustQty(1)}
                aria-label="Aumentar"
              >
                +
              </button>
              <div className="ml-auto flex flex-wrap gap-2">
                {[5, 10, 12, 24, 50].map((n) => (
                  <button
                    key={n}
                    onClick={() => setQuantity(n)}
                    className="btn-ghost px-3 py-2"
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="label">Valor unitário (R$)</label>
              <input
                type="number"
                step="0.01"
                value={unitPrice}
                onChange={(e) =>
                  setUnitPrice(parseFloat(e.target.value || "0"))
                }
                className="input text-xl font-semibold"
              />
            </div>
            <div>
              <label className="label">Desconto (R$)</label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={discount}
                onChange={(e) => setDiscount(parseFloat(e.target.value || "0"))}
                className="input text-xl font-semibold"
              />
            </div>
            <div>
              <label className="label">Cliente (opcional)</label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="input"
              >
                <option value="">— Consumidor —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Observação</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input"
              placeholder="Ex.: entrega na praia, troco para R$ 100…"
            />
          </div>

          {customerBalance && (
            <div className="flex items-center justify-between text-sm rounded-xl border border-coco-200 px-3 py-2 bg-coco-50">
              <span>
                Saldo em aberto deste cliente:{" "}
                <strong>{brl(Number(customerBalance.open_balance))}</strong>
                {customerBalance.credit_limit != null && (
                  <>
                    {" "}
                    · limite{" "}
                    <strong>{brl(Number(customerBalance.credit_limit))}</strong>
                  </>
                )}
              </span>
              {customerBalance.credit_limit != null &&
                Number(customerBalance.open_balance) + total >
                  Number(customerBalance.credit_limit) && (
                  <span className="text-amber-700 font-semibold">
                    ⚠ Esta venda fiada excede o limite
                  </span>
                )}
            </div>
          )}
        </div>

        <div className="card flex flex-col">
          <div className="text-coco-700 text-sm">Subtotal</div>
          <div className="text-2xl text-coco-800">{brl(subtotal)}</div>
          {discount > 0 && (
            <div className="text-amber-700 text-sm mt-1">
              − Desconto {brl(discount)}
            </div>
          )}
          <div className="text-coco-700 text-sm mt-3">Total</div>
          <div className="text-5xl font-extrabold text-coco-900 mb-3">
            {brl(total)}
          </div>
          <div className="text-coco-700 text-sm">
            {quantity} × {brl(unitPrice)}
          </div>

          <button
            onClick={finalizeSale}
            disabled={savingSale}
            className="btn-primary mt-auto text-lg py-4"
          >
            {savingSale ? "Salvando…" : "Finalizar Venda →"}
          </button>
          <button
            onClick={lancarFiado}
            disabled={savingSale || !customerId}
            className="btn-secondary mt-2"
            title={
              !customerId
                ? "Selecione um cliente para lançar como fiado"
                : "Lança a venda direto como fiado"
            }
          >
            📒 Lançar como Fiado (F2)
          </button>
          <button onClick={reset} className="btn-ghost mt-2">
            Limpar
          </button>
        </div>
      </div>

      {openSaleId && (
        <PaymentModal
          saleId={openSaleId}
          total={openSaleTotal}
          methods={methods}
          hasCustomer={openSaleHasCustomer}
          onClose={() => {
            reset();
          }}
        />
      )}
    </div>
  );
}
