"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PaymentMethod, SalePayment } from "@/lib/types";
import { useToast } from "./Toast";

function isoToLocal(iso: string): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function PaymentEditor({
  payment,
  methods,
  onClose,
  onSaved,
}: {
  payment: SalePayment;
  methods: PaymentMethod[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const toast = useToast();
  const [methodId, setMethodId] = useState(payment.payment_method_id);
  const [amount, setAmount] = useState<number>(Number(payment.amount));
  const [paidAtLocal, setPaidAtLocal] = useState<string>(
    isoToLocal(payment.paid_at)
  );
  const [notes, setNotes] = useState(payment.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!methodId) return setErr("Escolha uma forma de pagamento.");
    if (amount <= 0) return setErr("Valor inválido.");
    if (!paidAtLocal) return setErr("Informe a data do pagamento.");
    const paidAtIso = new Date(paidAtLocal).toISOString();
    if (new Date(paidAtIso).getTime() > Date.now() + 60_000) {
      return setErr("A data do pagamento não pode ser no futuro.");
    }
    setSaving(true);
    const { error } = await supabase
      .from("sale_payments")
      .update({
        payment_method_id: methodId,
        amount,
        paid_at: paidAtIso,
        notes: notes || null,
      })
      .eq("id", payment.id);
    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }
    toast.success("Pagamento atualizado.");
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-coco-900">Editar pagamento</h2>
          <button onClick={onClose} className="btn-ghost">
            Fechar
          </button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Forma de pagamento</label>
              <select
                className="input"
                value={methodId}
                onChange={(e) => setMethodId(e.target.value)}
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
                value={paidAtLocal}
                onChange={(e) => setPaidAtLocal(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="label">Valor recebido</label>
            <input
              type="number"
              step="0.01"
              className="input text-2xl font-bold"
              value={amount}
              onChange={(e) => setAmount(parseFloat(e.target.value || "0"))}
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
        </div>
        {err && <p className="text-red-700 text-sm mt-3">{err}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-ghost" disabled={saving}>
            Voltar
          </button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? "…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
