"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import type {
  Carga,
  CargaSummary,
  Sale,
  Expense,
  CashMovement,
  Vehicle,
  Route,
} from "@/lib/types";
import CargaSummaryCards from "@/components/CargaSummaryCards";
import CargaSaleForm from "@/components/CargaSaleForm";
import { useTenant } from "@/lib/useTenant";
import { useToast } from "@/components/Toast";

export default function CargaPage() {
  const supabase = createClient();
  const toast = useToast();
  const { userId, isAdmin, loading: tLoading } = useTenant();
  const [loading, setLoading] = useState(true);
  const [carga, setCarga] = useState<Carga | null>(null);
  const [summary, setSummary] = useState<CargaSummary | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [movs, setMovs] = useState<CashMovement[]>([]);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [showSale, setShowSale] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [showCashMov, setShowCashMov] = useState<"suprimento" | "sangria" | null>(
    null
  );

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    let q = supabase
      .from("cargas")
      .select("*")
      .eq("status", "aberta")
      .order("opened_at", { ascending: false })
      .limit(1);
    if (!isAdmin) q = q.eq("operator_id", userId);
    const { data: c } = await q.maybeSingle();
    const cur = (c as Carga | null) ?? null;
    setCarga(cur);
    if (!cur) {
      setLoading(false);
      return;
    }
    const [s, e, m, v, r, sum] = await Promise.all([
      supabase
        .from("sales")
        .select("*")
        .eq("carga_id", cur.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("expenses")
        .select("*")
        .eq("carga_id", cur.id)
        .order("paid_at", { ascending: false }),
      supabase
        .from("cash_movements")
        .select("*")
        .eq("carga_id", cur.id)
        .order("created_at", { ascending: false }),
      cur.vehicle_id
        ? supabase.from("vehicles").select("*").eq("id", cur.vehicle_id).maybeSingle()
        : Promise.resolve({ data: null }),
      cur.route_id
        ? supabase.from("routes").select("*").eq("id", cur.route_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("carga_summary")
        .select("*")
        .eq("carga_id", cur.id)
        .maybeSingle(),
    ]);
    setSales((s.data as Sale[]) ?? []);
    setExpenses((e.data as Expense[]) ?? []);
    setMovs((m.data as CashMovement[]) ?? []);
    setVehicle((v.data as Vehicle | null) ?? null);
    setRoute((r.data as Route | null) ?? null);
    setSummary((sum.data as CargaSummary | null) ?? null);
    setLoading(false);
  }, [supabase, userId, isAdmin]);

  useEffect(() => {
    if (!tLoading) load();
  }, [tLoading, load]);

  if (tLoading || loading) {
    return <div className="p-6 text-coco-700">Carregando…</div>;
  }

  if (!carga) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold text-coco-900">Minha Carga</h1>
        <div className="card text-center py-10">
          <div className="text-5xl mb-3">🚚</div>
          <p className="text-coco-700 mb-4">Você não tem carga aberta.</p>
          <Link href="/carga/abrir" className="btn-primary inline-block">
            Abrir nova carga
          </Link>
        </div>
      </div>
    );
  }

  const elapsedH =
    (Date.now() - new Date(carga.opened_at).getTime()) / 3_600_000;

  return (
    <div className="space-y-4 pb-32">
      <div className="sticky top-14 md:top-0 z-10 bg-white -mx-4 md:-mx-10 px-4 md:px-10 py-3 border-b border-coco-200 flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-xs text-coco-600 uppercase">
            Carga aberta há {Math.floor(elapsedH)}h
            {Math.floor((elapsedH % 1) * 60)
              ? ` ${Math.floor((elapsedH % 1) * 60)}min`
              : ""}
          </div>
          <div className="font-bold text-coco-900">
            {vehicle?.plate ?? "—"} · {route?.name ?? "Sem rota"}
          </div>
        </div>
        <Link href="/carga/fechar" className="btn-secondary">
          Fechar carga →
        </Link>
      </div>

      {summary && <CargaSummaryCards summary={summary} />}

      <div className="grid md:grid-cols-3 gap-2">
        <button onClick={() => setShowSale(true)} className="btn-primary py-4">
          🥥 Nova venda
        </button>
        <button
          onClick={() => setShowExpense(true)}
          className="btn-secondary py-4"
        >
          💸 Despesa
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setShowCashMov("suprimento")}
            className="btn-ghost border border-coco-200 py-4"
          >
            ⬆️ Suprimento
          </button>
          <button
            onClick={() => setShowCashMov("sangria")}
            className="btn-ghost border border-coco-200 py-4"
          >
            ⬇️ Sangria
          </button>
        </div>
      </div>

      <Section
        title={`Vendas (${sales.length})`}
        empty="Nenhuma venda ainda. Use o formulário acima pra registrar a primeira venda dessa carga."
        rows={sales.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between border-b border-coco-100 py-2"
          >
            <div>
              <div className="font-medium">
                {s.quantity} cocos · {brl(Number(s.total))}
              </div>
              <div className="text-xs text-coco-600">
                {fmtDate(s.created_at)} ·{" "}
                {Number(s.total) - Number(s.paid_amount) > 0.001
                  ? "Fiado"
                  : "Paga"}
              </div>
            </div>
            {Number(s.total) - Number(s.paid_amount) > 0.001 && (
              <Link
                href={`/carga/promissoria/${s.id}`}
                className="btn-ghost text-sm"
              >
                Promissória
              </Link>
            )}
          </div>
        ))}
      />

      <Section
        title={`Despesas (${expenses.length})`}
        empty="Nenhuma despesa lançada."
        rows={expenses.map((e) => (
          <div
            key={e.id}
            className="flex items-center justify-between border-b border-coco-100 py-2"
          >
            <div>
              <div className="font-medium">{e.description}</div>
              <div className="text-xs text-coco-600">
                {e.category ?? "—"} · {e.paid_at ? fmtDate(e.paid_at) : "—"}
              </div>
            </div>
            <div className="font-semibold text-red-700">
              − {brl(Number(e.amount))}
            </div>
          </div>
        ))}
      />

      <Section
        title={`Caixa (${movs.length})`}
        empty="Sem suprimentos/sangrias."
        rows={movs.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between border-b border-coco-100 py-2"
          >
            <div>
              <div className="font-medium capitalize">{m.kind}</div>
              <div className="text-xs text-coco-600">
                {fmtDate(m.created_at)} · {m.notes ?? "—"}
              </div>
            </div>
            <div
              className={`font-semibold ${
                m.kind === "suprimento" ? "text-green-700" : "text-red-700"
              }`}
            >
              {m.kind === "suprimento" ? "+ " : "− "}
              {brl(Number(m.amount))}
            </div>
          </div>
        ))}
      />

      {showSale && (
        <Modal title="Nova venda" onClose={() => setShowSale(false)}>
          <CargaSaleForm
            cargaId={carga.id}
            onSaved={() => {
              setShowSale(false);
              load();
            }}
          />
        </Modal>
      )}

      {showExpense && (
        <ExpenseForm
          cargaId={carga.id}
          onClose={() => setShowExpense(false)}
          onSaved={() => {
            setShowExpense(false);
            load();
            toast.success("Despesa registrada.");
          }}
        />
      )}

      {showCashMov && (
        <CashMovementForm
          cargaId={carga.id}
          kind={showCashMov}
          onClose={() => setShowCashMov(null)}
          onSaved={() => {
            setShowCashMov(null);
            load();
            toast.success("Movimento registrado.");
          }}
        />
      )}
    </div>
  );
}

