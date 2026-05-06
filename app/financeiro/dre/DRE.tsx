"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtPct, pctChange } from "@/lib/format";
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
};
type Expense = { amount: number };

export default function DRE() {
  const supabase = createClient();
  const [preset, setPreset] = useState<DashboardPreset>("mes");
  const [loading, setLoading] = useState(true);

  // Período corrente
  const [salesAll, setSalesAll] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [received, setReceived] = useState(0);

  // Período anterior (pra comparação)
  const [prevSalesTotal, setPrevSalesTotal] = useState(0);
  const [prevReceived, setPrevReceived] = useState(0);
  const [prevExpenses, setPrevExpenses] = useState(0);

  // Custo unitário médio (todas entradas com unit_cost preenchido).
  // Não-segmentado por período pra simplicidade — assumimos custo
  // estável.
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
      supabase
        .from("inventory_movements")
        .select("kind,quantity,unit_cost")
        .eq("kind", "entrada"),
    ]);

    setSalesAll((salesQ.data as Sale[]) ?? []);
    setExpenses((expQ.data as Expense[]) ?? []);
    setReceived(
      ((receivedQ.data as { amount: number | string }[]) ?? []).reduce(
        (s, p) => s + Number(p.amount ?? 0),
        0
      )
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

  // Custo médio ponderado por entrada (com unit_cost preenchido).
  const avgUnitCost = useMemo(() => {
    let totalQty = 0;
    let totalCost = 0;
    for (const m of invMovements) {
      if (m.unit_cost && Number(m.unit_cost) > 0) {
        totalQty += Number(m.quantity);
        totalCost += Number(m.quantity) * Number(m.unit_cost);
      }
    }
    return totalQty > 0 ? totalCost / totalQty : 0;
  }, [invMovements]);

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
    const cmv = +(cocosVendidos * avgUnitCost).toFixed(2);
    const margemBruta = receitaLiquida - cmv;
    const despesas = expenses.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const resultadoLiquido = margemBruta - despesas;
    return {
      receitaBruta,
      cancelamentos,
      receitaLiquida,
      cocosVendidos,
      cmv,
      margemBruta,
      despesas,
      resultadoLiquido,
      received,
    };
  }, [salesAll, expenses, avgUnitCost, received]);

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
                    avgUnitCost
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
            {avgUnitCost === 0 && (
              <p className="text-amber-800">
                ⚠ Sem custo unitário médio — preencha "Custo unitário"
                nas entradas em <Link href="/estoque" className="underline">/estoque</Link>{" "}
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
