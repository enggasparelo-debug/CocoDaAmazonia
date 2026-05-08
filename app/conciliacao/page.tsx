"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { fmtDateOnly } from "@/lib/format";
import type { BankAccount, BankReconciliation } from "@/lib/types";
import { useToast } from "@/components/Toast";

const BANKS = [
  "Sicoob", "Sicredi", "Credisis", "Bradesco", "Itaú", "Banco do Brasil",
  "Caixa Econômica Federal", "Santander", "Nubank", "Inter",
  "BTG Pactual", "C6 Bank", "XP", "Outro",
];

const empty = {
  name: "",
  bank_name: "",
  account_number: "",
  agency: "",
  notes: "",
};

type AccountWithLastReconciliation = BankAccount & {
  last_reconciliation?: Pick<BankReconciliation, "id" | "period_start" | "period_end" | "status"> | null;
};

export default function ConciliacaoPage() {
  const supabase = createClient();
  const toast = useToast();
  const [accounts, setAccounts] = useState<AccountWithLastReconciliation[]>([]);
  const [editing, setEditing] = useState<Partial<typeof empty> & { id?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data: accs } = await supabase
      .from("bank_accounts")
      .select("*")
      .eq("active", true)
      .order("bank_name");

    if (!accs) return;

    // Load last reconciliation per account
    const enriched = await Promise.all(
      accs.map(async (acc) => {
        const { data: rec } = await supabase
          .from("bank_reconciliations")
          .select("id, period_start, period_end, status")
          .eq("bank_account_id", acc.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return { ...acc, last_reconciliation: rec };
      })
    );

    setAccounts(enriched);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing?.name?.trim()) return toast.error("Nome da conta é obrigatório.");
    if (!editing?.bank_name?.trim()) return toast.error("Banco é obrigatório.");
    setSaving(true);

    const payload = {
      name: editing.name.trim(),
      bank_name: editing.bank_name.trim(),
      account_number: editing.account_number?.trim() || null,
      agency: editing.agency?.trim() || null,
      notes: editing.notes?.trim() || null,
    };

    const op = editing.id
      ? supabase.from("bank_accounts").update(payload).eq("id", editing.id)
      : supabase.from("bank_accounts").insert(payload);

    const { error } = await op;
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing.id ? "Conta atualizada." : "Conta cadastrada.");
    setEditing(null);
    load();
  }

  async function deactivate(id: string) {
    const { error } = await supabase
      .from("bank_accounts")
      .update({ active: false })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Conta removida.");
    load();
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">Conciliação Bancária</h1>
          <p className="text-coco-600">Gerencie suas contas e concilie o extrato com o sistema.</p>
        </div>
        <button onClick={() => setEditing({ ...empty })} className="btn-primary">
          + Nova Conta Bancária
        </button>
      </header>

      {accounts.length === 0 ? (
        <div className="card text-center py-16 text-coco-500">
          <div className="text-5xl mb-4">🏦</div>
          <p className="font-medium">Nenhuma conta bancária cadastrada.</p>
          <p className="text-sm mt-1">Cadastre sua primeira conta para começar a conciliar.</p>
          <button onClick={() => setEditing({ ...empty })} className="btn-primary mt-4">
            + Nova Conta Bancária
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((acc) => (
            <div key={acc.id} className="card flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-coco-900">{acc.name}</div>
                  <div className="text-sm text-coco-600">{acc.bank_name}</div>
                  {(acc.agency || acc.account_number) && (
                    <div className="text-xs text-coco-400 mt-0.5">
                      {acc.agency && `Ag. ${acc.agency}`}
                      {acc.agency && acc.account_number && " · "}
                      {acc.account_number && `CC ${acc.account_number}`}
                    </div>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => setEditing({ id: acc.id, name: acc.name, bank_name: acc.bank_name, account_number: acc.account_number ?? undefined, agency: acc.agency ?? undefined, notes: acc.notes ?? undefined })}
                    className="btn-ghost text-xs"
                    title="Editar"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => deactivate(acc.id)}
                    className="btn-ghost text-xs text-red-600"
                    title="Remover"
                  >
                    🗑
                  </button>
                </div>
              </div>

              {acc.last_reconciliation ? (
                <div className="rounded-lg bg-coco-50 border border-coco-100 p-2 text-xs">
                  <div className="text-coco-500">Última conciliação</div>
                  <div className="font-medium text-coco-800">
                    {fmtDateOnly(acc.last_reconciliation.period_start)} →{" "}
                    {fmtDateOnly(acc.last_reconciliation.period_end)}
                  </div>
                  <span
                    className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-xs font-medium ${
                      acc.last_reconciliation.status === "closed"
                        ? "bg-green-100 text-green-800"
                        : "bg-yellow-100 text-yellow-800"
                    }`}
                  >
                    {acc.last_reconciliation.status === "closed" ? "✔ Fechada" : "⏳ Em andamento"}
                  </span>
                </div>
              ) : (
                <div className="rounded-lg bg-coco-50 border border-coco-100 p-2 text-xs text-coco-400">
                  Nenhuma conciliação ainda
                </div>
              )}

              <Link
                href={`/conciliacao/${acc.id}`}
                className="btn-primary text-center text-sm"
              >
                Ver conciliações →
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Modal cadastro de conta */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold mb-4">
              {editing.id ? "Editar conta bancária" : "Nova conta bancária"}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="label">Nome da conta *</label>
                <input
                  className="input"
                  placeholder="Ex: Conta Corrente Principal"
                  value={editing.name ?? ""}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Banco *</label>
                <select
                  className="input"
                  value={editing.bank_name ?? ""}
                  onChange={(e) => setEditing({ ...editing, bank_name: e.target.value })}
                >
                  <option value="">Selecione...</option>
                  {BANKS.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Agência</label>
                  <input
                    className="input"
                    placeholder="0001"
                    value={editing.agency ?? ""}
                    onChange={(e) => setEditing({ ...editing, agency: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Conta</label>
                  <input
                    className="input"
                    placeholder="12345-6"
                    value={editing.account_number ?? ""}
                    onChange={(e) => setEditing({ ...editing, account_number: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="label">Observação</label>
                <textarea
                  className="input"
                  rows={2}
                  value={editing.notes ?? ""}
                  onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="btn-ghost">Cancelar</button>
              <button onClick={save} disabled={saving} className="btn-primary">
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
