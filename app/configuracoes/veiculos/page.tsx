"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Vehicle } from "@/lib/types";
import { useToast } from "@/components/Toast";

const empty: Partial<Vehicle> = {
  plate: "",
  model: "",
  description: "",
  active: true,
};

export default function VeiculosPage() {
  const supabase = createClient();
  const toast = useToast();
  const [rows, setRows] = useState<Vehicle[]>([]);
  const [editing, setEditing] = useState<Partial<Vehicle> | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("vehicles").select("*").order("plate");
    setRows((data as Vehicle[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setErr(null);
    if (!editing?.plate?.trim()) return setErr("Placa é obrigatória.");
    const payload = {
      plate: editing.plate!.trim().toUpperCase(),
      model: editing.model?.trim() || null,
      description: editing.description?.trim() || null,
      active: editing.active ?? true,
    };
    const op = editing.id
      ? supabase.from("vehicles").update(payload).eq("id", editing.id)
      : supabase.from("vehicles").insert(payload);
    const { error } = await op;
    if (error) {
      setErr(error.message);
      return;
    }
    toast.success("Salvo.");
    setEditing(null);
    load();
  }

  async function toggle(v: Vehicle) {
    await supabase.from("vehicles").update({ active: !v.active }).eq("id", v.id);
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
          <h1 className="text-3xl font-bold text-coco-900 mt-1">Veículos</h1>
        </div>
        <button onClick={() => setEditing({ ...empty })} className="btn-primary">
          + Novo veículo
        </button>
      </header>

      <div className="card">
        {loading ? (
          <p className="text-coco-600">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="text-coco-600">Nenhum veículo cadastrado.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Placa</th>
                <th>Modelo</th>
                <th>Descrição</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td className="font-mono font-semibold">{v.plate}</td>
                  <td>{v.model ?? "—"}</td>
                  <td>{v.description ?? "—"}</td>
                  <td>
                    <span
                      className={`badge ${
                        v.active
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-200 text-gray-700"
                      }`}
                    >
                      {v.active ? "ativo" : "inativo"}
                    </span>
                  </td>
                  <td className="text-right">
                    <button
                      onClick={() => setEditing(v)}
                      className="btn-ghost text-sm"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => toggle(v)}
                      className="btn-ghost text-sm"
                    >
                      {v.active ? "Desativar" : "Ativar"}
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
              {editing.id ? "Editar veículo" : "Novo veículo"}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="label">Placa *</label>
                <input
                  className="input font-mono uppercase"
                  value={editing.plate ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, plate: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="label">Modelo</label>
                <input
                  className="input"
                  value={editing.model ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, model: e.target.value })
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
