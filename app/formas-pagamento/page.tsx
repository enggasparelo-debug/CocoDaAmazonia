"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PaymentMethod } from "@/lib/types";

const empty: Partial<PaymentMethod> = {
  name: "",
  is_credit: false,
  active: true,
};

export default function FormasPagamentoPage() {
  const supabase = createClient();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [editing, setEditing] = useState<Partial<PaymentMethod> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase
      .from("payment_methods")
      .select("*")
      .order("name");
    setMethods((data as PaymentMethod[]) ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setError(null);
    if (!editing?.name?.trim()) {
      setError("Nome é obrigatório.");
      return;
    }
    const payload = {
      name: editing.name!.trim(),
      is_credit: editing.is_credit ?? false,
      active: editing.active ?? true,
    };
    const op = editing.id
      ? supabase.from("payment_methods").update(payload).eq("id", editing.id)
      : supabase.from("payment_methods").insert(payload);
    const { error } = await op;
    if (error) {
      setError(error.message);
      return;
    }
    setEditing(null);
    load();
  }

  async function toggleActive(m: PaymentMethod) {
    await supabase
      .from("payment_methods")
      .update({ active: !m.active })
      .eq("id", m.id);
    load();
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">
            Formas de Pagamento
          </h1>
          <p className="text-coco-600">
            Cadastre quais formas o operador pode escolher na finalização da
            venda.
          </p>
        </div>
        <button
          onClick={() => setEditing({ ...empty })}
          className="btn-primary"
        >
          + Nova forma
        </button>
      </header>

      <div className="card">
        {methods.length === 0 ? (
          <p className="text-coco-600">Nenhuma forma cadastrada.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Tipo</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {methods.map((m) => (
                <tr key={m.id}>
                  <td className="font-medium">{m.name}</td>
                  <td>
                    {m.is_credit ? (
                      <span className="badge bg-amber-100 text-amber-800">
                        a prazo (fiado)
                      </span>
                    ) : (
                      <span className="badge bg-coco-100 text-coco-800">
                        à vista
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        m.active
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-200 text-gray-700"
                      }`}
                    >
                      {m.active ? "ativo" : "inativo"}
                    </span>
                  </td>
                  <td className="text-right">
                    <button
                      onClick={() => setEditing(m)}
                      className="btn-ghost"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => toggleActive(m)}
                      className="btn-ghost"
                    >
                      {m.active ? "Desativar" : "Ativar"}
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
            <h2 className="text-2xl font-bold text-coco-900 mb-4">
              {editing.id ? "Editar forma" : "Nova forma"}
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
                  placeholder="Ex.: Pix, Dinheiro, Cartão Crédito…"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.is_credit ?? false}
                  onChange={(e) =>
                    setEditing({ ...editing, is_credit: e.target.checked })
                  }
                />
                É venda a prazo (fiado)
              </label>
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
            {error && (
              <p className="text-red-700 text-sm mt-3">{error}</p>
            )}
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
