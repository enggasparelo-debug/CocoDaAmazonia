"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate, startOfMonthISO, todayISO } from "@/lib/format";
import type { Sale } from "@/lib/types";
import StatusBadge from "@/components/StatusBadge";
import Sparkline from "@/components/Sparkline";
import { SkeletonRows } from "@/components/Skeleton";

type Stats = {
  todayCount: number;
  todayTotal: number;
  monthCount: number;
  monthTotal: number;
  monthExpenses: number;
  receivable: number;
  customers: number;
  stock: number;
  cashOpen: boolean;
};

export default function Dashboard() {
  const supabase = createClient();
  const [stats, setStats] = useState<Stats>({
    todayCount: 0,
    todayTotal: 0,
    monthCount: 0,
    monthTotal: 0,
    monthExpenses: 0,
    receivable: 0,
    customers: 0,
    stock: 0,
    cashOpen: false,
  });
  const [recent, setRecent] = useState<Sale[]>([]);
  const [series, setSeries] = useState<{ date: string; total: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const today = todayISO();
      const month = startOfMonthISO();
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      sevenDaysAgo.setHours(0, 0, 0, 0);

      const [
        todayQ,
        monthQ,
        monthExp,
        openQ,
        custQ,
        recentQ,
        weekSales,
        stock,
        cash,
      ] = await Promise.all([
        supabase
          .from("sales")
          .select("total", { count: "exact" })
          .gte("created_at", today)
          .neq("status", "cancelada"),
        supabase
          .from("sales")
          .select("total", { count: "exact" })
          .gte("created_at", month)
          .neq("status", "cancelada"),
        supabase
          .from("expenses")
          .select("amount")
          .gte("paid_at", month),
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
        supabase
          .from("sales")
          .select("created_at,total,status")
          .gte("created_at", sevenDaysAgo.toISOString()),
        supabase.from("inventory_balance").select("*").maybeSingle(),
        supabase
          .from("cash_sessions")
          .select("id")
          .is("closed_at", null)
          .limit(1)
          .maybeSingle(),
      ]);

      const todayTotal =
        todayQ.data?.reduce((s, r: any) => s + Number(r.total), 0) ?? 0;
      const monthTotal =
        monthQ.data?.reduce((s, r: any) => s + Number(r.total), 0) ?? 0;
      const monthExpenses =
        monthExp.data?.reduce((s, r: any) => s + Number(r.amount), 0) ?? 0;
      const receivable =
        openQ.data?.reduce((s, r: any) => s + Number(r.open_balance), 0) ?? 0;

      // série últimos 7 dias
      const days: { date: string; total: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        d.setHours(0, 0, 0, 0);
        const key = d.toISOString().slice(0, 10);
        days.push({ date: key, total: 0 });
      }
      (weekSales.data ?? []).forEach((s: any) => {
        if (s.status === "cancelada") return;
        const k = new Date(s.created_at).toISOString().slice(0, 10);
        const day = days.find((d) => d.date === k);
        if (day) day.total += Number(s.total);
      });
      setSeries(days);

      setStats({
        todayCount: todayQ.count ?? 0,
        todayTotal,
        monthCount: monthQ.count ?? 0,
        monthTotal,
        monthExpenses,
        receivable,
        customers: custQ.count ?? 0,
        stock: (stock.data as any)?.on_hand ?? 0,
        cashOpen: !!cash.data,
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

  const profit = stats.monthTotal - stats.monthExpenses;
  const sparkLabels = useMemo(
    () =>
      series.map((d) =>
        new Date(d.date).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
        })
      ),
    [series]
  );
  const sparkValues = useMemo(() => series.map((d) => d.total), [series]);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">Painel</h1>
          <p className="text-coco-600">Visão geral do dia e do mês</p>
        </div>
        <div className="flex gap-2">
          {!stats.cashOpen && (
            <Link href="/caixa" className="btn-secondary">
              💵 Abrir caixa
            </Link>
          )}
          <Link href="/vendas" className="btn-primary text-lg">
            🥥 Nova Venda
          </Link>
        </div>
      </header>

      {error && (
        <div className="card border-red-300 bg-red-50 text-red-700">
          Erro ao carregar dados: {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat title="Vendas hoje" value={stats.todayCount} />
        <Stat title="Total hoje" value={brl(stats.todayTotal)} highlight />
        <Stat title="Vendas no mês" value={stats.monthCount} />
        <Stat title="Total no mês" value={brl(stats.monthTotal)} highlight />
        <Stat title="Despesas no mês" value={brl(stats.monthExpenses)} accent="red" />
        <Stat
          title="Lucro estimado"
          value={brl(profit)}
          accent={profit >= 0 ? "green" : "red"}
        />
        <Stat
          title="A receber (fiado)"
          value={brl(stats.receivable)}
          accent="amber"
        />
        <Stat
          title="Estoque (cocos)"
          value={stats.stock}
          accent={stats.stock <= 0 ? "red" : "green"}
        />
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-coco-900">
            Vendas dos últimos 7 dias
          </h2>
          <Link href="/relatorios" className="text-coco-700 text-sm underline">
            ver mais
          </Link>
        </div>
        {series.length > 0 && (
          <Sparkline values={sparkValues} labels={sparkLabels} />
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-coco-900">Últimas vendas</h2>
          <Link href="/relatorios" className="text-coco-700 text-sm underline">
            ver todos
          </Link>
        </div>
        {loading ? (
          <SkeletonRows />
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
                <tr key={s.id} className={s.status === "cancelada" ? "opacity-60" : ""}>
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
  accent?: "amber" | "red" | "green";
}) {
  let cls = "card";
  if (highlight) cls += " bg-coco-600 text-white border-coco-600";
  else if (accent === "amber") cls += " bg-amber-50 border-amber-200";
  else if (accent === "red") cls += " bg-red-50 border-red-200";
  else if (accent === "green") cls += " bg-green-50 border-green-200";
  return (
    <div className={cls}>
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
