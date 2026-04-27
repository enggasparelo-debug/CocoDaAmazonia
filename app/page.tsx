"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate, startOfMonthISO, todayISO } from "@/lib/format";
import type { Sale } from "@/lib/types";
import StatusBadge from "@/components/StatusBadge";

type Stats = {
  todayCount: number;
  todayTotal: number;
  monthCount: number;
  monthTotal: number;
  receivable: number;
  customers: number;
};

export default function Dashboard() {
  const supabase = createClient();
  const [stats, setStats] = useState<Stats>({
    todayCount: 0,
    todayTotal: 0,
    monthCount: 0,
    monthTotal: 0,
    receivable: 0,
    customers: 0,
  });
  const [recent, setRecent] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const today = todayISO();
      const month = startOfMonthISO();

      const [todayQ, monthQ, openQ, custQ, recentQ] = await Promise.all([
        supabase
          .from("sales")
          .select("total", { count: "exact" })
          .gte("created_at", today),
        supabase
          .from("sales")
          .select("total", { count: "exact" })
          .gte("created_at", month),
        supabase.from("customer_balances").select("open_balance"),
        supabase
          .from("customers")
          .select("id", { count: "exact", head: true })
          .eq("active", true),
        supabase
          .from("sales")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(8),
      ]);

      const todayTotal =
        todayQ.data?.reduce((s, r: any) => s + Number(r.total), 0) ?? 0;
      const monthTotal =
        monthQ.data?.reduce((s, r: any) => s + Number(r.total), 0) ?? 0;
      const receivable =
        openQ.data?.reduce((s, r: any) => s + Number(r.open_balance), 0) ?? 0;

      setStats({
        todayCount: todayQ.count ?? 0,
        todayTotal,
        monthCount: monthQ.count ?? 0,
        monthTotal,
        receivable,
        customers: custQ.count ?? 0,
      });
      setRecent((recentQ.data as Sale[]) ?? []);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">Painel</h1>
          <p className="text-coco-600">Visão geral das vendas</p>
        </div>
        <Link href="/vendas" className="btn-primary text-lg">
          🥥 Nova Venda
        </Link>
      </header>

      {error && (
        <div className="card border-red-300 bg-red-50 text-red-700">
          Erro ao carregar dados: {error}
          <p className="text-xs mt-2">
            Verifique se as variáveis NEXT_PUBLIC_SUPABASE_URL e
            NEXT_PUBLIC_SUPABASE_ANON_KEY estão configuradas e se o schema foi
            executado.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat title="Vendas hoje" value={stats.todayCount} />
        <Stat title="Total hoje" value={brl(stats.todayTotal)} highlight />
        <Stat title="Vendas no mês" value={stats.monthCount} />
        <Stat title="Total no mês" value={brl(stats.monthTotal)} highlight />
        <Stat
          title="A receber (fiado)"
          value={brl(stats.receivable)}
          accent="amber"
        />
        <Stat title="Clientes ativos" value={stats.customers} />
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-coco-900">Últimas vendas</h2>
          <Link href="/relatorios" className="text-coco-700 text-sm underline">
            ver relatórios
          </Link>
        </div>
        {loading ? (
          <p className="text-coco-600">Carregando…</p>
        ) : recent.length === 0 ? (
          <p className="text-coco-600">Nenhuma venda registrada ainda.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Qtd</th>
                <th>Unitário</th>
                <th>Total</th>
                <th>Pago</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((s) => (
                <tr key={s.id}>
                  <td>{fmtDate(s.created_at)}</td>
                  <td>{s.quantity}</td>
                  <td>{brl(Number(s.unit_price))}</td>
                  <td className="font-semibold">{brl(Number(s.total))}</td>
                  <td>{brl(Number(s.paid_amount))}</td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({
  title,
  value,
  highlight,
  accent,
}: {
  title: string;
  value: string | number;
  highlight?: boolean;
  accent?: "amber";
}) {
  return (
    <div
      className={`card ${
        highlight ? "bg-coco-600 text-white border-coco-600" : ""
      } ${accent === "amber" ? "bg-amber-50 border-amber-200" : ""}`}
    >
      <div
        className={`text-xs uppercase tracking-wider ${
          highlight ? "text-coco-100" : "text-coco-700"
        }`}
      >
        {title}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

