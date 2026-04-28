"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDateOnly } from "@/lib/format";
import type { Customer, CustomerBalance } from "@/lib/types";

const empty: Partial<Customer> = {
  name: "",
  phone: "",
  email: "",
  document: "",
  address: "",
  notes: "",
  credit_limit: null,
  active: true,
};

export default function ClientesPage() {
  const supabase = createClient();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [balances, setBalances] = useState<Record<string, CustomerBalance>>({});
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Partial<Customer> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [c, b] = await Promise.all([
      supabase.from("customers").select("*").order("name"),
      supabase.from("customer_balances").select("*"),
    ]);
    setCustomers((c.data as Customer[]) ?? []);
    const map: Record<string, CustomerBalance> = {};
    (b.data as CustomerBalance[] | null)?.forEach((row) => {
      map[row.customer_id] = row;
    });
    setBalances(map);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q) ||
        c.document?.toLowerCase().includes(q)
    );
  }, [customers, search]);

  async function save() {
    setError(null);
    if (!editing?.name?.trim()) {
      setError("Nome é obrigatório.");
      return;
    }
    const payload = {
      name: editing.name!.trim(),
      phone: editing.phone || null,
      email: editing.email || null,
      document: editing.document || null,
      address: editing.address || null,
      notes: editing.notes || null,
      credit_limit:
        editing.credit_limit != null && Number(editing.credit_limit) > 0
          ? Number(editing.credit_limit)
          : null,
      active: editing.active ?? true,
    };
    const op = editing.id
      ? supabase.from("customers").update(payload).eq("id", editing.id)
      : supabase.from("customers").insert(payload);
    const { error } = await op;
    if (error) {
      setError(error.message);
      return;
    }
    setEditing(null);
    load();
  }

  async function toggleActive(c: Customer) {
    await supabase
      .from("customers")
      .update({ active: !c.active })
      .eq("id", c.id);
    load();
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">Clientes</h1>
          <p className="text-coco-600">Cadastro e saldo a receber</p>
        </div>
        <button
          className="btn-primary"
          onClick={() => setEditing({ ...empty })}
        >
          + Novo cliente
        </button>
      </header>

      <div className="card">
        <input
          className="input mb-4"
          placeholder="Buscar por nome, telefone ou documento…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {loading ? (
          <p className="text-coco-600">Carregando…</p>
        ) : filtered.length === 0 ? (
          <p className="text-coco-600">Nenhum cliente cadastrado.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Telefone</th>
                <th>Documento</th>
                <th>Saldo aberto</th>
                <th>Cadastrado</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const bal = balances[c.id]?.open_balance ?? 0;
                return (
                  <tr key={c.id}>
                    <td className="font-medium">
                      <Link href={`/clientes/${c.id}`} className="text-coco-800 hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td>{c.phone ?? "—"}</td>
                    <td>{c.document ?? "—"}</td>
                    <td
                      className={
                        bal > 0 ? "text-amber-700 font-semibold" : ""
                      }
                    >
                      {brl(Number(bal))}
                    </td>
                    <td>{fmtDateOnly(c.created_at)}</td>
                    <td>
                      <span
                        className={`badge ${
                          c.active
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-200 text-gray-700"
                        }`}
                      >
                        {c.active ? "ativo" : "inativo"}
                      </span>
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <Link
                        href={`/clientes/${c.id}`}
                        className="btn-ghost text-sm"
                      >
                        Histórico
                      </Link>
                      <Link
                        href={`/receber?cliente=${c.id}`}
                        className="btn-ghost text-sm"
                      >
                        Receber
                      </Link>
                      <button
                        onClick={() => setEditing(c)}
                        className="btn-ghost text-sm"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => toggleActive(c)}
                        className="btn-ghost text-sm"
                      >
                        {c.active ? "Desativar" : "Ativar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
            <h2 className="text-2xl font-bold text-coco-900 mb-4">
              {editing.id ? "Editar cliente" : "Novo cliente"}
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Telefone</label>
                  <input
                    className="input"
                    value={editing.phone ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, phone: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="label">Documento</label>
                  <input
                    className="input"
                    value={editing.document ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, document: e.target.value })
                    }
                  />
                </div>
              </div>
              <div>
                <label className="label">E-mail</label>
                <input
                  className="input"
                  value={editing.email ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, email: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="label">Endereço</label>
                <input
                  className="input"
                  value={editing.address ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, address: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="label">Limite de crédito (fiado)</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  className="input"
                  placeholder="Sem limite"
                  value={editing.credit_limit ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      credit_limit: e.target.value
                        ? parseFloat(e.target.value)
                        : null,
                    })
                  }
                />
                <p className="text-xs text-coco-600 mt-1">
                  Aviso na venda quando o saldo aberto exceder este valor.
                  Deixe vazio para sem limite.
                </p>
              </div>
              <div>
                <label className="label">Observações</label>
                <textarea
                  className="input"
                  rows={3}
                  value={editing.notes ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, notes: e.target.value })
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
