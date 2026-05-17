"use client";

import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/lib/ui";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate, fmtPct, pctChange } from "@/lib/format";
import {
  DASHBOARD_PRESETS,
  type DashboardPreset,
  bucketBy,
  chartGranularity,
  dashboardRange,
  hoursSince,
  previousRange,
  rangeBoundsIso,
  rangeDays,
  rangeWeeks,
  topBy,
  ymdToDate,
} from "@/lib/dashboard";
import { fmtYmd, startOfWeekMonday } from "@/lib/dateRanges";
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
import TodayCard from "@/components/TodayCard";
import SyncStatus from "@/components/SyncStatus";
import SaleEditor from "@/components/SaleEditor";
import EmptyOnboarding, {
  type OnboardingStep,
} from "@/components/EmptyOnboarding";
import { useTenant } from "@/lib/useTenant";

type SaleLite = Pick<
  Sale,
  | "id"
  | "code"
  | "total"
  | "paid_amount"
  | "quantity"
  | "customer_id"
  | "seller_id"
  | "carga_id"
  | "status"
  | "created_at"
>;

type InvMovement = {
  kind: string;
  quantity: number;
  unit_cost: number | null;
  created_at: string;
};

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
  // período corrente (já filtrado por seller no SQL)
  curSales: SaleLite[];
  curPayments: PaymentLite[];
  curExpenses: number;
  // período anterior equivalente
  prevSalesTotal: number;
  prevPaymentsTotal: number;
  prevExpenses: number;
  // série bruta (mesmo range, mesmo seller) pra gráfico
  chartSales: ChartSale[];
  recent: Sale[];
  // estado fixo (independem de range)
  receivable: number;
  oldestOpenIso: string | null;
  stock: number;
  minStock: number;
  cashOpen: boolean;
  cashOpenedAt: string | null;
  openCargas: number;
  oldestCargaOpenedAt: string | null;
  // CMV: entradas de estoque pra custo médio ponderado
  invMovements: InvMovement[];
};

const EMPTY: State = {
  curSales: [],
  curPayments: [],
  curExpenses: 0,
  prevSalesTotal: 0,
  prevPaymentsTotal: 0,
  prevExpenses: 0,
  chartSales: [],
  recent: [],
  receivable: 0,
  oldestOpenIso: null,
  stock: 0,
  minStock: 0,
  cashOpen: false,
  cashOpenedAt: null,
  openCargas: 0,
  oldestCargaOpenedAt: null,
  invMovements: [],
};

const WEEKDAY_LABELS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function todayYmd(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return fmtYmd(d);
}
function ymdNDaysAgo(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return fmtYmd(d);
}

