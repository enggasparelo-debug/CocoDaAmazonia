"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Seller, Membership } from "@/lib/types";
import { useToast } from "@/components/Toast";

const empty: Partial<Seller> = {
  name: "",
  user_id: null,
  active: true,
};

export default function VendedoresPage() {
  const supabase = createClient();
  const toast = useToast();
  const [rows, setRows] = useState<Seller[]>([]);
  const [editing, setEditing] = useState<Partial<Seller> | null>(null);
  const [operators, setOperators] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [s, m] = await Promise.all([
      supabase.from("sellers").select("*").order("name"),
      supabase
        .from("memberships")
        .select("*")
        .eq("role", "operador"),
    ]);
    setRows((s.data as Seller[]) ?? []);
    setOperators((m.data as Membership[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setErr(null);
    if (!editing?.name?.trim()) return setErr("Nome é obrigatório.");
    const payload = {
      name: editing.name!.trim(),
      user_id: editing.user_id || null,
      active: editing.active ?? true,
    };
    const op = editing.id
      ? supabase.from("sellers").update(payload).eq("id", editing.id)
      : supabase.from("sellers").insert(payload);
    const { error } = await op;
    if (error) {
      setErr(error.message);
      return;
    }
    toast.success("Vendedor salvo.");
    setEditing(null);
    load();
  }

  async function toggle(s: Seller) {
    await supabase.from("sellers").update({ active: !s.active }).eq("id", s.id);
    load();
  }

  async function backfill(s: Seller) {
    if (!s.user_id) {
      toast.error("Vendedor sem login vinculado — nada pra retroceder.");
      return;
    }
    const { data, error } = await supabase.rpc("link_seller_to_history", {
      p_seller_id: s.id,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${data ?? 0} vendas vinculadas a ${s.name}.`);
  }

  // user_ids já vinculados a outro vendedor (pra esconder no select)
  const usedUserIds = new Set(
    rows
      .filter((r) => r.user_id && r.id !== editing?.id)
      .map((r) => r.user_id as string)
  );

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link href="/configuracoes" className="text-coco-700 underline text-sm">
            ← Configurações
          </Link>
          <h1 className="text-3xl font-bold text-coco-900 mt-1">Vendedores</h1>
          <p className="text-coco-600 text-sm">
            Cadastro de quem vende. Vincule a um login pra que aquele operador
            possa registrar vendas no app.
          </p>
        </div>
        <button onClick={() => setEditing({ ...empty })} className="btn-primary">
          + Novo vendedor
        </button>
      </header>

      <div className="card">
        {loading ? (
          <p className="text-coco-600">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="text-coco-600">Nenhum vendedor cadastrado.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Login vinculado</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.name}</td>
                  <td className="font-mono text-xs">
                    {s.user_id ? `${s.user_id.slice(0, 8)}…` : "—"}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        s.active
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-200 text-gray-700"
                      }`}
                    >
                      {s.active ? "ativo" : "inativo"}
                    </span>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button
                      onClick={() => setEditing(s)}
                      className="btn-ghost text-sm"
                    >
                      Editar
                    </button>
                    {s.user_id && (
                      <button
                        onClick={() => backfill(s)}
                        className="btn-ghost text-sm"
                        title="Atribui este vendedor a vendas anteriores das cargas dele"
                      >
                        Vincular histórico
                      </button>
                    )}
                    <button
                      onClick={() => toggle(s)}
                      className="btn-ghost text-sm"
                    >
                      {s.active ? "Desativar" : "Ativar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold text-coco-900 mb-4">
              {editing.id ? "Editar vendedor" : "Novo vendedor"}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="label">Nome *</label>
                <input
                  className="input"
                  value={editing.name ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Login vinculado (opcional)</label>
                <select
                  className="input"
                  value={editing.user_id ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      user_id: e.target.value || null,
                    })
                  }
                >
                  <option value="">— Sem login (vendedor offline) —</option>
                  {operators
                    .filter(
                      (o) => !usedUserIds.has(o.user_id) || o.user_id === editing.user_id
                    )
                    .map((o) => (
                      <option key={o.user_id} value={o.user_id}>
                        {o.user_id.slice(0, 8)}… (operador)
                      </option>
                    ))}
                </select>
                <p className="text-xs text-coco-600 mt-1">
                  Se vinculado, esse operador consegue vender no app. Sem login,
                  é só um nome pra atribuição manual.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.active ?? true}
                  onChange={(e) =>
                    setEditing({ ...editing, active: e.target.checked })
                  }
                />
                Ativo
              </label>
            </div>
            {err && <p className="text-red-700 text-sm mt-3">{err}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="btn-ghost">
                Cancelar
              </button>
              <button onClick={save} className="btn-primary">
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
