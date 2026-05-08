"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, computeFee, fmtPct, pctChange } from "@/lib/format";
import { rangeBoundsIso } from "@/lib/dashboard";

type Sale = { quantity: number; total: number; canceled_at: string | null };
type Inv = {
  kind: string;
  quantity: number;
  unit_cost: number | null;
  created_at: string;
};
type Expense = { amount: number };
type PaymentRow = {
  amount: number;
  payment_method_id: string | null;
};
type MethodRow = {
  id: string;
  name: string;
  fee_percent: number | null;
  fee_fixed: number | null;
};

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    from: `${ym}-01`,
    to: `${ym}-${String(lastDay).padStart(2, "0")}`,
  };
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

export default function DRE() {
  const supabase = createClient();
  const [month, setMonth] = useState(currentMonthValue());
  const [loading, setLoading] = useState(true);

  // Período corrente
  const [salesAll, setSalesAll] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [received, setReceived] = useState(0);
  const [periodPayments, setPeriodPayments] = useState<PaymentRow[]>([]);
  const [methods, setMethods] = useState<MethodRow[]>([]);

  // Período anterior
  const [prevSalesAll, setPrevSalesAll] = useState<Sale[]>([]);
  const [prevExpensesTotal, setPrevExpensesTotal] = useState(0);
  const [prevReceived, setPrevReceived] = useState(0);

  // Entradas de estoque pra CMV
  const [invMovements, setInvMovements] = useState<Inv[]>([]);

  const range = useMemo(() => monthRange(month), [month]);
  const prevYm = useMemo(() => prevMonth(month), [month]);
  const prevRange = useMemo(() => monthRange(prevYm), [prevYm]);

  async function load() {
    setLoading(true);
    const cur = rangeBoundsIso(range);
    const prev = rangeBoundsIso(prevRange);

    const [
      salesQ,
      expQ,
      receivedQ,
      paymentsByMethodQ,
      methodsQ,
      prevSalesQ,
      prevExpQ,
      prevReceivedQ,
      invQ,
    ] = await Promise.all([
      supabase
        .from("sales")
        .select("quantity,total,canceled_at")
        .gte("created_at", cur.startIso)
        .lt("created_at", cur.endIso),
      supabase
        .from("expenses")
        .select("amount")
        .gte("paid_at", cur.startIso)
        .lt("paid_at", cur.endIso),
      supabase
        .from("sale_payments")
        .select("amount")
        .gte("paid_at", cur.startIso)
        .lt("paid_at", cur.endIso),
      supabase
        .from("sale_payments")
        .select("amount,payment_method_id")
        .gte("paid_at", cur.startIso)
        .lt("paid_at", cur.endIso),
      supabase
        .from("payment_methods")
        .select("id,name,fee_percent,fee_fixed"),
      supabase
        .from("sales")
        .select("quantity,total,canceled_at")
        .gte("created_at", prev.startIso)
        .lt("created_at", prev.endIso),
      supabase
        .from("expenses")
        .select("amount")
        .gte("paid_at", prev.startIso)
        .lt("paid_at", prev.endIso),
      supabase
        .from("sale_payments")
        .select("amount")
        .gte("paid_at", prev.startIso)
        .lt("paid_at", prev.endIso),
      supabase
        .from("inventory_movements")
        .select("kind,quantity,unit_cost,created_at")
        .eq("kind", "entrada")
        .order("created_at", { ascending: true }),
    ]);

    setSalesAll((salesQ.data as Sale[]) ?? []);
    setExpenses((expQ.data as Expense[]) ?? []);
    setReceived(
      ((receivedQ.data as { amount: number | string }[]) ?? []).reduce(
        (s, p) => s + Number(p.amount ?? 0),
        0
      )
    );
    setPeriodPayments(
      (
        (paymentsByMethodQ.data as {
          amount: number | string;
          payment_method_id: string | null;
        }[]) ?? []
      ).map((p) => ({
        amount: Number(p.amount ?? 0),
        payment_method_id: p.payment_method_id,
      }))
    );
    setMethods(
      (
        (methodsQ.data as {
          id: string;
          name: string;
          fee_percent: number | string | null;
          fee_fixed: number | string | null;
        }[]) ?? []
      ).map((m) => ({
        id: m.id,
        name: m.name,
        fee_percent: m.fee_percent === null ? null : Number(m.fee_percent),
        fee_fixed: m.fee_fixed === null ? null : Number(m.fee_fixed),
      }))
    );
    setPrevSalesAll((prevSalesQ.data as Sale[]) ?? []);
    setPrevExpensesTotal(
      ((prevExpQ.data as { amount: number | string }[]) ?? []).reduce(
        (s, r) => s + Number(r.amount ?? 0),
        0
      )
    );
    setPrevReceived(
      ((prevReceivedQ.data as { amount: number | string }[]) ?? []).reduce(
        (s, p) => s + Number(p.amount ?? 0),
        0
      )
    );
    setInvMovements((invQ.data as Inv[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  // CMV via custo médio das entradas do período (fallback histórico).
  const cmvPeriodo = useMemo(() => {
    if (invMovements.length === 0)
      return { custo: 0, custoUnitMedio: 0, semCusto: false, fonteHistorica: false };
    const cocosNoPeriodo = salesAll
      .filter((s) => !s.canceled_at)
      .reduce((s, r) => s + Number(r.quantity ?? 0), 0);

    const startMs = new Date(rangeBoundsIso(range).startIso).getTime();
    const entriesInPeriod = invMovements.filter(
      (m) =>
        new Date(m.created_at).getTime() >= startMs &&
        m.unit_cost !== null &&
        Number(m.unit_cost) > 0
    );

    let qty = 0;
    let cost = 0;
    if (entriesInPeriod.length > 0) {
      for (const m of entriesInPeriod) {
        qty += Number(m.quantity);
        cost += Number(m.quantity) * Number(m.unit_cost);
      }
    } else {
      for (const m of invMovements) {
        if (m.unit_cost && Number(m.unit_cost) > 0) {
          qty += Number(m.quantity);
          cost += Number(m.quantity) * Number(m.unit_cost);
        }
      }
    }
    const unitMedio = qty > 0 ? cost / qty : 0;
    const semCusto = unitMedio === 0;
    return {
      custo: +(cocosNoPeriodo * unitMedio).toFixed(2),
      custoUnitMedio: unitMedio,
      semCusto,
      fonteHistorica: entriesInPeriod.length === 0,
    };
  }, [invMovements, salesAll, range]);

  // Taxas de operadora sobre pagamentos do período.
  const taxasOperadora = useMemo(() => {
    const methodMap: Record<string, MethodRow> = {};
    methods.forEach((m) => (methodMap[m.id] = m));
    let total = 0;
    for (const p of periodPayments) {
      const m = p.payment_method_id ? methodMap[p.payment_method_id] : null;
      if (!m) continue;
      total += computeFee(p.amount, m.fee_percent, m.fee_fixed);
    }
    return +total.toFixed(2);
  }, [periodPayments, methods]);

  const data = useMemo(() => {
    const ativas = salesAll.filter((s) => !s.canceled_at);
    const canceladas = salesAll.filter((s) => s.canceled_at);
    const receitaBruta = salesAll.reduce(
      (s, r) => s + Number(r.total ?? 0),
      0
    );
    const devolucoes = canceladas.reduce(
      (s, r) => s + Number(r.total ?? 0),
      0
    );
    const receitaLiquida = ativas.reduce(
      (s, r) => s + Number(r.total ?? 0),
      0
    );
    const cocosVendidos = ativas.reduce(
      (s, r) => s + Number(r.quantity ?? 0),
      0
    );
    const cmv = cmvPeriodo.custo;
    const margemBruta = receitaLiquida - cmv;
    const despesas = expenses.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    // EBITDA ≈ Margem Bruta − Despesas Operacionais (sem taxas financeiras)
    const ebitda = margemBruta - despesas;
    const resultadoLiquido = ebitda - taxasOperadora;
    return {
      receitaBruta,
      devolucoes,
      receitaLiquida,
      cocosVendidos,
      cmv,
      margemBruta,
      despesas,
      ebitda,
      taxasOperadora,
      resultadoLiquido,
      received,
    };
  }, [salesAll, expenses, cmvPeriodo, taxasOperadora, received]);

  // Valores do mês anterior para deltas.
  const prevData = useMemo(() => {
    const ativas = prevSalesAll.filter((s) => !s.canceled_at);
    const canceladas = prevSalesAll.filter((s) => s.canceled_at);
    const receitaBruta = prevSalesAll.reduce(
      (s, r) => s + Number(r.total ?? 0),
      0
    );
    const devolucoes = canceladas.reduce(
      (s, r) => s + Number(r.total ?? 0),
      0
    );
    const receitaLiquida = ativas.reduce(
      (s, r) => s + Number(r.total ?? 0),
      0
    );
    const margemBruta = receitaLiquida; // CMV do mês anterior não calculado (simplificado)
    const ebitda = margemBruta - prevExpensesTotal;
    const resultadoLiquido = ebitda; // sem taxas prev (simplificado)
    return { receitaBruta, devolucoes, receitaLiquida, margemBruta, ebitda, resultadoLiquido };
  }, [prevSalesAll, prevExpensesTotal, prevReceived]);

  return (
    <div className="space-y-6 print:space-y-4">
      <header className="flex items-start justify-between flex-wrap gap-3 print:gap-1">
        <div>
          <Link
            href="/financeiro"
            className="text-coco-700 underline text-sm print:hidden"
          >
            ← Financeiro
          </Link>
          <h1 className="text-3xl font-bold text-coco-900 print:text-2xl">
            DRE — Demonstrativo de Resultados
          </h1>
          <p className="text-coco-600 capitalize">
            {fmtMonth(month)}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <div>
            <label className="label">Mês de referência</label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="input"
              max={currentMonthValue()}
            />
          </div>
          <button
            onClick={() => window.print()}
            className="btn-secondary self-end"
          >
            🖨 Imprimir
          </button>
        </div>
        <div className="hidden print:block text-sm text-coco-600">
          Emitido em {new Date().toLocaleDateString("pt-BR")}
        </div>
      </header>

      {loading ? (
        <p className="text-coco-700">Carregando…</p>
      ) : (
        <>
          <div className="card print:shadow-none print:border print:border-coco-200">
            <table className="w-full text-sm">
              <thead className="print:table-header-group">
                <tr className="text-xs text-coco-500 uppercase border-b border-coco-100">
                  <th className="text-left pb-2 font-medium">Linha</th>
                  <th className="text-right pb-2 font-medium">{fmtMonth(month)}</th>
                  <th className="text-right pb-2 font-medium text-coco-400">
                    {fmtMonth(prevYm)}
                  </th>
                  <th className="text-right pb-2 font-medium text-coco-400">Δ</th>
                </tr>
              </thead>
              <tbody>
                <CompRow
                  label="Receita bruta"
                  value={data.receitaBruta}
                  prev={prevData.receitaBruta}
                />
                <CompRow
                  label="(−) Devoluções / cancelamentos"
                  value={-data.devolucoes}
                  prev={-prevData.devolucoes}
                  faded
                />
                <CompRow
                  label="Receita líquida"
                  value={data.receitaLiquida}
                  prev={prevData.receitaLiquida}
                  bold
                  divider
                />
                <CompRow
                  label={`(−) CMV · ${data.cocosVendidos} cocos × ${brl(cmvPeriodo.custoUnitMedio)}`}
                  value={-data.cmv}
                  prev={null}
                  faded
                />
                <CompRow
                  label="Margem bruta"
                  value={data.margemBruta}
                  prev={prevData.margemBruta}
                  bold
                  divider
                />
                <CompRow
                  label="(−) Despesas operacionais"
                  value={-data.despesas}
                  prev={-prevExpensesTotal}
                  faded
                />
                <CompRow
                  label="EBITDA"
                  value={data.ebitda}
                  prev={prevData.ebitda}
                  bold
                  divider
                />
                <CompRow
                  label="(−) Taxas de operadora (cartão)"
                  value={-data.taxasOperadora}
                  prev={null}
                  faded
                />
                <CompRow
                  label="Resultado líquido"
                  value={data.resultadoLiquido}
                  prev={prevData.resultadoLiquido}
                  hero
                  divider
                />
              </tbody>
            </table>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 print:grid-cols-4 print:gap-2">
            <KpiCard
              label="Receita líquida"
              value={brl(data.receitaLiquida)}
              sub={`vs ${brl(prevData.receitaLiquida)} mês ant.`}
              delta={pctChange(data.receitaLiquida, prevData.receitaLiquida)}
            />
            <KpiCard
              label="Margem bruta"
              value={data.receitaLiquida > 0 ? `${((data.margemBruta / data.receitaLiquida) * 100).toFixed(1)}%` : "—"}
              sub={brl(data.margemBruta)}
            />
            <KpiCard
              label="EBITDA"
              value={brl(data.ebitda)}
              sub={data.receitaLiquida > 0 ? `${((data.ebitda / data.receitaLiquida) * 100).toFixed(1)}% da receita` : ""}
              delta={pctChange(data.ebitda, prevData.ebitda)}
            />
            <KpiCard
              label="Resultado líquido"
              value={brl(data.resultadoLiquido)}
              sub={`vs ${brl(prevData.resultadoLiquido)} mês ant.`}
              delta={pctChange(data.resultadoLiquido, prevData.resultadoLiquido)}
              highlight
            />
          </div>

          <div className="card text-sm space-y-2 bg-coco-50 print:bg-white print:border print:border-coco-200">
            <h3 className="font-bold text-coco-900">Notas</h3>
            <p>
              <strong>Regime:</strong> competência (receita = vendas criadas no
              mês, independente de quando foram pagas).
            </p>
            <p>
              <strong>Recebido (caixa):</strong>{" "}
              <span className="font-semibold">{brl(data.received)}</span> entrou
              efetivamente no mês. Compare com receita líquida (
              {brl(data.receitaLiquida)}) pra ver gap de cobrança.
            </p>
            <p>
              <strong>CMV:</strong>{" "}
              {cmvPeriodo.fonteHistorica
                ? "calculado com custo médio histórico (não houve entrada no período)."
                : "calculado com custo médio das entradas do próprio mês."}
            </p>
            <p>
              <strong>EBITDA:</strong> Margem Bruta menos Despesas Operacionais,
              antes de taxas financeiras e encargos de cartão.
            </p>
            {cmvPeriodo.semCusto && (
              <p className="text-amber-800">
                ⚠ Sem custo unitário registrado — preencha "Custo unitário" nas
                entradas em{" "}
                <Link href="/estoque" className="underline">
                  /estoque
                </Link>{" "}
                pra ter CMV e margem bruta.
              </p>
            )}
          </div>
        </>
      )}

      <style jsx global>{`
        @media print {
          nav, aside, .print\\:hidden { display: none !important; }
          body { background: white; }
          .card { box-shadow: none; }
        }
      `}</style>
    </div>
  );
}

function CompRow({
  label,
  value,
  prev,
  bold,
  hero,
  faded,
  divider,
}: {
  label: string;
  value: number;
  prev: number | null;
  bold?: boolean;
  hero?: boolean;
  faded?: boolean;
  divider?: boolean;
}) {
  const cls = hero
    ? "py-3 text-2xl font-bold"
    : bold
    ? "py-2 font-semibold"
    : "py-1";
  const valColor = value < 0 ? "text-red-700" : "text-coco-900";
  const delta = prev !== null ? pctChange(value, prev) : null;

  return (
    <tr className={divider ? "border-t border-coco-200" : ""}>
      <td className={`${cls} ${faded ? "text-coco-500" : ""} pr-4`}>
        {label}
      </td>
      <td className={`${cls} text-right ${valColor} whitespace-nowrap`}>
        {brl(value)}
      </td>
      <td className={`${cls} text-right text-coco-400 whitespace-nowrap`}>
        {prev !== null ? brl(prev) : "—"}
      </td>
      <td className="text-right whitespace-nowrap pl-2">
        {delta !== null && delta !== undefined ? (
          <span
            className={`text-xs font-medium ${
              delta >= 0 ? "text-green-700" : "text-red-700"
            }`}
          >
            {fmtPct(delta)}
          </span>
        ) : (
          <span className="text-xs text-coco-300">—</span>
        )}
      </td>
    </tr>
  );
}

function KpiCard({
  label,
  value,
  sub,
  delta,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  highlight?: boolean;
}) {
  return (
    <div
      className={`card ${
        highlight ? "bg-coco-900 text-white" : ""
      } print:border print:border-coco-200 print:shadow-none`}
    >
      <div
        className={`text-xs uppercase tracking-wider mb-1 ${
          highlight ? "text-coco-300" : "text-coco-600"
        }`}
      >
        {label}
      </div>
      <div className={`text-xl font-bold ${highlight ? "text-white" : "text-coco-900"}`}>
        {value}
      </div>
      {sub && (
        <div
          className={`text-xs mt-0.5 ${
            highlight ? "text-coco-400" : "text-coco-500"
          }`}
        >
          {sub}
        </div>
      )}
      {delta !== null && delta !== undefined && (
        <div
          className={`text-xs font-medium mt-1 ${
            delta >= 0 ? "text-green-400" : "text-red-400"
          }`}
        >
          {fmtPct(delta)} vs mês ant.
        </div>
      )}
    </div>
  );
}