export default function DashboardClient() {
  const supabase = createClient();
  const { tenant, isAdmin } = useTenant();
  // Filtro principal — governa todos os KPIs, gráfico, top lists e auditoria.
  const [presetId, setPresetId] = useState<DashboardPreset>("hoje");
  const [customFrom, setCustomFrom] = useState<string>(() => ymdNDaysAgo(6));
  const [customTo, setCustomTo] = useState<string>(() => todayYmd());
  const [sellerId, setSellerId] = useState<string>("");

  const [state, setState] = useState<State>(EMPTY);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [editing, setEditing] = useState<Sale | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Métrica do gráfico: faturamento R$ / cocos vendidos / preço médio R$/coco.
  const [chartMetric, setChartMetric] = useState<
    "revenue" | "cocos" | "avg_price"
  >("revenue");
  // Contagens pra onboarding (só carrega 1× por tenant)
  const [counts, setCounts] = useState<{
    vehicles: number;
    sellers: number;
    methods: number;
    cargas: number;
  } | null>(null);

  const range = useMemo(
    () => dashboardRange(presetId, new Date(), { from: customFrom, to: customTo }),
    [presetId, customFrom, customTo]
  );
  const prevR = useMemo(() => previousRange(range), [range]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const cur = rangeBoundsIso(range);
      const prev = rangeBoundsIso(prevR);

      // Filtro por vendedor: aplicado tanto no SQL (curSales/prevSales)
      // quanto na contagem do gráfico — chartSales = curSales (mesmo range,
      // mesmos filtros), evitando descompasso entre painel e gráfico.
      const curSalesBuilder = supabase
        .from("sales")
        .select(
          "id,code,total,paid_amount,quantity,customer_id,seller_id,carga_id,status,created_at,sale_payments(id,amount,paid_at,payment_method_id)"
        )
        .gte("created_at", cur.startIso)
        .lt("created_at", cur.endIso)
        .is("canceled_at", null);
      const prevSalesBuilder = supabase
        .from("sales")
        .select("total,sale_payments(amount)")
        .gte("created_at", prev.startIso)
        .lt("created_at", prev.endIso)
        .is("canceled_at", null);
      const curSalesQuery = sellerId
        ? curSalesBuilder.eq("seller_id", sellerId)
        : curSalesBuilder;
      const prevSalesQuery = sellerId
        ? prevSalesBuilder.eq("seller_id", sellerId)
        : prevSalesBuilder;

      const [
        curSalesQ,
        curExpensesQ,
        prevSalesQ,
        prevExpensesQ,
        recentQ,
        balancesQ,
        stockQ,
        prodQ,
        cashQ,
        cargasQ,
        custsQ,
        sellersQ,
        methodsQ,
        invMovQ,
      ] = await Promise.all([
        curSalesQuery,
        supabase
          .from("expenses")
          .select("amount")
          .gte("paid_at", cur.startIso)
          .lt("paid_at", cur.endIso),
        prevSalesQuery,
        supabase
          .from("expenses")
          .select("amount")
          .gte("paid_at", prev.startIso)
          .lt("paid_at", prev.endIso),
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
        supabase
          .from("inventory_movements")
          .select("kind,quantity,unit_cost,created_at")
          .eq("kind", "entrada")
          .order("created_at", { ascending: true }),
      ]);

      type SaleWithPayments = {
        id: string;
        code: number;
        total: number | string;
        paid_amount: number | string;
        quantity: number | string;
        customer_id: string | null;
        seller_id: string | null;
        carga_id: string | null;
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
        carga_id: s.carga_id ?? null,
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

      // Série pro gráfico = mesmas vendas do KPI (range + seller).
      const chartSales: ChartSale[] = curSales.map((s) => ({
        id: s.id,
        code: s.code,
        created_at: s.created_at,
        total: s.total,
        quantity: s.quantity,
        customer_id: s.customer_id ?? null,
        seller_id: s.seller_id ?? null,
      }));

      setState({
        curSales,
        curPayments,
        curExpenses: sumAmount(curExpensesQ.data as AmountRow[] | null),
        prevSalesTotal: sumTotal(prevSalesQ.data as TotalRow[] | null),
        prevPaymentsTotal,
        prevExpenses: sumAmount(prevExpensesQ.data as AmountRow[] | null),
        chartSales,
        recent: (recentQ.data as Sale[]) ?? [],
        receivable,
        oldestOpenIso,
        stock: Number(stockData?.on_hand ?? 0),
        minStock: Number(prodData?.min_stock ?? 0),
        cashOpen: !!cashData,
        cashOpenedAt: cashData?.opened_at ?? null,
        openCargas: cargasData.length,
        oldestCargaOpenedAt,
        invMovements: (invMovQ.data as InvMovement[]) ?? [],
      });
      setCustomers((custsQ.data as Customer[]) ?? []);
      setSellers((sellersQ.data as Seller[]) ?? []);
      setMethods((methodsQ.data as PaymentMethod[]) ?? []);
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  // Reload sempre que muda range efetivo ou seller. Usar strings primitivas
  // como deps evita ciclos quando `range` é recalculado a cada render.
  const queryKey = `${range.from}_${range.to}_${sellerId}`;
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  // Onboarding: carrega contagens uma vez por tenant pra decidir
  // quais passos exibir no checklist.
  useEffect(() => {
    if (!tenant || !isAdmin) return;
    let cancelled = false;
    (async () => {
      const [veh, sl, mt, cg] = await Promise.all([
        supabase
          .from("vehicles")
          .select("id", { count: "exact", head: true }),
        supabase
          .from("sellers")
          .select("id", { count: "exact", head: true }),
        supabase
          .from("payment_methods")
          .select("id", { count: "exact", head: true }),
        supabase
          .from("cargas")
          .select("id", { count: "exact", head: true }),
      ]);
      if (cancelled) return;
      setCounts({
        vehicles: veh.count ?? 0,
        sellers: sl.count ?? 0,
        methods: mt.count ?? 0,
        cargas: cg.count ?? 0,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [tenant, isAdmin, supabase]);

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
  }, [queryKey]);

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
  const avgPrice = totalCocos > 0 ? faturado / totalCocos : 0;
  const cocosPerDay = useMemo(() => {
    const days = rangeDays(range).length || 1;
    return totalCocos / days;
  }, [totalCocos, range]);
  const recebidoPctFat =
    faturado > 0 ? Math.round((recebido / faturado) * 100) : null;

  // CMV via custo médio ponderado das entradas de estoque (mesma lógica do DRE).
  const cmv = useMemo(() => {
    if (state.invMovements.length === 0)
      return { custo: 0, custoUnitMedio: 0, semCusto: true, fonteHistorica: false };
    const startMs = new Date(rangeBoundsIso(range).startIso).getTime();
    const entriesInPeriod = state.invMovements.filter(
      (m) =>
        new Date(m.created_at).getTime() >= startMs &&
        m.unit_cost !== null &&
        Number(m.unit_cost) > 0
    );
    let qty = 0;
    let cost = 0;
    const source = entriesInPeriod.length > 0 ? entriesInPeriod : state.invMovements;
    for (const m of source) {
      if (m.unit_cost && Number(m.unit_cost) > 0) {
        qty += Number(m.quantity);
        cost += Number(m.quantity) * Number(m.unit_cost);
      }
    }
    const unitMedio = qty > 0 ? cost / qty : 0;
    return {
      custo: +(totalCocos * unitMedio).toFixed(2),
      custoUnitMedio: unitMedio,
      semCusto: unitMedio === 0,
      fonteHistorica: entriesInPeriod.length === 0,
    };
  }, [state.invMovements, totalCocos, range]);

  const margemBruta = faturado - cmv.custo;
  const margemBrutaPct = faturado > 0 ? Math.round((margemBruta / faturado) * 100) : null;

  // Receita por canal: vendas via carga (rotas) vs varejo direto.
  const receitaCargas = state.curSales.reduce(
    (s, r) => s + (r.carga_id ? r.total : 0),
    0
  );
  const receitaVarejo = faturado - receitaCargas;

  const dFat = pctChange(faturado, state.prevSalesTotal);
  const dRec = pctChange(recebido, state.prevPaymentsTotal);
  const dLucro = pctChange(lucroAtual, lucroPrev);

  // Granularidade automática: ≤62 dias = barras diárias; senão semanais.
  const granularity = useMemo(() => chartGranularity(range), [range]);

  const chartPoints = useMemo<BarPoint[]>(() => {
    const todayKey = fmtYmd(
      (() => {
        const t = new Date();
        t.setHours(0, 0, 0, 0);
        return t;
      })()
    );
    const buckets =
      granularity === "week" ? rangeWeeks(range) : rangeDays(range);
    const keyFn = (d: Date) =>
      granularity === "week" ? fmtYmd(startOfWeekMonday(d)) : fmtYmd(d);
    // Bucket triplo: revenue, cocos e contagem de vendas (pra média).
    const accs = buckets.map(() => ({ revenue: 0, cocos: 0 }));
    const idx = new Map<string, number>();
    buckets.forEach((d, i) => idx.set(fmtYmd(d), i));
    for (const r of state.chartSales) {
      const k = keyFn(new Date(r.created_at));
      const i = idx.get(k);
      if (i === undefined) continue;
      accs[i].revenue += r.total;
      accs[i].cocos += r.quantity;
    }
    const todayBucketKey =
      granularity === "week"
        ? fmtYmd(startOfWeekMonday(ymdToDate(todayKey)))
        : todayKey;
    return buckets.map((d, i) => {
      const date = fmtYmd(d);
      const acc = accs[i];
      let value: number;
      if (chartMetric === "cocos") value = acc.cocos;
      else if (chartMetric === "avg_price")
        value = acc.cocos > 0 ? acc.revenue / acc.cocos : 0;
      else value = acc.revenue;
      return {
        date,
        value,
        label: d.toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
        }),
        subLabel:
          granularity === "week" ? "sem" : WEEKDAY_LABELS[d.getDay()],
        highlight: date === todayBucketKey,
      };
    });
  }, [granularity, range, state.chartSales, chartMetric]);

  // Preço médio é R$, demais BRL/Int adequam o eixo Y do BarChart.
  const chartUnit: "brl" | "int" =
    chartMetric === "cocos" ? "int" : "brl";

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

  const topSellers = useMemo(
    () =>
      topBy(
        state.curSales,
        (s) => s.seller_id,
        (s) => s.total,
        3
      ).map((t) => ({
        key: t.key,
        label: sellerMap[t.key]?.name ?? "—",
        value: t.value,
      })),
    [state.curSales, sellerMap]
  );
  const topCustomers = useMemo(
    () =>
      topBy(
        state.curSales,
        (s) => s.customer_id,
        (s) => s.total,
        3
      ).map((t) => ({
        key: t.key,
        label: customerMap[t.key]?.name ?? "—",
        value: t.value,
      })),
    [state.curSales, customerMap]
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
    DASHBOARD_PRESETS.find((p) => p.id === presetId)?.label ?? "";
  const rangeLabel = useMemo(() => {
    if (presetId !== "personalizado") return presetLabel;
    const f = ymdToDate(range.from);
    const t = ymdToDate(range.to);
    const sameDay = range.from === range.to;
    const fmt = (d: Date) =>
      d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    return sameDay ? fmt(f) : `${fmt(f)} – ${fmt(t)}`;
  }, [presetId, presetLabel, range]);
  const sellerLabel = sellerId
    ? sellerMap[sellerId]?.name ?? null
    : null;

  // Onboarding: só renderiza pra admin com tenant fresco (<14 dias)
  // E que ainda não fechou todos os passos. Não pisca: se counts não
  // chegou, não renderiza nada.
  const onboardingSteps = useMemo<OnboardingStep[]>(() => {
    if (!isAdmin || !counts || !tenant) return [];
    const tenantAgeDays =
      (Date.now() - new Date(tenant.created_at).getTime()) / 86_400_000;
    if (tenantAgeDays > 14) return [];
    return [
      {
        id: "methods",
        label: "Configurar formas de pagamento",
        description: "Dinheiro, PIX, cartão — com taxas pra DRE.",
        href: "/formas-pagamento",
        done: counts.methods > 0,
      },
      {
        id: "vehicles",
        label: "Cadastrar veículo",
        description: "Carro/moto da rota.",
        href: "/configuracoes/veiculos",
        done: counts.vehicles > 0,
      },
      {
        id: "sellers",
        label: "Cadastrar vendedor",
        description: "Quem vende em campo (com comissão se quiser).",
        href: "/configuracoes/vendedores",
        done: counts.sellers > 0,
      },
      {
        id: "cargas",
        label: "Abrir primeira carga",
        description: "Estoque, operador, rota — começa a operação.",
        href: "/carga/abrir",
        done: counts.cargas > 0,
      },
    ];
  }, [isAdmin, counts, tenant]);

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold text-coco-900">Painel</h1>
            <p className="text-coco-600 text-sm">
              Operações e financeiro · período:{" "}
              <strong>{rangeLabel}</strong>
              {sellerLabel && (
                <>
                  {" · vendedor: "}
                  <strong>{sellerLabel}</strong>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 bg-coco-50 p-1 rounded-xl overflow-x-auto max-w-full">
            {DASHBOARD_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPresetId(p.id)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors whitespace-nowrap ${
                  presetId === p.id
                    ? "bg-white text-coco-900 shadow-sm font-semibold"
                    : "text-coco-700 hover:bg-white/60"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <select
            value={sellerId}
            onChange={(e) => setSellerId(e.target.value)}
            className="input !py-1.5 !w-auto text-sm"
            aria-label="Filtrar painel por vendedor"
          >
            <option value="">Todos os vendedores</option>
            {sellers
              .filter((s) => s.active || s.id === sellerId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.active ? "" : " (inativo)"}
                </option>
              ))}
          </select>
          {sellerId && (
            <button
              onClick={() => setSellerId("")}
              className="text-coco-700 text-xs underline"
            >
              limpar vendedor
            </button>
          )}
        </div>

        {presetId === "personalizado" && (
          <div className="flex flex-wrap items-end gap-2 bg-coco-50 p-3 rounded-xl">
            <div>
              <label className="label text-xs">De</label>
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="input !py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="label text-xs">Até</label>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value)}
                className="input !py-1.5 text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-1 ml-auto">
              <button
                type="button"
                onClick={() => {
                  setCustomFrom(ymdNDaysAgo(6));
                  setCustomTo(todayYmd());
                }}
                className="text-xs text-coco-700 underline"
              >
                últimos 7 dias
              </button>
              <button
                type="button"
                onClick={() => {
                  setCustomFrom(ymdNDaysAgo(29));
                  setCustomTo(todayYmd());
                }}
                className="text-xs text-coco-700 underline"
              >
                últimos 30 dias
              </button>
            </div>
          </div>
        )}
      </header>

      {error && (
        <div className="card border-red-300 bg-red-50 text-red-700">
          Erro ao carregar dados: {error}
        </div>
      )}

      {onboardingSteps.length > 0 && (
        <EmptyOnboarding steps={onboardingSteps} />
      )}

      <TodayCard />

      <SyncStatus />

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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <DashboardKpi
          label="Cocos vendidos"
          icon="🥥"
          accent="primary"
          value={totalCocos.toLocaleString("pt-BR")}
          sub={
            cocosPerDay > 0
              ? `${Math.round(cocosPerDay).toLocaleString("pt-BR")}/dia`
              : undefined
          }
        />
        <DashboardKpi
          label="Preço médio"
          icon="🏷️"
          accent="green"
          value={totalCocos > 0 ? brl(avgPrice) : "—"}
          sub={totalCocos > 0 ? "R$/coco" : "sem vendas"}
        />
        <DashboardKpi
          label="A receber (fiado)"
          icon="📒"
          accent="amber"
          value={brl(state.receivable)}
          href="/receber"
          sub="saldo aberto atual"
        />
        <DashboardKpi
          label={`Despesas · ${rangeLabel.toLowerCase()}`}
          icon="💸"
          accent="red"
          value={brl(state.curExpenses)}
          href="/pagar"
          sub={sellerLabel ? "(global, sem filtro de vendedor)" : undefined}
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

      {/* Margem Bruta e KPIs por Canal de Venda */}
      <div className="card space-y-3">
        <h2 className="text-base font-bold text-coco-900">
          Margem &amp; Canal de Venda · <span className="font-normal text-coco-600">{rangeLabel}</span>
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <DashboardKpi
            label="Margem bruta"
            icon="📊"
            accent={margemBruta >= 0 ? "green" : "red"}
            value={cmv.semCusto ? "—" : brl(margemBruta)}
            sub={
              cmv.semCusto
                ? "sem custo cadastrado"
                : margemBrutaPct !== null
                ? `${margemBrutaPct}% do faturado`
                : undefined
            }
          />
          <DashboardKpi
            label="CMV estimado"
            icon="🏭"
            accent="neutral"
            value={cmv.semCusto ? "—" : brl(cmv.custo)}
            sub={
              cmv.semCusto
                ? "sem custo cadastrado"
                : cmv.fonteHistorica
                ? "custo histórico"
                : "custo do período"
            }
          />
          <DashboardKpi
            label="Custo médio/coco"
            icon="🥥"
            accent="neutral"
            value={cmv.custoUnitMedio > 0 ? brl(cmv.custoUnitMedio) : "—"}
            sub={cmv.custoUnitMedio > 0 ? "R$/unidade" : "sem custo cadastrado"}
          />
          <DashboardKpi
            label="Varejo direto"
            icon="🛒"
            accent="primary"
            value={brl(receitaVarejo)}
            sub={
              faturado > 0
                ? `${Math.round((receitaVarejo / faturado) * 100)}% do faturado`
                : "sem vendas"
            }
          />
          <DashboardKpi
            label="Cargas / Rotas"
            icon="🚚"
            accent="amber"
            value={brl(receitaCargas)}
            href="/cargas"
            sub={
              faturado > 0
                ? `${Math.round((receitaCargas / faturado) * 100)}% do faturado`
                : "sem vendas"
            }
          />
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold text-coco-900">
              {chartMetric === "cocos"
                ? "Cocos vendidos"
                : chartMetric === "avg_price"
                ? "Preço médio (R$/coco)"
                : "Faturamento"}{" "}
              por {granularity === "week" ? "semana" : "dia"} · {rangeLabel}
              {sellerLabel && (
                <span className="text-coco-600 font-normal text-base ml-1">
                  · {sellerLabel}
                </span>
              )}
            </h2>
            <p className="text-xs text-coco-600">
              {chartMetric === "cocos" ? (
                <>
                  Total {totalCocos.toLocaleString("pt-BR")} · média{" "}
                  {Math.round(chartSummary.avg).toLocaleString("pt-BR")}/
                  {granularity === "week" ? "sem" : "dia"}
                </>
              ) : chartMetric === "avg_price" ? (
                <>
                  Geral {totalCocos > 0 ? brl(avgPrice) : "—"} · média por{" "}
                  {granularity === "week" ? "semana" : "dia"}{" "}
                  {brl(chartSummary.avg)}
                </>
              ) : (
                <>
                  Total {brl(chartSummary.total)} · média{" "}
                  {brl(chartSummary.avg)}/
                  {granularity === "week" ? "sem" : "dia"}
                </>
              )}
              {chartSummary.peak.value > 0 && (
                <>
                  {" "}
                  · melhor {granularity === "week" ? "semana" : "dia"}{" "}
                  {ymdToDate(chartSummary.peak.date).toLocaleDateString(
                    "pt-BR",
                    { day: "2-digit", month: "2-digit" }
                  )}{" "}
                  (
                  {chartUnit === "int"
                    ? Math.round(chartSummary.peak.value).toLocaleString(
                        "pt-BR"
                      )
                    : brl(chartSummary.peak.value)}
                  )
                </>
              )}
            </p>
          </div>
          <Link href="/relatorios" className="text-coco-700 text-sm underline">
            ver mais
          </Link>
        </div>

        <div className="flex flex-wrap gap-1 bg-coco-50 p-1 rounded-xl mb-3 w-fit">
          {(
            [
              { id: "revenue", label: "R$" },
              { id: "cocos", label: "Cocos" },
              { id: "avg_price", label: "R$/coco" },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              onClick={() => setChartMetric(m.id)}
              className={`px-3 py-1 text-sm rounded-lg transition-colors whitespace-nowrap ${
                chartMetric === m.id
                  ? "bg-white text-coco-900 shadow-sm font-semibold"
                  : "text-coco-700 hover:bg-white/60"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {chartPoints.length > 0 && chartSummary.total > 0 ? (
          <BarChart points={chartPoints} unit={chartUnit} />
        ) : (
          <p className="text-coco-600 text-sm">
            Sem vendas no intervalo
            {sellerLabel ? ` pra ${sellerLabel}` : ""}.
          </p>
        )}
      </div>

      <details className="card">
        <summary className="cursor-pointer font-bold text-coco-900">
          🔍 Auditar vendas contabilizadas em{" "}
          <span className="text-coco-700 font-normal">
            {rangeLabel.toLowerCase()}
            {sellerLabel ? ` · ${sellerLabel}` : ""}
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
          title={`Top vendedores · ${rangeLabel.toLowerCase()}`}
          icon="🏆"
          items={topSellers}
          emptyText={`Sem vendas em ${rangeLabel.toLowerCase()}.`}
        />
        <TopList
          title={`Top clientes · ${rangeLabel.toLowerCase()}`}
          icon="👤"
          items={topCustomers}
          emptyText={`Sem cliente identificado em ${rangeLabel.toLowerCase()}.`}
        />
        <TopList
          title={`Recebido por forma · ${rangeLabel.toLowerCase()}`}
          icon="💳"
          items={topMethods}
          emptyText={`Nada recebido em ${rangeLabel.toLowerCase()}.`}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link href="/vendas" className="btn-primary text-center text-base">
          🥥 Nova venda
        </Link>
        <Link href="/receber" className="btn-secondary text-center text-base">
          📒 Receber
        </Link>
        <Link href="/pagar" className="btn-secondary text-center text-base">
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
