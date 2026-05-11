"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDateOnly } from "@/lib/format";
import { nowLocalIso } from "@/lib/datetime";
import { downloadCsv, downloadXlsx, rowsToCsv } from "@/lib/export";
import { cobrancaMessage, waLink } from "@/lib/whatsapp";
import { useTenant } from "@/lib/useTenant";
import type {
  Customer,
  CustomerBalance,
  PaymentMethod,
  Sale,
} from "@/lib/types";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

type StatusTab = "abertas" | "vencidas" | "pagas" | "todas";

export default function ReceberPage() {
  return (
    <Suspense fallback={<div className="text-coco-700">Carregando…</div>}>
      <ReceberInner />
    </Suspense>
  );
}

function ReceberInner() {
  const supabase = createClient();
  const params = useSearchParams();
  const { tenant } = useTenant();
  const initialCustomer = params.get("cliente") ?? "";

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [balances, setBalances] = useState<CustomerBalance[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [selected, setSelected] = useState<string>(initialCustomer);
  const [sales, setSales] = useState<Sale[]>([]);
  // Estatísticas lifetime do cliente selecionado (todas as vendas não
  // canceladas — usado pra summary "screenshotável" no rodapé).
  const [customerLifetime, setCustomerLifetime] = useState<{
    cocos: number;
    total: number;
    sales: number;
  } | null>(null);
  const [allOpenSales, setAllOpenSales] = useState<
    { id: string; created_at: string; total: number; paid_amount: number }[]
  >([]);
  const [payingSale, setPayingSale] = useState<Sale | null>(null);
  const [payMethod, setPayMethod] = useState<string>("");
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payDate, setPayDate] = useState<string>("");
  const [payNotes, setPayNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState<string>(firstOfMonthIso());
  const [dateTo, setDateTo] = useState<string>(todayIso());
  const [statusTab, setStatusTab] = useState<StatusTab>("abertas");

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkAmount, setBulkAmount] = useState<number>(0);
  const [bulkMethod, setBulkMethod] = useState<string>("");
  const [bulkDate, setBulkDate] = useState<string>("");
  const [bulkNotes, setBulkNotes] = useState<string>("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  async function loadAll() {
    const [c, b, m, ao] = await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase
        .from("customer_balances")
        .select("*")
        .gt("open_balance", 0)
        .order("open_balance", { ascending: false }),
      supabase
        .from("payment_methods")
        .select("*")
        .eq("active", true)
        .eq("is_credit", false)
        .order("name"),
      supabase
        .from("sales")
        .select("id,created_at,total,paid_amount")
        .neq("status", "paga")
        .is("canceled_at", null),
    ]);
    setCustomers((c.data as Customer[]) ?? []);
    setBalances((b.data as CustomerBalance[]) ?? []);
    setMethods((m.data as PaymentMethod[]) ?? []);
    setAllOpenSales(
      ((ao.data as Sale[]) ?? []).map((s) => ({
        id: s.id,
        created_at: s.created_at,
        total: Number(s.total),
        paid_amount: Number(s.paid_amount),
      }))
    );
    if (m.data && m.data.length > 0) setPayMethod(m.data[0].id);
  }

  const loadSales = useCallback(
    async (custId: string, tab: StatusTab, from: string, to: string) => {
      if (!custId) {
        setSales([]);
        setCustomerLifetime(null);
        return;
      }

      let query = supabase
        .from("sales")
        .select("*")
        .eq("customer_id", custId)
        .is("canceled_at", null)
        .order("created_at", { ascending: true });

      if (from) query = query.gte("created_at", `${from}T00:00:00`);
      if (to) query = query.lte("created_at", `${to}T23:59:59`);

      if (tab === "pagas") {
        query = query.eq("status", "paga");
      } else if (tab !== "todas") {
        query = query.neq("status", "paga");
      }

      const [{ data }, allQ] = await Promise.all([
        query,
        supabase
          .from("sales")
          .select("quantity,total")
          .eq("customer_id", custId)
          .is("canceled_at", null),
      ]);
      let rows = (data as Sale[]) ?? [];

      if (tab === "vencidas") {
        const cutoff = Date.now() - 30 * 86400000;
        rows = rows.filter(
          (s) => new Date(s.created_at).getTime() < cutoff
        );
      }

      setSales(rows);
      const allRows =
        (allQ.data as { quantity: number; total: number }[] | null) ?? [];
      setCustomerLifetime({
        cocos: allRows.reduce((s, r) => s + Number(r.quantity ?? 0), 0),
        total: allRows.reduce((s, r) => s + Number(r.total ?? 0), 0),
        sales: allRows.length,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    loadSales(selected, statusTab, dateFrom, dateTo);
  }, [selected, statusTab, dateFrom, dateTo, loadSales]);

  const totalOpen = useMemo(
    () => balances.reduce((s, b) => s + Number(b.open_balance), 0),
    [balances]
  );

  const aging = useMemo(() => {
    const buckets = { ate30: 0, d31_60: 0, d61_90: 0, mais90: 0 };
    const now = Date.now();
    for (const s of allOpenSales) {
      const remaining = +(s.total - s.paid_amount).toFixed(2);
      if (remaining <= 0) continue;
      const days = Math.floor(
        (now - new Date(s.created_at).getTime()) / 86400000
      );
      if (days <= 30) buckets.ate30 += remaining;
      else if (days <= 60) buckets.d31_60 += remaining;
      else if (days <= 90) buckets.d61_90 += remaining;
      else buckets.mais90 += remaining;
    }
    return buckets;
  }, [allOpenSales]);

  // Only open/partial sales for bulk payment
  const openSales = useMemo(
    () => sales.filter((s) => s.status !== "paga"),
    [sales]
  );

  function startPay(s: Sale) {
    setPayingSale(s);
    setPayAmount(+(Number(s.total) - Number(s.paid_amount)).toFixed(2));
    setPayDate(nowLocalIso());
    setPayNotes("");
    setError(null);
  }

  async function confirmPay() {
    if (!payingSale) return;
    setError(null);
    if (!payMethod) return setError("Escolha uma forma de pagamento.");
    if (payAmount <= 0) return setError("Valor inválido.");
    if (!payDate) return setError("Informe a data do pagamento.");

    const paidAtIso = new Date(payDate).toISOString();
    if (new Date(paidAtIso).getTime() > Date.now() + 60_000) {
      return setError("A data do pagamento não pode ser no futuro.");
    }

    const { error } = await supabase.from("sale_payments").insert({
      sale_id: payingSale.id,
      payment_method_id: payMethod,
      amount: payAmount,
      paid_at: paidAtIso,
      notes: payNotes || null,
    });
    if (error) {
      setError(error.message);
      return;
    }
    setPayingSale(null);
    await loadAll();
    await loadSales(selected, statusTab, dateFrom, dateTo);
  }

  function openBulk() {
    setBulkAmount(
      openSales.reduce(
        (s, x) => s + (Number(x.total) - Number(x.paid_amount)),
        0
      )
    );
    setBulkMethod(methods[0]?.id ?? "");
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
    for (const s of openSales) {
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
      return setBulkError("Sem vendas em aberto pra distribuir.");
    }

    setBulkSaving(true);
    const { error } = await supabase.from("sale_payments").insert(inserts);
    setBulkSaving(false);
    if (error) {
      setBulkError(error.message);
      return;
    }
    setBulkOpen(false);
    await loadAll();
    await loadSales(selected, statusTab, dateFrom, dateTo);
  }

  function buildAgingRows() {
    const now = Date.now();
    return balances
      .filter((b) => Number(b.open_balance ?? 0) > 0)
      .map((b) => {
        const days = b.oldest_open_at
          ? Math.floor((now - new Date(b.oldest_open_at).getTime()) / 86400000)
          : 0;
        return {
          cliente: b.customer_name,
          saldo: Number(b.open_balance).toFixed(2),
          vendas_em_aberto: b.open_sales ?? 0,
          dias_em_atraso: days,
          venda_mais_antiga: b.oldest_open_at
            ? fmtDateOnly(b.oldest_open_at)
            : "",
        };
      });
  }

  function handlePrint() {
    const cust = customers.find((c) => c.id === selected);
    const bal = balances.find((b) => b.customer_id === selected);
    if (!cust) return;

    const totalSales = sales.reduce((s, x) => s + Number(x.total), 0);
    const totalPaid = sales.reduce((s, x) => s + Number(x.paid_amount), 0);
    const totalPending = totalSales - totalPaid;

    const rows = sales
      .map(
        (s) => `
        <tr>
          <td>${fmtDateOnly(s.created_at)}</td>
          <td>${s.status === "paga" ? "Paga" : new Date(s.created_at).getTime() < Date.now() - 30 * 86400000 ? "Vencida" : "Aberta"}</td>
          <td style="text-align:right">${brl(Number(s.total))}</td>
          <td style="text-align:right">${brl(Number(s.paid_amount))}</td>
          <td style="text-align:right">${brl(Number(s.total) - Number(s.paid_amount))}</td>
        </tr>`
      )
      .join("");

    const periodo =
      dateFrom && dateTo
        ? `${fmtDateOnly(dateFrom + "T00:00:00")} a ${fmtDateOnly(dateTo + "T00:00:00")}`
        : "Todo o período";

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <title>Relatório – ${cust.name}</title>
  <style>
    @page { size: A4 landscape; margin: 20mm; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #111; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    .sub { color: #666; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f0f0f0; border: 1px solid #ccc; padding: 5px 8px; text-align: left; }
    td { border: 1px solid #ddd; padding: 5px 8px; }
    tfoot td { font-weight: bold; background: #fafafa; }
    .badge-paga { color: #166534; }
    .badge-vencida { color: #991b1b; }
    .badge-aberta { color: #92400e; }
  </style>
</head>
<body>
  <h1>Contas a Receber – ${cust.name}</h1>
  <p class="sub">Período: ${periodo} · Saldo total em aberto: ${brl(Number(bal?.open_balance ?? 0))}</p>
  <table>
    <thead>
      <tr>
        <th>Vencimento</th>
        <th>Status</th>
        <th style="text-align:right">Valor Total</th>
        <th style="text-align:right">Valor Pago</th>
        <th style="text-align:right">Saldo</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="2">Totais</td>
        <td style="text-align:right">${brl(totalSales)}</td>
        <td style="text-align:right">${brl(totalPaid)}</td>
        <td style="text-align:right">${brl(totalPending)}</td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }

  const tabConfig: { key: StatusTab; label: string; color: string }[] = [
    { key: "abertas", label: "Abertas", color: "bg-amber-100 text-amber-800 border-amber-300" },
    { key: "vencidas", label: "Vencidas", color: "bg-red-100 text-red-800 border-red-300" },
    { key: "pagas", label: "Pagas", color: "bg-green-100 text-green-800 border-green-300" },
    { key: "todas", label: "Todas", color: "bg-coco-100 text-coco-800 border-coco-300" },
  ];

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">Contas a Receber</h1>
          <p className="text-coco-600">
            Saldo em aberto por cliente. Total geral:{" "}
            <strong>{brl(totalOpen)}</strong>
          </p>
        </div>
        {balances.length > 0 && (
          <div className="flex gap-2">
            <button
              onClick={() =>
                downloadCsv("aging_fiado.csv", rowsToCsv(buildAgingRows()))
              }
              className="btn-secondary"
            >
              ⬇ CSV
            </button>
            <button
              onClick={() =>
                downloadXlsx("aging_fiado.xlsx", "Aging", buildAgingRows())
              }
              className="btn-secondary"
            >
              ⬇ Excel
            </button>
          </div>
        )}
      </header>

      {totalOpen > 0 && (
        <div className="card">
          <h2 className="font-bold text-coco-900 mb-3">Aging do fiado</h2>
          <p className="text-xs text-coco-600 mb-3">
            Saldo aberto agrupado pela idade da venda mais antiga em aberto de cada cliente.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <AgingBucket label="0–30 dias" value={aging.ate30} tone="green" />
            <AgingBucket label="31–60 dias" value={aging.d31_60} tone="amber" />
            <AgingBucket label="61–90 dias" value={aging.d61_90} tone="red" />
            <AgingBucket label="90+ dias" value={aging.mais90} tone="redDeep" />
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-1">
          <h2 className="font-bold text-coco-900 mb-3">Clientes em aberto</h2>
          {balances.length === 0 ? (
            <div className="text-sm space-y-2">
              <p className="text-coco-600">Nenhum saldo em aberto. 🎉</p>
              <a
                href="/relatorios"
                className="text-coco-700 underline hover:text-coco-900"
              >
                Ver vendas pagas →
              </a>
            </div>
          ) : (
            <ul className="space-y-1">
              {balances.map((b) => {
                const days = b.oldest_open_at
                  ? Math.floor(
                      (Date.now() - new Date(b.oldest_open_at).getTime()) /
                        86400000
                    )
                  : 0;
                const overdue = days > 30;
                return (
                  <li key={b.customer_id}>
                    <button
                      onClick={() => setSelected(b.customer_id)}
                      className={`w-full text-left px-3 py-2 rounded-xl flex items-center justify-between ${
                        selected === b.customer_id
                          ? "bg-coco-600 text-white"
                          : "hover:bg-coco-50"
                      }`}
                    >
                      <span>
                        {b.customer_name}
                        {overdue && (
                          <span
                            className={`ml-2 text-xs font-semibold ${
                              selected === b.customer_id
                                ? "text-amber-200"
                                : "text-amber-700"
                            }`}
                          >
                            ⚠ {days}d
                          </span>
                        )}
                      </span>
                      <span className="font-semibold">
                        {brl(Number(b.open_balance))}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="card lg:col-span-2">
          {/* Customer selector + actions */}
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="label">Cliente</label>
              <select
                className="input"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">— selecione —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            {selected &&
              (() => {
                const cust = customers.find((c) => c.id === selected);
                const bal = balances.find((b) => b.customer_id === selected);
                const wa = cust
                  ? waLink(
                      cust.phone,
                      cobrancaMessage({
                        customerName: cust.name,
                        storeName: tenant?.name ?? "Coco da Amazônia",
                        totalOpen: Number(bal?.open_balance ?? 0),
                        openSales: openSales.map((s) => ({
                          created_at: s.created_at,
                          total: Number(s.total),
                          paid: Number(s.paid_amount),
                        })),
                        oldestOpenAt: bal?.oldest_open_at ?? null,
                      })
                    )
                  : null;
                return (
                  <div className="flex gap-2 flex-wrap">
                    {openSales.length > 0 && (
                      <button
                        onClick={openBulk}
                        className="btn-secondary"
                        title="Distribui um pagamento entre as vendas mais antigas"
                      >
                        💰 Receber tudo
                      </button>
                    )}
                    {sales.length > 0 && (
                      <button
                        onClick={handlePrint}
                        className="btn-secondary"
                        title="Gerar relatório imprimível"
                      >
                        🖨 Imprimir
                      </button>
                    )}
                    {wa && (
                      <a
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secondary"
                      >
                        📲 WhatsApp
                      </a>
                    )}
                    {openSales.length > 0 && (
                      <a
                        href={`/cobranca/${selected}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secondary"
                        title="Abre uma página pronta pra imprimir / salvar como PDF"
                      >
                        📄 PDF de cobrança
                      </a>
                    )}
                    <a href={`/clientes/${selected}`} className="btn-ghost">
                      Histórico
                    </a>
                  </div>
                );
              })()}
          </div>

          {/* Date range filter */}
          {selected && (
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div>
                <label className="label">Data início</label>
                <input
                  type="date"
                  className="input"
                  value={dateFrom}
                  max={dateTo}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Data fim</label>
                <input
                  type="date"
                  className="input"
                  value={dateTo}
                  min={dateFrom}
                  max={todayIso()}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Status tabs */}
          {selected && (
            <div className="mb-3 flex gap-2 flex-wrap">
              {tabConfig.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setStatusTab(t.key)}
                  className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                    statusTab === t.key
                      ? t.color + " shadow-sm"
                      : "bg-white text-coco-600 border-coco-200 hover:bg-coco-50"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {!selected ? (
            <p className="text-coco-600 text-sm">
              Escolha um cliente para ver as vendas e lançar recebimentos.
            </p>
          ) : sales.length === 0 ? (
            <p className="text-coco-600 text-sm">
              Nenhuma venda encontrada com os filtros selecionados.
            </p>
          ) : (
            <>
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Status</th>
                  <th>Qtd</th>
                  <th>Total</th>
                  <th>Pago</th>
                  <th>Restante</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => {
                  const rest = Number(s.total) - Number(s.paid_amount);
                  const daysOld = Math.floor(
                    (Date.now() - new Date(s.created_at).getTime()) / 86400000
                  );
                  const isOverdue = s.status !== "paga" && daysOld > 30;
                  return (
                    <tr key={s.id}>
                      <td>{fmtDateOnly(s.created_at)}</td>
                      <td>
                        <SaleStatusBadge
                          status={s.status}
                          isOverdue={isOverdue}
                        />
                      </td>
                      <td>{s.quantity}</td>
                      <td>{brl(Number(s.total))}</td>
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
                      <td className="text-right">
                        {s.status !== "paga" && (
                          <button
                            onClick={() => startPay(s)}
                            className="btn-primary text-sm py-1.5"
                          >
                            Receber
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {sales.length > 1 && (
                <tfoot>
                  <tr className="bg-coco-50 font-semibold text-sm">
                    <td colSpan={3} className="py-2 px-3">
                      Total
                    </td>
                    <td className="py-2 px-3">
                      {brl(sales.reduce((s, x) => s + Number(x.total), 0))}
                    </td>
                    <td className="py-2 px-3">
                      {brl(sales.reduce((s, x) => s + Number(x.paid_amount), 0))}
                    </td>
                    <td className="py-2 px-3">
                      {brl(
                        sales.reduce(
                          (s, x) =>
                            s + (Number(x.total) - Number(x.paid_amount)),
                          0
                        )
                      )}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>

            {openSales.length > 0 && (() => {
              const cust = customers.find((c) => c.id === selected);
              const bal = balances.find((b) => b.customer_id === selected);
              const openQty = openSales.reduce(
                (s, x) => s + Number(x.quantity ?? 0),
                0
              );
              const openTotal = openSales.reduce(
                (s, x) =>
                  s +
                  (Number(x.total ?? 0) - Number(x.paid_amount ?? 0)),
                0
              );
              const oldestDays = bal?.oldest_open_at
                ? Math.floor(
                    (Date.now() -
                      new Date(bal.oldest_open_at).getTime()) /
                      86400000
                  )
                : 0;
              return (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
                    <h3 className="font-bold text-amber-900 text-lg">
                      Resumo da cobrança · {cust?.name ?? "—"}
                    </h3>
                    {bal?.oldest_open_at && (
                      <span className="text-xs text-amber-800">
                        Mais antiga em aberto:{" "}
                        {fmtDateOnly(bal.oldest_open_at)}{" "}
                        {oldestDays > 0 && (
                          <strong>(há {oldestDays} dia{oldestDays === 1 ? "" : "s"})</strong>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <SummaryStat
                      label="Cocos em aberto"
                      value={openQty.toLocaleString("pt-BR")}
                      emphasis
                    />
                    <SummaryStat
                      label="Valor em aberto"
                      value={brl(openTotal)}
                      emphasis
                    />
                    <SummaryStat
                      label="Vendas em aberto"
                      value={String(openSales.length)}
                    />
                    {customerLifetime && (
                      <SummaryStat
                        label="Total comprado"
                        value={`${customerLifetime.cocos.toLocaleString(
                          "pt-BR"
                        )} cocos`}
                        sub={brl(customerLifetime.total)}
                      />
                    )}
                  </div>
                </div>
              );
            })()}
            </>
          )}
        </div>
      </div>

      {payingSale && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-coco-900 mb-4">
              Receber pagamento
            </h2>
            <p className="text-coco-700 text-sm mb-3">
              Venda de {brl(Number(payingSale.total))} ·{" "}
              {brl(Number(payingSale.paid_amount))} já recebido.
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Forma de pagamento</label>
                  <select
                    className="input"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                  >
                    {methods.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Data do pagamento</label>
                  <input
                    type="datetime-local"
                    className="input"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="label">Valor recebido</label>
                <input
                  type="number"
                  step="0.01"
                  className="input text-2xl font-bold"
                  value={payAmount}
                  onChange={(e) =>
                    setPayAmount(parseFloat(e.target.value || "0"))
                  }
                />
              </div>
              <div>
                <label className="label">Observação (opcional)</label>
                <input
                  className="input"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="Ex.: pagamento em mãos, comprovante #123…"
                />
              </div>
            </div>
            {error && <p className="text-red-700 text-sm mt-3">{error}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setPayingSale(null)}
                className="btn-ghost"
              >
                Cancelar
              </button>
              <button onClick={confirmPay} className="btn-primary">
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkOpen &&
        (() => {
          let remaining = +bulkAmount.toFixed(2);
          let coveredCount = 0;
          let lastPartial = 0;
          for (const s of openSales) {
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
                <h2 className="text-2xl font-bold text-coco-900 mb-2">
                  Receber em lote
                </h2>
                <p className="text-coco-700 text-sm mb-4">
                  Distribui o valor entre as vendas em aberto, da mais antiga
                  pra mais nova. Sobra fica creditada na próxima venda em
                  aberto.
                </p>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Forma de pagamento</label>
                      <select
                        className="input"
                        value={bulkMethod}
                        onChange={(e) => setBulkMethod(e.target.value)}
                      >
                        {methods.map((m) => (
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
                    <label className="label">Valor recebido</label>
                    <input
                      type="number"
                      step="0.01"
                      className="input text-2xl font-bold"
                      value={bulkAmount}
                      onChange={(e) =>
                        setBulkAmount(parseFloat(e.target.value || "0"))
                      }
                    />
                  </div>
                  <div>
                    <label className="label">Observação (opcional)</label>
                    <input
                      className="input"
                      value={bulkNotes}
                      onChange={(e) => setBulkNotes(e.target.value)}
                      placeholder="Ex.: pagamento total da semana…"
                    />
                  </div>
                  <div className="bg-coco-50 border border-coco-100 rounded-xl p-3 text-sm">
                    <strong>Vai cobrir {coveredCount} venda(s)</strong>
                    {lastPartial > 0 && (
                      <span>
                        {" "}
                        · última recebe parcial de {brl(lastPartial)}
                      </span>
                    )}
                    {remaining > 0.01 && (
                      <span className="text-amber-700">
                        {" "}
                        · sobra {brl(remaining)} não distribuída
                      </span>
                    )}
                  </div>
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
                    {bulkSaving ? "…" : "Confirmar"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}

function SaleStatusBadge({
  status,
  isOverdue,
}: {
  status: string;
  isOverdue: boolean;
}) {
  if (status === "paga") {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
        Paga
      </span>
    );
  }
  if (isOverdue) {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
        Vencida
      </span>
    );
  }
  if (status === "parcial") {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
        Parcial
      </span>
    );
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800">
      Aberta
    </span>
  );
}

function SummaryStat({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white border border-amber-200 p-3">
      <div className="text-[11px] uppercase tracking-wider text-amber-800">
        {label}
      </div>
      <div
        className={`mt-1 ${
          emphasis ? "text-2xl font-bold" : "text-lg font-semibold"
        } text-amber-900`}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-amber-700">{sub}</div>}
    </div>
  );
}

function AgingBucket({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "amber" | "red" | "redDeep";
}) {
  const cls =
    tone === "green"
      ? "bg-green-50 border-green-200 text-green-900"
      : tone === "amber"
      ? "bg-amber-50 border-amber-200 text-amber-900"
      : tone === "red"
      ? "bg-red-50 border-red-200 text-red-900"
      : "bg-red-100 border-red-300 text-red-900";
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="text-xs uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-xl font-bold mt-1">{brl(value)}</div>
    </div>
  );
}
