"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate, fmtDateOnly } from "@/lib/format";
import { nowLocalIso } from "@/lib/datetime";
import type {
  Customer,
  PaymentMethod,
  Sale,
  SalePayment,
} from "@/lib/types";

type CustomerProfitability = {
  customer_id: string;
  tenant_id: string;
  total_sales: number;
  ltv: number;
  total_qty: number;
  total_paid: number;
  first_sale_at: string | null;
  last_sale_at: string | null;
  avg_ticket: number;
  purchases_per_month: number;
  avg_unit_cost: number;
  net_margin_pct: number | null;
};
import StatusBadge from "@/components/StatusBadge";
import ConfirmModal from "@/components/ConfirmModal";
import SaleEditor from "@/components/SaleEditor";
import PaymentEditor from "@/components/PaymentEditor";
import { useToast } from "@/components/Toast";
import { useTenant } from "@/lib/useTenant";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function daysAgoIso(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

type StatusTab = "todas" | "abertas" | "vencidas" | "pagas";

const QUICK_FILTERS = [
  { label: "7 dias", from: () => daysAgoIso(7), to: () => todayIso() },
  { label: "15 dias", from: () => daysAgoIso(15), to: () => todayIso() },
  { label: "21 dias", from: () => daysAgoIso(21), to: () => todayIso() },
  { label: "30 dias", from: () => daysAgoIso(30), to: () => todayIso() },
  { label: "Tudo", from: () => "2000-01-01", to: () => todayIso() },
];

export default function ClienteDetalhePage() {
  const supabase = createClient();
  const toast = useToast();
  const { isAdmin } = useTenant();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [payments, setPayments] = useState<SalePayment[]>([]);
  const [methods, setMethods] = useState<Record<string, PaymentMethod>>({});
  const [methodList, setMethodList] = useState<PaymentMethod[]>([]);
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const [profitability, setProfitability] = useState<CustomerProfitability | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<SalePayment | null>(null);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [editingPayment, setEditingPayment] = useState<SalePayment | null>(null);
  const [confirmDeleteSale, setConfirmDeleteSale] = useState<Sale | null>(null);

  const [dateFrom, setDateFrom] = useState(daysAgoIso(30));
  const [dateTo, setDateTo] = useState(todayIso());
  const [activeQuick, setActiveQuick] = useState<string>("30 dias");
  const [statusTab, setStatusTab] = useState<StatusTab>("todas");

  // Bulk payment (FIFO)
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkAmount, setBulkAmount] = useState(0);
  const [bulkMethod, setBulkMethod] = useState("");
  const [bulkDate, setBulkDate] = useState("");
  const [bulkNotes, setBulkNotes] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [c, s, m, ac, prof] = await Promise.all([
      supabase.from("customers").select("*").eq("id", id).single(),
      supabase
        .from("sales")
        .select("*")
        .eq("customer_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("payment_methods").select("*"),
      supabase.from("customers").select("*").order("name"),
      supabase
        .from("customer_profitability")
        .select("*")
        .eq("customer_id", id)
        .maybeSingle(),
    ]);
    setCustomer((c.data as Customer) ?? null);
    setSales((s.data as Sale[]) ?? []);
    setAllCustomers((ac.data as Customer[]) ?? []);
    setProfitability((prof.data as CustomerProfitability) ?? null);

    const map: Record<string, PaymentMethod> = {};
    const list = (m.data as PaymentMethod[] | null) ?? [];
    list.forEach((x) => (map[x.id] = x));
    setMethods(map);
    setMethodList(list.filter((x) => x.active && !x.is_credit));

    if (s.data && s.data.length > 0) {
      const ids = s.data.map((x) => x.id);
      const { data: p } = await supabase
        .from("sale_payments")
        .select("*")
        .in("sale_id", ids);
      setPayments((p as SalePayment[]) ?? []);
    } else {
      setPayments([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [id]);

  async function deletePayment(p: SalePayment) {
    const { error } = await supabase
      .from("sale_payments")
      .delete()
      .eq("id", p.id);
    setConfirmDelete(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Pagamento removido.");
    load();
  }

  async function deleteSale(s: Sale) {
    const { error } = await supabase.from("sales").delete().eq("id", s.id);
    setConfirmDeleteSale(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Venda apagada.");
    load();
  }

  // All open (non-paid, non-cancelled) sales sorted oldest first — for FIFO bulk payment
  const allOpenSales = useMemo(
    () =>
      sales
        .filter((s) => s.status !== "paga" && s.status !== "cancelada")
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ),
    [sales]
  );

  function openBulk() {
    const total = allOpenSales.reduce(
      (s, x) => s + (Number(x.total) - Number(x.paid_amount)),
      0
    );
    setBulkAmount(+total.toFixed(2));
    setBulkMethod(methodList[0]?.id ?? "");
    setBulkDate(nowLocalIso());
    setBulkNotes("");
    setBulkError(null);
    setBulkOpen(true);
  }

  async function confirmBulk() {
    setBulkError(null);
    if (!bulkMethod) return setBulkError("Escolha uma forma de pagamento.");
    if (bulkAmount <= 0) return setBulkError("Valor inválido.");
    if (!bulkDate) return setBulkError("Informe a data do pagamento.");
    const paidAtIso = new Date(bulkDate).toISOString();
    if (new Date(paidAtIso).getTime() > Date.now() + 60_000) {
      return setBulkError("A data do pagamento não pode ser no futuro.");
    }

    let remaining = +bulkAmount.toFixed(2);
    const inserts: {
      sale_id: string;
      payment_method_id: string;
      amount: number;
      paid_at: string;
      notes: string | null;
    }[] = [];

    for (const s of allOpenSales) {
      if (remaining <= 0) break;
      const rest = +(Number(s.total) - Number(s.paid_amount)).toFixed(2);
      if (rest <= 0) continue;
      const apply = Math.min(rest, remaining);
      inserts.push({
        sale_id: s.id,
        payment_method_id: bulkMethod,
        amount: +apply.toFixed(2),
        paid_at: paidAtIso,
        notes: bulkNotes || null,
      });
      remaining = +(remaining - apply).toFixed(2);
    }

    if (inserts.length === 0) {
      return setBulkError("Nenhuma venda em aberto para distribuir.");
    }

    setBulkSaving(true);
    const { error } = await supabase.from("sale_payments").insert(inserts);
    setBulkSaving(false);
    if (error) {
      setBulkError(error.message);
      return;
    }
    setBulkOpen(false);
    toast.success(`Pagamento distribuído em ${inserts.length} venda(s).`);
    load();
  }

  const sortedPayments = useMemo(
    () =>
      [...payments].sort(
        (a, b) =>
          new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime()
      ),
    [payments]
  );

  // Filtered + tabbed sales
  const filteredSales = useMemo(() => {
    const from = new Date(`${dateFrom}T00:00:00`).getTime();
    const to = new Date(`${dateTo}T23:59:59`).getTime();
    const now = Date.now();

    return sales.filter((s) => {
      const t = new Date(s.created_at).getTime();
      if (t < from || t > to) return false;
      if (s.status === "cancelada") return false;

      if (statusTab === "pagas") return s.status === "paga";
      if (statusTab === "abertas")
        return (
          s.status !== "paga" &&
          now - t <= 30 * 86400000
        );
      if (statusTab === "vencidas")
        return s.status !== "paga" && now - t > 30 * 86400000;
      return true; // todas
    });
  }, [sales, dateFrom, dateTo, statusTab]);

  const summaryFiltered = useMemo(() => {
    const totalBought = filteredSales.reduce(
      (acc, s) => acc + Number(s.total),
      0
    );
    const totalPaid = filteredSales.reduce(
      (acc, s) => acc + Number(s.paid_amount),
      0
    );
    return { totalBought, totalPaid, open: totalBought - totalPaid };
  }, [filteredSales]);

  // Global totals (all non-cancelled sales)
  const globalTotals = useMemo(() => {
    const nonCancelled = sales.filter((s) => s.status !== "cancelada");
    const totalBought = nonCancelled.reduce(
      (acc, s) => acc + Number(s.total),
      0
    );
    const totalPaid = nonCancelled.reduce(
      (acc, s) => acc + Number(s.paid_amount),
      0
    );
    return { totalBought, totalPaid, open: totalBought - totalPaid };
  }, [sales]);

  function applyQuick(qf: (typeof QUICK_FILTERS)[number]) {
    setDateFrom(qf.from());
    setDateTo(qf.to());
    setActiveQuick(qf.label);
  }

  if (loading) return <div className="text-coco-700">Carregando…</div>;
  if (!customer)
    return <div className="text-coco-700">Cliente não encontrado.</div>;

  function whatsappLink() {
    if (!customer?.phone) return null;
    const phone = customer.phone.replace(/\D/g, "");
    if (!phone) return null;
    const msg = encodeURIComponent(
      `Olá ${customer.name}! Saldo da sua conta na Coco da Amazônia: ${brl(globalTotals.open)}.`
    );
    return `https://wa.me/55${phone}?text=${msg}`;
  }

  const wa = whatsappLink();

  const tabConfig: { key: StatusTab; label: string; active: string; inactive: string }[] = [
    {
      key: "todas",
      label: "Todas",
      active: "bg-coco-600 text-white border-coco-600",
      inactive: "bg-white text-coco-600 border-coco-200 hover:bg-coco-50",
    },
    {
      key: "abertas",
      label: "Abertas",
      active: "bg-amber-100 text-amber-800 border-amber-300",
      inactive: "bg-white text-coco-600 border-coco-200 hover:bg-coco-50",
    },
    {
      key: "vencidas",
      label: "Vencidas",
      active: "bg-red-100 text-red-800 border-red-300",
      inactive: "bg-white text-coco-600 border-coco-200 hover:bg-coco-50",
    },
    {
      key: "pagas",
      label: "Pagas",
      active: "bg-green-100 text-green-800 border-green-300",
      inactive: "bg-white text-coco-600 border-coco-200 hover:bg-coco-50",
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link href="/clientes" className="text-coco-700 underline text-sm">
            ← Clientes
          </Link>
          <h1 className="text-3xl font-bold text-coco-900 mt-1">
            {customer.name}
          </h1>
          <p className="text-coco-600 text-sm">
            {customer.phone || "sem telefone"}
            {customer.email && <> · {customer.email}</>}
          </p>
        </div>
        <div className="flex gap-2">
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              📲 WhatsApp do saldo
            </a>
          )}
          {allOpenSales.length > 0 && (
            <button onClick={openBulk} className="btn-primary">
              💰 Distribuir pagamento
            </button>
          )}
          <Link href={`/receber?cliente=${customer.id}`} className="btn-secondary">
            📒 Ver contas
          </Link>
        </div>
      </header>

      {/* Global summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card">
          <div className="text-xs uppercase text-coco-700">Total comprado</div>
          <div className="text-2xl font-bold">{brl(globalTotals.totalBought)}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-coco-700">Total pago</div>
          <div className="text-2xl font-bold text-green-700">
            {brl(globalTotals.totalPaid)}
          </div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-coco-700">Em aberto</div>
          <div
            className={`text-2xl font-bold ${
              globalTotals.open > 0 ? "text-amber-700" : "text-green-700"
            }`}
          >
            {brl(globalTotals.open)}
          </div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-coco-700">Vendas</div>
          <div className="text-2xl font-bold">{sales.filter(s => s.status !== "cancelada").length}</div>
        </div>
      </div>

      {profitability && (
        <div className="card">
          <h2 className="font-bold text-coco-900 mb-3">Rentabilidade</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <div className="text-xs uppercase text-coco-700 mb-1">LTV (receita total)</div>
              <div className="text-xl font-bold text-coco-900">{brl(Number(profitability.ltv))}</div>
              <div className="text-xs text-coco-600 mt-0.5">
                {profitability.total_qty} cocos vendidos
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-coco-700 mb-1">Ticket médio</div>
              <div className="text-xl font-bold">{brl(Number(profitability.avg_ticket))}</div>
              <div className="text-xs text-coco-600 mt-0.5">
                por venda ({profitability.total_sales} no total)
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-coco-700 mb-1">Frequência</div>
              <div className="text-xl font-bold">
                {Number(profitability.purchases_per_month).toFixed(1)}×/mês
              </div>
              {profitability.first_sale_at && (
                <div className="text-xs text-coco-600 mt-0.5">
                  desde {fmtDate(profitability.first_sale_at)}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs uppercase text-coco-700 mb-1">Margem líquida est.</div>
              {profitability.net_margin_pct !== null ? (
                <>
                  <div
                    className={`text-xl font-bold ${
                      Number(profitability.net_margin_pct) >= 0.2
                        ? "text-green-700"
                        : Number(profitability.net_margin_pct) >= 0
                        ? "text-amber-700"
                        : "text-red-700"
                    }`}
                  >
                    {(Number(profitability.net_margin_pct) * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-coco-600 mt-0.5">
                    custo médio {brl(Number(profitability.avg_unit_cost))}/un
                  </div>
                </>
              ) : (
                <div className="text-xl font-bold text-coco-400">—</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payments history */}
      <div className="card">
        <h2 className="font-bold text-coco-900 mb-3">Histórico de pagamentos</h2>
        {sortedPayments.length === 0 ? (
          <p className="text-coco-600 text-sm">
            Nenhum pagamento lançado ainda.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Data do pagamento</th>
                <th>Forma</th>
                <th className="text-right">Valor</th>
                <th>Venda</th>
                <th>Observação</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedPayments.map((p) => {
                const sale = sales.find((s) => s.id === p.sale_id);
                return (
                  <tr key={p.id}>
                    <td>{fmtDate(p.paid_at)}</td>
                    <td>{methods[p.payment_method_id]?.name ?? "—"}</td>
                    <td className="text-right font-semibold text-green-700">
                      {brl(Number(p.amount))}
                    </td>
                    <td className="text-xs">
                      {sale ? (
                        <Link
                          href={`/recibo/${sale.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-coco-700 underline"
                        >
                          venda de {fmtDateOnly(sale.created_at)}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-xs text-coco-600">{p.notes ?? ""}</td>
                    <td className="text-right whitespace-nowrap">
                      {isAdmin && (
                        <>
                          <button
                            onClick={() => setEditingPayment(p)}
                            className="btn-ghost text-xs"
                            title="Editar pagamento"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => setConfirmDelete(p)}
                            className="btn-ghost text-xs text-red-700"
                            title="Remover pagamento"
                          >
                            🗑
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Sales history with filters */}
      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h2 className="font-bold text-coco-900">Histórico de vendas</h2>
          {filteredSales.length > 0 && (
            <div className="text-sm text-coco-600">
              {filteredSales.length} venda(s) ·{" "}
              <span className="text-amber-700 font-semibold">
                {brl(summaryFiltered.open)} em aberto
              </span>
            </div>
          )}
        </div>

        {/* Quick filters */}
        <div className="flex flex-wrap gap-2 mb-3">
          {QUICK_FILTERS.map((qf) => (
            <button
              key={qf.label}
              onClick={() => applyQuick(qf)}
              className={`px-3 py-1 rounded-lg border text-xs font-medium transition-all ${
                activeQuick === qf.label
                  ? "bg-coco-600 text-white border-coco-600"
                  : "bg-white text-coco-600 border-coco-200 hover:bg-coco-50"
              }`}
            >
              {qf.label}
            </button>
          ))}
          <div className="flex gap-2 ml-auto flex-wrap">
            <input
              type="date"
              className="input text-xs py-1 h-auto"
              value={dateFrom}
              max={dateTo}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setActiveQuick("");
              }}
            />
            <input
              type="date"
              className="input text-xs py-1 h-auto"
              value={dateTo}
              min={dateFrom}
              max={todayIso()}
              onChange={(e) => {
                setDateTo(e.target.value);
                setActiveQuick("");
              }}
            />
          </div>
        </div>

        {/* Status tabs */}
        <div className="flex gap-2 flex-wrap mb-4">
          {tabConfig.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatusTab(t.key)}
              className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                statusTab === t.key ? t.active : t.inactive
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {filteredSales.length === 0 ? (
          <p className="text-coco-600 text-sm">
            Nenhuma venda encontrada com os filtros selecionados.
          </p>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Qtd</th>
                  <th>Total</th>
                  <th>Pago</th>
                  <th>Restante</th>
                  <th>Status</th>
                  <th>Pagamentos</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.map((s) => {
                  const sp = payments.filter((p) => p.sale_id === s.id);
                  const rest = Number(s.total) - Number(s.paid_amount);
                  const daysOld = Math.floor(
                    (Date.now() - new Date(s.created_at).getTime()) / 86400000
                  );
                  const isOverdue = s.status !== "paga" && daysOld > 30;
                  return (
                    <tr key={s.id}>
                      <td>{fmtDateOnly(s.created_at)}</td>
                      <td>{s.quantity}</td>
                      <td className="font-semibold">{brl(Number(s.total))}</td>
                      <td>{brl(Number(s.paid_amount))}</td>
                      <td
                        className={
                          rest > 0
                            ? isOverdue
                              ? "font-semibold text-red-700"
                              : "font-semibold text-amber-700"
                            : "text-green-700"
                        }
                      >
                        {brl(rest)}
                      </td>
                      <td>
                        <StatusBadge status={s.status} />
                        {isOverdue && (
                          <span className="ml-1 text-xs text-red-500">
                            ⚠ {daysOld}d
                          </span>
                        )}
                      </td>
                      <td className="text-xs">
                        {sp.length === 0 ? (
                          "—"
                        ) : (
                          <div className="space-y-0.5">
                            {sp.map((p) => (
                              <div key={p.id}>
                                {fmtDateOnly(p.paid_at)} ·{" "}
                                {methods[p.payment_method_id]?.name ?? "?"} ·{" "}
                                <strong>{brl(Number(p.amount))}</strong>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <Link
                          href={`/recibo/${s.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-ghost text-xs"
                          title="Recibo"
                          aria-label="Abrir recibo"
                        >
                          🧾
                        </Link>
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => setEditingSale(s)}
                              className="btn-ghost text-xs"
                              title="Editar venda"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => setConfirmDeleteSale(s)}
                              className="btn-ghost text-xs text-red-700"
                              title="Apagar venda definitivamente"
                            >
                              🗑
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {filteredSales.length > 1 && (
                <tfoot>
                  <tr className="bg-coco-50 font-semibold text-sm">
                    <td colSpan={2} className="py-2 px-3">
                      Total
                    </td>
                    <td className="py-2 px-3">
                      {brl(summaryFiltered.totalBought)}
                    </td>
                    <td className="py-2 px-3">
                      {brl(summaryFiltered.totalPaid)}
                    </td>
                    <td className="py-2 px-3">{brl(summaryFiltered.open)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </>
        )}
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Remover pagamento?"
          danger
          confirmText="Remover"
          message={
            <>
              Vai apagar o lançamento de{" "}
              <strong>{brl(Number(confirmDelete.amount))}</strong> em{" "}
              {fmtDate(confirmDelete.paid_at)}. Isso atualiza o saldo da venda
              correspondente automaticamente. A ação fica registrada na
              auditoria.
            </>
          }
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => deletePayment(confirmDelete)}
        />
      )}

      {editingSale && (
        <SaleEditor
          sale={editingSale}
          customers={allCustomers}
          onClose={() => setEditingSale(null)}
          onSaved={() => {
            setEditingSale(null);
            load();
          }}
        />
      )}

      {editingPayment && (
        <PaymentEditor
          payment={editingPayment}
          methods={methodList}
          onClose={() => setEditingPayment(null)}
          onSaved={() => {
            setEditingPayment(null);
            load();
          }}
        />
      )}

      {confirmDeleteSale && (
        <ConfirmModal
          title="Apagar esta venda definitivamente?"
          danger
          confirmText="Apagar tudo"
          message={
            <>
              Vai apagar a venda de{" "}
              <strong>{brl(Number(confirmDeleteSale.total))}</strong> de{" "}
              {fmtDateOnly(confirmDeleteSale.created_at)}{" "}
              <strong>e todos os pagamentos relacionados</strong>. Não dá pra
              desfazer.
              <br />
              <br />
              Se for só corrigir, prefira <strong>Editar</strong> ou{" "}
              <strong>Cancelar</strong> a venda — assim o histórico fica
              preservado.
            </>
          }
          onCancel={() => setConfirmDeleteSale(null)}
          onConfirm={() => deleteSale(confirmDeleteSale)}
        />
      )}

      {/* Bulk FIFO payment modal */}
      {bulkOpen &&
        (() => {
          let remaining = +bulkAmount.toFixed(2);
          let coveredCount = 0;
          let lastPartial = 0;
          for (const s of allOpenSales) {
            if (remaining <= 0) break;
            const rest = +(Number(s.total) - Number(s.paid_amount)).toFixed(2);
            if (rest <= 0) continue;
            const apply = Math.min(rest, remaining);
            coveredCount++;
            if (apply < rest) lastPartial = apply;
            remaining = +(remaining - apply).toFixed(2);
          }
          return (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
                <h2 className="text-2xl font-bold text-coco-900 mb-1">
                  Distribuir pagamento
                </h2>
                <p className="text-coco-600 text-sm mb-4">
                  Digite o valor recebido. O sistema distribui automaticamente
                  da venda mais antiga para a mais nova (FIFO).
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="label">Valor recebido</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0.01}
                      className="input text-2xl font-bold"
                      value={bulkAmount}
                      onChange={(e) =>
                        setBulkAmount(parseFloat(e.target.value || "0"))
                      }
                      autoFocus
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Forma de pagamento</label>
                      <select
                        className="input"
                        value={bulkMethod}
                        onChange={(e) => setBulkMethod(e.target.value)}
                      >
                        {methodList.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Data</label>
                      <input
                        type="datetime-local"
                        className="input"
                        value={bulkDate}
                        onChange={(e) => setBulkDate(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="label">Observação (opcional)</label>
                    <input
                      className="input"
                      value={bulkNotes}
                      onChange={(e) => setBulkNotes(e.target.value)}
                      placeholder="Ex.: PIX recebido, comprovante #123…"
                    />
                  </div>

                  {bulkAmount > 0 && (
                    <div className="bg-coco-50 border border-coco-100 rounded-xl p-3 text-sm space-y-1">
                      <div>
                        <strong>Vai cobrir {coveredCount} venda(s)</strong>
                        {" "}da mais antiga para a mais nova
                      </div>
                      {lastPartial > 0 && (
                        <div className="text-amber-700">
                          · Última venda recebe pagamento parcial de {brl(lastPartial)}
                        </div>
                      )}
                      {remaining > 0.01 && (
                        <div className="text-red-600">
                          · Sobram {brl(remaining)} — valor excede o saldo em aberto
                        </div>
                      )}
                      {coveredCount === 0 && (
                        <div className="text-red-600">
                          · Nenhuma venda em aberto para cobrir
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {bulkError && (
                  <p className="text-red-700 text-sm mt-3">{bulkError}</p>
                )}
                <div className="flex justify-end gap-2 mt-5">
                  <button
                    onClick={() => setBulkOpen(false)}
                    className="btn-ghost"
                    disabled={bulkSaving}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmBulk}
                    disabled={bulkSaving || coveredCount === 0}
                    className="btn-primary"
                  >
                    {bulkSaving ? "Distribuindo…" : "Confirmar"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
