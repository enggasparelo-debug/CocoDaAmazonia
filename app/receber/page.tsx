"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import type {
  Customer,
  CustomerBalance,
  PaymentMethod,
  Sale,
} from "@/lib/types";

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
  const initialCustomer = params.get("cliente") ?? "";

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [balances, setBalances] = useState<CustomerBalance[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [selected, setSelected] = useState<string>(initialCustomer);
  const [openSales, setOpenSales] = useState<Sale[]>([]);
  const [payingSale, setPayingSale] = useState<Sale | null>(null);
  const [payMethod, setPayMethod] = useState<string>("");
  const [payAmount, setPayAmount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    const [c, b, m] = await Promise.all([
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
    ]);
    setCustomers((c.data as Customer[]) ?? []);
    setBalances((b.data as CustomerBalance[]) ?? []);
    setMethods((m.data as PaymentMethod[]) ?? []);
    if (m.data && m.data.length > 0) setPayMethod(m.data[0].id);
  }

  async function loadSales(custId: string) {
    if (!custId) {
      setOpenSales([]);
      return;
    }
    const { data } = await supabase
      .from("sales")
      .select("*")
      .eq("customer_id", custId)
      .neq("status", "paga")
      .order("created_at", { ascending: true });
    setOpenSales((data as Sale[]) ?? []);
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    loadSales(selected);
  }, [selected]);

  const totalOpen = useMemo(
    () => balances.reduce((s, b) => s + Number(b.open_balance), 0),
    [balances]
  );

  function startPay(s: Sale) {
    setPayingSale(s);
    setPayAmount(+(Number(s.total) - Number(s.paid_amount)).toFixed(2));
  }

  async function confirmPay() {
    if (!payingSale) return;
    setError(null);
    if (!payMethod) return setError("Escolha uma forma de pagamento.");
    if (payAmount <= 0) return setError("Valor inválido.");
    const { error } = await supabase.from("sale_payments").insert({
      sale_id: payingSale.id,
      payment_method_id: payMethod,
      amount: payAmount,
    });
    if (error) {
      setError(error.message);
      return;
    }
    setPayingSale(null);
    await loadAll();
    await loadSales(selected);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-coco-900">Contas a Receber</h1>
        <p className="text-coco-600">
          Saldo em aberto por cliente. Total geral:{" "}
          <strong>{brl(totalOpen)}</strong>
        </p>
      </header>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-1">
          <h2 className="font-bold text-coco-900 mb-3">Clientes em aberto</h2>
          {balances.length === 0 ? (
            <p className="text-coco-600 text-sm">
              Nenhum saldo em aberto. 🎉
            </p>
          ) : (
            <ul className="space-y-1">
              {balances.map((b) => (
                <li key={b.customer_id}>
                  <button
                    onClick={() => setSelected(b.customer_id)}
                    className={`w-full text-left px-3 py-2 rounded-xl flex items-center justify-between ${
                      selected === b.customer_id
                        ? "bg-coco-600 text-white"
                        : "hover:bg-coco-50"
                    }`}
                  >
                    <span>{b.customer_name}</span>
                    <span className="font-semibold">
                      {brl(Number(b.open_balance))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card lg:col-span-2">
          <div className="mb-3">
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

          {!selected ? (
            <p className="text-coco-600 text-sm">
              Escolha um cliente para ver as vendas em aberto e lançar
              recebimentos.
            </p>
          ) : openSales.length === 0 ? (
            <p className="text-coco-600 text-sm">
              Este cliente não possui vendas em aberto.
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Qtd</th>
                  <th>Total</th>
                  <th>Pago</th>
                  <th>Restante</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {openSales.map((s) => {
                  const rest = Number(s.total) - Number(s.paid_amount);
                  return (
                    <tr key={s.id}>
                      <td>{fmtDate(s.created_at)}</td>
                      <td>{s.quantity}</td>
                      <td>{brl(Number(s.total))}</td>
                      <td>{brl(Number(s.paid_amount))}</td>
                      <td className="font-semibold text-amber-700">
                        {brl(rest)}
                      </td>
                      <td className="text-right">
                        <button
                          onClick={() => startPay(s)}
                          className="btn-primary text-sm py-1.5"
                        >
                          Receber
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
            </div>
            {error && (
              <p className="text-red-700 text-sm mt-3">{error}</p>
            )}
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
    </div>
  );
}
