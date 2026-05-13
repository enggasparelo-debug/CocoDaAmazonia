"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Customer } from "@/lib/types";

export default function CustomerQuickForm({
  onCreated,
  onClose,
  requireDocsForCredit = false,
}: {
  onCreated: (c: Customer) => void;
  onClose: () => void;
  requireDocsForCredit?: boolean;
}) {
  const supabase = createClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [document, setDocument] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Nome é obrigatório.");
    if (requireDocsForCredit) {
      if (!document.trim())
        return setError("CPF é obrigatório para venda fiado.");
      if (!address.trim())
        return setError("Endereço é obrigatório para venda fiado.");
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("customers")
      .insert({
        name: name.trim(),
        phone: phone.trim() || null,
        document: document.trim() || null,
        address: address.trim() || null,
        active: true,
      })
      .select("*")
      .single();
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    onCreated(data as Customer);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card modal-card--md modal-pad">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-coco-900">Novo cliente</h2>
          <button onClick={onClose} className="btn-ghost" aria-label="Fechar">
            Fechar
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Nome *</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              enterKeyHint="next"
              autoFocus
            />
          </div>
          <div>
            <label className="label">Telefone</label>
            <input
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              enterKeyHint="next"
              placeholder="(00) 00000-0000"
            />
          </div>
          <div>
            <label className="label">
              CPF {requireDocsForCredit && <span className="text-red-700">*</span>}
            </label>
            <input
              className="input"
              value={document}
              onChange={(e) => setDocument(e.target.value)}
              inputMode="numeric"
              enterKeyHint="next"
              placeholder="000.000.000-00"
            />
            {requireDocsForCredit && (
              <p className="text-xs text-coco-600 mt-1">
                Obrigatório para emitir promissória de fiado.
              </p>
            )}
          </div>
          <div>
            <label className="label">
              Endereço{" "}
              {requireDocsForCredit && <span className="text-red-700">*</span>}
            </label>
            <input
              className="input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              autoComplete="street-address"
              enterKeyHint="done"
            />
          </div>
        </div>

        {error && (
          <p className="text-red-700 text-sm mt-3 bg-red-50 border border-red-200 rounded p-2">
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="btn-ghost btn-touch"
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            onClick={save}
            className="btn-primary btn-touch"
            disabled={saving}
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
