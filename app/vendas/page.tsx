"use client";

import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/lib/ui";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtBrNumber, parseBrNumber } from "@/lib/format";
import { nowLocalIso } from "@/lib/datetime";
import type {
  Customer,
  PaymentMethod,
  ProductSettings,
  Seller,
} from "@/lib/types";
import PaymentModal from "@/components/PaymentModal";
import { useToast } from "@/components/Toast";
import { enqueueSale } from "@/lib/offlineQueue";
import { useTenant } from "@/lib/useTenant";
import { useOnline } from "@/lib/useOnline";
import SearchableSelect from "@/components/SearchableSelect";

export default function VendasPage() {
  const supabase = createClient();
  const toast = useToast();
  const { seller: mySeller } = useTenant();
  const online = useOnline();
  const [settings, setSettings] = useState<ProductSettings | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);

  const [quantity, setQuantity] = useState<string>("");
  const [unitPriceStr, setUnitPriceStr] = useState<string>("");
  const [discountStr, setDiscountStr] = useState<string>("0");
  const [customerId, setCustomerId] = useState<string>("");
  const [sellerId, setSellerId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [saleDate, setSaleDate] = useState<string>(nowLocalIso());
  const [savingSale, setSavingSale] = useState(false);

  const [openSaleId, setOpenSaleId] = useState<string | null>(null);
  const [openSaleTotal, setOpenSaleTotal] = useState<number>(0);
  const [openSaleHasCustomer, setOpenSaleHasCustomer] = useState<boolean>(false);
  const [customerBalance, setCustomerBalance] = useState<{
    open_balance: number;
    credit_limit: number | null;
  } | null>(null);

  const qty = useMemo(() => {
    const n = parseInt(quantity || "0", 10);
    return isNaN(n) ? 0 : n;
  }, [quantity]);

  const unitPrice = useMemo(() => parseBrNumber(unitPriceStr), [unitPriceStr]);
  const discount = useMemo(() => parseBrNumber(discountStr), [discountStr]);

  const subtotal = useMemo(
    () => Number((qty * unitPrice).toFixed(2)),
    [qty, unitPrice]
  );
  const total = useMemo(
    () => Math.max(0, +(subtotal - discount).toFixed(2)),
    [subtotal, discount]
  );

  async function loadData() {
    const [s, c, m, sl] = await Promise.all([
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
      supabase
        .from("sellers")
        .select("*")
        .eq("active", true)
        .order("name"),
    ]);
    if (s.data) {
      setSettings(s.data as ProductSettings);
      // só seta o preço unitário inicial se ainda não foi tocado
      setUnitPriceStr((cur) => cur || fmtBrNumber(Number(s.data.unit_price)));
    }
    setCustomers((c.data as Customer[]) ?? []);
    setMethods((m.data as PaymentMethod[]) ?? []);
    setSellers((sl.data as Seller[]) ?? []);
  }

  useEffect(() => {
    loadData();
  }, []);

  // Pré-seleciona o seller do admin logado, se houver vínculo
  useEffect(() => {
    if (mySeller && !sellerId) setSellerId(mySeller.id);
  }, [mySeller, sellerId]);

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
        if (data)
          setCustomerBalance(
            data as { open_balance: number; credit_limit: number | null }
          );
      });
  }, [customerId, supabase]);

  function buildPayload() {
    return {
      customer_id: customerId || null,
      seller_id: sellerId,
      quantity: qty,
      unit_price: unitPrice,
      discount,
      total,
      notes: notes || null,
      created_at: new Date(saleDate).toISOString(),
    };
  }

  function validate(): string | null {
    if (qty <= 0) return "Informe a quantidade.";
    if (unitPrice <= 0) return "Informe o valor unitário.";
    if (discount > subtotal) return "Desconto maior que o subtotal.";
    if (!sellerId) return "Selecione um vendedor.";
    if (!saleDate) return "Informe a data da venda.";
    if (new Date(saleDate).getTime() > Date.now() + 60_000)
      return "A data da venda não pode ser no futuro.";
    return null;
  }

  async function finalizeSale() {
    const err = validate();
    if (err) return toast.error(err);
    setSavingSale(true);
    const payload = buildPayload();
    try {
      // Sem internet: enfileira como aberta e abre comprovante "vai sincronizar".
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueueSale(payload);
        toast.warn(
          `Sem conexão — venda de ${brl(total)} salva e será sincronizada.`
        );
        reset();
        return;
      }
      const { data, error } = await supabase
        .from("sales")
        .insert(payload)
        .select("*")
        .single();
      if (error) throw error;
      setOpenSaleId(data.id);
      setOpenSaleTotal(Number(data.total));
      setOpenSaleHasCustomer(!!data.customer_id);
    } catch (e: unknown) {
      // Fallback: se falhou online, salva offline pra não perder a venda.
      try {
        await enqueueSale(payload);
        toast.warn(
          `Falhou online — venda de ${brl(total)} enfileirada. Tente novamente.`
        );
        reset();
      } catch {
        toast.error(errorMessage(e));
      }
    } finally {
      setSavingSale(false);
    }
  }

  async function lancarFiado() {
    if (!customerId)
      return toast.error("Selecione um cliente para lançar como fiado.");
    const err = validate();
    if (err) return toast.error(err);
    setSavingSale(true);
    const payload = {
      ...buildPayload(),
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
    } catch (e: unknown) {
      try {
        await enqueueSale(payload);
        toast.warn(`Falhou online — venda enfileirada (${brl(total)}).`);
        reset();
      } catch {
        toast.error(errorMessage(e));
      }
    } finally {
      setSavingSale(false);
    }
  }

  function reset() {
    setQuantity("");
    setDiscountStr("0");
    setCustomerId("");
    setNotes("");
    setOpenSaleId(null);
    setOpenSaleTotal(0);
    setOpenSaleHasCustomer(false);
    setSaleDate(nowLocalIso());
    setSellerId(mySeller?.id ?? "");
    if (settings) setUnitPriceStr(fmtBrNumber(Number(settings.unit_price)));
  }

  // Atalhos de teclado (apenas em desktop / fora dos inputs)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F2") {
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
  }, [quantity, unitPriceStr, discountStr, customerId, notes, saleDate]);

  const selectOnFocus = (e: React.FocusEvent<HTMLInputElement>) =>
    e.target.select();

  return (
    <div className="space-y-6">
      {!online && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-3 flex items-center gap-2">
          <span className="text-xl" aria-hidden>📡</span>
          <div className="text-sm">
            <strong>Sem internet.</strong> Vendas que você finalizar agora ficam
            salvas no celular e sincronizam quando a conexão voltar.
          </div>
        </div>
      )}
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">Venda Rápida</h1>
          <p className="text-coco-600">
            {settings?.name ?? "Coco Verde"} · preço atual{" "}
            <strong>{brl(Number(settings?.unit_price ?? 0))}</strong>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-coco-600 hidden sm:block">
            Atalhos: F2 fiado · Ctrl+Enter finalizar
          </div>
        </div>
      </header>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-2 space-y-5">
          <div>
            <label className="label">Quantidade</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={quantity}
              onChange={(e) =>
                setQuantity(e.target.value.replace(/[^0-9]/g, ""))
              }
              onFocus={selectOnFocus}
              placeholder="0"
              autoFocus
              className="input text-4xl text-center font-bold h-16"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Valor unitário (R$)</label>
              <input
                type="text"
                inputMode="decimal"
                value={unitPriceStr}
                onChange={(e) =>
                  setUnitPriceStr(e.target.value.replace(/[^0-9.,]/g, ""))
                }
                onFocus={selectOnFocus}
                className="input text-2xl font-semibold"
              />
            </div>
            <div>
              <label className="label">Desconto (R$)</label>
              <input
                type="text"
                inputMode="decimal"
                value={discountStr}
                onChange={(e) =>
                  setDiscountStr(e.target.value.replace(/[^0-9.,]/g, ""))
                }
                onFocus={selectOnFocus}
                className="input text-2xl font-semibold"
              />
            </div>
          </div>

          <div>
            <SearchableSelect
              label="Vendedor"
              required
              value={sellerId}
              onChange={setSellerId}
              items={sellers.map((s) => ({ id: s.id, label: s.name }))}
              placeholder="— Selecione —"
              allowClear={false}
            />
            {sellers.length === 0 && (
              <p className="text-xs text-amber-700 mt-1">
                Nenhum vendedor ativo. Cadastre em Configurações → Vendedores.
              </p>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Data da venda</label>
              <input
                type="datetime-local"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
                className="input"
              />
              <p className="text-xs text-coco-600 mt-1">
                Padrão: agora. Pode ajustar para registrar uma venda passada.
              </p>
            </div>
            <div>
              <SearchableSelect
                label="Cliente (opcional)"
                value={customerId}
                onChange={setCustomerId}
                items={customers.map((c) => ({
                  id: c.id,
                  label: c.name,
                  sublabel: c.phone ?? undefined,
                }))}
                placeholder="— Consumidor —"
              />
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
                    <strong>
                      {brl(Number(customerBalance.credit_limit))}
                    </strong>
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
            {qty || 0} × {brl(unitPrice)}
          </div>

          <button
            onClick={finalizeSale}
            disabled={savingSale}
            className="btn-primary btn-touch mt-auto"
          >
            {savingSale ? "Salvando…" : "Finalizar Venda →"}
          </button>
          <button
            onClick={lancarFiado}
            disabled={savingSale || !customerId}
            className="btn-secondary btn-touch mt-2"
            title={
              !customerId
                ? "Selecione um cliente para lançar como fiado"
                : "Lança a venda direto como fiado"
            }
          >
            📒 Lançar como Fiado
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
