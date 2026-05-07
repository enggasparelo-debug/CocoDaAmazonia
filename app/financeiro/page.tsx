"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";

type FlowRow = {
  id: string;
  amount: number;
  paid_at: string;
  payment_method_id: string;
  sale_id: string;
  notes: string | null;
  sale: { code: number } | null;
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

export default function FinanceiroPage() {
  const supabase = createClient();
  const [from, setFrom] = useState(firstOfMonthStr());
  const [to, setTo] = useState(todayStr());
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [rows, setRows] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [m, p] = await Promise.all([
      supabase.from("payment_methods").select("*"),
      supabase
        .from("sale_payments")
        .select("*, sale:sales(code)")
        .gte("paid_at", isoStartOfDay(from))
        .lte("paid_at", isoEndOfDay(to))
        .order("paid_at", { ascending: false }),
    ]);
    setMethods((m.data as PaymentMethod[]) ?? []);
    setRows((p.data as FlowRow[]) ?? []);
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
      byMethod[r.payment_method_id] =
        (byMethod[r.payment_method_id] || 0) + a;
      total += a;
    });
    return { byMethod, total };
  }, [rows]);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">Financeiro</h1>
          <p className="text-coco-600">
            Fluxo de recebimentos por forma de pagamento.
          </p>
        </div>
        <a
          href="/financeiro/dre"
          className="btn-secondary"
        >
          📊 Ver DRE
        </a>
      </header>

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
          <div className="text-3xl font-bold text-coco-900">
            {brl(totals.total)}
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {methods.map((m) => (
          <div key={m.id} className="card">
            <div className="text-xs uppercase tracking-wider text-coco-700">
              {m.name}
            </div>
            <div className="text-2xl font-bold mt-1">
              {brl(totals.byMethod[m.id] || 0)}
            </div>
          </div>
        ))}
      </div>

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
                  <td className="text-right font-semibold">
                    {brl(Number(r.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
