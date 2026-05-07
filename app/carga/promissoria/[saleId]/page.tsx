"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import type {
  Sale,
  Customer,
  Tenant,
  FiadoPromissoria,
} from "@/lib/types";
import SignaturePad from "@/components/SignaturePad";
import { useToast } from "@/components/Toast";

export default function PromissoriaPage() {
  const supabase = createClient();
  const params = useParams<{ saleId: string }>();
  const saleId = params.saleId;
  const toast = useToast();

  const [sale, setSale] = useState<Sale | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [existing, setExisting] = useState<FiadoPromissoria | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [sQ, pQ] = await Promise.all([
      supabase.from("sales").select("*").eq("id", saleId).maybeSingle(),
      supabase
        .from("fiado_promissorias")
        .select("*")
        .eq("sale_id", saleId)
        .maybeSingle(),
    ]);
    const s = (sQ.data as Sale | null) ?? null;
    setSale(s);
    setExisting((pQ.data as FiadoPromissoria | null) ?? null);
    if (s?.customer_id) {
      const { data: c } = await supabase
        .from("customers")
        .select("*")
        .eq("id", s.customer_id)
        .maybeSingle();
      setCustomer((c as Customer | null) ?? null);
    }
    if (s?.tenant_id) {
      const { data: t } = await supabase
        .from("tenants")
        .select("*")
        .eq("id", s.tenant_id)
        .maybeSingle();
      setTenant((t as Tenant | null) ?? null);
    }
  }, [saleId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  if (!sale) {
    return <div className="p-6 text-coco-700">Carregando…</div>;
  }

  const remaining = Number(sale.total) - Number(sale.paid_amount);

  if (!customer) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <p className="text-red-700 mb-4">
          Esta venda não tem cliente vinculado. Não é possível emitir promissória.
        </p>
        <Link href="/carga" className="btn-primary inline-block">
          Voltar
        </Link>
      </div>
    );
  }

  if (remaining <= 0) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <p className="text-coco-700 mb-4">
          Esta venda já está paga. Sem fiado em aberto para promissória.
        </p>
        <Link href="/carga" className="btn-primary inline-block">
          Voltar
        </Link>
      </div>
    );
  }

  async function sign(dataUrl: string) {
    if (!sale || !customer) return;
    if (!customer.document?.trim() || !customer.address?.trim()) {
      setErr(
        "Cliente sem CPF ou endereço. Edite o cadastro antes de emitir a promissória."
      );
      return;
    }
    setSaving(true);
    setErr(null);
    const { data, error } = await supabase
      .from("fiado_promissorias")
      .insert({
        sale_id: sale.id,
        carga_id: sale.carga_id ?? null,
        signer_name: customer.name,
        signer_document: customer.document,
        signer_address: customer.address,
        signature_data_url: dataUrl,
        amount: remaining,
      })
      .select("*")
      .single();
    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setExisting(data as FiadoPromissoria);
    toast.success("Promissória assinada.");
  }

  return (
    <div className="min-h-screen bg-white text-coco-900 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-4 print:hidden">
          <Link href="/carga" className="text-coco-700 underline text-sm">
            ← Voltar
          </Link>
          {existing && (
            <button onClick={() => window.print()} className="btn-primary">
              🖨 Imprimir
            </button>
          )}
        </div>

        <div className="border border-coco-300 rounded-2xl p-6 print:border-0">
          <div className="text-center mb-4">
            <div className="text-3xl">📜</div>
            <h1 className="text-2xl font-bold">Nota Promissória</h1>
            <p className="text-xs text-coco-700">
              {tenant?.name ?? "Coco da Amazônia"}
            </p>
          </div>

          <p className="text-sm leading-relaxed mb-4">
            Aos <strong>{fmtDate(sale.created_at)}</strong>, eu,{" "}
            <strong>{customer.name}</strong>
            {customer.document && (
              <>
                , portador(a) do CPF <strong>{customer.document}</strong>
              </>
            )}
            {customer.address && (
              <>
                , residente em <strong>{customer.address}</strong>
              </>
            )}
            , declaro dever a <strong>{tenant?.name ?? "Coco da Amazônia"}</strong>{" "}
            a quantia de{" "}
            <strong className="text-lg">{brl(remaining)}</strong>, referente à
            compra de <strong>{sale.quantity} cocos verdes</strong> a{" "}
            {brl(Number(sale.unit_price))} cada (venda nº {sale.code}).
            Comprometo-me a quitar este valor conforme combinado verbalmente.
          </p>

          <div className="text-xs space-y-1 border-t border-coco-200 pt-3 mb-4">
            <div>
              Venda: {sale.quantity} × {brl(Number(sale.unit_price))} ={" "}
              {brl(Number(sale.total))}
            </div>
            {Number(sale.paid_amount) > 0 && (
              <div>Recebido na entrega: {brl(Number(sale.paid_amount))}</div>
            )}
            <div className="font-bold">A pagar: {brl(remaining)}</div>
          </div>

          <div className="mt-8">
            <p className="text-xs text-coco-700 mb-1">
              Assinatura do(a) devedor(a):
            </p>

            {existing ? (
              <div className="space-y-2">
                <img
                  src={existing.signature_data_url}
                  alt="Assinatura"
                  className="border border-coco-200 rounded bg-white max-w-full"
                />
                <p className="text-xs text-coco-600">
                  Assinada em {fmtDate(existing.signed_at)}.
                </p>
              </div>
            ) : (
              <>
                <SignaturePad onSign={sign} />
                {err && (
                  <p className="text-red-700 text-sm mt-2 bg-red-50 border border-red-200 p-2 rounded print:hidden">
                    {err}
                  </p>
                )}
                {saving && (
                  <p className="text-coco-600 text-sm mt-2">Salvando…</p>
                )}
              </>
            )}

            <div className="mt-6 border-t-2 border-black pt-1 text-center text-xs">
              {customer.name} · {customer.document ?? "—"}
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          body {
            background: white;
          }
          @page {
            margin: 10mm;
            size: A5;
          }
        }
      `}</style>
    </div>
  );
}
