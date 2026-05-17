"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl } from "@/lib/format";

type TodayData = {
  salesCount: number;
  salesTotal: number;
  receivedTotal: number;
  openCargas: number;
  dueTodayCount: number;
  dueTodayTotal: number;
};

const EMPTY: TodayData = {
  salesCount: 0,
  salesTotal: 0,
  receivedTotal: 0,
  openCargas: 0,
  dueTodayCount: 0,
  dueTodayTotal: 0,
};

function todayIsoBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function todayYmd() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export default function TodayCard() {
  const supabase = createClient();
  const [data, setData] = useState<TodayData>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { start, end } = todayIsoBounds();
      const today = todayYmd();

      const [salesQ, paysQ, cargasQ, payablesQ, expensesQ] = await Promise.all([
        supabase
          .from("sales")
          .select("total", { count: "exact" })
          .gte("created_at", start)
          .lt("created_at", end)
          .is("canceled_at", null),
        supabase
          .from("sale_payments")
          .select("amount")
          .gte("paid_at", start)
          .lt("paid_at", end),
        supabase
          .from("cargas")
          .select("id", { count: "exact", head: true })
          .is("closed_at", null),
        supabase
          .from("payables")
          .select("amount")
          .in("status", ["pendente", "vencido"])
          .eq("due_date", today),
        supabase
          .from("expenses")
          .select("amount")
          .eq("status", "open")
          .is("carga_id", null)
          .eq("due_date", today),
      ]);

      if (cancelled) return;

      const salesRows = (salesQ.data as { total: number }[] | null) ?? [];
      const salesTotal = salesRows.reduce((s, r) => s + Number(r.total), 0);
      const paysRows = (paysQ.data as { amount: number }[] | null) ?? [];
      const receivedTotal = paysRows.reduce((s, r) => s + Number(r.amount), 0);
      const payablesRows = (payablesQ.data as { amount: number }[] | null) ?? [];
      const expensesRows = (expensesQ.data as { amount: number }[] | null) ?? [];
      const dueTodayTotal =
        payablesRows.reduce((s, r) => s + Number(r.amount), 0) +
        expensesRows.reduce((s, r) => s + Number(r.amount), 0);

      setData({
        salesCount: salesQ.count ?? salesRows.length,
        salesTotal,
        receivedTotal,
        openCargas: cargasQ.count ?? 0,
        dueTodayCount: payablesRows.length + expensesRows.length,
        dueTodayTotal,
      });
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return (
    <div className="bg-gradient-to-br from-coco-700 to-coco-800 text-white rounded-2xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-coco-200">Hoje</div>
          <div className="text-lg font-bold">
            {new Date().toLocaleDateString("pt-BR", {
              weekday: "long",
              day: "2-digit",
              month: "long",
            })}
          </div>
        </div>
        {loading && <div className="text-xs text-coco-200">Carregando…</div>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link
          href="/vendas"
          className="bg-coco-600/40 hover:bg-coco-600/60 rounded-xl p-3 transition"
        >
          <div className="text-xs text-coco-200 uppercase">Vendas</div>
          <div className="text-2xl font-bold leading-tight">{data.salesCount}</div>
          <div className="text-xs text-coco-100">{brl(data.salesTotal)}</div>
        </Link>
        <Link
          href="/financeiro"
          className="bg-coco-600/40 hover:bg-coco-600/60 rounded-xl p-3 transition"
        >
          <div className="text-xs text-coco-200 uppercase">Recebido</div>
          <div className="text-2xl font-bold leading-tight">{brl(data.receivedTotal)}</div>
          <div className="text-xs text-coco-100">&nbsp;</div>
        </Link>
        <Link
          href="/cargas"
          className="bg-coco-600/40 hover:bg-coco-600/60 rounded-xl p-3 transition"
        >
          <div className="text-xs text-coco-200 uppercase">Cargas ativas</div>
          <div className="text-2xl font-bold leading-tight">{data.openCargas}</div>
          <div className="text-xs text-coco-100">em rota</div>
        </Link>
        <Link
          href="/pagar"
          className={`rounded-xl p-3 transition ${
            data.dueTodayCount > 0
              ? "bg-red-500/40 hover:bg-red-500/60"
              : "bg-coco-600/40 hover:bg-coco-600/60"
          }`}
        >
          <div className="text-xs text-coco-200 uppercase">Vence hoje</div>
          <div className="text-2xl font-bold leading-tight">{data.dueTodayCount}</div>
          <div className="text-xs text-coco-100">{brl(data.dueTodayTotal)}</div>
        </Link>
      </div>
    </div>
  );
}
