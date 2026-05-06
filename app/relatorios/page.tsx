"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import type {
  Carga,
  Customer,
  PaymentMethod,
  Sale,
  Seller,
} from "@/lib/types";
import StatusBadge from "@/components/StatusBadge";
import SaleEditor from "@/components/SaleEditor";
import ConfirmModal from "@/components/ConfirmModal";
import Link from "next/link";
import { useTenant } from "@/lib/useTenant";
import { useToast } from "@/components/Toast";
import {
  PRESET_LABELS,
  presetRange,
  type DateRangePreset,
} from "@/lib/dateRanges";
import { downloadCsv, downloadXlsx, rowsToCsv } from "@/lib/export";

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
  const toast = useToast();
  const { isAdmin } = useTenant();
  const [from, setFrom] = useState(firstOfMonthStr());
  const [to, setTo] = useState(todayStr());
  const [customerId, setCustomerId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [sellerId, setSellerId] = useState<string>("");
  const [cargaId, setCargaId] = useState<string>("");
  const [methodFilter, setMethodFilter] = useState<string>("");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [cargas, setCargas] = useState<Carga[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [payments, setPayments] = useState<
    { sale_id: string; amount: number; payment_method_id: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Sale | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Sale | null>(null);

  async function deleteSale(s: Sale) {
    const { error } = await supabase.from("sales").delete().eq("id", s.id);
    setConfirmDelete(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Venda apagada.");
    loadReport();
  }

  async function loadAux() {
    const [c, m, sl, cg] = await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase.from("payment_methods").select("*"),
      supabase.from("sellers").select("*").order("name"),
      supabase
        .from("cargas")
        .select("*")
        .order("opened_at", { ascending: false })
        .limit(50),
    ]);
    setCustomers((c.data as Customer[]) ?? []);
    setMethods((m.data as PaymentMethod[]) ?? []);
    setSellers((sl.data as Seller[]) ?? []);
    setCargas((cg.data as Carga[]) ?? []);
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
    if (sellerId) q = q.eq("seller_id", sellerId);
    if (cargaId) q = q.eq("carga_id", cargaId);
    const { data: s } = await q;
    let result = (s as Sale[]) ?? [];

    let pays: { sale_id: string; amount: number; payment_method_id: string }[] = [];
    if (result.length > 0) {
      const ids = result.map((x) => x.id);
      const { data: p } = await supabase
        .from("sale_payments")
        .select("sale_id, amount, payment_method_id")
        .in("sale_id", ids);
      pays = (p as typeof pays) ?? [];
    }

    if (methodFilter) {
      // Filtra pra vendas que tenham ao menos 1 pagamento na forma escolhida.
      const saleIdsWithMethod = new Set(
        pays
          .filter((p) => p.payment_method_id === methodFilter)
          .map((p) => p.sale_id)
      );
      result = result.filter((sa) => saleIdsWithMethod.has(sa.id));
      pays = pays.filter((p) => saleIdsWithMethod.has(p.sale_id));
    }

    setSales(result);
    setPayments(pays);
    setLoading(false);
  }

  useEffect(() => {
    loadAux();
  }, []);

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, customerId, status, sellerId, cargaId, methodFilter]);

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

  function buildExportRows() {
    return sales.map((s) => ({
      "#": s.code,
      data: fmtDate(s.created_at),
      cliente: s.customer_id
        ? custMap[s.customer_id]?.name ?? ""
        : "Consumidor",
      quantidade: s.quantity,
      unitario: Number(s.unit_price).toFixed(2),
      total: Number(s.total).toFixed(2),
      pago: Number(s.paid_amount).toFixed(2),
      saldo: (Number(s.total) - Number(s.paid_amount)).toFixed(2),
      status: s.status,
      observacao: (s.notes ?? "").replace(/[\n]/g, " "),
    }));
  }

  function exportCsv() {
    const rows = buildExportRows();
    downloadCsv(`vendas_${from}_${to}.csv`, rowsToCsv(rows));
  }

  async function exportXlsx() {
    const rows = buildExportRows();
    await downloadXlsx(`vendas_${from}_${to}.xlsx`, "Vendas", rows);
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
        <div className="flex gap-2">
          <button onClick={exportCsv} className="btn-secondary">
            ⬇ CSV
          </button>
          <button onClick={exportXlsx} className="btn-secondary">
            ⬇ Excel
          </button>
        </div>
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
              <option value="cancelada">Cancelada</option>
            </select>
          </div>
          <div>
            <label className="label">Vendedor</label>
            <select
              value={sellerId}
              onChange={(e) => setSellerId(e.target.value)}
              className="input"
            >
              <option value="">Todos</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.active ? "" : " (inativo)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Carga</label>
            <select
              value={cargaId}
              onChange={(e) => setCargaId(e.target.value)}
              className="input"
            >
              <option value="">Todas</option>
              {cargas.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.code} · {c.status}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Forma de pagamento</label>
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="input"
            >
              <option value="">Todas</option>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setCustomerId("");
                setStatus("");
                setSellerId("");
                setCargaId("");
                setMethodFilter("");
              }}
              className="btn-ghost w-full"
              disabled={
                !customerId &&
                !status &&
                !sellerId &&
                !cargaId &&
                !methodFilter
              }
            >
              Limpar filtros
            </button>
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
                      rel="noopener noreferrer"
                      className="btn-ghost text-xs px-2"
                      title="Recibo"
                      aria-label="Abrir recibo"
                    >
                      🧾
                    </Link>
                    <button
                      onClick={() => setEditing(s)}
                      className="btn-ghost text-xs px-2"
                      title="Editar"
                    >
                      ✏️
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => setConfirmDelete(s)}
                        className="btn-ghost text-xs px-2 text-red-700"
                        title="Apagar venda definitivamente"
                      >
                        🗑
                      </button>
                    )}
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

      {confirmDelete && (
        <ConfirmModal
          title="Apagar esta venda definitivamente?"
          danger
          confirmText="Apagar tudo"
          message={
            <>
              Vai apagar a venda <strong>#{confirmDelete.code}</strong> de{" "}
              {brl(Number(confirmDelete.total))}{" "}
              <strong>e todos os pagamentos relacionados</strong>. Não dá pra
              desfazer.
              <br />
              <br />
              Se for só corrigir, prefira <strong>Editar</strong> ou{" "}
              <strong>Cancelar</strong> a venda — assim o histórico fica
              preservado.
            </>
          }
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => deleteSale(confirmDelete)}
        />
      )}
    </div>
  );
}
