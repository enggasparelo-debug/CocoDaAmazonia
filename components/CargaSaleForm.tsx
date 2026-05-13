"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/lib/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtBrNumber, parseBrNumber } from "@/lib/format";
import type { Customer, PaymentMethod, ProductSettings } from "@/lib/types";
import PaymentModal from "@/components/PaymentModal";
import CustomerQuickForm from "@/components/CustomerQuickForm";
import { useToast } from "@/components/Toast";
import { useTenant } from "@/lib/useTenant";
import { useOnline } from "@/lib/useOnline";
import { enqueueSale } from "@/lib/offlineQueue";
import SearchableSelect from "@/components/SearchableSelect";

export default function CargaSaleForm({
  cargaId,
  onSaved,
}: {
  cargaId: string;
  onSaved?: () => void;
}) {
  const supabase = createClient();
  const toast = useToast();
  const router = useRouter();
  const { seller, isAdmin, loading: tLoading } = useTenant();
  const online = useOnline();
  const [settings, setSettings] = useState<ProductSettings | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);

  const [quantity, setQuantity] = useState<string>("");
  const [unitPriceStr, setUnitPriceStr] = useState<string>("");
  const [customerId, setCustomerId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [requireDocs, setRequireDocs] = useState(false);

  const [openSale, setOpenSale] = useState<{
    id: string;
    total: number;
    hasCustomer: boolean;
  } | null>(null);

  const qty = useMemo(() => {
    const n = parseInt(quantity || "0", 10);
    return isNaN(n) ? 0 : n;
  }, [quantity]);

  const unitPrice = useMemo(() => parseBrNumber(unitPriceStr), [unitPriceStr]);
  const total = useMemo(
    () => Number((qty * unitPrice).toFixed(2)),
    [qty, unitPrice]
  );

  const loadData = useCallback(async () => {
    const [s, c, m] = await Promise.all([
      supabase.from("product_settings").select("*").limit(1).maybeSingle(),
      supabase.from("customers").select("*").eq("active", true).order("name"),
      supabase
        .from("payment_methods")
        .select("*")
        .eq("active", true)
        .order("name"),
    ]);
    if (s.data) {
      setSettings(s.data as ProductSettings);
      setUnitPriceStr((cur) => cur || fmtBrNumber(Number(s.data.unit_price)));
    }
    setCustomers((c.data as Customer[]) ?? []);
    setMethods((m.data as PaymentMethod[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function reset() {
    setQuantity("");
    setNotes("");
    setCustomerId("");
    setOpenSale(null);
    if (settings) setUnitPriceStr(fmtBrNumber(Number(settings.unit_price)));
  }

  async function finalize() {
    if (qty <= 0) return toast.error("Informe a quantidade.");
    if (unitPrice <= 0) return toast.error("Informe o valor unitário.");
    if (!seller) return toast.error("Vendedor não vinculado ao seu login.");
    setSaving(true);
    const payload = {
      customer_id: customerId || null,
      quantity: qty,
      unit_price: unitPrice,
      discount: 0,
      total,
      notes: notes || null,
      carga_id: cargaId,
      seller_id: seller.id,
    };
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueueSale(payload);
        toast.warn(
          `Sem conexão — venda de ${brl(total)} salva e será sincronizada.`
        );
        reset();
        onSaved?.();
        return;
      }
      const { data, error } = await supabase
        .from("sales")
        .insert(payload)
        .select("*")
        .single();
      if (error) throw error;
      setOpenSale({
        id: data.id,
        total: Number(data.total),
        hasCustomer: !!data.customer_id,
      });
    } catch (e: unknown) {
      try {
        await enqueueSale(payload);
        toast.warn(
          `Falhou online — venda de ${brl(total)} enfileirada.`
        );
        reset();
        onSaved?.();
      } catch {
        toast.error(errorMessage(e));
      }
    } finally {
      setSaving(false);
    }
  }

  if (!tLoading && !seller) {
    return (
      <div className="card border-amber-300 bg-amber-50 text-amber-900 space-y-2">
        <div className="font-bold">Sem vendedor vinculado</div>
        <p className="text-sm">
          Você ainda não está cadastrado como vendedor. Peça a um admin pra
          criar seu vendedor em <strong>Configurações → Vendedores</strong> e
          vincular ao seu login.
        </p>
        {isAdmin && (
          <Link
            href="/configuracoes/vendedores"
            className="btn-secondary inline-block mt-2"
          >
            Ir pra Vendedores
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!online && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-2 text-sm flex items-center gap-2">
          <span aria-hidden>📡</span>
          Sem internet — vendas ficam salvas e sincronizam depois.
        </div>
      )}
      <div className="card space-y-4">
        {seller && (
          <div className="text-xs text-coco-700">
            Vendedor: <strong>{seller.name}</strong>
          </div>
        )}
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
            placeholder="0"
            className="input text-4xl text-center font-bold h-16"
            autoFocus
          />
          <div className="flex gap-2 mt-2 flex-wrap">
            {[10, 50, 100, 200, 500].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  const cur = parseInt(quantity || "0", 10);
                  setQuantity(String(cur + n));
                }}
                className="btn-ghost text-base px-4 min-h-[44px]"
                aria-label={`Adicionar ${n} cocos`}
              >
                +{n}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setQuantity("")}
              className="btn-ghost text-base px-4 min-h-[44px] text-red-700 ml-auto"
              aria-label="Limpar quantidade"
            >
              limpar
            </button>
          </div>
        </div>

        <div>
          <label className="label">Valor unitário (R$)</label>
          <input
            type="text"
            inputMode="decimal"
            value={unitPriceStr}
            onChange={(e) =>
              setUnitPriceStr(e.target.value.replace(/[^0-9.,]/g, ""))
            }
            className="input text-2xl font-semibold"
          />
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
            prepend={{
              label: "Novo cliente",
              icon: "＋",
              onSelect: () => {
                setRequireDocs(false);
                setShowCustomerForm(true);
              },
            }}
          />
          <p className="text-xs text-coco-600 mt-1">
            Para venda fiado é obrigatório selecionar um cliente.
          </p>
        </div>

        <div>
          <label className="label">Observação</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input"
            placeholder="Ex.: entrega na praia…"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="card !p-3">
            <div className="text-xs text-coco-700">Quantidade</div>
            <div className="text-lg font-bold">{qty} cocos</div>
          </div>
          <div className="card !p-3 bg-coco-600 text-white border-coco-600">
            <div className="text-xs text-coco-100">Total</div>
            <div className="text-2xl font-bold">{brl(total)}</div>
          </div>
        </div>

        <button
          onClick={finalize}
          disabled={saving || qty <= 0 || unitPrice <= 0}
          className="btn-primary btn-touch w-full"
        >
          {saving ? "Salvando…" : "Finalizar venda →"}
        </button>
      </div>

      {openSale && (
        <PaymentModal
          saleId={openSale.id}
          total={openSale.total}
          methods={methods}
          hasCustomer={openSale.hasCustomer}
          onClose={() => {
            // Se sobrou fiado, vai pra promissória
            (async () => {
              const { data: s } = await supabase
                .from("sales")
                .select("total, paid_amount")
                .eq("id", openSale.id)
                .single();
              const remaining =
                Number(s?.total ?? 0) - Number(s?.paid_amount ?? 0);
              const saleId = openSale.id;
              reset();
              if (remaining > 0.001) {
                router.push(`/carga/promissoria/${saleId}`);
              } else {
                onSaved?.();
                router.refresh();
              }
            })();
          }}
        />
      )}

      {showCustomerForm && (
        <CustomerQuickForm
          requireDocsForCredit={requireDocs}
          onClose={() => setShowCustomerForm(false)}
          onCreated={(c) => {
            setCustomers((arr) => [...arr, c].sort((a, b) => a.name.localeCompare(b.name)));
            setCustomerId(c.id);
            setShowCustomerForm(false);
          }}
        />
      )}
    </div>
  );
}
