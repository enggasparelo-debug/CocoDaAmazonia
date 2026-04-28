"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { brl } from "@/lib/format";
import type { Customer, PaymentMethod, ProductSettings } from "@/lib/types";
import PaymentModal from "@/components/PaymentModal";
import CustomerQuickForm from "@/components/CustomerQuickForm";
import { useToast } from "@/components/Toast";

function parseBrNumber(s: string): number {
  if (!s) return 0;
  const norm = s.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(norm);
  return isNaN(n) ? 0 : n;
}

function fmtBrNumber(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

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

  async function loadData() {
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
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("sales")
        .insert({
          customer_id: customerId || null,
          quantity: qty,
          unit_price: unitPrice,
          discount: 0,
          total,
          notes: notes || null,
          carga_id: cargaId,
        })
        .select("*")
        .single();
      if (error) throw error;
      setOpenSale({
        id: data.id,
        total: Number(data.total),
        hasCustomer: !!data.customer_id,
      });
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-4">
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
          <label className="label">Cliente</label>
          <div className="flex gap-2">
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="input flex-1"
            >
              <option value="">— Consumidor —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-secondary whitespace-nowrap"
              onClick={() => {
                setRequireDocs(false);
                setShowCustomerForm(true);
              }}
            >
              + Novo
            </button>
          </div>
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
          className="btn-primary w-full text-lg py-4"
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
