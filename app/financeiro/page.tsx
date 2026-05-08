"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";
import DashboardKpi from "@/components/DashboardKpi";

type FlowRow = {
  id: string;
  amount: number;
  paid_at: string;
  payment_method_id: string;
  sale_id: string;
  notes: string | null;
  sale: { code: number } | null;
};

type SalePeriod = {
  id: string;
  total: number;
  quantity: number;
  customer_id: string | null;
  canceled_at: string | null;
  customer: { name: string } | null;
};

type PmrPayment = {
  paid_at: string;
  amount: number;
  sale: { created_at: string } | null;
};

type CustomerBalance = {
  open_balance: number;
};

type InvMovement = {
  kind: string;
  quantity: number;
  unit_cost: number | null;
  created_at: string;
};

function isoStartOfDay(date: string) {
  const d = new Date(date + "T00:00:00");
  return d.toISOString();
}
function isoEndOfDay(date: string) {
  const d = new Date(date + "T23:59:59.999");
  return d.toISOString();
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthStr() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

const BAR_COLORS = [
  "bg-coco-600",
  "bg-amber-500",
  "bg-green-500",
  "bg-blue-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-orange-500",
];

export default function FinanceiroPage() {
  const supabase = createClient();
  const [from, setFrom] = useState(firstOfMonthStr());
  const [to, setTo] = useState(todayStr());
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [rows, setRows] = useState<FlowRow[]>([]);
  const [salesPeriod, setSalesPeriod] = useState<SalePeriod[]>([]);
  const [pmrPayments, setPmrPayments] = useState<PmrPayment[]>([]);
  const [customerBalances, setCustomerBalances] = useState<CustomerBalance[]>([]);
  const [invMovements, setInvMovements] = useState<InvMovement[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const startIso = isoStartOfDay(from);
    const endIso = isoEndOfDay(to);

    const [m, p, sales, pmr, balances, inv] = await Promise.all([
      supabase.from("payment_methods").select("*"),
      supabase
        .from("sale_payments")
        .select("*, sale:sales(code)")
        .gte("paid_at", startIso)
        .lte("paid_at", endIso)
        .order("paid_at", { ascending: false }),
      supabase
        .from("sales")
        .select("id,total,quantity,customer_id,canceled_at,customer:customers(name)")
        .gte("created_at", startIso)
        .lte("created_at", endIso),
      supabase
        .from("sale_payments")
        .select("paid_at,amount,sale:sales(created_at)")
        .gte("paid_at", startIso)
        .lte("paid_at", endIso),
      supabase
        .from("customer_balances")
        .select("open_balance"),
      supabase
        .from("inventory_movements")
        .select("kind,quantity,unit_cost,created_at")
        .eq("kind", "entrada")
        .order("created_at", { ascending: true }),
    ]);

    setMethods((m.data as PaymentMethod[]) ?? []);
    setRows((p.data as FlowRow[]) ?? []);
    setSalesPeriod((sales.data as SalePeriod[]) ?? []);
    setPmrPayments((pmr.data as PmrPayment[]) ?? []);
    setCustomerBalances((balances.data as CustomerBalance[]) ?? []);
    setInvMovements((inv.data as InvMovement[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [from, to]);

  const methodsById = useMemo(() => {
    const map: Record<string, PaymentMethod> = {};
    methods.forEach((m) => (map[m.id] = m));
    return map;
  }, [methods]);

  const totals = useMemo(() => {
    const byMethod: Record<string, number> = {};
    let total = 0;
    rows.forEach((r) => {
      const a = Number(r.amount);
      byMethod[r.payment_method_id] = (byMethod[r.payment_method_id] || 0) + a;
      total += a;
    });
    return { byMethod, total };
  }, [rows]);

  const kpis = useMemo(() => {
    const ativas = salesPeriod.filter((s) => !s.canceled_at);
    const receitaLiquida = ativas.reduce((s, r) => s + Number(r.total ?? 0), 0);

    // Ticket médio
    const ticketMedio = ativas.length > 0 ? receitaLiquida / ativas.length : 0;

    // PMR - média de dias entre venda e pagamento
    const diffs = pmrPayments
      .filter((p) => p.sale?.created_at)
      .map((p) => {
        const paidMs = new Date(p.paid_at).getTime();
        const createdMs = new Date(p.sale!.created_at).getTime();
        return (paidMs - createdMs) / (1000 * 60 * 60 * 24);
      })
      .filter((d) => d >= 0);
    const pmr = diffs.length > 0 ? diffs.reduce((s, d) => s + d, 0) / diffs.length : 0;

    // Taxa de inadimplência
    const totalOpenBalance = customerBalances.reduce(
      (s, r) => s + Number(r.open_balance ?? 0),
      0
    );
    const inadimplencia = receitaLiquida > 0 ? (totalOpenBalance / receitaLiquida) * 100 : 0;

    // Margem de contribuição via CMV (custo médio ponderado das entradas)
    const startMs = new Date(isoStartOfDay(from)).getTime();
    const entriesInPeriod = invMovements.filter(
      (m) => new Date(m.created_at).getTime() >= startMs && m.unit_cost && Number(m.unit_cost) > 0
    );
    const sourceMovements = entriesInPeriod.length > 0 ? entriesInPeriod : invMovements.filter((m) => m.unit_cost && Number(m.unit_cost) > 0);
    let invQty = 0, invCost = 0;
    for (const m of sourceMovements) {
      invQty += Number(m.quantity);
      invCost += Number(m.quantity) * Number(m.unit_cost);
    }
    const custoUnitMedio = invQty > 0 ? invCost / invQty : 0;
    const totalQty = ativas.reduce((s, r) => s + Number(r.quantity ?? 0), 0);
    const cmv = +(totalQty * custoUnitMedio).toFixed(2);
    const margemContribuicao = receitaLiquida > 0 && cmv > 0
      ? ((receitaLiquida - cmv) / receitaLiquida) * 100
      : null;

    // Top 5 clientes
    const customerMap: Record<string, { name: string; total: number }> = {};
    ativas.forEach((s) => {
      if (!s.customer_id) return;
      const name = (s.customer as { name: string } | null)?.name ?? "—";
      if (!customerMap[s.customer_id]) customerMap[s.customer_id] = { name, total: 0 };
      customerMap[s.customer_id].total += Number(s.total ?? 0);
    });
    const top5 = Object.values(customerMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    return { ticketMedio, pmr, inadimplencia, margemContribuicao, top5, receitaLiquida, cmvDisponivel: custoUnitMedio > 0 };
  }, [salesPeriod, pmrPayments, customerBalances, invMovements, from]);

  const paymentMethodBars = useMemo(() => {
    const total = totals.total;
    if (total === 0) return [];
    return methods
      .filter((m) => (totals.byMethod[m.id] || 0) > 0)
      .map((m) => ({
        name: m.name,
        amount: totals.byMethod[m.id] || 0,
        pct: ((totals.byMethod[m.id] || 0) / total) * 100,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [methods, totals]);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">Financeiro</h1>
          <p className="text-coco-600">KPIs gerenciais e fluxo de recebimentos.</p>
        </div>
        <a href="/financeiro/dre" className="btn-secondary">
          📊 Ver DRE
        </a>
      </header>

      {/* Period filter */}
      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">De</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="label">Até</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input"
          />
        </div>
        <button onClick={load} className="btn-secondary">
          Atualizar
        </button>
        <div className="ml-auto text-right">
          <div className="text-coco-700 text-sm">Total recebido</div>
          <div className="text-3xl font-bold text-coco-900">{brl(totals.total)}</div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <DashboardKpi
          label="Ticket Médio"
          value={brl(kpis.ticketMedio)}
          sub="Receita líquida ÷ nº de vendas"
          icon="🎟️"
          accent="neutral"
        />
        <DashboardKpi
          label="Prazo Médio de Recebimento"
          value={kpis.pmr > 0 ? `${kpis.pmr.toFixed(1)} dias` : "—"}
          sub="Média entre venda e pagamento"
          icon="⏱️"
          accent={kpis.pmr > 7 ? "amber" : "neutral"}
        />
        <DashboardKpi
          label="Taxa de Inadimplência"
          value={`${kpis.inadimplencia.toFixed(1)}%`}
          sub="Saldo em aberto ÷ receita do período"
          icon="⚠️"
          accent={kpis.inadimplencia > 10 ? "red" : kpis.inadimplencia > 5 ? "amber" : "green"}
        />
        <DashboardKpi
          label="Margem de Contribuição"
          value={
            kpis.margemContribuicao !== null
              ? `${kpis.margemContribuicao.toFixed(1)}%`
              : "—"
          }
          sub={
            kpis.margemContribuicao !== null
              ? "(Receita − CMV) ÷ Receita"
              : "Sem custo de inventário cadastrado"
          }
          icon="📈"
          accent={
            kpis.margemContribuicao === null
              ? "neutral"
              : kpis.margemContribuicao >= 40
              ? "green"
              : kpis.margemContribuicao >= 20
              ? "amber"
              : "red"
          }
        />
        <DashboardKpi
          label="Receita Líquida do Período"
          value={brl(kpis.receitaLiquida)}
          sub="Vendas não canceladas"
          icon="💰"
          accent="primary"
        />
        <DashboardKpi
          label="Vendas no Período"
          value={salesPeriod.filter((s) => !s.canceled_at).length}
          sub={`${salesPeriod.filter((s) => s.canceled_at).length} canceladas`}
          icon="🛒"
          accent="neutral"
        />
      </div>

      {/* Top 5 clientes */}
      {kpis.top5.length > 0 && (
        <div className="card">
          <h2 className="font-bold text-coco-900 mb-3">Top 5 Clientes por Receita</h2>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Cliente</th>
                <th className="text-right">Receita</th>
                <th className="text-right">Part. %</th>
              </tr>
            </thead>
            <tbody>
              {kpis.top5.map((c, i) => (
                <tr key={i}>
                  <td className="text-coco-500 font-semibold">{i + 1}</td>
                  <td>{c.name}</td>
                  <td className="text-right font-semibold">{brl(c.total)}</td>
                  <td className="text-right text-coco-600">
                    {kpis.receitaLiquida > 0
                      ? `${((c.total / kpis.receitaLiquida) * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Receita por forma de pagamento */}
      {paymentMethodBars.length > 0 && (
        <div className="card">
          <h2 className="font-bold text-coco-900 mb-4">Receita por Forma de Pagamento</h2>
          <div className="space-y-3">
            {paymentMethodBars.map((bar, i) => (
              <div key={i}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-coco-800 font-medium">{bar.name}</span>
                  <span className="text-coco-600">
                    {brl(bar.amount)} · {bar.pct.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 bg-coco-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`}
                    style={{ width: `${bar.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lançamentos */}
      <div className="card">
        <h2 className="font-bold text-coco-900 mb-3">Lançamentos</h2>
        {loading ? (
          <p className="text-coco-600">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="text-coco-600">Sem recebimentos no período.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Forma</th>
                <th>Venda</th>
                <th className="text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.paid_at)}</td>
                  <td>{methodsById[r.payment_method_id]?.name ?? "—"}</td>
                  <td className="text-xs text-coco-600">
                    {r.sale ? `#${r.sale.code}` : "—"}
                  </td>
                  <td className="text-right font-semibold">{brl(Number(r.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
