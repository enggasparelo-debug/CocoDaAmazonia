"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PaymentMethod, SalePayment } from "@/lib/types";
import { useToast } from "./Toast";
import { useTenant } from "@/lib/useTenant";
import { uploadAttachment } from "@/lib/attachments";
import { isoToLocal } from "@/lib/datetime";

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
  const { tenant } = useTenant();
  const [methodId, setMethodId] = useState(payment.payment_method_id);
  const [amount, setAmount] = useState<number>(Number(payment.amount));
  const [paidAtLocal, setPaidAtLocal] = useState<string>(
    isoToLocal(payment.paid_at)
  );
  const [notes, setNotes] = useState(payment.notes ?? "");
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(
    payment.attachment_url ?? null
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!tenant?.id) return setErr("Tenant ainda carregando.");
    setUploading(true);
    setErr(null);
    const { url, error } = await uploadAttachment(supabase, {
      tenantId: tenant.id,
      table: "sale_payments",
      rowId: payment.id,
      file,
    });
    setUploading(false);
    if (error) return setErr(error);
    setAttachmentUrl(url);
  }

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
        attachment_url: attachmentUrl,
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
          <div>
            <label className="label">
              Comprovante (PIX, foto, recibo)
            </label>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              disabled={uploading}
              className="input"
            />
            {uploading && (
              <p className="text-xs text-coco-600 mt-1">Enviando…</p>
            )}
            {attachmentUrl && (
              <div className="text-xs mt-1 flex items-center gap-2">
                <a
                  href={attachmentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-coco-700 underline"
                >
                  Ver anexo
                </a>
                <button
                  type="button"
                  onClick={() => setAttachmentUrl(null)}
                  className="text-red-700 underline"
                >
                  Remover
                </button>
              </div>
            )}
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
