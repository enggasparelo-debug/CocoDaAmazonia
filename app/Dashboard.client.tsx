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
  last14Days,
  previousRange,
  rangeBoundsIso,
  topBy,
} from "@/lib/dashboard";
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

type State = {
  // período corrente
  curSales: SaleLite[];
  curPayments: PaymentLite[];
  curExpenses: number;
  // período anterior equivalente
  prevSalesTotal: number;
  prevPaymentsTotal: number;
  prevExpenses: number;
  // séries fixas
  bar14: BarPoint[];
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
  bar14: [],
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

  const range = useMemo(() => dashboardRange(preset), [preset]);
  const prevR = useMemo(() => previousRange(range), [range]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const cur = rangeBoundsIso(range);
      const prev = rangeBoundsIso(prevR);
      const days = last14Days();
      const bar14Start = days[0].toISOString();

      const [
        curSalesQ,
        curPaymentsQ,
        curExpensesQ,
        prevSalesQ,
        prevPaymentsQ,
        prevExpensesQ,
        bar14Q,
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
            "id,code,total,paid_amount,quantity,customer_id,seller_id,status,created_at"
          )
          .gte("created_at", cur.startIso)
          .lt("created_at", cur.endIso)
          .neq("status", "cancelada"),
        supabase
          .from("sale_payments")
          .select("id,amount,paid_at,payment_method_id")
          .gte("paid_at", cur.startIso)
          .lt("paid_at", cur.endIso),
        supabase
          .from("expenses")
          .select("amount")
          .gte("paid_at", cur.startIso)
          .lt("paid_at", cur.endIso),
        supabase
          .from("sales")
          .select("total")
          .gte("created_at", prev.startIso)
          .lt("created_at", prev.endIso)
          .neq("status", "cancelada"),
        supabase
          .from("sale_payments")
          .select("amount")
          .gte("paid_at", prev.startIso)
          .lt("paid_at", prev.endIso),
        supabase
          .from("expenses")
          .select("amount")
          .gte("paid_at", prev.startIso)
          .lt("paid_at", prev.endIso),
        supabase
          .from("sales")
          .select("created_at,total,status")
          .gte("created_at", bar14Start),
        supabase
          .from("sales")
          .select("*")
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
        supabase.from("customers").select("*").order("name"),
        supabase.from("sellers").select("*").order("name"),
        supabase.from("payment_methods").select("*").order("name"),
      ]);

      const bar14Rows = (bar14Q.data ?? []).filter(
        (r: any) => r.status !== "cancelada"
      );
      const buckets = bucketByDay(
        bar14Rows as { created_at: string; total: number }[],
        days,
        (r) => new Date(r.created_at),
        (r) => Number(r.total)
      );
      const todayKey = days[days.length - 1].toISOString().slice(0, 10);
      const bar14: BarPoint[] = buckets.map((b) => {
        const d = new Date(b.date);
        return {
          date: b.date,
          value: b.value,
          label: d.toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
          }),
          highlight: b.date === todayKey,
        };
      });

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

      const sumAmount = (rows: any[] | null | undefined) =>
        (rows ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
      const sumTotal = (rows: any[] | null | undefined) =>
        (rows ?? []).reduce((s, r) => s + Number(r.total ?? 0), 0);

      setState({
        curSales: ((curSalesQ.data ?? []) as SaleLite[]).map((s) => ({
          ...s,
          total: Number(s.total),
          paid_amount: Number(s.paid_amount),
          quantity: Number(s.quantity),
        })),
        curPayments: ((curPaymentsQ.data ?? []) as PaymentLite[]).map((p) => ({
          ...p,
          amount: Number(p.amount),
        })),
        curExpenses: sumAmount(curExpensesQ.data),
        prevSalesTotal: sumTotal(prevSalesQ.data),
        prevPaymentsTotal: sumAmount(prevPaymentsQ.data),
        prevExpenses: sumAmount(prevExpensesQ.data),
        bar14,
        recent: (recentQ.data as Sale[]) ?? [],
        receivable,
        oldestOpenIso,
        stock: Number((stockQ.data as any)?.on_hand ?? 0),
        minStock: Number((prodQ.data as any)?.min_stock ?? 0),
        cashOpen: !!cashQ.data,
        cashOpenedAt: (cashQ.data as any)?.opened_at ?? null,
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
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-coco-900">
            Vendas · últimos 14 dias
          </h2>
          <Link href="/relatorios" className="text-coco-700 text-sm underline">
            ver mais
          </Link>
        </div>
        {state.bar14.length > 0 ? (
          <BarChart points={state.bar14} />
        ) : (
          <p className="text-coco-600 text-sm">Sem vendas no intervalo.</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <TopList
          title="Top vendedores"
          icon="🏆"
          items={topSellers}
          emptyText={`Sem vendas em ${presetLabel.toLowerCase()}.`}
        />
        <TopList
          title="Top clientes"
          icon="👤"
          items={topCustomers}
          emptyText="Sem cliente identificado no período."
        />
        <TopList
          title="Recebido por forma"
          icon="💳"
          items={topMethods}
          emptyText="Nada recebido no período."
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
