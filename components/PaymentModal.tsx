"use client";

import { useMemo, useState } from "react";
import { errorMessage } from "@/lib/ui";
import { createClient } from "@/lib/supabase/client";
import { brl } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";

type Entry = {
  payment_method_id: string;
  amount: number;
};

function methodIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("dinheiro") || n.includes("cash")) return "💵";
  if (n.includes("pix")) return "📱";
  if (n.includes("débito") || n.includes("debito")) return "💳";
  if (n.includes("crédito") || n.includes("credito") || n.includes("cartão") || n.includes("cartao")) return "💳";
  if (n.includes("transfer")) return "🏦";
  if (n.includes("boleto")) return "🧾";
  return "💰";
}

export default function PaymentModal({
  saleId,
  total,
  methods,
  hasCustomer,
  onClose,
}: {
  saleId: string;
  total: number;
  methods: PaymentMethod[];
  hasCustomer: boolean;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [paidAt, setPaidAt] = useState<string>(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  // Calculadora de troco: dinheiro entregue pelo cliente
  const [cashGiven, setCashGiven] = useState<string>("");

  const cashMethods = useMemo(
    () => methods.filter((m) => !m.is_credit),
    [methods]
  );

  const paid = useMemo(
    () => entries.reduce((s, e) => s + (Number(e.amount) || 0), 0),
    [entries]
  );
  const remaining = Math.max(0, +(total - paid).toFixed(2));

  // Troco: aplica-se quando há método "dinheiro" lançado.
  const cashGivenNum = parseFloat(cashGiven.replace(",", ".")) || 0;
  const isCashEntry = (mid: string) => {
    const m = cashMethods.find((x) => x.id === mid);
    return !!m && /(dinheiro|cash)/i.test(m.name);
  };
  const hasCash = entries.some((e) => isCashEntry(e.payment_method_id));
  const change =
    hasCash && cashGivenNum > 0
      ? Math.max(0, +(cashGivenNum - total).toFixed(2))
      : 0;

  function quickPay(methodId: string) {
    setEntries((arr) => [
      ...arr,
      {
        payment_method_id: methodId,
        amount: remaining > 0 ? remaining : 0,
      },
    ]);
  }

  function updateEntry(i: number, patch: Partial<Entry>) {
    setEntries((arr) => arr.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function removeEntry(i: number) {
    setEntries((arr) => arr.filter((_, idx) => idx !== i));
  }

  async function confirm() {
    setError(null);
    if (remaining > 0 && !hasCustomer) {
      setError(
        "Para deixar saldo em aberto (fiado), volte e selecione um cliente."
      );
      return;
    }
    if (!paidAt) {
      setError("Informe a data do pagamento.");
      return;
    }
    const paidAtIso = new Date(paidAt).toISOString();
    if (new Date(paidAtIso).getTime() > Date.now() + 60_000) {
      setError("A data do pagamento não pode ser no futuro.");
      return;
    }
    setSaving(true);
    try {
      const valid = entries.filter(
        (e) => e.payment_method_id && Number(e.amount) > 0
      );
      if (valid.length > 0) {
        const { error } = await supabase.from("sale_payments").insert(
          valid.map((e) => ({
            sale_id: saleId,
            payment_method_id: e.payment_method_id,
            amount: Number(e.amount),
            paid_at: paidAtIso,
          }))
        );
        if (error) throw error;
      }
      setDone(true);
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const shareReceiptUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/recibo/${saleId}`
      : `/recibo/${saleId}`;
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(
    `Recibo de coco verde — ${brl(total)}\n${shareReceiptUrl}`
  )}`;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-card modal-card--xl modal-pad">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-coco-900">
            {done ? "Venda finalizada ✅" : "Recebimento"}
          </h2>
          <button
            onClick={onClose}
            className="btn-ghost"
            aria-label="Fechar"
          >
            Fechar
          </button>
        </div>

        {!done ? (
          <>
            <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
              <div className="card !p-3">
                <div className="text-xs text-coco-700">Total</div>
                <div className="text-lg sm:text-xl font-bold">{brl(total)}</div>
              </div>
              <div className="card !p-3">
                <div className="text-xs text-coco-700">Recebido</div>
                <div className="text-lg sm:text-xl font-bold text-green-700">
                  {brl(paid)}
                </div>
              </div>
              <div className="card !p-3">
                <div className="text-xs text-coco-700">
                  {remaining > 0 ? "Fiado" : "Restante"}
                </div>
                <div
                  className={`text-lg sm:text-xl font-bold ${
                    remaining > 0 ? "text-amber-700" : "text-green-700"
                  }`}
                >
                  {brl(remaining)}
                </div>
              </div>
            </div>

            <div className="mb-4">
              <div className="text-sm font-semibold text-coco-800 mb-2">
                Receber com…
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {cashMethods.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => quickPay(m.id)}
                    className="chip-pay"
                    aria-label={`Receber ${brl(remaining || total)} em ${m.name}`}
                  >
                    <span className="text-2xl leading-none">{methodIcon(m.name)}</span>
                    <span className="text-sm leading-tight text-center">{m.name}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-coco-600 mt-2">
                Toque para lançar o valor restante. Você pode combinar várias formas.
              </p>
              {hasCustomer && entries.length === 0 && (
                <button
                  type="button"
                  onClick={confirm}
                  disabled={saving}
                  className="mt-3 w-full rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 px-3 py-2 text-sm flex items-center justify-center gap-2 transition text-amber-900"
                  title="Não receber nada agora — deixa tudo pendente na conta do cliente"
                >
                  <span aria-hidden>📒</span>
                  <span>
                    <strong>Deixar pendente (fiado)</strong>
                    <span className="text-amber-800/80"> — {brl(total)}</span>
                  </span>
                </button>
              )}
            </div>

            {entries.length > 0 && (
              <div className="space-y-2 mb-4">
                {entries.map((e, i) => {
                  const method = cashMethods.find(
                    (m) => m.id === e.payment_method_id
                  );
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 border border-coco-100 rounded-xl p-2"
                    >
                      <span className="text-2xl" aria-hidden>
                        {methodIcon(method?.name ?? "")}
                      </span>
                      <select
                        value={e.payment_method_id}
                        onChange={(ev) =>
                          updateEntry(i, {
                            payment_method_id: ev.target.value,
                          })
                        }
                        className="input flex-1 min-w-0"
                      >
                        {cashMethods.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={e.amount || ""}
                        onChange={(ev) =>
                          updateEntry(i, {
                            amount: parseFloat(
                              ev.target.value.replace(",", ".") || "0"
                            ),
                          })
                        }
                        onFocus={(ev) => ev.target.select()}
                        className="input text-right font-semibold w-28"
                        aria-label="Valor"
                      />
                      <button
                        onClick={() => removeEntry(i)}
                        className="btn-ghost text-red-600 px-2"
                        aria-label="Remover pagamento"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {hasCash && (
              <div className="mb-4 rounded-xl border border-coco-200 bg-coco-50 p-3">
                <label className="label">Dinheiro recebido (para calcular troco)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  enterKeyHint="done"
                  value={cashGiven}
                  onChange={(e) =>
                    setCashGiven(e.target.value.replace(/[^0-9.,]/g, ""))
                  }
                  onFocus={(e) => e.target.select()}
                  placeholder="Ex.: 100,00"
                  className="input text-2xl font-semibold"
                />
                {cashGivenNum > 0 && (
                  <div
                    className={`mt-2 text-lg font-bold ${
                      change > 0 ? "text-green-700" : "text-coco-700"
                    }`}
                  >
                    {change > 0
                      ? `Troco: ${brl(change)}`
                      : cashGivenNum < total
                      ? `Faltam ${brl(total - cashGivenNum)}`
                      : "Valor exato — sem troco"}
                  </div>
                )}
              </div>
            )}

            <details className="mb-4">
              <summary className="text-sm text-coco-700 cursor-pointer">
                Ajustar data do pagamento
              </summary>
              <div className="mt-2">
                <input
                  type="datetime-local"
                  className="input max-w-xs"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                />
                <p className="text-xs text-coco-600 mt-1">
                  Padrão: agora. Ajuste se o pagamento foi em outro momento.
                </p>
              </div>
            </details>

            {remaining > 0 && (
              <div
                className={`text-sm rounded-xl p-3 mb-3 border ${
                  hasCustomer
                    ? "bg-amber-50 border-amber-200 text-amber-800"
                    : "bg-red-50 border-red-200 text-red-700"
                }`}
              >
                {hasCustomer ? (
                  <>
                    📒 Restará <strong>{brl(remaining)}</strong> em aberto
                    (fiado) na conta do cliente.
                  </>
                ) : (
                  <>
                    ⚠️ Para deixar saldo em aberto (fiado) é preciso{" "}
                    <strong>selecionar um cliente</strong> na tela anterior.
                  </>
                )}
              </div>
            )}

            {error && (
              <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
                {error}
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sticky bottom-0 bg-white pt-2">
              <button onClick={onClose} className="btn-ghost btn-touch">
                Cancelar
              </button>
              <button
                onClick={confirm}
                disabled={saving || (remaining > 0 && !hasCustomer)}
                className="btn-primary btn-touch"
              >
                {saving
                  ? "Salvando…"
                  : remaining > 0
                  ? `Confirmar — ${brl(remaining)} fiado`
                  : "Confirmar pagamento"}
              </button>
            </div>
          </>
        ) : (
          <div className="text-center py-6">
            <div className="text-5xl mb-3">🥥✅</div>
            <p className="text-coco-700 mb-2">Venda salva.</p>
            <p className="text-coco-700 mb-4 text-sm">
              Total: {brl(total)} · Recebido: {brl(paid)}
              {remaining > 0 && (
                <>
                  {" "}·{" "}
                  <strong className="text-amber-700">
                    Fiado: {brl(remaining)}
                  </strong>
                </>
              )}
              {change > 0 && (
                <>
                  {" "}·{" "}
                  <strong className="text-green-700">
                    Troco: {brl(change)}
                  </strong>
                </>
              )}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 max-w-md mx-auto">
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary btn-touch"
              >
                📲 WhatsApp
              </a>
              <a
                href={`/recibo/${saleId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary btn-touch"
              >
                🧾 Imprimir
              </a>
              <button onClick={onClose} className="btn-primary btn-touch">
                Nova venda
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
