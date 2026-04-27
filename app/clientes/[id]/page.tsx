"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import type {
  Customer,
  PaymentMethod,
  Sale,
  SalePayment,
} from "@/lib/types";
import StatusBadge from "@/components/StatusBadge";

export default function ClienteDetalhePage() {
  const supabase = createClient();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [payments, setPayments] = useState<SalePayment[]>([]);
  const [methods, setMethods] = useState<Record<string, PaymentMethod>>({});
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [c, s, m] = await Promise.all([
      supabase.from("customers").select("*").eq("id", id).single(),
      supabase
        .from("sales")
        .select("*")
        .eq("customer_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("payment_methods").select("*"),
    ]);
    setCustomer((c.data as Customer) ?? null);
    setSales((s.data as Sale[]) ?? []);

    const map: Record<string, PaymentMethod> = {};
    (m.data as PaymentMethod[] | null)?.forEach((x) => (map[x.id] = x));
    setMethods(map);

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

  if (loading) return <div className="text-coco-700">Carregando…</div>;
  if (!customer) return <div className="text-coco-700">Cliente não encontrado.</div>;

  const totalBought = sales
    .filter((s) => s.status !== "cancelada")
    .reduce((acc, s) => acc + Number(s.total), 0);
  const totalPaid = sales
    .filter((s) => s.status !== "cancelada")
    .reduce((acc, s) => acc + Number(s.paid_amount), 0);
  const open = totalBought - totalPaid;

  function whatsappLink() {
    if (!customer?.phone) return null;
    const phone = customer.phone.replace(/\D/g, "");
    if (!phone) return null;
    const msg = encodeURIComponent(
      `Olá ${customer.name}! Saldo da sua conta na Coco da Amazônia: ${brl(
        open
      )}.`
    );
    return `https://wa.me/55${phone}?text=${msg}`;
  }

  const wa = whatsappLink();

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
              rel="noreferrer"
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card">
          <div className="text-xs uppercase text-coco-700">Total comprado</div>
          <div className="text-2xl font-bold">{brl(totalBought)}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-coco-700">Total pago</div>
          <div className="text-2xl font-bold text-green-700">{brl(totalPaid)}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-coco-700">Em aberto</div>
          <div className="text-2xl font-bold text-amber-700">{brl(open)}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase text-coco-700">Vendas</div>
          <div className="text-2xl font-bold">{sales.length}</div>
        </div>
      </div>

      <div className="card">
        <h2 className="font-bold text-coco-900 mb-3">Histórico de vendas</h2>
        {sales.length === 0 ? (
          <p className="text-coco-600">Sem vendas ainda.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Qtd</th>
                <th>Total</th>
                <th>Pago</th>
                <th>Status</th>
                <th>Pagamentos</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => {
                const sp = payments.filter((p) => p.sale_id === s.id);
                return (
                  <tr
                    key={s.id}
                    className={s.status === "cancelada" ? "opacity-60" : ""}
                  >
                    <td>{fmtDate(s.created_at)}</td>
                    <td>{s.quantity}</td>
                    <td className="font-semibold">{brl(Number(s.total))}</td>
                    <td>{brl(Number(s.paid_amount))}</td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="text-xs">
                      {sp.length === 0
                        ? "—"
                        : sp
                            .map(
                              (p) =>
                                `${
                                  methods[p.payment_method_id]?.name ?? "?"
                                } ${brl(Number(p.amount))}`
                            )
                            .join(", ")}
                    </td>
                    <td className="text-right">
                      <Link
                        href={`/recibo/${s.id}`}
                        target="_blank"
                        className="btn-ghost text-xs"
                      >
                        🧾
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
