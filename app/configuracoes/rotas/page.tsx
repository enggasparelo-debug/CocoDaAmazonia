"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Route } from "@/lib/types";
import { useToast } from "@/components/Toast";

const empty: Partial<Route> = {
  name: "",
  description: "",
  active: true,
};

export default function RotasPage() {
  const supabase = createClient();
  const toast = useToast();
  const [rows, setRows] = useState<Route[]>([]);
  const [editing, setEditing] = useState<Partial<Route> | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("routes").select("*").order("name");
    setRows((data as Route[]) ?? []);
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
      description: editing.description?.trim() || null,
      active: editing.active ?? true,
    };
    const op = editing.id
      ? supabase.from("routes").update(payload).eq("id", editing.id)
      : supabase.from("routes").insert(payload);
    const { error } = await op;
    if (error) {
      setErr(error.message);
      return;
    }
    toast.success("Salvo.");
    setEditing(null);
    load();
  }

  async function toggle(r: Route) {
    await supabase.from("routes").update({ active: !r.active }).eq("id", r.id);
    load();
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/configuracoes"
            className="text-coco-700 underline text-sm"
          >
            ← Configurações
          </Link>
          <h1 className="text-3xl font-bold text-coco-900 mt-1">Rotas</h1>
        </div>
        <button onClick={() => setEditing({ ...empty })} className="btn-primary">
          + Nova rota
        </button>
      </header>

      <div className="card">
        {loading ? (
          <p className="text-coco-600">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="text-coco-600">Nenhuma rota cadastrada.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Descrição</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.name}</td>
                  <td>{r.description ?? "—"}</td>
                  <td>
                    <span
                      className={`badge ${
                        r.active
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-200 text-gray-700"
                      }`}
                    >
                      {r.active ? "ativa" : "inativa"}
                    </span>
                  </td>
                  <td className="text-right">
                    <button
                      onClick={() => setEditing(r)}
                      className="btn-ghost text-sm"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => toggle(r)}
                      className="btn-ghost text-sm"
                    >
                      {r.active ? "Desativar" : "Ativar"}
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
              {editing.id ? "Editar rota" : "Nova rota"}
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
                />
              </div>
              <div>
                <label className="label">Descrição</label>
                <input
                  className="input"
                  value={editing.description ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value })
                  }
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.active ?? true}
                  onChange={(e) =>
                    setEditing({ ...editing, active: e.target.checked })
                  }
                />
                Ativa
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
