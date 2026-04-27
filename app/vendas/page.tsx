"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl } from "@/lib/format";
import type { Customer, PaymentMethod, ProductSettings } from "@/lib/types";
import PaymentModal from "@/components/PaymentModal";

export default function VendasPage() {
  const supabase = createClient();
  const [settings, setSettings] = useState<ProductSettings | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);

  const [unitPrice, setUnitPrice] = useState<number>(0);
  const [quantity, setQuantity] = useState<number>(1);
  const [customerId, setCustomerId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [savingSale, setSavingSale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [openSaleId, setOpenSaleId] = useState<string | null>(null);
  const [openSaleTotal, setOpenSaleTotal] = useState<number>(0);

  const total = useMemo(
    () => Number((unitPrice * quantity).toFixed(2)),
    [unitPrice, quantity]
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

  async function finalizeSale() {
    setError(null);
    if (quantity <= 0) return setError("Quantidade deve ser maior que zero.");
    if (unitPrice <= 0) return setError("Valor unitário inválido.");
    setSavingSale(true);
    try {
      const { data, error } = await supabase
        .from("sales")
        .insert({
          customer_id: customerId || null,
          quantity,
          unit_price: unitPrice,
          total,
          notes: notes || null,
        })
        .select("*")
        .single();
      if (error) throw error;
      setOpenSaleId(data.id);
      setOpenSaleTotal(Number(data.total));
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSavingSale(false);
    }
  }

  function reset() {
    setQuantity(1);
    setCustomerId("");
    setNotes("");
    setOpenSaleId(null);
    setOpenSaleTotal(0);
    if (settings) setUnitPrice(Number(settings.unit_price));
  }

  function adjustQty(delta: number) {
    setQuantity((q) => Math.max(1, q + delta));
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">Venda Rápida</h1>
          <p className="text-coco-600">
            {settings?.name ?? "Coco Verde"} · preço atual{" "}
            <strong>{brl(Number(settings?.unit_price ?? 0))}</strong>
          </p>
        </div>
      </header>

      {error && (
        <div className="card border-red-300 bg-red-50 text-red-700">
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-2 space-y-5">
          <div>
            <label className="label">Quantidade</label>
            <div className="flex items-center gap-3">
              <button
                className="btn-secondary text-2xl w-14 h-14"
                onClick={() => adjustQty(-1)}
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

          <div className="grid sm:grid-cols-2 gap-4">
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
              <p className="text-xs text-coco-600 mt-1">
                Pode ser ajustado pelo operador antes de finalizar.
              </p>
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
              <p className="text-xs text-coco-600 mt-1">
                Selecione um cliente cadastrado para vendas a prazo.
              </p>
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
        </div>

        <div className="card flex flex-col">
          <div className="text-coco-700 text-sm">Total</div>
          <div className="text-5xl font-extrabold text-coco-900 my-3">
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
          onClose={() => {
            reset();
          }}
        />
      )}
    </div>
  );
}
