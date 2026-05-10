"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate, fmtDateOnly } from "@/lib/format";
import type {
  Customer,
  PaymentMethod,
  Sale,
  SalePayment,
} from "@/lib/types";
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

function monthsAgoIso(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

type StatusTab = "todas" | "abertas" | "vencidas" | "pagas";

const QUICK_FILTERS = [
  { label: "Mês atual", from: () => firstOfMonthIso(), to: () => todayIso() },
  { label: "3 meses", from: () => monthsAgoIso(3), to: () => todayIso() },
  { label: "6 meses", from: () => monthsAgoIso(6), to: () => todayIso() },
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
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<SalePayment | null>(null);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [editingPayment, setEditingPayment] = useState<SalePayment | null>(null);
  const [confirmDeleteSale, setConfirmDeleteSale] = useState<Sale | null>(null);

  const [dateFrom, setDateFrom] = useState(firstOfMonthIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [activeQuick, setActiveQuick] = useState<string>("Mês atual");
  const [statusTab, setStatusTab] = useState<StatusTab>("todas");

  async function load() {
    setLoading(true);
    const [c, s, m, ac] = await Promise.all([
      supabase.from("customers").select("*").eq("id", id).single(),
      supabase
        .from("sales")
        .select("*")
        .eq("customer_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("payment_methods").select("*"),
      supabase.from("customers").select("*").order("name"),
    ]);
    setCustomer((c.data as Customer) ?? null);
    setSales((s.data as Sale[]) ?? []);
    setAllCustomers((ac.data as Customer[]) ?? []);

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
          <Link href={`/receber?cliente=${customer.id}`} className="btn-primary">
            📒 Receber
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
    </div>
  );
}
