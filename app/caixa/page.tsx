"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import type { CashMovement, CashSession, PaymentMethod } from "@/lib/types";
import { useToast } from "@/components/Toast";
import ConfirmModal from "@/components/ConfirmModal";

export default function CaixaPage() {
  const supabase = createClient();
  const toast = useToast();
  const [session, setSession] = useState<CashSession | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [recentSessions, setRecentSessions] = useState<CashSession[]>([]);
  const [loading, setLoading] = useState(true);

  const [openingAmt, setOpeningAmt] = useState<number>(0);
  const [closingAmt, setClosingAmt] = useState<number>(0);
  const [openConfirm, setOpenConfirm] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [acceptDiff, setAcceptDiff] = useState(false);
  const [moveKind, setMoveKind] = useState<"suprimento" | "sangria">("sangria");
  const [moveAmt, setMoveAmt] = useState<number>(0);
  const [moveNotes, setMoveNotes] = useState("");

  const [salesCash, setSalesCash] = useState<number>(0);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);

  async function load() {
    setLoading(true);
    const [sRes, recent, m] = await Promise.all([
      supabase
        .from("cash_sessions")
        .select("*")
        .is("closed_at", null)
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("cash_sessions")
        .select("*")
        .order("opened_at", { ascending: false })
        .limit(10),
      supabase.from("payment_methods").select("*"),
    ]);
    setMethods((m.data as PaymentMethod[]) ?? []);
    setRecentSessions((recent.data as CashSession[]) ?? []);

    const open = (sRes.data as CashSession) ?? null;
    setSession(open);
    if (open) {
      const [mvts, dinheiroRecebido] = await Promise.all([
        supabase
          .from("cash_movements")
          .select("*")
          .eq("session_id", open.id)
          .order("created_at", { ascending: false }),
        countCashSales(open.opened_at, m.data as PaymentMethod[]),
      ]);
      setMovements((mvts.data as CashMovement[]) ?? []);
      setSalesCash(dinheiroRecebido);
    } else {
      setMovements([]);
      setSalesCash(0);
    }
    setLoading(false);
  }

  async function countCashSales(since: string, allMethods: PaymentMethod[]) {
    const dinheiro = allMethods?.find((m) =>
      m.name.toLowerCase().includes("dinheiro")
    );
    if (!dinheiro) return 0;
    const { data } = await supabase
      .from("sale_payments")
      .select("amount")
      .eq("payment_method_id", dinheiro.id)
      .gte("paid_at", since);
    return (
      (data as { amount: number | string }[] | null)?.reduce(
        (acc, r) => acc + Number(r.amount),
        0
      ) ?? 0
    );
  }

  useEffect(() => {
    load();
  }, []);

  const expected = useMemo(() => {
    if (!session) return 0;
    const supr = movements
      .filter((m) => m.kind === "suprimento")
      .reduce((s, m) => s + Number(m.amount), 0);
    const sang = movements
      .filter((m) => m.kind === "sangria")
      .reduce((s, m) => s + Number(m.amount), 0);
    return Number(session.opening_amt) + supr - sang + salesCash;
  }, [session, movements, salesCash]);

  async function openSession() {
    setOpenConfirm(false);
    const { data, error } = await supabase
      .from("cash_sessions")
      .insert({ opening_amt: openingAmt })
      .select("*")
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Caixa aberto!");
    setSession(data as CashSession);
    setOpeningAmt(0);
    load();
  }

  async function addMovement() {
    if (!session) return;
    if (moveAmt <= 0) return toast.error("Valor inválido.");
    const { error } = await supabase.from("cash_movements").insert({
      session_id: session.id,
      kind: moveKind,
      amount: moveAmt,
      notes: moveNotes || null,
    });
    if (error) return toast.error(error.message);
    toast.success(
      `${moveKind === "sangria" ? "Sangria" : "Suprimento"} registrado.`
    );
    setMoveAmt(0);
    setMoveNotes("");
    load();
  }

  async function closeSession() {
    if (!session) return;
    setCloseConfirm(false);
    const { error } = await supabase
      .from("cash_sessions")
      .update({
        closed_at: new Date().toISOString(),
        closing_amt: closingAmt,
      })
      .eq("id", session.id);
    if (error) return toast.error(error.message);
    toast.success("Caixa fechado.");
    setClosingAmt(0);
    setAcceptDiff(false);
    load();
  }

  const diff = +(closingAmt - expected).toFixed(2);
  const hasDiff = diff !== 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-coco-900">Caixa</h1>
        <p className="text-coco-600">
          Abertura, sangria, suprimento e fechamento — controle físico do
          dinheiro.
        </p>
      </header>

      {loading ? (
        <p className="text-coco-700">Carregando…</p>
      ) : !session ? (
        <div className="card max-w-md">
          <h2 className="font-bold text-coco-900 mb-3">Abrir caixa</h2>
          <label className="label">Troco / saldo inicial (R$)</label>
          <input
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            value={openingAmt || ""}
            onChange={(e) =>
              setOpeningAmt(
                parseFloat(e.target.value.replace(",", ".") || "0")
              )
            }
            onFocus={(e) => e.target.select()}
            placeholder="0,00"
            className="input text-2xl font-bold"
          />
          <button
            onClick={() => setOpenConfirm(true)}
            className="btn-primary btn-touch mt-3 w-full"
          >
            Abrir caixa
          </button>
          {openConfirm && (
            <ConfirmModal
              title="Abrir caixa?"
              message={`Saldo inicial: ${brl(openingAmt)}.`}
              onCancel={() => setOpenConfirm(false)}
              onConfirm={openSession}
            />
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="card">
              <div className="text-xs uppercase text-coco-700">Aberto em</div>
              <div className="font-semibold">{fmtDate(session.opened_at)}</div>
            </div>
            <div className="card">
              <div className="text-xs uppercase text-coco-700">Inicial</div>
              <div className="text-2xl font-bold">
                {brl(Number(session.opening_amt))}
              </div>
            </div>
            <div className="card">
              <div className="text-xs uppercase text-coco-700">
                Vendas em dinheiro
              </div>
              <div className="text-2xl font-bold text-green-700">
                {brl(salesCash)}
              </div>
            </div>
            <div className="card bg-coco-600 text-white border-coco-600">
              <div className="text-xs uppercase text-coco-100">
                Saldo esperado
              </div>
              <div className="text-2xl font-bold">{brl(expected)}</div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="font-bold text-coco-900 mb-3">
                Suprimento / Sangria
              </h3>
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setMoveKind("sangria")}
                  className={
                    moveKind === "sangria" ? "btn-primary" : "btn-ghost"
                  }
                >
                  Sangria (saída)
                </button>
                <button
                  onClick={() => setMoveKind("suprimento")}
                  className={
                    moveKind === "suprimento" ? "btn-primary" : "btn-ghost"
                  }
                >
                  Suprimento (entrada)
                </button>
              </div>
              <div className="space-y-2">
                <input
                  type="text"
                  inputMode="decimal"
                  enterKeyHint="next"
                  value={moveAmt || ""}
                  onChange={(e) =>
                    setMoveAmt(
                      parseFloat(e.target.value.replace(",", ".") || "0")
                    )
                  }
                  onFocus={(e) => e.target.select()}
                  className="input text-lg"
                  placeholder="Valor R$"
                />
                <input
                  value={moveNotes}
                  onChange={(e) => setMoveNotes(e.target.value)}
                  className="input"
                  placeholder="Observação (ex.: troco, recolhido pelo dono)"
                  enterKeyHint="done"
                />
                <button
                  onClick={addMovement}
                  className="btn-secondary btn-touch w-full"
                >
                  Registrar
                </button>
              </div>

              <div className="mt-4">
                <h4 className="text-sm font-semibold mb-2">Movimentos</h4>
                {movements.length === 0 ? (
                  <p className="text-coco-600 text-sm">
                    Nenhum movimento ainda.
                  </p>
                ) : (
                  <ul className="text-sm divide-y divide-coco-100">
                    {movements.map((m) => (
                      <li
                        key={m.id}
                        className="py-1 flex justify-between items-center"
                      >
                        <span>
                          <strong>
                            {m.kind === "sangria" ? "−" : "+"}{" "}
                            {brl(Number(m.amount))}
                          </strong>{" "}
                          <span className="text-coco-600">{m.notes}</span>
                        </span>
                        <span className="text-xs text-coco-500">
                          {fmtDate(m.created_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="card">
              <h3 className="font-bold text-coco-900 mb-3">Fechar caixa</h3>
              <p className="text-sm text-coco-700 mb-3">
                Conte o dinheiro físico e informe o valor abaixo. O sistema
                mostra a diferença em relação ao saldo esperado.
              </p>
              <label className="label">Dinheiro contado (R$)</label>
              <input
                type="text"
                inputMode="decimal"
                enterKeyHint="done"
                value={closingAmt || ""}
                onChange={(e) =>
                  setClosingAmt(
                    parseFloat(e.target.value.replace(",", ".") || "0")
                  )
                }
                onFocus={(e) => e.target.select()}
                placeholder="0,00"
                className="input text-2xl font-bold"
              />
              <div className="text-sm mt-3">
                <div className="flex justify-between">
                  <span>Esperado</span>
                  <span className="font-semibold">{brl(expected)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Contado</span>
                  <span className="font-semibold">{brl(closingAmt)}</span>
                </div>
                <div className="flex justify-between border-t border-coco-200 pt-1 mt-1">
                  <span>Diferença</span>
                  <span
                    className={`font-bold ${
                      !hasDiff
                        ? "text-green-700"
                        : diff < 0
                        ? "text-red-700"
                        : "text-amber-700"
                    }`}
                  >
                    {hasDiff && diff > 0 && "+"}{brl(diff)}
                  </span>
                </div>
              </div>
              {hasDiff && (
                <label className="mt-3 flex items-start gap-2 text-sm rounded-xl border border-amber-300 bg-amber-50 p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptDiff}
                    onChange={(e) => setAcceptDiff(e.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    <strong>
                      {diff < 0 ? "Falta" : "Sobra"} de {brl(Math.abs(diff))}.
                    </strong>{" "}
                    Confirmo que conferi e quero fechar mesmo com diferença.
                  </span>
                </label>
              )}
              <button
                onClick={() => setCloseConfirm(true)}
                disabled={closingAmt <= 0 || (hasDiff && !acceptDiff)}
                className="btn-danger btn-touch w-full mt-3"
              >
                Fechar caixa
              </button>
              {closeConfirm && (
                <ConfirmModal
                  title="Fechar caixa?"
                  message={
                    hasDiff
                      ? `Diferença de ${brl(diff)}. Continuar?`
                      : `Dinheiro contado: ${brl(closingAmt)}. Confere?`
                  }
                  onCancel={() => setCloseConfirm(false)}
                  onConfirm={closeSession}
                />
              )}
            </div>
          </div>
        </>
      )}

      <div className="card">
        <h2 className="font-bold text-coco-900 mb-3">Últimas sessões</h2>
        {recentSessions.length === 0 ? (
          <p className="text-coco-600 text-sm">Sem histórico.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Aberto em</th>
                <th>Fechado em</th>
                <th>Inicial</th>
                <th>Final</th>
              </tr>
            </thead>
            <tbody>
              {recentSessions.map((s) => (
                <tr key={s.id}>
                  <td>{fmtDate(s.opened_at)}</td>
                  <td>{s.closed_at ? fmtDate(s.closed_at) : "— em aberto"}</td>
                  <td>{brl(Number(s.opening_amt))}</td>
                  <td>
                    {s.closing_amt != null
                      ? brl(Number(s.closing_amt))
                      : "—"}
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
