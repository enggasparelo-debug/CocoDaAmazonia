"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import type { Customer, PaymentMethod, Sale } from "@/lib/types";
import StatusBadge from "@/components/StatusBadge";
import SaleEditor from "@/components/SaleEditor";
import Link from "next/link";
import {
  PRESET_LABELS,
  presetRange,
  type DateRangePreset,
} from "@/lib/dateRanges";

const PRESETS: DateRangePreset[] = [
  "hoje",
  "ontem",
  "amanha",
  "semana-atual",
  "semana-passada",
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthStr() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function isoStart(d: string) {
  return new Date(d + "T00:00:00").toISOString();
}
function isoEnd(d: string) {
  return new Date(d + "T23:59:59.999").toISOString();
}

export default function RelatoriosPage() {
  const supabase = createClient();
  const [from, setFrom] = useState(firstOfMonthStr());
  const [to, setTo] = useState(todayStr());
  const [customerId, setCustomerId] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [payments, setPayments] = useState<
    { sale_id: string; amount: number; payment_method_id: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Sale | null>(null);

  async function loadAux() {
    const [c, m] = await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase.from("payment_methods").select("*"),
    ]);
    setCustomers((c.data as Customer[]) ?? []);
    setMethods((m.data as PaymentMethod[]) ?? []);
  }

  async function loadReport() {
    setLoading(true);
    let q = supabase
      .from("sales")
      .select("*")
      .gte("created_at", isoStart(from))
      .lte("created_at", isoEnd(to))
      .order("created_at", { ascending: false });
    if (customerId) q = q.eq("customer_id", customerId);
    if (status) q = q.eq("status", status);
    const { data: s } = await q;
    setSales((s as Sale[]) ?? []);

    if (s && s.length > 0) {
      const ids = s.map((x) => x.id);
      const { data: p } = await supabase
        .from("sale_payments")
        .select("sale_id, amount, payment_method_id")
        .in("sale_id", ids);
      setPayments((p as any[]) ?? []);
    } else {
      setPayments([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAux();
  }, []);

  useEffect(() => {
    loadReport();
  }, [from, to, customerId, status]);

  const custMap = useMemo(() => {
    const map: Record<string, Customer> = {};
    customers.forEach((c) => (map[c.id] = c));
    return map;
  }, [customers]);

  const methodMap = useMemo(() => {
    const map: Record<string, PaymentMethod> = {};
    methods.forEach((m) => (map[m.id] = m));
    return map;
  }, [methods]);

  const totals = useMemo(() => {
    const totalSales = sales.reduce((s, v) => s + Number(v.total), 0);
    const totalPaid = sales.reduce((s, v) => s + Number(v.paid_amount), 0);
    const totalQty = sales.reduce((s, v) => s + Number(v.quantity), 0);
    const totalOpen = totalSales - totalPaid;
    const byMethod: Record<string, number> = {};
    payments.forEach((p) => {
      byMethod[p.payment_method_id] =
        (byMethod[p.payment_method_id] || 0) + Number(p.amount);
    });
    return {
      totalSales,
      totalPaid,
      totalOpen,
      totalQty,
      count: sales.length,
      byMethod,
    };
  }, [sales, payments]);

  function exportCsv() {
    const headers = [
      "data",
      "cliente",
      "quantidade",
      "unitario",
      "total",
      "pago",
      "saldo",
      "status",
      "observacao",
    ];
    const lines = sales.map((s) => [
      fmtDate(s.created_at),
      s.customer_id ? custMap[s.customer_id]?.name ?? "" : "Consumidor",
      s.quantity,
      Number(s.unit_price).toFixed(2),
      Number(s.total).toFixed(2),
      Number(s.paid_amount).toFixed(2),
      (Number(s.total) - Number(s.paid_amount)).toFixed(2),
      s.status,
      (s.notes ?? "").replace(/[\n;]/g, " "),
    ]);
    const csv = [headers, ...lines]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const blob = new Blob(["﻿" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vendas_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">Relatórios</h1>
          <p className="text-coco-600">
            Vendas detalhadas com filtros por período, cliente e status.
          </p>
        </div>
        <button onClick={exportCsv} className="btn-secondary">
          ⬇ Exportar CSV
        </button>
      </header>

      <div className="card space-y-3">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const r = presetRange(p);
            const active = from === r.from && to === r.to;
            return (
              <button
                key={p}
                onClick={() => {
                  setFrom(r.from);
                  setTo(r.to);
                }}
                className={`px-3 py-1.5 rounded-full text-sm border transition ${
                  active
                    ? "bg-coco-600 text-white border-coco-600"
                    : "bg-white text-coco-800 border-coco-200 hover:bg-coco-50"
                }`}
              >
                {PRESET_LABELS[p]}
              </button>
            );
          })}
        </div>
        <div className="grid md:grid-cols-4 gap-3">
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
        <div>
          <label className="label">Cliente</label>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="input"
          >
            <option value="">Todos</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="input"
          >
            <option value="">Todos</option>
            <option value="paga">Paga</option>
            <option value="parcial">Parcial</option>
            <option value="aberta">Aberta</option>
          </select>
        </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="card">
          <div className="text-xs uppercase text-coco-700">Vendas</div>
          <div className="text-2xl font-bold">{totals.count}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-coco-700">Cocos</div>
          <div className="text-2xl font-bold">{totals.totalQty}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-coco-700">Faturado</div>
          <div className="text-2xl font-bold">{brl(totals.totalSales)}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-coco-700">Recebido</div>
          <div className="text-2xl font-bold text-green-700">
            {brl(totals.totalPaid)}
          </div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-coco-700">Em aberto</div>
          <div className="text-2xl font-bold text-amber-700">
            {brl(totals.totalOpen)}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="font-bold text-coco-900 mb-3">Recebido por forma</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {methods.map((m) => (
            <div
              key={m.id}
              className="rounded-xl border border-coco-100 p-3"
            >
              <div className="text-xs text-coco-700">{m.name}</div>
              <div className="font-bold">
                {brl(totals.byMethod[m.id] || 0)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="font-bold text-coco-900 mb-3">Vendas</h2>
        {loading ? (
          <p className="text-coco-600">Carregando…</p>
        ) : sales.length === 0 ? (
          <p className="text-coco-600">Nenhuma venda no filtro.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Data</th>
                <th>Cliente</th>
                <th>Qtd</th>
                <th>Unit.</th>
                <th>Total</th>
                <th>Pago</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id} className={s.status === "cancelada" ? "opacity-60" : ""}>
                  <td className="font-mono font-semibold">#{s.code}</td>
                  <td>{fmtDate(s.created_at)}</td>
                  <td>
                    {s.customer_id
                      ? custMap[s.customer_id]?.name ?? "—"
                      : "Consumidor"}
                  </td>
                  <td>{s.quantity}</td>
                  <td>{brl(Number(s.unit_price))}</td>
                  <td className="font-semibold">{brl(Number(s.total))}</td>
                  <td>{brl(Number(s.paid_amount))}</td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <Link
                      href={`/recibo/${s.id}`}
                      target="_blank"
                      className="btn-ghost text-xs px-2"
                    >
                      🧾
                    </Link>
                    <button
                      onClick={() => setEditing(s)}
                      className="btn-ghost text-xs px-2"
                    >
                      ✏️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <SaleEditor
          sale={editing}
          customers={customers}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loadReport();
          }}
        />
      )}
    </div>
  );
}