function Section({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: React.ReactNode[];
}) {
  return (
    <details className="card" open>
      <summary className="font-bold text-coco-900 cursor-pointer">
        {title}
      </summary>
      <div className="mt-2">
        {rows.length === 0 ? (
          <p className="text-coco-600 text-sm">{empty}</p>
        ) : (
          rows
        )}
      </div>
    </details>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4 overflow-y-auto">
      <div className="bg-white md:rounded-2xl shadow-xl max-w-lg w-full p-5 md:p-6 min-h-[60vh] md:min-h-0 max-h-screen overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-coco-900">{title}</h2>
          <button onClick={onClose} className="btn-ghost">
            Fechar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ExpenseForm({
  cargaId,
  onClose,
  onSaved,
}: {
  cargaId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Combustível");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    const value = parseFloat((amount || "0").replace(",", "."));
    if (!description.trim()) return setErr("Informe a descrição.");
    if (!(value > 0)) return setErr("Valor deve ser positivo.");
    setSaving(true);
    const { error } = await supabase.from("expenses").insert({
      description: description.trim(),
      category: category || null,
      amount: value,
      carga_id: cargaId,
    });
    setSaving(false);
    if (error) return setErr(error.message);
    onSaved();
  }

  return (
    <Modal title="Lançar despesa" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label">Categoria</label>
          <select
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option>Combustível</option>
            <option>Comida</option>
            <option>Pedágio</option>
            <option>Manutenção</option>
            <option>Outros</option>
          </select>
        </div>
        <div>
          <label className="label">Descrição</label>
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Valor (R$)</label>
          <input
            className="input text-2xl font-semibold"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))}
          />
        </div>
        {err && (
          <p className="text-red-700 text-sm bg-red-50 border border-red-200 p-2 rounded">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CashMovementForm({
  cargaId,
  kind,
  onClose,
  onSaved,
}: {
  cargaId: string;
  kind: "suprimento" | "sangria";
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    const value = parseFloat((amount || "0").replace(",", "."));
    if (!(value > 0)) return setErr("Valor deve ser positivo.");
    setSaving(true);
    const { error } = await supabase.from("cash_movements").insert({
      kind,
      amount: value,
      notes: notes.trim() || null,
      carga_id: cargaId,
      session_id: null,
    });
    setSaving(false);
    if (error) return setErr(error.message);
    onSaved();
  }

  return (
    <Modal
      title={kind === "suprimento" ? "Suprimento de caixa" : "Sangria de caixa"}
      onClose={onClose}
    >
      <div className="space-y-3">
        <div>
          <label className="label">Valor (R$)</label>
          <input
            className="input text-2xl font-semibold"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))}
            autoFocus
          />
        </div>
        <div>
          <label className="label">Observação</label>
          <input
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {err && (
          <p className="text-red-700 text-sm bg-red-50 border border-red-200 p-2 rounded">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
