"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import type { Supplier } from "@/lib/types";

const empty: Partial<Supplier> = {
  name: "",
  document: "",
  phone: "",
  email: "",
  notes: "",
  active: true,
};

export default function FornecedoresPage() {
  const supabase = createClient();
  const toast = useToast();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Supplier> | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    const q = supabase.from("suppliers").select("*").order("name").limit(1000);
    if (!showInactive) q.eq("active", true);
    const { data } = await q;
    setSuppliers((data ?? []) as Supplier[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [showInactive]);

  async function save() {
    if (!editing?.name?.trim()) return toast.error("Nome do fornecedor obrigatório.");

    const payload = {
      name: editing.name!.trim(),
      document: editing.document?.trim() || null,
      phone: editing.phone?.trim() || null,
      email: editing.email?.trim() || null,
      notes: editing.notes?.trim() || null,
      active: editing.active ?? true,
    };

    const op = editing.id
      ? supabase.from("suppliers").update(payload).eq("id", editing.id)
      : supabase.from("suppliers").insert(payload);
    const { error } = await op;
    if (error) return toast.error(error.message);
    toast.success("Fornecedor salvo.");
    setEditing(null);
    load();
  }

  async function toggleActive(s: Supplier) {
    const { error } = await supabase
      .from("suppliers")
      .update({ active: !s.active })
      .eq("id", s.id);
    if (error) return toast.error(error.message);
    load();
  }

  const filtered = suppliers.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.document ?? "").includes(search)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-coco-800">Fornecedores</h1>
        <button onClick={() => setEditing({ ...empty })} className="btn-primary">
          + Novo Fornecedor
        </button>
      </div>

      <div className="flex gap-3 flex-wrap items-center">
        <input
          className="input-field max-w-xs"
          placeholder="Buscar por nome ou CNPJ…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded"
          />
          Mostrar inativos
        </label>
      </div>

      {loading ? (
        <div className="text-coco-700">Carregando…</div>
      ) : filtered.length === 0 ? (
        <div className="text-gray-400 text-center py-12">
          Nenhum fornecedor encontrado.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => (
            <div
              key={s.id}
              className={`bg-white rounded-xl p-4 border shadow-sm flex flex-col sm:flex-row sm:items-center gap-3 ${
                !s.active ? "opacity-50" : "border-gray-100"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-coco-900">{s.name}</span>
                  {!s.active && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                      Inativo
                    </span>
                  )}
                </div>
                <div className="flex gap-4 mt-1 flex-wrap">
                  {s.document && (
                    <span className="text-xs text-gray-500">CNPJ/CPF: {s.document}</span>
                  )}
                  {s.phone && (
                    <span className="text-xs text-gray-500">📞 {s.phone}</span>
                  )}
                  {s.email && (
                    <span className="text-xs text-gray-500">✉ {s.email}</span>
                  )}
                </div>
                {s.notes && (
                  <div className="text-xs text-gray-400 mt-0.5 truncate">{s.notes}</div>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <Link
                  href={`/fornecedores/${s.id}`}
                  className="btn-secondary text-xs px-3 py-1"
                >
                  Analytics
                </Link>
                <button
                  onClick={() => setEditing(s)}
                  className="btn-secondary text-xs px-3 py-1"
                >
                  Editar
                </button>
                <button
                  onClick={() => toggleActive(s)}
                  className="text-xs text-gray-400 hover:text-coco-700 px-2"
                  title={s.active ? "Desativar" : "Reativar"}
                >
                  {s.active ? "Desativar" : "Reativar"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-coco-800">
              {editing.id ? "Editar Fornecedor" : "Novo Fornecedor"}
            </h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nome / Razão Social *
              </label>
              <input
                className="input-field"
                value={editing.name ?? ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Ex: Fazenda Boa Vista"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  CNPJ / CPF
                </label>
                <input
                  className="input-field"
                  value={editing.document ?? ""}
                  onChange={(e) => setEditing({ ...editing, document: e.target.value })}
                  placeholder="00.000.000/0001-00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
                <input
                  className="input-field"
                  value={editing.phone ?? ""}
                  onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                  placeholder="(11) 99999-9999"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
              <input
                className="input-field"
                type="email"
                value={editing.email ?? ""}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                placeholder="contato@fornecedor.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Observações</label>
              <textarea
                className="input-field"
                rows={2}
                value={editing.notes ?? ""}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              />
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button className="btn-secondary" onClick={() => setEditing(null)}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={save}>
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
