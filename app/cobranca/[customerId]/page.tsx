"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDateOnly } from "@/lib/format";
import { useTenant } from "@/lib/useTenant";
import type { Customer, Sale } from "@/lib/types";

export default function CobrancaPage() {
  const supabase = createClient();
  const params = useParams<{ customerId: string }>();
  const customerId = params.customerId;
  const { tenant } = useTenant();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [openSales, setOpenSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [c, s] = await Promise.all([
        supabase.from("customers").select("*").eq("id", customerId).single(),
        supabase
          .from("sales")
          .select("*")
          .eq("customer_id", customerId)
          .neq("status", "paga")
          .is("canceled_at", null)
          .order("created_at", { ascending: true }),
      ]);
      setCustomer((c.data as Customer) ?? null);
      setOpenSales((s.data as Sale[]) ?? []);
      setLoading(false);
    })();
  }, [customerId, supabase]);

  const stats = useMemo(() => {
    const cocos = openSales.reduce((s, x) => s + Number(x.quantity ?? 0), 0);
    const total = openSales.reduce(
      (s, x) => s + (Number(x.total ?? 0) - Number(x.paid_amount ?? 0)),
      0
    );
    const oldest =
      openSales.length > 0
        ? new Date(openSales[0].created_at)
        : null;
    const days = oldest
      ? Math.floor((Date.now() - oldest.getTime()) / 86400000)
      : 0;
    return { cocos, total, oldest, days };
  }, [openSales]);

  if (loading) {
    return <div className="p-6 text-coco-700">Carregando…</div>;
  }
  if (!customer) {
    return <div className="p-6 text-red-700">Cliente não encontrado.</div>;
  }

  const today = new Date();
  const storeName = tenant?.name ?? "Coco da Amazônia";

  return (
    <div className="min-h-screen bg-white text-coco-900 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-4 print:hidden">
          <a href="/receber" className="text-coco-700 underline text-sm">
            ← Voltar
          </a>
          <button onClick={() => window.print()} className="btn-primary">
            🖨 Imprimir / Salvar PDF
          </button>
        </div>

        <div className="cobranca-card border border-coco-200 rounded-2xl p-6 print:border-0 print:p-0">
          <header className="flex items-start justify-between mb-4 border-b border-coco-200 pb-3">
            <div>
              <div className="text-2xl">🥥 {storeName}</div>
              <div className="text-xs text-coco-700">
                Demonstrativo de débito
              </div>
            </div>
            <div className="text-right text-xs text-coco-700">
              Emitido em
              <br />
              <strong>{fmtDateOnly(today.toISOString())}</strong>
            </div>
          </header>

          <section className="mb-4">
            <div className="text-xs uppercase tracking-wider text-coco-600">
              Cliente
            </div>
            <div className="text-lg font-bold">{customer.name}</div>
            {customer.phone && (
              <div className="text-sm text-coco-700">📞 {customer.phone}</div>
            )}
            {customer.address && (
              <div className="text-xs text-coco-600 mt-0.5">
                {customer.address}
              </div>
            )}
          </section>

          {openSales.length === 0 ? (
            <p className="bg-green-50 border border-green-200 text-green-900 rounded-xl p-3 text-center">
              ✅ Cliente sem vendas em aberto. Tudo certo!
            </p>
          ) : (
            <>
              <section className="mb-4">
                <h2 className="font-bold text-coco-900 mb-2">
                  Vendas em aberto ({openSales.length})
                </h2>
                <table className="w-full text-sm border border-coco-200 rounded">
                  <thead className="bg-coco-50">
                    <tr>
                      <th className="text-left px-2 py-1">Data</th>
                      <th className="text-right px-2 py-1">Qtd</th>
                      <th className="text-right px-2 py-1">Unit.</th>
                      <th className="text-right px-2 py-1">Total</th>
                      <th className="text-right px-2 py-1">Pago</th>
                      <th className="text-right px-2 py-1">Restante</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openSales.map((s) => {
                      const rest =
                        Number(s.total) - Number(s.paid_amount);
                      return (
                        <tr
                          key={s.id}
                          className="border-t border-coco-100"
                        >
                          <td className="px-2 py-1">
                            {fmtDateOnly(s.created_at)}
                          </td>
                          <td className="text-right px-2 py-1">
                            {s.quantity}
                          </td>
                          <td className="text-right px-2 py-1">
                            {brl(Number(s.unit_price))}
                          </td>
                          <td className="text-right px-2 py-1">
                            {brl(Number(s.total))}
                          </td>
                          <td className="text-right px-2 py-1 text-green-700">
                            {brl(Number(s.paid_amount))}
                          </td>
                          <td className="text-right px-2 py-1 font-semibold text-amber-800">
                            {brl(rest)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-coco-300 bg-amber-50">
                      <td className="px-2 py-2 font-bold">Totais</td>
                      <td className="text-right px-2 py-2 font-bold">
                        {stats.cocos}
                      </td>
                      <td colSpan={3} className="text-right px-2 py-2 text-coco-700">
                        Saldo devedor
                      </td>
                      <td className="text-right px-2 py-2 font-bold text-amber-900 text-base">
                        {brl(stats.total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </section>

              <section className="grid grid-cols-3 gap-3 mb-4">
                <SummaryBox label="Cocos em aberto" value={String(stats.cocos)} />
                <SummaryBox
                  label="Valor em aberto"
                  value={brl(stats.total)}
                  highlight
                />
                <SummaryBox
                  label="Mais antiga"
                  value={
                    stats.oldest
                      ? fmtDateOnly(stats.oldest.toISOString())
                      : "—"
                  }
                  sub={
                    stats.days > 0
                      ? `há ${stats.days} dia${stats.days === 1 ? "" : "s"}`
                      : undefined
                  }
                />
              </section>
            </>
          )}

          <footer className="border-t border-coco-200 pt-3 text-xs text-coco-600 space-y-1">
            <p>
              Documento informativo gerado automaticamente em{" "}
              {fmtDateOnly(today.toISOString())}. Em caso de dúvida ou
              divergência, entre em contato com {storeName}.
            </p>
            {tenant?.name && <p className="text-coco-500">{tenant.name}</p>}
          </footer>
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
          @page {
            size: A4;
            margin: 12mm;
          }
          .cobranca-card {
            border: none !important;
            padding: 0 !important;
            max-width: 100% !important;
          }
        }
      `}</style>
    </div>
  );
}

function SummaryBox({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        highlight
          ? "bg-amber-50 border-amber-300 text-amber-900"
          : "bg-coco-50 border-coco-200"
      }`}
    >
      <div className="text-[11px] uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="text-lg font-bold">{value}</div>
      {sub && <div className="text-xs opacity-80">{sub}</div>}
    </div>
  );
}
