"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate, fmtPct, pctChange } from "@/lib/format";
import {
  DASHBOARD_PRESETS,
  type DashboardPreset,
  bucketByDay,
  dashboardRange,
  hoursSince,
  lastNDays,
  previousRange,
  rangeBoundsIso,
  topBy,
  ymdToDate,
} from "@/lib/dashboard";
import { fmtYmd } from "@/lib/dateRanges";
import type {
  Customer,
  PaymentMethod,
  Sale,
  Seller,
} from "@/lib/types";
import StatusBadge from "@/components/StatusBadge";
import { SkeletonRows } from "@/components/Skeleton";
import BarChart, { type BarPoint } from "@/components/BarChart";
import DashboardKpi from "@/components/DashboardKpi";
import DashboardAlerts, {
  type DashboardAlert,
} from "@/components/DashboardAlerts";
import TopList from "@/components/TopList";
import SaleEditor from "@/components/SaleEditor";

type SaleLite = Pick<
  Sale,
  | "id"
  | "code"
  | "total"
  | "paid_amount"
  | "quantity"
  | "customer_id"
  | "seller_id"
  | "status"
  | "created_at"
>;

type PaymentLite = {
  id: string;
  amount: number;
  paid_at: string;
  payment_method_id: string | null;
};

type ChartSale = {
  id: string;
  code: number;
  created_at: string;
  total: number;
  quantity: number;
  customer_id: string | null;
  seller_id: string | null;
};

type State = {
  // período corrente
  curSales: SaleLite[];
  curPayments: PaymentLite[];
  curExpenses: number;
  // período anterior equivalente
  prevSalesTotal: number;
  prevPaymentsTotal: number;
  prevExpenses: number;
  // série pra gráfico (30d, depois filtrada/recortada no cliente)
  chart30Sales: ChartSale[];
  recent: Sale[];
  // estado fixo
  receivable: number;
  oldestOpenIso: string | null;
  stock: number;
  minStock: number;
  cashOpen: boolean;
  cashOpenedAt: string | null;
  openCargas: number;
  oldestCargaOpenedAt: string | null;
};

const EMPTY: State = {
  curSales: [],
  curPayments: [],
  curExpenses: 0,
  prevSalesTotal: 0,
  prevPaymentsTotal: 0,
  prevExpenses: 0,
  chart30Sales: [],
  recent: [],
  receivable: 0,
  oldestOpenIso: null,
  stock: 0,
  minStock: 0,
  cashOpen: false,
  cashOpenedAt: null,
  openCargas: 0,
  oldestCargaOpenedAt: null,
};

type ChartDays = 7 | 14 | 30;
const CHART_DAY_OPTIONS: ChartDays[] = [7, 14, 30];

