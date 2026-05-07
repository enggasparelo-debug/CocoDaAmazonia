"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import type {
  Carga,
  CargaSummary,
  Sale,
  Expense,
  CashMovement,
  Vehicle,
  Route,
  Tenant,
} from "@/lib/types";

export default function FechamentoPdfPage() {
  const supabase = createClient();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [carga, setCarga] = useState<Carga | null>(null);
  const [summary, setSummary] = useState<CargaSummary | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [movs, setMovs] = useState<CashMovement[]>([]);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase
        .from("cargas")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      const cur = (c as Carga | null) ?? null;
      setCarga(cur);
      if (!cur) return;

      const [s, e, m, sum, v, r, t] = await Promise.all([
        supabase
          .from("sales")
          .select("*")
          .eq("carga_id", id)
          .order("created_at"),
        supabase
          .from("expenses")
          .select("*")
          .eq("carga_id", id)
          .order("paid_at"),
        supabase
          .from("cash_movements")
          .select("*")
          .eq("carga_id", id)
          .order("created_at"),
        supabase
          .from("carga_summary")
          .select("*")
          .eq("carga_id", id)
          .maybeSingle(),
        cur.vehicle_id
          ? supabase
              .from("vehicles")
              .select("*")
              .eq("id", cur.vehicle_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        cur.route_id
          ? supabase
              .from("routes")
              .select("*")
              .eq("id", cur.route_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from("tenants")
          .select("*")
          .eq("id", cur.tenant_id)
          .maybeSingle(),
      ]);
      setSales((s.data as Sale[]) ?? []);
      setExpenses((e.data as Expense[]) ?? []);
      setMovs((m.data as CashMovement[]) ?? []);
      setSummary((sum.data as CargaSummary | null) ?? null);
      setVehicle((v.data as Vehicle | null) ?? null);
      setRoute((r.data as Route | null) ?? null);
      setTenant((t.data as Tenant | null) ?? null);
    })();
  }, [id, supabase]);

  if (!carga || !summary) {
    return <div className="p-6 text-coco-700">Carregando…</div>;
  }

  const Row = ({
    label,
    value,
    bold,
  }: {
    label: string;
    value: string;
    bold?: boolean;
  }) => (
    <div
      className={`flex justify-between text-sm py-1 ${
        bold ? "font-bold border-t border-coco-300 mt-1 pt-2" : ""
      }`}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-white text-coco-900 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-4 print:hidden">
          <Link href="/carga" className="text-coco-700 underline text-sm">
            ← Voltar
          </Link>
          <button onClick={() => window.print()} className="btn-primary">
            🖨 Imprimir
          </button>
        </div>

        <div className="border border-coco-300 rounded-2xl p-6 print:border-0 space-y-4">
          <div className="text-center">
            <div className="text-3xl">🚚</div>
            <h1 className="text-2xl font-bold">Fechamento de Carga</h1>
            <p className="text-xs text-coco-700">
              {tenant?.name ?? "Coco da Amazônia"}
            </p>
          </div>

          <div className="text-xs text-coco-700">
            <div>Carga #{carga.code}</div>
            <div>Aberta em {fmtDate(carga.opened_at)}</div>
            {carga.closed_at && (
              <div>Fechada em {fmtDate(carga.closed_at)}</div>
            )}
            <div>Veículo: {vehicle?.plate ?? "—"}</div>
            <div>Rota: {route?.name ?? "—"}</div>
          </div>

          <div>
            <h2 className="font-bold text-coco-900 mb-1">Cocos</h2>
            <Row label="Saída do balcão" value={String(summary.opening_cocos)} />
            <Row label="Vendidos" value={String(summary.cocos_vendidos)} />
            <Row
              label="Sobra (retorno)"
              value={String(summary.closing_cocos_remaining ?? 0)}
            />
            <Row label="Perda" value={String(summary.cocos_perda)} />
          </div>

          <div>
            <h2 className="font-bold text-coco-900 mb-1">Recebimento</h2>
            <Row label="Dinheiro" value={brl(Number(summary.total_dinheiro))} />
            <Row label="Pix" value={brl(Number(summary.total_pix))} />
            <Row label="Cartão" value={brl(Number(summary.total_cartao))} />
            <Row label="Outros" value={brl(Number(summary.total_outros))} />
            <Row
              label="Fiado (a receber)"
              value={brl(Number(summary.total_fiado))}
            />
            <Row
              label="Total vendido"
              value={brl(Number(summary.total_vendido))}
              bold
            />
          </div>

          <div>
            <h2 className="font-bold text-coco-900 mb-1">Caixa</h2>
            <Row
              label="Suprimento"
              value={brl(Number(summary.total_suprimento))}
            />
            <Row label="Sangria" value={brl(Number(summary.total_sangria))} />
            <Row
              label="Despesas"
              value={brl(Number(summary.total_despesas))}
            />
            <Row
              label="Esperado em caixa"
              value={brl(Number(summary.expected_cash))}
              bold
            />
            <Row
              label="Declarado pelo operador"
              value={brl(Number(summary.closing_cash_declared ?? 0))}
            />
            <Row
              label="Diferença"
              value={brl(Number(summary.cash_diff))}
              bold
            />
          </div>

          {sales.length > 0 && (
            <div>
              <h2 className="font-bold text-coco-900 mb-1">
                Vendas ({sales.length})
              </h2>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-coco-200">
                    <th className="text-left py-1">Data</th>
                    <th className="text-right">Qtd</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Pago</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s) => (
                    <tr
                      key={s.id}
                      className={s.canceled_at ? "opacity-50 line-through" : ""}
                    >
                      <td className="py-1">{fmtDate(s.created_at)}</td>
                      <td className="text-right">{s.quantity}</td>
                      <td className="text-right">{brl(Number(s.total))}</td>
                      <td className="text-right">
                        {brl(Number(s.paid_amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {expenses.length > 0 && (
            <div>
              <h2 className="font-bold text-coco-900 mb-1">
                Despesas ({expenses.length})
              </h2>
              {expenses.map((e) => (
                <div
                  key={e.id}
                  className="flex justify-between text-xs py-1 border-b border-coco-100"
                >
                  <span>
                    {e.category ?? "—"} · {e.description}
                  </span>
                  <span>{brl(Number(e.amount))}</span>
                </div>
              ))}
            </div>
          )}

          {movs.length > 0 && (
            <div>
              <h2 className="font-bold text-coco-900 mb-1">
                Caixa ({movs.length})
              </h2>
              {movs.map((m) => (
                <div
                  key={m.id}
                  className="flex justify-between text-xs py-1 border-b border-coco-100"
                >
                  <span>
                    {m.kind} · {m.notes ?? "—"}
                  </span>
                  <span>{brl(Number(m.amount))}</span>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-8 mt-12 pt-4">
            <div className="text-center">
              <div className="border-t-2 border-black pt-1 text-xs">
                Operador
              </div>
            </div>
            <div className="text-center">
              <div className="border-t-2 border-black pt-1 text-xs">Admin</div>
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
          }
        }
      `}</style>
    </div>
  );
}
