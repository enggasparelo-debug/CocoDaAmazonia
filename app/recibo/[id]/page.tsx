"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import type {
  Customer,
  PaymentMethod,
  ProductSettings,
  Sale,
  SalePayment,
} from "@/lib/types";

export default function ReciboPage() {
  const supabase = createClient();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [sale, setSale] = useState<Sale | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [payments, setPayments] = useState<SalePayment[]>([]);
  const [methods, setMethods] = useState<Record<string, PaymentMethod>>({});
  const [product, setProduct] = useState<ProductSettings | null>(null);

  useEffect(() => {
    (async () => {
      const [s, p, m, ps] = await Promise.all([
        supabase.from("sales").select("*").eq("id", id).single(),
        supabase.from("sale_payments").select("*").eq("sale_id", id),
        supabase.from("payment_methods").select("*"),
        supabase.from("product_settings").select("*").limit(1).single(),
      ]);
      setSale((s.data as Sale) ?? null);
      setPayments((p.data as SalePayment[]) ?? []);
      const map: Record<string, PaymentMethod> = {};
      (m.data as PaymentMethod[] | null)?.forEach((x) => (map[x.id] = x));
      setMethods(map);
      setProduct((ps.data as ProductSettings) ?? null);

      if (s.data?.customer_id) {
        const c = await supabase
          .from("customers")
          .select("*")
          .eq("id", s.data.customer_id)
          .single();
        setCustomer((c.data as Customer) ?? null);
      }
    })();
  }, [id, supabase]);

  if (!sale) {
    return <div className="p-6 text-coco-700">Carregando comprovante…</div>;
  }

  const subtotal = Number(sale.unit_price) * sale.quantity;
  const remaining = Number(sale.total) - Number(sale.paid_amount);

  return (
    <div className="min-h-screen bg-white text-coco-900 p-6">
      <div className="max-w-md mx-auto">
        <div className="flex justify-between items-center mb-4 print:hidden">
          <a href="/vendas" className="text-coco-700 underline text-sm">
            ← Voltar
          </a>
          <button
            onClick={() => window.print()}
            className="btn-primary"
          >
            🖨 Imprimir
          </button>
        </div>

        <div className="recibo-card border border-coco-200 rounded-2xl p-5 print:border-0">
          <div className="text-center mb-4">
            <div className="text-3xl">🥥</div>
            <h1 className="text-xl font-bold">Coco da Amazônia</h1>
            <p className="text-xs text-coco-700">Comprovante de venda</p>
          </div>

          <div className="text-xs text-coco-700 mb-3">
            {fmtDate(sale.created_at)} · Venda #{sale.code}
          </div>

          {customer && (
            <div className="mb-3 p-2 bg-coco-50 rounded text-sm">
              <strong>Cliente:</strong> {customer.name}
              {customer.phone && <span> · {customer.phone}</span>}
            </div>
          )}

          <table className="w-full text-sm mb-3">
            <thead>
              <tr className="border-b border-coco-200">
                <th className="text-left py-1">Item</th>
                <th className="text-right py-1">Qtd</th>
                <th className="text-right py-1">Unit.</th>
                <th className="text-right py-1">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-2">{product?.name ?? "Coco Verde"}</td>
                <td className="text-right">{sale.quantity}</td>
                <td className="text-right">{brl(Number(sale.unit_price))}</td>
                <td className="text-right">{brl(subtotal)}</td>
              </tr>
            </tbody>
          </table>

          <div className="text-sm space-y-1 border-t border-coco-200 pt-2">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{brl(subtotal)}</span>
            </div>
            {Number(sale.discount) > 0 && (
              <div className="flex justify-between text-amber-700">
                <span>Desconto</span>
                <span>− {brl(Number(sale.discount))}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base">
              <span>Total</span>
              <span>{brl(Number(sale.total))}</span>
            </div>
          </div>

          {payments.length > 0 && (
            <div className="mt-3 pt-2 border-t border-coco-200 text-sm">
              <div className="font-semibold mb-1">Pagamentos</div>
              {payments.map((p) => (
                <div key={p.id} className="flex justify-between">
                  <span>{methods[p.payment_method_id]?.name ?? "—"}</span>
                  <span>{brl(Number(p.amount))}</span>
                </div>
              ))}
              <div className="flex justify-between mt-1">
                <span>Total recebido</span>
                <span className="font-semibold text-green-700">
                  {brl(Number(sale.paid_amount))}
                </span>
              </div>
            </div>
          )}

          {remaining > 0 && sale.status !== "cancelada" && (
            <div className="mt-3 pt-2 border-t border-amber-300 bg-amber-50 -mx-5 -mb-5 px-5 py-3 rounded-b-2xl">
              <div className="flex justify-between font-bold text-amber-800">
                <span>📒 Em aberto (fiado)</span>
                <span>{brl(remaining)}</span>
              </div>
              {customer && (
                <div className="text-xs text-amber-700 mt-1">
                  Saldo do cliente {customer.name}.
                </div>
              )}
            </div>
          )}

          {sale.status === "cancelada" && (
            <div className="mt-3 text-center text-red-700 font-bold">
              ❌ VENDA CANCELADA
              {sale.cancel_reason && (
                <div className="text-xs font-normal">
                  Motivo: {sale.cancel_reason}
                </div>
              )}
            </div>
          )}

          <div className="text-center text-xs text-coco-500 mt-4">
            Obrigado!
          </div>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          html,
          body {
            background: white;
            margin: 0;
            padding: 0;
          }
          /* Margens compactas — funciona em A4 e térmica 80mm/58mm.
             Pra papel térmico estreito, configure o driver da
             impressora pra papel customizado (ex.: 80mm × auto). */
          @page {
            margin: 5mm;
          }
          .recibo-card {
            border: none !important;
            padding: 0 !important;
            max-width: 100% !important;
          }
        }
      `}</style>
    </div>
  );
}