const WEEKDAY_LABELS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export default function DashboardClient() {
  const supabase = createClient();
  const [preset, setPreset] = useState<DashboardPreset>("hoje");
  const [state, setState] = useState<State>(EMPTY);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [editing, setEditing] = useState<Sale | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Filtros do gráfico (não mexe nos KPIs / top lists)
  const [chartDays, setChartDays] = useState<ChartDays>(14);
  const [chartSellerId, setChartSellerId] = useState<string>("");

  const range = useMemo(() => dashboardRange(preset), [preset]);
  const prevR = useMemo(() => previousRange(range), [range]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const cur = rangeBoundsIso(range);
      const prev = rangeBoundsIso(prevR);
      const chartStart = lastNDays(30)[0].toISOString();

      const [
        curSalesQ,
        curExpensesQ,
        prevSalesQ,
        prevExpensesQ,
        chartSalesQ,
        recentQ,
        balancesQ,
        stockQ,
        prodQ,
        cashQ,
        cargasQ,
        custsQ,
        sellersQ,
        methodsQ,
      ] = await Promise.all([
        supabase
          .from("sales")
          .select(
            "id,code,total,paid_amount,quantity,customer_id,seller_id,status,created_at,sale_payments(id,amount,paid_at,payment_method_id)"
          )
          .gte("created_at", cur.startIso)
          .lt("created_at", cur.endIso)
          .is("canceled_at", null),
        supabase
          .from("expenses")
          .select("amount")
          .gte("paid_at", cur.startIso)
          .lt("paid_at", cur.endIso),
        supabase
          .from("sales")
          .select("total,sale_payments(amount)")
          .gte("created_at", prev.startIso)
          .lt("created_at", prev.endIso)
          .is("canceled_at", null),
        supabase
          .from("expenses")
          .select("amount")
          .gte("paid_at", prev.startIso)
          .lt("paid_at", prev.endIso),
        supabase
          .from("sales")
          .select(
            "id,code,created_at,total,quantity,customer_id,seller_id"
          )
          .gte("created_at", chartStart)
          .is("canceled_at", null),
        supabase
          .from("sales")
          .select(
            "id,tenant_id,code,customer_id,seller_id,carga_id,quantity,unit_price,discount,total,paid_amount,status,notes,canceled_at,cancel_reason,created_at"
          )
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("customer_balances")
          .select("open_balance,oldest_open_at"),
        supabase.from("inventory_balance").select("on_hand").maybeSingle(),
        supabase
          .from("product_settings")
          .select("min_stock")
          .limit(1)
          .maybeSingle(),
        supabase
          .from("cash_sessions")
          .select("id,opened_at")
          .is("closed_at", null)
          .order("opened_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("cargas")
          .select("id,opened_at")
          .eq("status", "aberta"),
        supabase.from("customers").select("id,name").order("name"),
        supabase.from("sellers").select("id,name,active").order("name"),
        supabase.from("payment_methods").select("id,name").order("name"),
      ]);

      type ChartSaleRow = {
        id: string;
        code: number | null;
        created_at: string;
        total: number | string;
        quantity: number | string;
        customer_id: string | null;
        seller_id: string | null;
      };
      type SaleWithPayments = {
        id: string;
        code: number;
        total: number | string;
        paid_amount: number | string;
        quantity: number | string;
        customer_id: string | null;
        seller_id: string | null;
        status: SaleLite["status"];
        created_at: string;
        sale_payments?:
          | {
              id: string;
              amount: number | string;
              paid_at: string;
              payment_method_id: string | null;
            }[]
          | null;
      };
      type PrevSaleRow = {
        total: number | string;
        sale_payments?: { amount: number | string }[] | null;
      };
      type AmountRow = { amount: number | string };
      type TotalRow = { total: number | string };

      const chart30Sales: ChartSale[] = (
        (chartSalesQ.data ?? []) as ChartSaleRow[]
      ).map((r) => ({
        id: r.id,
        code: Number(r.code ?? 0),
        created_at: r.created_at,
        total: Number(r.total ?? 0),
        quantity: Number(r.quantity ?? 0),
        customer_id: r.customer_id ?? null,
        seller_id: r.seller_id ?? null,
      }));

      const balances = (balancesQ.data ?? []) as {
        open_balance: number | null;
        oldest_open_at: string | null;
      }[];
      const receivable = balances.reduce(
        (s, r) => s + Number(r.open_balance ?? 0),
        0
      );
      const oldestOpenIso =
        balances
          .map((b) => b.oldest_open_at)
          .filter((x): x is string => !!x)
          .sort()[0] ?? null;

      const cargasData = (cargasQ.data ?? []) as { opened_at: string }[];
      const oldestCargaOpenedAt =
        cargasData
          .map((c) => c.opened_at)
          .filter((x): x is string => !!x)
          .sort()[0] ?? null;

      const sumAmount = (rows: AmountRow[] | null | undefined) =>
        (rows ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
      const sumTotal = (rows: TotalRow[] | null | undefined) =>
        (rows ?? []).reduce((s, r) => s + Number(r.total ?? 0), 0);

      // Vendas do período + pagamentos via nested select. Recebido = soma
      // de TODOS os pagamentos das vendas do período (mesma definição do
      // /relatorios), independente de quando o pagamento foi feito.
      const curRows = (curSalesQ.data ?? []) as SaleWithPayments[];
      const curSales: SaleLite[] = curRows.map((s) => ({
        id: s.id,
        code: s.code,
        total: Number(s.total),
        paid_amount: Number(s.paid_amount),
        quantity: Number(s.quantity),
        customer_id: s.customer_id ?? null,
        seller_id: s.seller_id ?? null,
        status: s.status,
        created_at: s.created_at,
      }));
      const curPayments: PaymentLite[] = curRows.flatMap((s) =>
        (s.sale_payments ?? []).map((p) => ({
          id: p.id,
          amount: Number(p.amount ?? 0),
          paid_at: p.paid_at,
          payment_method_id: p.payment_method_id ?? null,
        }))
      );
      const prevRows = (prevSalesQ.data ?? []) as PrevSaleRow[];
      const prevPaymentsTotal = prevRows.reduce(
        (s, r) =>
          s +
          (r.sale_payments ?? []).reduce(
            (ss: number, p) => ss + Number(p.amount ?? 0),
            0
          ),
        0
      );

      const stockData = (stockQ.data ?? null) as {
        on_hand: number | null;
      } | null;
      const prodData = (prodQ.data ?? null) as {
        min_stock: number | null;
      } | null;
      const cashData = (cashQ.data ?? null) as {
        id: string;
        opened_at: string | null;
      } | null;

      setState({
        curSales,
        curPayments,
        curExpenses: sumAmount(curExpensesQ.data as AmountRow[] | null),
        prevSalesTotal: sumTotal(prevSalesQ.data as TotalRow[] | null),
        prevPaymentsTotal,
        prevExpenses: sumAmount(prevExpensesQ.data as AmountRow[] | null),
        chart30Sales,
        recent: (recentQ.data as Sale[]) ?? [],
        receivable,
        oldestOpenIso,
        stock: Number(stockData?.on_hand ?? 0),
        minStock: Number(prodData?.min_stock ?? 0),
        cashOpen: !!cashData,
        cashOpenedAt: cashData?.opened_at ?? null,
        openCargas: cargasData.length,
        oldestCargaOpenedAt,
      });
      setCustomers((custsQ.data as Customer[]) ?? []);
      setSellers((sellersQ.data as Seller[]) ?? []);
      setMethods((methodsQ.data as PaymentMethod[]) ?? []);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  // Realtime: invalida o painel quando vendas, pagamentos ou despesas
  // mudam em qualquer lugar do app. Faz reload simples com debounce
  // pra agrupar bursts (ex.: import de Excel).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => load(), 1500);
    };
    const channel = supabase
      .channel("dashboard-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales" },
        trigger
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sale_payments" },
        trigger
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "expenses" },
        trigger
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  const customerMap = useMemo(() => {
    const m: Record<string, Customer> = {};
    customers.forEach((c) => (m[c.id] = c));
    return m;
  }, [customers]);
  const sellerMap = useMemo(() => {
    const m: Record<string, Seller> = {};
    sellers.forEach((s) => (m[s.id] = s));
    return m;
  }, [sellers]);
  const methodMap = useMemo(() => {
    const m: Record<string, PaymentMethod> = {};
    methods.forEach((p) => (m[p.id] = p));
    return m;
  }, [methods]);

  const faturado = state.curSales.reduce((s, r) => s + r.total, 0);
  const recebido = state.curPayments.reduce((s, p) => s + p.amount, 0);
  const lucroAtual = recebido - state.curExpenses;
  const lucroPrev = state.prevPaymentsTotal - state.prevExpenses;
  const totalCocos = state.curSales.reduce((s, r) => s + r.quantity, 0);
  const recebidoPctFat =
    faturado > 0 ? Math.round((recebido / faturado) * 100) : null;

  const dFat = pctChange(faturado, state.prevSalesTotal);
  const dRec = pctChange(recebido, state.prevPaymentsTotal);
  const dLucro = pctChange(lucroAtual, lucroPrev);

  // Pontos do gráfico — recalculados quando muda o range, o vendedor
  // filtrado, ou os dados crus.
  const chartPoints = useMemo<BarPoint[]>(() => {
    const days = lastNDays(chartDays);
    const filtered = chartSellerId
      ? state.chart30Sales.filter((r) => r.seller_id === chartSellerId)
      : state.chart30Sales;
    const buckets = bucketByDay(
      filtered,
      days,
      (r) => new Date(r.created_at),
      (r) => r.total
    );
    // todayKey precisa ser yyyy-mm-dd em TZ LOCAL (não UTC). E o
    // rótulo da barra também é gerado a partir de uma Date construída
    // em local-midnight, senão fusos negativos mostram "01/05" pra
    // bucket "2026-05-02" (parsing ISO date-only é UTC).
    const todayKey = fmtYmd(days[days.length - 1]);
    return buckets.map((b) => {
      const d = ymdToDate(b.date);
      return {
        date: b.date,
        value: b.value,
        label: d.toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
        }),
        subLabel: WEEKDAY_LABELS[d.getDay()],
        highlight: b.date === todayKey,
      };
    });
  }, [chartDays, chartSellerId, state.chart30Sales]);

  const chartSummary = useMemo(() => {
    const total = chartPoints.reduce((s, p) => s + p.value, 0);
    const days = chartPoints.length || 1;
    const avg = total / days;
    const peak = chartPoints.reduce(
      (m, p) => (p.value > m.value ? p : m),
      { value: 0, date: "" } as { value: number; date: string }
    );
    return { total, avg, peak };
  }, [chartPoints]);

  // Vendas dentro da janela do gráfico (chartDays). Usado pelos top lists
  // pra que o ranking sempre cubra um período útil mesmo quando o seletor
  // principal está em "Hoje".
  const chartWindowSales = useMemo(() => {
    const days = lastNDays(chartDays);
    const startMs = days[0].getTime();
    const endMs = days[days.length - 1].getTime() + 86_400_000;
    return state.chart30Sales.filter((s) => {
      const t = new Date(s.created_at).getTime();
      return t >= startMs && t < endMs;
    });
  }, [chartDays, state.chart30Sales]);

  const topSellers = useMemo(
    () =>
      topBy(
        chartWindowSales,
        (s) => s.seller_id,
        (s) => s.total,
        3
      ).map((t) => ({
        key: t.key,
        label: sellerMap[t.key]?.name ?? "—",
        value: t.value,
      })),
    [chartWindowSales, sellerMap]
  );
  const topCustomers = useMemo(
    () =>
      topBy(
        chartWindowSales,
        (s) => s.customer_id,
        (s) => s.total,
        3
      ).map((t) => ({
        key: t.key,
        label: customerMap[t.key]?.name ?? "—",
        value: t.value,
      })),
    [chartWindowSales, customerMap]
  );
  const topMethods = useMemo(
    () =>
      topBy(
        state.curPayments,
        (p) => p.payment_method_id,
        (p) => p.amount,
        3
      ).map((t) => ({
        key: t.key,
        label: methodMap[t.key]?.name ?? "Outros",
        value: t.value,
      })),
    [state.curPayments, methodMap]
  );

  const alerts = useMemo<DashboardAlert[]>(() => {
    const list: DashboardAlert[] = [];
    if (state.minStock > 0 && state.stock <= state.minStock) {
      list.push({
        id: "stock",
        icon: "🥥",
        text:
          state.stock <= 0
            ? "Estoque zerado"
            : `Estoque baixo: ${state.stock} ≤ mínimo ${state.minStock}`,
        href: "/estoque",
        tone: "red",
      });
    }
    const oldestOpenH = hoursSince(state.oldestOpenIso);
    if (oldestOpenH !== null && oldestOpenH > 24 * 30) {
      list.push({
        id: "fiado",
        icon: "💰",
        text: `Fiado em aberto há +${Math.floor(oldestOpenH / 24)} dias`,
        href: "/receber",
        tone: "amber",
      });
    }
    const cashH = hoursSince(state.cashOpenedAt);
    if (state.cashOpen && cashH !== null && cashH >= 24) {
      list.push({
        id: "cash",
        icon: "💵",
        text: `Caixa aberto há ${cashH}h`,
        href: "/caixa",
        tone: "amber",
      });
    }
    const cargaH = hoursSince(state.oldestCargaOpenedAt);
    if (state.openCargas > 0 && cargaH !== null && cargaH >= 24) {
      list.push({
        id: "carga",
        icon: "🚚",
        text:
          state.openCargas === 1
            ? `Carga aberta há ${cargaH}h`
            : `${state.openCargas} cargas abertas (mais antiga há ${cargaH}h)`,
        href: "/cargas",
        tone: "amber",
      });
    }
    return list;
  }, [state]);

  const presetLabel =
    DASHBOARD_PRESETS.find((p) => p.id === preset)?.label ?? "";

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">Painel</h1>
          <p className="text-coco-600">
            Operações e financeiro · período: <strong>{presetLabel}</strong>
          </p>
        </div>
        <div className="flex flex-wrap gap-1 bg-coco-50 p-1 rounded-xl">
          {DASHBOARD_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                preset === p.id
                  ? "bg-white text-coco-900 shadow-sm font-semibold"
                  : "text-coco-700 hover:bg-white/60"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="card border-red-300 bg-red-50 text-red-700">
          Erro ao carregar dados: {error}
        </div>
      )}

      <DashboardAlerts alerts={alerts} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <DashboardKpi
          label="Faturado"
          icon="🧾"
          accent="primary"
          size="hero"
          value={brl(faturado)}
          sub={
            <>
              {state.curSales.length} venda
              {state.curSales.length === 1 ? "" : "s"} · {totalCocos} coco
              {totalCocos === 1 ? "" : "s"}
              {dFat !== null && (
                <span className="ml-2 opacity-90">{fmtPct(dFat)}</span>
              )}
            </>
          }
        />
        <DashboardKpi
          label="Recebido"
          icon="💵"
          accent="green"
          size="hero"
          value={brl(recebido)}
          sub={
            <>
              {recebidoPctFat !== null
                ? `${recebidoPctFat}% do faturado`
                : "—"}
              {dRec !== null && <span className="ml-2">{fmtPct(dRec)}</span>}
            </>
          }
        />
        <DashboardKpi
          label="Lucro estimado"
          icon={lucroAtual >= 0 ? "📈" : "📉"}
          accent={lucroAtual >= 0 ? "green" : "red"}
          size="hero"
          value={brl(lucroAtual)}
          sub={
            <>
              recebido − despesas
              {dLucro !== null && (
                <span className="ml-2">{fmtPct(dLucro)} vs anterior</span>
              )}
            </>
          }
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <DashboardKpi
          label="A receber (fiado)"
          icon="📒"
          accent="amber"
          value={brl(state.receivable)}
          href="/receber"
          sub="saldo aberto atual"
        />
        <DashboardKpi
          label={`Despesas · ${presetLabel.toLowerCase()}`}
          icon="💸"
          accent="red"
          value={brl(state.curExpenses)}
          href="/despesas"
        />
        <DashboardKpi
          label="Estoque"
          icon="🥥"
          accent={
            state.minStock > 0 && state.stock <= state.minStock
              ? "red"
              : state.stock > 0
              ? "green"
              : "neutral"
          }
          value={`${state.stock} cocos`}
          href="/estoque"
          sub={state.minStock > 0 ? `mínimo ${state.minStock}` : undefined}
        />
        <DashboardKpi
          label="Caixa"
          icon="💵"
          accent={state.cashOpen ? "green" : "neutral"}
          value={state.cashOpen ? "Aberto" : "Fechado"}
          href="/caixa"
          sub={
            state.cashOpen && state.cashOpenedAt
              ? `há ${hoursSince(state.cashOpenedAt) ?? 0}h`
              : undefined
          }
        />
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold text-coco-900">
              Vendas por dia · últimos {chartDays} dias
              {chartSellerId && sellerMap[chartSellerId] && (
                <span className="text-coco-600 font-normal text-base ml-1">
                  · {sellerMap[chartSellerId].name}
                </span>
              )}
            </h2>
            <p className="text-xs text-coco-600">
              Total {brl(chartSummary.total)} · média{" "}
              {brl(chartSummary.avg)}/dia
              {chartSummary.peak.value > 0 && (
                <>
                  {" "}
                  · melhor dia{" "}
                  {ymdToDate(chartSummary.peak.date).toLocaleDateString(
                    "pt-BR",
                    { day: "2-digit", month: "2-digit" }
                  )}{" "}
                  ({brl(chartSummary.peak.value)})
                </>
              )}
            </p>
          </div>
          <Link href="/relatorios" className="text-coco-700 text-sm underline">
            ver mais
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex gap-1 bg-coco-50 p-1 rounded-xl">
            {CHART_DAY_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setChartDays(d)}
                className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                  chartDays === d
                    ? "bg-white text-coco-900 shadow-sm font-semibold"
                    : "text-coco-700 hover:bg-white/60"
                }`}
              >
                {d} dias
              </button>
            ))}
          </div>
          <select
            value={chartSellerId}
            onChange={(e) => setChartSellerId(e.target.value)}
            className="input !py-1 !w-auto text-sm"
            aria-label="Filtrar gráfico por vendedor"
          >
            <option value="">Todos os vendedores</option>
            {sellers
              .filter((s) => s.active || s.id === chartSellerId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.active ? "" : " (inativo)"}
                </option>
              ))}
          </select>
          {chartSellerId && (
            <button
              onClick={() => setChartSellerId("")}
              className="text-coco-700 text-xs underline"
            >
              limpar filtro
            </button>
          )}
        </div>
        {chartPoints.length > 0 && chartSummary.total > 0 ? (
          <BarChart points={chartPoints} />
        ) : (
          <p className="text-coco-600 text-sm">
            Sem vendas no intervalo
            {chartSellerId ? " pra esse vendedor" : ""}.
          </p>
        )}
      </div>

      <details className="card">
        <summary className="cursor-pointer font-bold text-coco-900">
          🔍 Auditar vendas contabilizadas em{" "}
          <span className="text-coco-700 font-normal">
            {presetLabel.toLowerCase()}
          </span>{" "}
          ({state.curSales.length})
        </summary>
        <p className="text-xs text-coco-600 mt-2">
          Cada linha aqui é uma venda que entrou no <strong>Faturado</strong>.
          Vendas canceladas (canceled_at definido) já são filtradas.
        </p>
        {state.curSales.length === 0 ? (
          <p className="text-coco-600 text-sm mt-3">
            Nada contabilizado nesse período.
          </p>
        ) : (
          <div className="overflow-x-auto mt-3">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Data/hora</th>
                  <th>Cliente</th>
                  <th>Vendedor</th>
                  <th>Qtd</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {[...state.curSales]
                  .sort(
                    (a, b) =>
                      new Date(b.created_at).getTime() -
                      new Date(a.created_at).getTime()
                  )
                  .map((s) => (
                    <tr key={s.id}>
                      <td className="text-coco-500">#{s.code}</td>
                      <td>{fmtDate(s.created_at)}</td>
                      <td>
                        {s.customer_id
                          ? customerMap[s.customer_id]?.name ?? "—"
                          : "Consumidor"}
                      </td>
                      <td>
                        {s.seller_id
                          ? sellerMap[s.seller_id]?.name ?? "—"
                          : "—"}
                      </td>
                      <td>{s.quantity}</td>
                      <td className="font-semibold">{brl(Number(s.total))}</td>
                      <td>
                        <StatusBadge status={s.status} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <TopList
          title={`Top vendedores · ${chartDays}d`}
          icon="🏆"
          items={topSellers}
          emptyText={`Sem vendas nos últimos ${chartDays} dias.`}
        />
        <TopList
          title={`Top clientes · ${chartDays}d`}
          icon="👤"
          items={topCustomers}
          emptyText={`Sem cliente identificado nos últimos ${chartDays} dias.`}
        />
        <TopList
          title={`Recebido por forma · ${presetLabel.toLowerCase()}`}
          icon="💳"
          items={topMethods}
          emptyText={`Nada recebido em ${presetLabel.toLowerCase()}.`}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link href="/vendas" className="btn-primary text-center text-base">
          🥥 Nova venda
        </Link>
        <Link href="/receber" className="btn-secondary text-center text-base">
          📒 Receber
        </Link>
        <Link href="/despesas" className="btn-secondary text-center text-base">
          💸 Despesa
        </Link>
        <Link href="/cargas" className="btn-secondary text-center text-base">
          🚚 Cargas
        </Link>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-coco-900">Últimas vendas</h2>
          <Link href="/relatorios" className="text-coco-700 text-sm underline">
            ver todas
          </Link>
        </div>
        {loading ? (
          <SkeletonRows />
        ) : state.recent.length === 0 ? (
          <p className="text-coco-600">Nenhuma venda registrada ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th>Vendedor</th>
                  <th>Qtd</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {state.recent.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setEditing(s)}
                    className={`cursor-pointer hover:bg-coco-50 ${
                      s.status === "cancelada" ? "opacity-60" : ""
                    }`}
                  >
                    <td className="text-coco-500">#{s.code}</td>
                    <td>{fmtDate(s.created_at)}</td>
                    <td>
                      {s.customer_id
                        ? customerMap[s.customer_id]?.name ?? "—"
                        : "Consumidor"}
                    </td>
                    <td>
                      {s.seller_id
                        ? sellerMap[s.seller_id]?.name ?? "—"
                        : "—"}
                    </td>
                    <td>{s.quantity}</td>
                    <td className="font-semibold">{brl(Number(s.total))}</td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <SaleEditor
          sale={editing}
          customers={customers}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
