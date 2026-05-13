"use client";

import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/lib/ui";
import Link from "next/link";
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

const QTY_SHORTCUTS = [5, 10, 20, 50];

export default function VendasPage() {
  const supabase = createClient();
  const toast = useToast();
  const { seller: mySeller, isAdmin } = useTenant();
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

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) ?? null,
    [customers, customerId]
  );

  const priceChanged = useMemo(() => {
    if (!settings) return false;
    return Math.abs(unitPrice - Number(settings.unit_price)) > 0.001;
  }, [unitPrice, settings]);

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

  function stepQty(delta: number) {
    setQuantity((cur) => {
      const n = parseInt(cur || "0", 10) || 0;
      return String(Math.max(0, n + delta));
    });
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

  const finalizeLabel = savingSale ? "Salvando…" : "Finalizar →";

  return (
    // pb-40 garante que o conteúdo não fica embaixo do bottom-bar fixo
    <div className="space-y-4 pb-40 lg:pb-6">
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
          <h1 className="text-2xl sm:text-3xl font-bold text-coco-900">Venda Rápida</h1>
          <p className="text-coco-600 text-sm hidden sm:block">
            {settings?.name ?? "Coco Verde"} · preço atual{" "}
            <strong>{brl(Number(settings?.unit_price ?? 0))}</strong>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="btn-ghost text-sm"
            aria-label="Limpar formulário"
          >
            ↺ Limpar
          </button>
          {isAdmin && (
            <Link
              href="/vendas/importar"
              className="btn-secondary text-sm hidden md:inline-flex"
            >
              📥 Importar
            </Link>
          )}
          <div className="text-xs text-coco-600 hidden lg:block">
            F2 fiado · Ctrl+Enter finalizar
          </div>
        </div>
      </header>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-2 space-y-4">
          {/* Stepper de quantidade — o protagonista da Venda Rápida */}
          <div>
            <label className="label">Quantidade</label>
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => stepQty(-1)}
                disabled={qty <= 0}
                aria-label="Diminuir quantidade"
                className="rounded-xl bg-coco-100 text-coco-800 hover:bg-coco-200 active:scale-[.97] transition disabled:opacity-30 disabled:cursor-not-allowed w-16 min-h-[64px] text-3xl font-bold flex items-center justify-center"
              >
                −
              </button>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                enterKeyHint="next"
                value={quantity}
                onChange={(e) =>
                  setQuantity(e.target.value.replace(/[^0-9]/g, ""))
                }
                onFocus={selectOnFocus}
                placeholder="0"
                autoFocus
                className="input text-4xl text-center font-bold flex-1 min-h-[64px]"
              />
              <button
                type="button"
                onClick={() => stepQty(+1)}
                aria-label="Aumentar quantidade"
                className="rounded-xl bg-coco-600 text-white hover:bg-coco-700 active:scale-[.97] transition w-16 min-h-[64px] text-3xl font-bold flex items-center justify-center"
              >
                ＋
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {QTY_SHORTCUTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setQuantity(String(n))}
                  className="rounded-full border border-coco-200 px-3 py-1 text-sm text-coco-700 hover:bg-coco-50 active:scale-[.97] transition"
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Vendedor — sempre visível, obrigatório */}
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

          {/* Disclosures pra reduzir poluição visual no caso comum */}
          <details className="rounded-xl border border-coco-100 bg-coco-50/40 px-3 group">
            <summary className="cursor-pointer select-none text-coco-700 py-3 flex items-center justify-between list-none">
              <span>
                💰 Preço e desconto
                {priceChanged && (
                  <span className="ml-2 text-xs font-semibold text-amber-700">
                    (preço alterado)
                  </span>
                )}
                {discount > 0 && (
                  <span className="ml-2 text-xs font-semibold text-amber-700">
                    (desconto {brl(discount)})
                  </span>
                )}
              </span>
              <span className="text-coco-500 group-open:rotate-180 transition" aria-hidden>
                ▾
              </span>
            </summary>
            <div className="grid sm:grid-cols-2 gap-3 pb-3 pt-1">
              <div>
                <label className="label">Valor unitário (R$)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  enterKeyHint="next"
                  value={unitPriceStr}
                  onChange={(e) =>
                    setUnitPriceStr(e.target.value.replace(/[^0-9.,]/g, ""))
                  }
                  onFocus={selectOnFocus}
                  className="input text-xl font-semibold"
                />
              </div>
              <div>
                <label className="label">Desconto (R$)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  enterKeyHint="done"
                  value={discountStr}
                  onChange={(e) =>
                    setDiscountStr(e.target.value.replace(/[^0-9.,]/g, ""))
                  }
                  onFocus={selectOnFocus}
                  className="input text-xl font-semibold"
                />
              </div>
            </div>
          </details>

          <details
            className="rounded-xl border border-coco-100 bg-coco-50/40 px-3 group"
            open={!!customerId}
          >
            <summary className="cursor-pointer select-none text-coco-700 py-3 flex items-center justify-between list-none">
              <span>
                👤 Cliente{" "}
                {selectedCustomer ? (
                  <strong className="text-coco-900">— {selectedCustomer.name}</strong>
                ) : (
                  <span className="text-coco-500">(Consumidor)</span>
                )}
              </span>
              <span className="text-coco-500 group-open:rotate-180 transition" aria-hidden>
                ▾
              </span>
            </summary>
            <div className="pb-3 pt-1 space-y-2">
              <SearchableSelect
                value={customerId}
                onChange={setCustomerId}
                items={customers.map((c) => ({
                  id: c.id,
                  label: c.name,
                  sublabel: c.phone ?? undefined,
                }))}
                placeholder="— Consumidor —"
              />
              {customerBalance && (
                <div className="flex items-center justify-between text-sm rounded-xl border border-coco-200 px-3 py-2 bg-white">
                  <span>
                    Saldo em aberto:{" "}
                    <strong>{brl(Number(customerBalance.open_balance))}</strong>
                    {customerBalance.credit_limit != null && (
                      <>
                        {" "}· limite{" "}
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
                        ⚠ excede limite
                      </span>
                    )}
                </div>
              )}
            </div>
          </details>

          <details className="rounded-xl border border-coco-100 bg-coco-50/40 px-3 group">
            <summary className="cursor-pointer select-none text-coco-700 py-3 flex items-center justify-between list-none">
              <span>
                📅 Data e observação
                {notes && (
                  <span className="ml-2 text-xs text-coco-600">
                    · &ldquo;{notes.length > 20 ? notes.slice(0, 20) + "…" : notes}&rdquo;
                  </span>
                )}
              </span>
              <span className="text-coco-500 group-open:rotate-180 transition" aria-hidden>
                ▾
              </span>
            </summary>
            <div className="grid sm:grid-cols-2 gap-3 pb-3 pt-1">
              <div>
                <label className="label">Data da venda</label>
                <input
                  type="datetime-local"
                  value={saleDate}
                  onChange={(e) => setSaleDate(e.target.value)}
                  className="input"
                />
                <p className="text-xs text-coco-600 mt-1">
                  Padrão: agora. Pode registrar uma venda passada.
                </p>
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
          </details>
        </div>

        {/* Resumo lateral — só desktop. No mobile, a bottom-bar fixa cumpre esse papel. */}
        <div className="card hidden lg:flex flex-col">
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
            {finalizeLabel}
          </button>
          <button
            onClick={lancarFiado}
            disabled={savingSale}
            className="btn-secondary btn-touch mt-2"
            title={
              !customerId
                ? "Selecione um cliente abaixo para lançar como fiado"
                : "Lança a venda direto como fiado"
            }
          >
            📒 Lançar como Fiado
          </button>
        </div>
      </div>

      {/* Bottom-bar sticky — atalho de finalização no mobile/tablet */}
      <div
        className="lg:hidden fixed inset-x-0 bottom-0 z-30 bg-white border-t border-coco-200 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="px-4 pt-3 pb-3 max-w-7xl mx-auto">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-xs text-coco-600 truncate">
              {qty || 0} × {brl(unitPrice)}
              {discount > 0 ? ` − ${brl(discount)}` : ""}
            </div>
            <div className="text-2xl font-extrabold text-coco-900">
              {brl(total)}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={lancarFiado}
              disabled={savingSale}
              className="btn-secondary btn-touch flex-1"
              aria-label="Lançar como fiado"
            >
              📒 Fiado
            </button>
            <button
              onClick={finalizeSale}
              disabled={savingSale}
              className="btn-primary btn-touch flex-[2]"
            >
              {finalizeLabel}
            </button>
          </div>
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
