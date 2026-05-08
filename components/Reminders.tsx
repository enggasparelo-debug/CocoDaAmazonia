"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Reminder = { kind: "info" | "warn" | "danger"; msg: string; href?: string };

export default function Reminders() {
  const supabase = createClient();
  const [items, setItems] = useState<Reminder[]>([]);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const list: Reminder[] = [];

      // caixa aberto há > 12h
      const { data: cash } = await supabase
        .from("cash_sessions")
        .select("opened_at")
        .is("closed_at", null)
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cash?.opened_at) {
        const hours =
          (Date.now() - new Date(cash.opened_at).getTime()) / 3_600_000;
        if (hours > 12) {
          list.push({
            kind: "warn",
            msg: `💵 Caixa aberto há ${Math.floor(hours)}h.`,
            href: "/caixa",
          });
        }
      }

      // estoque abaixo do mínimo
      const [{ data: bal }, { data: prod }] = await Promise.all([
        supabase.from("inventory_balance").select("*").maybeSingle(),
        supabase.from("product_settings").select("min_stock,name").maybeSingle(),
      ]);
      const balRow = bal as { on_hand?: number } | null;
      const prodRow = prod as { min_stock?: number; name?: string } | null;
      const onHand = balRow?.on_hand ?? 0;
      const minStock = Number(prodRow?.min_stock ?? 0);
      if (minStock > 0 && onHand <= minStock) {
        list.push({
          kind: "danger",
          msg: `📦 Estoque baixo: ${onHand} ${
            prodRow?.name ?? "unidades"
          } (mínimo ${minStock}).`,
          href: "/estoque",
        });
      }

      // contas a pagar vencidas ou vencendo hoje
      const todayStr = new Date().toISOString().slice(0, 10);
      const { data: overduePay, count: overduePayCount } = await supabase
        .from("payables")
        .select("id, amount", { count: "exact" })
        .in("status", ["pendente", "vencido"])
        .lte("due_date", todayStr);
      if (overduePayCount && overduePayCount > 0) {
        const total = (overduePay ?? []).reduce(
          (s: number, p: { amount: number }) => s + Number(p.amount),
          0
        );
        list.push({
          kind: "danger",
          msg: `🧾 ${overduePayCount} conta(s) a pagar vencida(s) — R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.`,
          href: "/pagar",
        });
      }

      // fiado vencido > 60d
      const { data: aging } = await supabase
        .from("customer_balances")
        .select("oldest_open_at, open_balance")
        .gt("open_balance", 0);
      type AgingRow = { oldest_open_at: string | null; open_balance: number };
      const overdue = (aging as AgingRow[] | null)?.filter((r) => {
        if (!r.oldest_open_at) return false;
        const days =
          (Date.now() - new Date(r.oldest_open_at).getTime()) / 86_400_000;
        return days > 60;
      });
      if (overdue && overdue.length > 0) {
        list.push({
          kind: "warn",
          msg: `📒 ${overdue.length} cliente(s) com fiado > 60 dias.`,
          href: "/receber",
        });
      }

      if (alive) setItems(list);
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  if (hidden || items.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {items.map((r, i) => (
        <div
          key={i}
          className={`rounded-xl px-3 py-2 text-sm border flex items-center justify-between ${
            r.kind === "danger"
              ? "bg-red-50 border-red-200 text-red-800"
              : r.kind === "warn"
              ? "bg-amber-50 border-amber-200 text-amber-800"
              : "bg-coco-50 border-coco-200 text-coco-800"
          }`}
        >
          <span>{r.msg}</span>
          {r.href && (
            <Link href={r.href} className="underline text-xs">
              ver
            </Link>
          )}
        </div>
      ))}
      <button
        onClick={() => setHidden(true)}
        className="text-xs text-coco-600 underline"
      >
        ocultar lembretes
      </button>
    </div>
  );
}
