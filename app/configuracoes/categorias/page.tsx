"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { ExpenseCategory } from "@/lib/types";
import { useToast } from "@/components/Toast";

const empty: Partial<ExpenseCategory> = {
  name: "",
  active: true,
  sort_order: 0,
};

export default function CategoriasDespesaPage() {
  const supabase = createClient();
  const toast = useToast();
  const [rows, setRows] = useState<ExpenseCategory[]>([]);
  const [editing, setEditing] = useState<Partial<ExpenseCategory> | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("expense_categories")
      .select("*")
      .order("sort_order")
      .order("name");
    setRows((data as ExpenseCategory[]) ?? []);
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
      active: editing.active ?? true,
      sort_order: editing.sort_order ?? 0,
    };
    const op = editing.id
      ? supabase
          .from("expense_categories")
          .update(payload)
          .eq("id", editing.id)
      : supabase.from("expense_categories").insert(payload);
    const { error } = await op;
    if (error) {
      setErr(error.message);
      return;
    }
    toast.success("Categoria salva.");
    setEditing(null);
    load();
  }

  async function toggle(c: ExpenseCategory) {
    await supabase
      .from("expense_categories")
      .update({ active: !c.active })
      .eq("id", c.id);
    load();
  }

  async function remove(c: ExpenseCategory) {
    if (!confirm(`Apagar categoria "${c.name}"?\n\nDespesas antigas continuam com o nome registrado.`))
      return;
    const { error } = await supabase
      .from("expense_categories")
      .delete()
      .eq("id", c.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Categoria apagada.");
    load();
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link href="/configuracoes" className="text-coco-700 underline text-sm">
            ← Configurações
          </Link>
          <h1 className="text-3xl font-bold text-coco-900 mt-1">
            Categorias de despesa
          </h1>
          <p className="text-coco-600 text-sm">
            As categorias aqui aparecem no select ao lançar uma despesa. Ordem
            menor = aparece antes.
          </p>
        </div>
        <button onClick={() => setEditing({ ...empty })} className="btn-primary">
          + Nova categoria
        </button>
      </header>

      <div className="card">
        {loading ? (
          <p className="text-coco-600">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="text-coco-600">Nenhuma categoria cadastrada.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="w-16">Ordem</th>
                <th>Nome</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="text-coco-600">{c.sort_order}</td>
                  <td className="font-medium">{c.name}</td>
                  <td>
                    <span
                      className={`badge ${
                        c.active
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-200 text-gray-700"
                      }`}
                    >
                      {c.active ? "ativa" : "inativa"}
                    </span>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button
                      onClick={() => setEditing(c)}
                      className="btn-ghost text-sm"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => toggle(c)}
                      className="btn-ghost text-sm"
                    >
                      {c.active ? "Desativar" : "Ativar"}
                    </button>
                    <button
                      onClick={() => remove(c)}
                      className="btn-ghost text-sm text-red-700"
                    >
                      Apagar
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
              {editing.id ? "Editar categoria" : "Nova categoria"}
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
                <label className="label">Ordem de exibição</label>
                <input
                  type="number"
                  className="input w-32"
                  value={editing.sort_order ?? 0}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      sort_order: parseInt(e.target.value || "0"),
                    })
                  }
                />
                <p className="text-xs text-coco-600 mt-1">
                  Categorias com ordem menor aparecem antes no select.
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
                Ativa (aparece no select de novas despesas)
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
