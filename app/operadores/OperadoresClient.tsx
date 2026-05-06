"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl } from "@/lib/format";
import {
  DASHBOARD_PRESETS,
  dashboardRange,
  rangeBoundsIso,
  type DashboardPreset,
} from "@/lib/dashboard";
import type { Carga, Sale, Seller } from "@/lib/types";

type SellerMetrics = {
  seller: Seller;
  vendas: number;
  cocos: number;
  faturado: number;
  recebido: number;
  fiado_em_aberto: number; // total - paid_amount, do conjunto da venda
  pct_fiado: number; // % do faturado que ainda está em aberto
  cargas_abertas: number;
  cargas_fechadas: number;
  tempo_medio_carga_h: number | null; // só conta cargas fechadas
  diferenca_caixa_total: number;
};

export default function OperadoresClient() {
  const supabase = createClient();
  const [preset, setPreset] = useState<DashboardPreset>("mes");
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [cargas, setCargas] = useState<Carga[]>([]);
  const [diffByCarga, setDiffByCarga] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => dashboardRange(preset), [preset]);

  async function load() {
    setLoading(true);
    const cur = rangeBoundsIso(range);
    const [sl, sa, cg] = await Promise.all([
      supabase.from("sellers").select("*").order("name"),
      supabase
        .from("sales")
        .select("*")
        .gte("created_at", cur.startIso)
        .lt("created_at", cur.endIso)
        .is("canceled_at", null),
      supabase
        .from("cargas")
        .select("*")
        .gte("opened_at", cur.startIso)
        .lt("opened_at", cur.endIso),
    ]);
    setSellers((sl.data as Seller[]) ?? []);
    setSales((sa.data as Sale[]) ?? []);
    const cargasData = (cg.data as Carga[]) ?? [];
    setCargas(cargasData);

    // Diferença de caixa por carga: cash_diff da view carga_summary
    const closedIds = cargasData
      .filter((c) => c.status !== "aberta")
      .map((c) => c.id);
    if (closedIds.length > 0) {
      const { data: cs } = await supabase
        .from("carga_summary")
        .select("carga_id,cash_diff")
        .in("carga_id", closedIds);
      const map: Record<string, number> = {};
      ((cs as { carga_id: string; cash_diff: number }[]) ?? []).forEach(
        (s) => {
          map[s.carga_id] = Number(s.cash_diff ?? 0);
        }
      );
      setDiffByCarga(map);
    } else {
      setDiffByCarga({});
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  const metrics = useMemo<SellerMetrics[]>(() => {
    return sellers
      .map((s) => {
        const mySales = sales.filter((sa) => sa.seller_id === s.id);
        const vendas = mySales.length;
        const cocos = mySales.reduce(
          (sum, sa) => sum + Number(sa.quantity ?? 0),
          0
        );
        const faturado = mySales.reduce(
          (sum, sa) => sum + Number(sa.total ?? 0),
          0
        );
        const recebido = mySales.reduce(
          (sum, sa) => sum + Number(sa.paid_amount ?? 0),
          0
        );
        const fiado = faturado - recebido;
        // Cargas do operador atrelado a este seller (via user_id)
        const myCargas = s.user_id
          ? cargas.filter((c) => c.operator_id === s.user_id)
          : [];
        const cargas_abertas = myCargas.filter(
          (c) => c.status === "aberta"
        ).length;
        const cargas_fechadas = myCargas.filter(
          (c) => c.status !== "aberta"
        ).length;
        const closedCargas = myCargas.filter(
          (c) => c.status !== "aberta" && c.opened_at && c.closed_at
        );
        const tempo_medio_carga_h =
          closedCargas.length > 0
            ? closedCargas.reduce(
                (sum, c) =>
                  sum +
                  (new Date(c.closed_at as string).getTime() -
                    new Date(c.opened_at).getTime()) /
                    3_600_000,
                0
              ) / closedCargas.length
            : null;
        const diferenca_caixa_total = myCargas.reduce(
          (sum, c) => sum + (diffByCarga[c.id] ?? 0),
          0
        );
        return {
          seller: s,
          vendas,
          cocos,
          faturado,
          recebido,
          fiado_em_aberto: fiado,
          pct_fiado: faturado > 0 ? (fiado / faturado) * 100 : 0,
          cargas_abertas,
          cargas_fechadas,
          tempo_medio_carga_h,
          diferenca_caixa_total,
        };
      })
      .filter((m) => m.vendas > 0 || m.cargas_abertas + m.cargas_fechadas > 0)
      .sort((a, b) => b.faturado - a.faturado);
  }, [sellers, sales, cargas, diffByCarga]);

  const presetLabel =
    DASHBOARD_PRESETS.find((p) => p.id === preset)?.label ?? "";

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">Operadores</h1>
          <p className="text-coco-600">
            Produtividade por vendedor · período: <strong>{presetLabel}</strong>
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

      <div className="card overflow-x-auto">
        {loading ? (
          <p className="text-coco-600">Carregando…</p>
        ) : metrics.length === 0 ? (
          <p className="text-coco-600">
            Sem dados de vendedores no período.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Vendedor</th>
                <th className="text-right">Vendas</th>
                <th className="text-right">Cocos</th>
                <th className="text-right">Faturado</th>
                <th className="text-right">Recebido</th>
                <th className="text-right">Fiado</th>
                <th className="text-right">% fiado</th>
                <th className="text-right">Cargas (a/f)</th>
                <th className="text-right">Tempo médio</th>
                <th className="text-right">Δ caixa</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.seller.id}>
                  <td className="font-medium">
                    {m.seller.name}
                    {m.seller.user_id ? "" : " (offline)"}
                  </td>
                  <td className="text-right">{m.vendas}</td>
                  <td className="text-right">{m.cocos}</td>
                  <td className="text-right font-semibold">
                    {brl(m.faturado)}
                  </td>
                  <td className="text-right text-green-700">
                    {brl(m.recebido)}
                  </td>
                  <td
                    className={`text-right ${
                      m.fiado_em_aberto > 0 ? "text-amber-700" : ""
                    }`}
                  >
                    {brl(m.fiado_em_aberto)}
                  </td>
                  <td
                    className={`text-right ${
                      m.pct_fiado > 30
                        ? "text-red-700"
                        : m.pct_fiado > 10
                        ? "text-amber-700"
                        : ""
                    }`}
                  >
                    {m.pct_fiado.toFixed(0)}%
                  </td>
                  <td className="text-right text-xs">
                    {m.cargas_abertas}/{m.cargas_fechadas}
                  </td>
                  <td className="text-right text-xs">
                    {m.tempo_medio_carga_h !== null
                      ? `${m.tempo_medio_carga_h.toFixed(1)}h`
                      : "—"}
                  </td>
                  <td
                    className={`text-right text-xs ${
                      Math.abs(m.diferenca_caixa_total) < 0.01
                        ? "text-green-700"
                        : m.diferenca_caixa_total > 0
                        ? "text-amber-700"
                        : "text-red-700"
                    }`}
                  >
                    {brl(m.diferenca_caixa_total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="text-xs text-coco-600 mt-3 space-y-1">
          <p>
            <strong>% fiado</strong>: parte do faturado que ainda não foi
            recebida. Acima de 30% sinaliza risco de inadimplência alta.
          </p>
          <p>
            <strong>Cargas (a/f)</strong>: abertas / fechadas+conferidas.
            Considera só vendedores vinculados a um login (user_id).
          </p>
          <p>
            <strong>Tempo médio</strong>: média de horas entre abrir e
            fechar uma carga.
          </p>
          <p>
            <strong>Δ caixa</strong>: soma das diferenças de caixa nas cargas
            (declarado − esperado). Negativo = caixa faltou.
          </p>
        </div>
      </div>
    </div>
  );
}
