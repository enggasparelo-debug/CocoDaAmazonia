"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";

type Entry = {
  payment_method_id: string;
  amount: number;
};

export default function PaymentModal({
  saleId,
  total,
  methods,
  onClose,
}: {
  saleId: string;
  total: number;
  methods: PaymentMethod[];
  onClose: () => void;
}) {
  const supabase = createClient();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const paid = useMemo(
    () => entries.reduce((s, e) => s + (Number(e.amount) || 0), 0),
    [entries]
  );
  const remaining = Math.max(0, +(total - paid).toFixed(2));

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
    setSaving(true);
    try {
      const valid = entries.filter(
        (e) => e.payment_method_id && Number(e.amount) > 0
      );
      if (valid.length === 0) {
        // permitir confirmar como totalmente fiado: sem pagamentos
        setDone(true);
        return;
      }
      const { error } = await supabase
        .from("sale_payments")
        .insert(
          valid.map((e) => ({
            sale_id: saleId,
            payment_method_id: e.payment_method_id,
            amount: Number(e.amount),
          }))
        );
      if (error) throw error;
      setDone(true);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-coco-900">
            {done ? "Venda finalizada ✅" : "Recebimento"}
          </h2>
          <button onClick={onClose} className="btn-ghost">
            Fechar
          </button>
        </div>

        {!done ? (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="card !p-3">
                <div className="text-xs text-coco-700">Total</div>
                <div className="text-xl font-bold">{brl(total)}</div>
              </div>
              <div className="card !p-3">
                <div className="text-xs text-coco-700">Recebido</div>
                <div className="text-xl font-bold text-green-700">
                  {brl(paid)}
                </div>
              </div>
              <div className="card !p-3">
                <div className="text-xs text-coco-700">Restante</div>
                <div
                  className={`text-xl font-bold ${
                    remaining > 0 ? "text-amber-700" : "text-green-700"
                  }`}
                >
                  {brl(remaining)}
                </div>
              </div>
            </div>

            <div className="mb-4">
              <div className="text-sm font-semibold text-coco-800 mb-2">
                Forma de pagamento
              </div>
              <div className="flex flex-wrap gap-2">
                {methods.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => quickPay(m.id)}
                    className="btn-secondary"
                    title={m.is_credit ? "Venda a prazo / Fiado" : ""}
                  >
                    {m.is_credit ? "📒" : "💳"} {m.name}
                  </button>
                ))}
              </div>
              <p className="text-xs text-coco-600 mt-1">
                Toque uma forma para lançar o restante. Você pode adicionar
                várias (split).
              </p>
            </div>

            {entries.length > 0 && (
              <table className="table mb-4">
                <thead>
                  <tr>
                    <th>Forma</th>
                    <th>Valor</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr key={i}>
                      <td>
                        <select
                          value={e.payment_method_id}
                          onChange={(ev) =>
                            updateEntry(i, {
                              payment_method_id: ev.target.value,
                            })
                          }
                          className="input"
                        >
                          {methods.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="w-40">
                        <input
                          type="number"
                          step="0.01"
                          value={e.amount}
                          onChange={(ev) =>
                            updateEntry(i, {
                              amount: parseFloat(ev.target.value || "0"),
                            })
                          }
                          className="input text-right"
                        />
                      </td>
                      <td className="w-24 text-right">
                        <button
                          onClick={() => removeEntry(i)}
                          className="btn-ghost text-red-600"
                        >
                          remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {error && (
              <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="btn-ghost">
                Cancelar
              </button>
              <button
                onClick={confirm}
                disabled={saving}
                className="btn-primary"
              >
                {saving
                  ? "Salvando…"
                  : remaining > 0
                  ? "Confirmar (deixar saldo em aberto)"
                  : "Confirmar pagamento"}
              </button>
            </div>
          </>
        ) : (
          <div className="text-center py-6">
            <div className="text-5xl mb-3">🥥✅</div>
            <p className="text-coco-700 mb-6">
              Venda salva. Saldo total: {brl(total)} · Recebido: {brl(paid)}
              {remaining > 0 && (
                <>
                  {" "}
                  · <strong className="text-amber-700">
                    Em aberto: {brl(remaining)}
                  </strong>
                </>
              )}
            </p>
            <button onClick={onClose} className="btn-primary">
              Nova venda
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
