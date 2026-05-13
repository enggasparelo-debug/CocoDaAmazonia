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
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);

  function toggleId(id: string) {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkDeactivate() {
    if (selectedIds.size === 0) return;
    setBulkRunning(true);
    const ids = Array.from(selectedIds);
    const { error } = await supabase
      .from("customers")
      .update({ active: false })
      .in("id", ids);
    setBulkRunning(false);
    setBulkConfirm(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSelectedIds(new Set());
    load();
  }

  async function load() {
    setLoading(true);
    const [c, b] = await Promise.all([
      supabase.from("customers").select("*").order("name").limit(2000),
      supabase.from("customer_balances").select("*").limit(2000),
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

  const summary = useMemo(() => {
    const now = Date.now();
    let totalOpen = 0;
    let totalOverdue = 0;
    let customersWithBalance = 0;

    Object.values(balances).forEach((b) => {
      const open = Number(b.open_balance ?? 0);
      if (open <= 0) return;
      totalOpen += open;
      customersWithBalance++;
      if (b.oldest_open_at) {
        const days = Math.floor(
          (now - new Date(b.oldest_open_at).getTime()) / 86400000
        );
        if (days > 30) totalOverdue += open;
      }
    });

    return { totalOpen, totalOverdue, customersWithBalance };
  }, [balances]);

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
    setSaving(true);
    const op = editing.id
      ? supabase.from("customers").update(payload).eq("id", editing.id)
      : supabase.from("customers").insert(payload);
    const { error } = await op;
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setEditing(null);
    load();
  }

  async function toggleActive(c: Customer) {
    if (togglingId) return;
    setTogglingId(c.id);
    await supabase
      .from("customers")
      .update({ active: !c.active })
      .eq("id", c.id);
    setTogglingId(null);
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

      {/* Summary Cards */}
      {!loading && summary.customersWithBalance > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card border-l-4 border-amber-400 bg-amber-50 flex items-center gap-4 py-4">
            <div className="text-3xl">📊</div>
            <div>
              <div className="text-xs text-amber-700 uppercase tracking-wide font-semibold">
                Saldo Total em Aberto
              </div>
              <div className="text-2xl font-bold text-amber-900">
                {brl(summary.totalOpen)}
              </div>
              <div className="text-xs text-amber-600 mt-0.5">
                {summary.customersWithBalance} cliente(s) com saldo
              </div>
            </div>
          </div>
          <div className="card border-l-4 border-red-400 bg-red-50 flex items-center gap-4 py-4">
            <div className="text-3xl">⚠️</div>
            <div>
              <div className="text-xs text-red-700 uppercase tracking-wide font-semibold">
                Valor Vencido (+30 dias)
              </div>
              <div className="text-2xl font-bold text-red-900">
                {brl(summary.totalOverdue)}
              </div>
              <div className="text-xs text-red-600 mt-0.5">
                {summary.totalOpen > 0
                  ? `${((summary.totalOverdue / summary.totalOpen) * 100).toFixed(0)}% do total em aberto`
                  : "—"}
              </div>
            </div>
          </div>
          <div className="card border-l-4 border-coco-400 bg-coco-50 flex items-center gap-4 py-4">
            <div className="text-3xl">👥</div>
            <div>
              <div className="text-xs text-coco-700 uppercase tracking-wide font-semibold">
                Clientes Inadimplentes
              </div>
              <div className="text-2xl font-bold text-coco-900">
                {summary.customersWithBalance}
              </div>
              <div className="text-xs text-coco-600 mt-0.5">
                <Link href="/receber" className="underline hover:text-coco-800">
                  Ver contas a receber →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

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
          <div className="text-center py-8 space-y-3">
            <div className="text-5xl" aria-hidden="true">
              👤
            </div>
            <p className="text-coco-700 font-medium">
              {search.trim()
                ? "Nenhum cliente bate com a busca."
                : "Nenhum cliente cadastrado ainda."}
            </p>
            {!search.trim() && (
              <button
                className="btn-primary"
                onClick={() => setEditing({ ...empty })}
              >
                + Cadastrar primeiro cliente
              </button>
            )}
          </div>
        ) : (
          <>
            {selectedIds.size > 0 && (
              <div className="mb-3 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm">
                <span className="font-medium text-amber-900">
                  {selectedIds.size} selecionado(s)
                </span>
                <button
                  onClick={() => setBulkConfirm(true)}
                  className="btn-ghost text-red-700 text-sm"
                  disabled={bulkRunning}
                >
                  Desativar selecionados
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-coco-700 underline text-xs ml-auto"
                >
                  limpar seleção
                </button>
              </div>
            )}
            {bulkConfirm && (
              <div className="mb-3 card border-red-300 bg-red-50">
                <p className="text-red-800 font-medium mb-2">
                  Desativar {selectedIds.size} cliente(s)?
                </p>
                <p className="text-red-700 text-sm mb-3">
                  Eles ficarão inativos (não somem do histórico). Você pode
                  reativar depois.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={bulkDeactivate}
                    disabled={bulkRunning}
                    className="btn-primary !bg-red-600 hover:!bg-red-700"
                  >
                    {bulkRunning ? "Desativando…" : "Confirmar"}
                  </button>
                  <button
                    onClick={() => setBulkConfirm(false)}
                    className="btn-ghost"
                    disabled={bulkRunning}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={
                        filtered.length > 0 &&
                        selectedIds.size === filtered.length
                      }
                      onChange={() => {
                        if (
                          selectedIds.size === filtered.length &&
                          filtered.length > 0
                        ) {
                          setSelectedIds(new Set());
                        } else {
                          setSelectedIds(new Set(filtered.map((c) => c.id)));
                        }
                      }}
                      aria-label="Selecionar todos os clientes"
                    />
                  </th>
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
                  const bal = balances[c.id];
                  const openBal = Number(bal?.open_balance ?? 0);
                  const daysOldest = bal?.oldest_open_at
                    ? Math.floor(
                        (Date.now() -
                          new Date(bal.oldest_open_at).getTime()) /
                          86400000
                      )
                    : 0;
                  const isOverdue = openBal > 0 && daysOldest > 30;
                  return (
                    <tr key={c.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(c.id)}
                          onChange={() => toggleId(c.id)}
                          aria-label={`Selecionar ${c.name}`}
                        />
                      </td>
                      <td className="font-medium">
                        <Link
                          href={`/clientes/${c.id}`}
                          className="text-coco-800 hover:underline"
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td>{c.phone ?? "—"}</td>
                      <td>{c.document ?? "—"}</td>
                      <td>
                        {openBal > 0 ? (
                          <span
                            className={`font-semibold ${
                              isOverdue ? "text-red-700" : "text-amber-700"
                            }`}
                          >
                            {brl(openBal)}
                            {isOverdue && (
                              <span className="ml-1 text-xs text-red-500">
                                ⚠ {daysOldest}d
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-green-700">{brl(0)}</span>
                        )}
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
                        {openBal > 0 && (
                          <Link
                            href={`/receber?cliente=${c.id}`}
                            className="btn-ghost text-sm text-amber-700"
                          >
                            Ver Contas
                          </Link>
                        )}
                        <button
                          onClick={() => setEditing(c)}
                          className="btn-ghost text-sm"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => toggleActive(c)}
                          disabled={togglingId === c.id}
                          className="btn-ghost text-sm"
                        >
                          {togglingId === c.id
                            ? "…"
                            : c.active
                            ? "Desativar"
                            : "Ativar"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
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
                  Aviso na venda quando o saldo aberto exceder este valor. Deixe
                  vazio para sem limite.
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

            {error && <p className="text-red-700 text-sm mt-3">{error}</p>}

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setEditing(null)}
                className="btn-ghost"
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                onClick={save}
                className="btn-primary"
                disabled={saving}
              >
                {saving ? "…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
