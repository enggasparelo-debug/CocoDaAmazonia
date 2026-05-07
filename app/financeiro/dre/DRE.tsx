"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, computeFee, fmtPct, pctChange } from "@/lib/format";
import {
  DASHBOARD_PRESETS,
  dashboardRange,
  rangeBoundsIso,
  previousRange,
  type DashboardPreset,
} from "@/lib/dashboard";

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

export default function DRE() {
  const supabase = createClient();
  const [preset, setPreset] = useState<DashboardPreset>("mes");
  const [loading, setLoading] = useState(true);

  // Período corrente
  const [salesAll, setSalesAll] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [received, setReceived] = useState(0);
  const [periodPayments, setPeriodPayments] = useState<PaymentRow[]>([]);
  const [methods, setMethods] = useState<MethodRow[]>([]);

  // Período anterior (pra comparação)
  const [prevSalesTotal, setPrevSalesTotal] = useState(0);
  const [prevReceived, setPrevReceived] = useState(0);
  const [prevExpenses, setPrevExpenses] = useState(0);

  // Entradas pra cálculo de CMV por período (FIFO simples no client).
  const [invMovements, setInvMovements] = useState<Inv[]>([]);

  const range = useMemo(() => dashboardRange(preset), [preset]);
  const prevR = useMemo(() => previousRange(range), [range]);

  async function load() {
    setLoading(true);
    const cur = rangeBoundsIso(range);
    const prev = rangeBoundsIso(prevR);

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
      // Inclui canceladas pra mostrar "Vendas brutas - Cancelamentos"
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
      // Recebido = sale_payments.paid_at no período (regime de caixa)
      supabase
        .from("sale_payments")
        .select("amount")
        .gte("paid_at", cur.startIso)
        .lt("paid_at", cur.endIso),
      // Pagamentos por método pra calcular taxas de cartão.
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
        .select("total")
        .gte("created_at", prev.startIso)
        .lt("created_at", prev.endIso)
        .is("canceled_at", null),
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
      // Pega TODAS as entradas (não só do período) pra montar o estoque
      // FIFO até a data de início do período.
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
    setPrevSalesTotal(
      ((prevSalesQ.data as { total: number | string }[]) ?? []).reduce(
        (s, r) => s + Number(r.total ?? 0),
        0
      )
    );
    setPrevExpenses(
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
  }, [preset]);

  // CMV por período via FIFO simplificado.
  //
  // Modelo: monto uma fila de "lotes" usando todas as entradas com
  // unit_cost preenchido (em ordem cronológica). Calculo quantos cocos
  // foram vendidos ANTES do período (pra avançar a fila) e quantos
  // foram vendidos DENTRO do período (pra extrair o custo).
  //
  // Limitações conhecidas:
  // - Vendas com canceled_at IS NOT NULL não são consideradas (não
  //   consumiram lote físico).
  // - Não diferencia perdas de vendas (perdas também consomem lote, mas
  //   não geram receita). Aceitável pra esta versão.
  const cmvPeriodo = useMemo(() => {
    if (invMovements.length === 0)
      return { custo: 0, custoUnitMedio: 0, semCusto: false };
    // Cocos vendidos no período (sem canceladas)
    const cocosNoPeriodo = salesAll
      .filter((s) => !s.canceled_at)
      .reduce((s, r) => s + Number(r.quantity ?? 0), 0);

    // Cocos vendidos antes do período: precisamos de uma query
    // adicional. Pra evitar complexidade, aproximamos: assumimos que o
    // CMV usa uma janela "do início do período até hoje" — ou seja,
    // pegamos o custo médio das entradas DO período em diante, com
    // fallback pro custo médio histórico se não houver entrada no
    // período.
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
      // Fallback: usa custo médio histórico de TODAS as entradas com
      // unit_cost. Marca o usuário pra ele saber que CMV é estimativa.
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

  // Taxas de operadora (cartão) sobre os pagamentos do período.
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
    const cancelamentos = canceladas.reduce(
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
    const resultadoLiquido = margemBruta - despesas - taxasOperadora;
    return {
      receitaBruta,
      cancelamentos,
      receitaLiquida,
      cocosVendidos,
      cmv,
      margemBruta,
      despesas,
      taxasOperadora,
      resultadoLiquido,
      received,
    };
  }, [salesAll, expenses, cmvPeriodo, taxasOperadora, received]);

  const presetLabel =
    DASHBOARD_PRESETS.find((p) => p.id === preset)?.label ?? "";

  const dRecLiquida = pctChange(data.receitaLiquida, prevSalesTotal);
  const dResultado = pctChange(
    data.resultadoLiquido,
    prevReceived - prevExpenses
  );

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/financeiro"
            className="text-coco-700 underline text-sm"
          >
            ← Financeiro
          </Link>
          <h1 className="text-3xl font-bold text-coco-900">
            DRE — Demonstrativo de Resultado
          </h1>
          <p className="text-coco-600">
            Período: <strong>{presetLabel}</strong>. CMV usa o custo médio
            ponderado das entradas registradas.
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

      {loading ? (
        <p className="text-coco-700">Carregando…</p>
      ) : (
        <>
          <div className="card">
            <table className="w-full text-sm">
              <tbody>
                <Row label="Receita bruta" value={data.receitaBruta} />
                <Row
                  label="(−) Cancelamentos"
                  value={-data.cancelamentos}
                  faded
                />
                <Row
                  label="Receita líquida"
                  value={data.receitaLiquida}
                  bold
                  divider
                  delta={dRecLiquida}
                />
                <Row
                  label={`(−) CMV · ${data.cocosVendidos} cocos × ${brl(
                    cmvPeriodo.custoUnitMedio
                  )}`}
                  value={-data.cmv}
                  faded
                />
                <Row
                  label="Margem bruta"
                  value={data.margemBruta}
                  bold
                  divider
                />
                <Row
                  label="(−) Despesas operacionais"
                  value={-data.despesas}
                  faded
                />
                <Row
                  label="(−) Taxas de operadora (cartão)"
                  value={-data.taxasOperadora}
                  faded
                />
                <Row
                  label="Resultado líquido"
                  value={data.resultadoLiquido}
                  hero
                  divider
                  delta={dResultado}
                />
              </tbody>
            </table>
          </div>

          <div className="card text-sm space-y-2 bg-coco-50">
            <h3 className="font-bold text-coco-900">Notas</h3>
            <p>
              <strong>Regime:</strong> competência (receita = vendas
              criadas no período, independente de quando foram pagas).
            </p>
            <p>
              <strong>Recebido (caixa):</strong>{" "}
              <span className="font-semibold">{brl(data.received)}</span>{" "}
              entrou efetivamente no período. Compare com receita líquida
              ({brl(data.receitaLiquida)}) pra ver gap de cobrança.
            </p>
            <p>
              <strong>CMV:</strong>{" "}
              {cmvPeriodo.fonteHistorica
                ? "calculado com custo médio histórico (não houve entrada no período)."
                : "calculado com custo médio das entradas do próprio período."}
            </p>
            {data.taxasOperadora > 0 && (
              <p>
                <strong>Taxas:</strong> a taxa total de R${" "}
                {data.taxasOperadora.toFixed(2)} foi calculada sobre os{" "}
                pagamentos do período usando{" "}
                <code>fee_percent</code> e <code>fee_fixed</code> de cada{" "}
                forma de pagamento. Edite em{" "}
                <Link
                  href="/formas-pagamento"
                  className="underline"
                >
                  Formas de Pagamento
                </Link>
                .
              </p>
            )}
            {cmvPeriodo.semCusto && (
              <p className="text-amber-800">
                ⚠ Sem custo unitário registrado — preencha "Custo
                unitário" nas entradas em{" "}
                <Link href="/estoque" className="underline">
                  /estoque
                </Link>{" "}
                pra ter CMV e margem bruta.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  hero,
  faded,
  divider,
  delta,
}: {
  label: string;
  value: number;
  bold?: boolean;
  hero?: boolean;
  faded?: boolean;
  divider?: boolean;
  delta?: number | null;
}) {
  const cls =
    hero
      ? "py-3 text-2xl font-bold"
      : bold
      ? "py-2 font-semibold"
      : "py-1";
  const valColor = value < 0 ? "text-red-700" : "text-coco-900";
  return (
    <tr className={divider ? "border-t border-coco-200" : ""}>
      <td className={`${cls} ${faded ? "text-coco-600" : ""}`}>{label}</td>
      <td className={`${cls} text-right ${valColor}`}>
        {brl(value)}
        {delta !== undefined && delta !== null && (
          <span
            className={`ml-2 text-xs ${
              delta >= 0 ? "text-green-700" : "text-red-700"
            }`}
          >
            {fmtPct(delta)}
          </span>
        )}
      </td>
    </tr>
  );
}
