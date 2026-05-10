"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl } from "@/lib/format";
import DashboardKpi from "@/components/DashboardKpi";

// ─── helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function isoStart(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toISOString();
}
function isoEnd(dateStr: string) {
  return new Date(dateStr + "T23:59:59.999").toISOString();
}
function fmtShort(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}
function brlShort(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return brl(n).replace("R$ ", "").replace("R$ ", "");
}

// ─── types ────────────────────────────────────────────────────────────────────

type DayRow = {
  date: string;
  type: "realizado" | "projetado";
  entradas: number;
  saidas: number;
  saldo: number;
  acumulado: number;
};

// ─── dual-series line + bar chart ─────────────────────────────────────────────

function CashFlowChart({ rows }: { rows: DayRow[] }) {
  if (!rows.length) return null;

  const W = 700;
  const H = 240;
  const PT = 24;
  const PB = 40;
  const PL = 52;
  const PR = 8;
  const IW = W - PL - PR;
  const IH = H - PT - PB;

  const maxAcc = Math.max(...rows.map((r) => r.acumulado), 0);
  const minAcc = Math.min(...rows.map((r) => r.acumulado), 0);
  const maxBar = Math.max(...rows.map((r) => Math.max(r.entradas, r.saidas)), 1);
  const range = maxAcc - minAcc || 1;
  const zeroY = PT + IH * (maxAcc / range);

  function xFor(i: number) {
    return PL + (i + 0.5) * (IW / rows.length);
  }
  function yForAcc(v: number) {
    return PT + IH * ((maxAcc - v) / range);
  }
  function barH(v: number) {
    return Math.max((v / maxBar) * (IH * 0.45), 0);
  }

  const slotW = IW / rows.length;
  const barW = Math.max(slotW * 0.3, 2);

  const realizadoLine = rows
    .filter((r) => r.type === "realizado")
    .map((r, _, arr) => {
      const i = rows.indexOf(r);
      return `${xFor(i)},${yForAcc(r.acumulado)}`;
    })
    .join(" ");

  const projetadoLine = rows
    .filter((r) => r.type === "projetado" || (r.type === "realizado" && rows.indexOf(r) === rows.filter((x) => x.type === "realizado").length - 1))
    .map((r) => {
      const i = rows.indexOf(r);
      return `${xFor(i)},${yForAcc(r.acumulado)}`;
    })
    .join(" ");

  // label step: target ~10 labels
  const step = Math.max(1, Math.ceil(rows.length / 10));
  const todayIdx = rows.findIndex((r) => r.date === todayStr());

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {/* zero line */}
      <line x1={PL} y1={zeroY} x2={W - PR} y2={zeroY} stroke="#d1d5db" strokeWidth="1" />
      {maxAcc > 0 && (
        <>
          <line x1={PL} y1={PT} x2={W - PR} y2={PT} stroke="#e5e7eb" strokeWidth="0.5" strokeDasharray="3 3" />
          <text x="4" y={PT + 4} fontSize="9" fill="#6b7280">{brlShort(maxAcc)}</text>
        </>
      )}
      {minAcc < 0 && (
        <>
          <line x1={PL} y1={PT + IH} x2={W - PR} y2={PT + IH} stroke="#e5e7eb" strokeWidth="0.5" strokeDasharray="3 3" />
          <text x="4" y={PT + IH + 4} fontSize="9" fill="#6b7280">{brlShort(minAcc)}</text>
        </>
      )}
      <text x="4" y={zeroY + 4} fontSize="9" fill="#9ca3af">0</text>

      {/* "hoje" separator */}
      {todayIdx >= 0 && (
        <line
          x1={xFor(todayIdx)}
          y1={PT}
          x2={xFor(todayIdx)}
          y2={H - PB}
          stroke="#f59e0b"
          strokeWidth="1"
          strokeDasharray="4 2"
          opacity="0.7"
        />
      )}

      {/* bars per day */}
      {rows.map((r, i) => {
        const x = xFor(i);
        const isProj = r.type === "projetado";
        return (
          <g key={r.date}>
            {/* entrada bar (green, above zero) */}
            {r.entradas > 0 && (
              <rect
                x={x - barW - 0.5}
                y={zeroY - barH(r.entradas)}
                width={barW}
                height={barH(r.entradas)}
                fill={isProj ? "#86efac" : "#4ade80"}
                opacity={isProj ? 0.6 : 0.85}
                rx="1"
              >
                <title>{fmtShort(r.date)} · Entradas {brl(r.entradas)}</title>
              </rect>
            )}
            {/* saida bar (red, below zero) */}
            {r.saidas > 0 && (
              <rect
                x={x + 0.5}
                y={zeroY}
                width={barW}
                height={barH(r.saidas)}
                fill={isProj ? "#fca5a5" : "#f87171"}
                opacity={isProj ? 0.6 : 0.85}
                rx="1"
              >
                <title>{fmtShort(r.date)} · Saídas {brl(r.saidas)}</title>
              </rect>
            )}
          </g>
        );
      })}

      {/* accumulated balance line – realizado */}
      {realizadoLine && (
        <polyline
          points={realizadoLine}
          fill="none"
          stroke="#2563eb"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      )}

      {/* accumulated balance line – projetado */}
      {projetadoLine && (
        <polyline
          points={projetadoLine}
          fill="none"
          stroke="#f59e0b"
          strokeWidth="1.8"
          strokeDasharray="5 3"
          strokeLinejoin="round"
        />
      )}

      {/* dots on realized line */}
      {rows
        .filter((r) => r.type === "realizado")
        .map((r) => {
          const i = rows.indexOf(r);
          return (
            <circle
              key={r.date}
              cx={xFor(i)}
              cy={yForAcc(r.acumulado)}
              r="2.5"
              fill="#2563eb"
            >
              <title>
                {fmtShort(r.date)} · Saldo acumulado {brl(r.acumulado)}
              </title>
            </circle>
          );
        })}

      {/* X-axis labels */}
      {rows.map((r, i) => {
        if (i % step !== 0 && i !== rows.length - 1) return null;
        return (
          <text
            key={r.date}
            x={xFor(i)}
            y={H - PB + 14}
            textAnchor="middle"
            fontSize="9"
            fill={r.date === todayStr() ? "#f59e0b" : "#6b7280"}
            fontWeight={r.date === todayStr() ? "bold" : "normal"}
          >
            {fmtShort(r.date)}
          </text>
        );
      })}

      {/* legend */}
      <g transform={`translate(${PL + 4}, ${H - PB + 26})`}>
        <rect x="0" y="-5" width="10" height="5" fill="#4ade80" rx="1" />
        <text x="13" y="0" fontSize="8" fill="#374151">Entradas realizadas</text>
        <rect x="90" y="-5" width="10" height="5" fill="#f87171" rx="1" />
        <text x="103" y="0" fontSize="8" fill="#374151">Saídas realizadas</text>
        <line x1="190" y1="-2" x2="200" y2="-2" stroke="#2563eb" strokeWidth="2" />
        <text x="203" y="0" fontSize="8" fill="#374151">Saldo acumulado</text>
        <line x1="290" y1="-2" x2="300" y2="-2" stroke="#f59e0b" strokeWidth="1.8" strokeDasharray="4 2" />
        <text x="303" y="0" fontSize="8" fill="#374151">Projetado</text>
      </g>
    </svg>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function FluxoCaixaPage() {
  const supabase = createClient();

  const [lookbackDays, setLookbackDays] = useState(60);
  const [projDays] = useState(30);
  const [loading, setLoading] = useState(true);

  type SalePayment = { paid_at: string; amount: number };
  type ExpenseRow = { paid_at: string | null; due_date: string | null; status: string; amount: number };
  type PayableRow = { due_date: string; amount: number; status: string };
  type BalanceRow = { open_balance: number };

  const [salePayments, setSalePayments] = useState<SalePayment[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [payables, setPayables] = useState<PayableRow[]>([]);
  const [arBalance, setArBalance] = useState(0);

  async function load() {
    setLoading(true);
    const today = todayStr();
    const start = addDays(today, -lookbackDays);
    const projEnd = addDays(today, projDays);

    const [spRes, expPaidRes, expOpenRes, payRes, balRes] = await Promise.all([
      supabase
        .from("sale_payments")
        .select("paid_at, amount")
        .gte("paid_at", isoStart(start))
        .lte("paid_at", isoEnd(today)),
      supabase
        .from("expenses")
        .select("paid_at, due_date, status, amount")
        .eq("status", "paid")
        .gte("paid_at", isoStart(start))
        .lte("paid_at", isoEnd(today)),
      supabase
        .from("expenses")
        .select("paid_at, due_date, status, amount")
        .eq("status", "open")
        .lte("due_date", projEnd),
      supabase
        .from("payables")
        .select("due_date, amount, status")
        .in("status", ["pendente", "vencido"])
        .lte("due_date", projEnd),
      supabase.from("customer_balances").select("open_balance"),
    ]);

    const allExpenses = [
      ...((expPaidRes.data as ExpenseRow[]) ?? []),
      ...((expOpenRes.data as ExpenseRow[]) ?? []),
    ];

    setSalePayments((spRes.data as SalePayment[]) ?? []);
    setExpenses(allExpenses);
    setPayables((payRes.data as PayableRow[]) ?? []);
    const totalAR = ((balRes.data as BalanceRow[]) ?? []).reduce(
      (s, r) => s + Number(r.open_balance ?? 0),
      0
    );
    setArBalance(totalAR);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [lookbackDays]);

  const rows = useMemo<DayRow[]>(() => {
    const today = todayStr();
    const start = addDays(today, -lookbackDays);
    const projEnd = addDays(today, projDays);

    // build date range
    const allDates: string[] = [];
    let cur = start;
    while (cur <= projEnd) {
      allDates.push(cur);
      cur = addDays(cur, 1);
    }

    // aggregate realized
    const realEntradas: Record<string, number> = {};
    const realSaidas: Record<string, number> = {};
    salePayments.forEach((p) => {
      const d = p.paid_at.slice(0, 10);
      realEntradas[d] = (realEntradas[d] ?? 0) + Number(p.amount);
    });
    expenses.forEach((e) => {
      if (e.status === "paid" && e.paid_at) {
        const d = e.paid_at.slice(0, 10);
        realSaidas[d] = (realSaidas[d] ?? 0) + Number(e.amount);
      }
    });

    // aggregate projected (payables + open expenses with future due_date)
    const projSaidas: Record<string, number> = {};
    payables.forEach((p) => {
      if (p.due_date > today) {
        projSaidas[p.due_date] = (projSaidas[p.due_date] ?? 0) + Number(p.amount);
      }
    });
    expenses.forEach((e) => {
      if (e.status === "open" && e.due_date && e.due_date > today) {
        projSaidas[e.due_date] = (projSaidas[e.due_date] ?? 0) + Number(e.amount);
      }
    });
    // spread AR evenly across projection days (rough estimate)
    const futureDates = allDates.filter((d) => d > today);
    const arPerDay = futureDates.length > 0 ? arBalance / futureDates.length : 0;

    let acumulado = 0;
    return allDates.map((date) => {
      const isProj = date > today;
      const entradas = isProj ? arPerDay : (realEntradas[date] ?? 0);
      const saidas = isProj ? (projSaidas[date] ?? 0) : (realSaidas[date] ?? 0);
      const saldo = entradas - saidas;
      acumulado += saldo;
      return {
        date,
        type: isProj ? "projetado" : "realizado",
        entradas,
        saidas,
        saldo,
        acumulado,
      };
    });
  }, [salePayments, expenses, payables, arBalance, lookbackDays, projDays]);

  const kpis = useMemo(() => {
    const realized = rows.filter((r) => r.type === "realizado");
    const projected = rows.filter((r) => r.type === "projetado");
    const totalEntradas = realized.reduce((s, r) => s + r.entradas, 0);
    const totalSaidas = realized.reduce((s, r) => s + r.saidas, 0);
    const saldoRealizado = realized[realized.length - 1]?.acumulado ?? 0;
    const saldoProjetado = rows[rows.length - 1]?.acumulado ?? 0;
    const projEntradas = projected.reduce((s, r) => s + r.entradas, 0);
    const projSaidas = projected.reduce((s, r) => s + r.saidas, 0);
    return { totalEntradas, totalSaidas, saldoRealizado, saldoProjetado, projEntradas, projSaidas };
  }, [rows]);

  const tableRows = useMemo(
    () => [...rows].reverse().filter((r) => r.entradas > 0 || r.saidas > 0),
    [rows]
  );

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">Fluxo de Caixa</h1>
          <p className="text-coco-600">Realizado vs Projetado — entradas e saídas diárias.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <a href="/financeiro" className="btn-secondary">💰 Financeiro</a>
          <a href="/pagar" className="btn-secondary">🧾 Contas a Pagar</a>
        </div>
      </header>

      {/* lookback selector */}
      <div className="card flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-coco-700">Período realizado:</span>
        {[30, 60, 90].map((d) => (
          <button
            key={d}
            onClick={() => setLookbackDays(d)}
            className={`px-3 py-1 rounded-lg text-sm font-medium transition ${
              lookbackDays === d
                ? "bg-coco-700 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {d} dias
          </button>
        ))}
        <span className="text-xs text-coco-500 ml-auto">+ 30 dias projetados</span>
        {!loading && (
          <button onClick={load} className="btn-secondary text-sm">
            Atualizar
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <DashboardKpi
          label="Entradas Realizadas"
          value={brl(kpis.totalEntradas)}
          sub={`Últimos ${lookbackDays} dias`}
          icon="📥"
          accent="green"
        />
        <DashboardKpi
          label="Saídas Realizadas"
          value={brl(kpis.totalSaidas)}
          sub={`Últimos ${lookbackDays} dias`}
          icon="📤"
          accent={kpis.totalSaidas > kpis.totalEntradas ? "red" : "neutral"}
        />
        <DashboardKpi
          label="Saldo Acumulado Atual"
          value={brl(kpis.saldoRealizado)}
          sub="Realizado até hoje"
          icon="💵"
          accent={kpis.saldoRealizado >= 0 ? "primary" : "red"}
        />
        <DashboardKpi
          label="A Receber (AR)"
          value={brl(arBalance)}
          sub="Saldo em aberto — usado na projeção"
          icon="📒"
          accent="neutral"
        />
        <DashboardKpi
          label="Saídas Projetadas (30d)"
          value={brl(kpis.projSaidas)}
          sub="Contas a pagar pendentes"
          icon="📅"
          accent={kpis.projSaidas > arBalance ? "amber" : "neutral"}
        />
        <DashboardKpi
          label="Saldo Projetado (30d)"
          value={brl(kpis.saldoProjetado)}
          sub="Após entradas e saídas estimadas"
          icon="🔮"
          accent={kpis.saldoProjetado >= 0 ? "green" : "red"}
        />
      </div>

      {/* chart */}
      <div className="card">
        <h2 className="font-bold text-coco-900 mb-1">
          Saldo Acumulado + Fluxo Diário
        </h2>
        <p className="text-xs text-coco-500 mb-4">
          Barras: entradas (verde) e saídas (vermelho) por dia. Linha azul: saldo acumulado realizado. Linha laranja pontilhada: projeção.
        </p>
        {loading ? (
          <div className="h-40 flex items-center justify-center text-coco-500">
            Carregando…
          </div>
        ) : rows.length === 0 ? (
          <div className="text-coco-500 text-sm">Sem dados no período.</div>
        ) : (
          <CashFlowChart rows={rows} />
        )}
      </div>

      {/* detail table */}
      <div className="card">
        <h2 className="font-bold text-coco-900 mb-3">Detalhamento Diário</h2>
        {loading ? (
          <p className="text-coco-600">Carregando…</p>
        ) : tableRows.length === 0 ? (
          <p className="text-coco-600 text-sm">Sem movimentações no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th className="text-right">Entradas</th>
                  <th className="text-right">Saídas</th>
                  <th className="text-right">Saldo Dia</th>
                  <th className="text-right">Saldo Acumulado</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r) => (
                  <tr key={r.date} className={r.date === todayStr() ? "bg-amber-50" : ""}>
                    <td className="font-mono text-sm">
                      {new Date(r.date + "T12:00:00").toLocaleDateString("pt-BR")}
                      {r.date === todayStr() && (
                        <span className="ml-1 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                          hoje
                        </span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          r.type === "realizado"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-orange-100 text-orange-700"
                        }`}
                      >
                        {r.type === "realizado" ? "Realizado" : "Projetado"}
                      </span>
                    </td>
                    <td className="text-right text-green-700 font-medium">
                      {r.entradas > 0 ? brl(r.entradas) : "—"}
                    </td>
                    <td className="text-right text-red-700 font-medium">
                      {r.saidas > 0 ? brl(r.saidas) : "—"}
                    </td>
                    <td
                      className={`text-right font-semibold ${
                        r.saldo >= 0 ? "text-green-700" : "text-red-700"
                      }`}
                    >
                      {r.saldo >= 0 ? "+" : ""}
                      {brl(r.saldo)}
                    </td>
                    <td
                      className={`text-right font-bold ${
                        r.acumulado >= 0 ? "text-coco-800" : "text-red-800"
                      }`}
                    >
                      {brl(r.acumulado)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* projection disclaimer */}
      <div className="card bg-amber-50 border-amber-200">
        <h3 className="font-semibold text-amber-800 mb-1">Sobre a Projeção</h3>
        <ul className="text-sm text-amber-700 space-y-1 list-disc list-inside">
          <li>
            <strong>Entradas projetadas</strong>: saldo total em aberto de{" "}
            <em>Contas a Receber</em> ({brl(arBalance)}) distribuído uniformemente
            pelos próximos {projDays} dias.
          </li>
          <li>
            <strong>Saídas projetadas</strong>: contas a pagar pendentes com
            vencimento nos próximos {projDays} dias, agrupadas por data de vencimento.
          </li>
          <li>
            O saldo acumulado da projeção parte do saldo realizado até hoje.
          </li>
        </ul>
      </div>
    </div>
  );
}
