"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import { isoToLocal, nowLocalIso } from "@/lib/datetime";
import { downloadCsv, downloadXlsx, rowsToCsv } from "@/lib/export";
import type { Expense, ExpenseCategory, PaymentMethod } from "@/lib/types";
import { useToast } from "@/components/Toast";

type Tab = "todas" | "aberto" | "pagas";

const empty: Partial<Expense> = {
  description: "",
  category: "",
  amount: 0,
  notes: "",
  payment_method_id: null,
  due_date: null,
  doc_number: "",
  is_nf: false,
  payee: "",
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function statusBadge(e: Expense) {
  if (e.status === "paid") {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-800 rounded-full px-2 py-0.5">
        ✓ Paga
      </span>
    );
  }
  const today = todayStr();
  const overdue = e.due_date && e.due_date < today;
  return overdue ? (
    <span className="inline-flex items-center gap-1 text-xs bg-red-100 text-red-800 rounded-full px-2 py-0.5">
      ⚠ Vencida
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs bg-yellow-100 text-yellow-800 rounded-full px-2 py-0.5">
      ⏳ Em Aberto
    </span>
  );
}

export default function DespesasPage() {
  const supabase = createClient();
  const toast = useToast();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [editing, setEditing] = useState<Partial<Expense> | null>(null);
  const [paidAtLocal, setPaidAtLocal] = useState<string>(nowLocalIso());
  const [dueDateStr, setDueDateStr] = useState<string>("");
  const [tab, setTab] = useState<Tab>("todas");

  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  function openNew() {
    setEditing({ ...empty });
    setPaidAtLocal(nowLocalIso());
    setDueDateStr("");
  }

  function openEdit(e: Expense) {
    setEditing(e);
    setPaidAtLocal(e.paid_at ? isoToLocal(e.paid_at) : nowLocalIso());
    setDueDateStr(e.due_date ?? "");
  }

  async function load() {
    const [m, c] = await Promise.all([
      supabase
        .from("payment_methods")
        .select("*")
        .eq("active", true)
        .eq("is_credit", false)
        .order("name"),
      supabase
        .from("expense_categories")
        .select("*")
        .order("sort_order")
        .order("name"),
    ]);
    setMethods((m.data as PaymentMethod[]) ?? []);
    setCategories((c.data as ExpenseCategory[]) ?? []);
    await loadExpenses();
  }

  async function loadExpenses() {
    let q = supabase.from("expenses").select("*");

    if (tab === "aberto") {
      q = q.eq("status", "open").order("due_date", { ascending: true });
    } else if (tab === "pagas") {
      q = q
        .eq("status", "paid")
        .gte("paid_at", new Date(from + "T00:00:00").toISOString())
        .lte("paid_at", new Date(to + "T23:59:59.999").toISOString())
        .order("paid_at", { ascending: false });
    } else {
      // "todas": pagas no período + abertas
      const { data: pagas } = await supabase
        .from("expenses")
        .select("*")
        .eq("status", "paid")
        .gte("paid_at", new Date(from + "T00:00:00").toISOString())
        .lte("paid_at", new Date(to + "T23:59:59.999").toISOString())
        .order("paid_at", { ascending: false });

      const { data: abertas } = await supabase
        .from("expenses")
        .select("*")
        .eq("status", "open")
        .order("due_date", { ascending: true });

      const combined = [
        ...((abertas as Expense[]) ?? []),
        ...((pagas as Expense[]) ?? []),
      ];
      setExpenses(combined);
      return;
    }

    const { data } = await q;
    setExpenses((data as Expense[]) ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    loadExpenses();
  }, [tab, from, to]);

  const total = useMemo(
    () => expenses.reduce((s, e) => s + Number(e.amount), 0),
    [expenses]
  );

  const totalAberto = useMemo(
    () =>
      expenses
        .filter((e) => e.status === "open")
        .reduce((s, e) => s + Number(e.amount), 0),
    [expenses]
  );

  const byCategory = useMemo(() => {
    const map: Record<string, number> = {};
    expenses.forEach((e) => {
      const k = e.category || "Outros";
      map[k] = (map[k] || 0) + Number(e.amount);
    });
    return map;
  }, [expenses]);

  async function save() {
    if (!editing?.description?.trim())
      return toast.error("Descrição obrigatória.");
    if (!editing.amount || editing.amount <= 0)
      return toast.error("Valor inválido.");

    const isFutureDue = dueDateStr && dueDateStr > todayStr();
    const isOpenExpense = isFutureDue;

    let paidAt: string | null = null;
    if (!isOpenExpense) {
      if (!paidAtLocal) return toast.error("Informe a data da despesa.");
      paidAt = new Date(paidAtLocal).toISOString();
    }

    const payload = {
      description: editing.description!.trim(),
      category: editing.category || null,
      amount: editing.amount,
      payment_method_id: editing.payment_method_id || null,
      notes: editing.notes || null,
      due_date: dueDateStr || null,
      status: isOpenExpense ? "open" : "paid",
      paid_at: isOpenExpense ? null : paidAt,
      doc_number: editing.doc_number?.trim() || null,
      is_nf: !!editing.is_nf,
      payee: editing.payee?.trim() || null,
    };

    const op = editing.id
      ? supabase.from("expenses").update(payload).eq("id", editing.id)
      : supabase.from("expenses").insert(payload);
    const { error } = await op;
    if (error) return toast.error(error.message);
    toast.success("Despesa salva.");
    setEditing(null);
    loadExpenses();
  }

  async function markPaid(e: Expense) {
    const { error } = await supabase
      .from("expenses")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", e.id);
    if (error) return toast.error(error.message);
    toast.success("Despesa marcada como paga.");
    loadExpenses();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Despesa apagada.");
    loadExpenses();
  }

  const exportRows = expenses.map((e) => ({
    vencimento: e.due_date ?? "",
    pago_em: e.paid_at ? fmtDate(e.paid_at) : "",
    status: e.status === "paid" ? "Paga" : "Em Aberto",
    descricao: e.description,
    categoria: e.category ?? "",
    valor: Number(e.amount).toFixed(2),
    forma: methods.find((m) => m.id === e.payment_method_id)?.name ?? "",
    doc_numero: e.doc_number ?? "",
    nf: e.is_nf ? "Sim" : "Não",
    favorecido: e.payee ?? "",
    observacao: (e.notes ?? "").replace(/[\n]/g, " "),
  }));

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">Despesas</h1>
          <p className="text-coco-600">
            Custos do negócio e contas a pagar.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() =>
              downloadCsv(
                `despesas_${from}_${to}.csv`,
                rowsToCsv(exportRows)
              )
            }
            disabled={expenses.length === 0}
            className="btn-secondary"
          >
            ⬇ CSV
          </button>
          <button
            onClick={async () => {
              await downloadXlsx(
                `despesas_${from}_${to}.xlsx`,
                "Despesas",
                exportRows
              );
            }}
            disabled={expenses.length === 0}
            className="btn-secondary"
          >
            ⬇ Excel
          </button>
          <button onClick={openNew} className="btn-primary">
            + Nova despesa
          </button>
        </div>
      </header>

      {/* Abas */}
      <div className="flex gap-1 border-b border-coco-200">
        {(
          [
            { key: "todas", label: "Todas" },
            { key: "aberto", label: "Em Aberto" },
            { key: "pagas", label: "Pagas" },
          ] as { key: Tab; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${
              tab === key
                ? "bg-white border border-b-white border-coco-200 text-coco-900 -mb-px"
                : "text-coco-600 hover:text-coco-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filtros de data — só para "todas" e "pagas" */}
      {tab !== "aberto" && (
        <div className="card flex flex-wrap items-end gap-3">
          <div>
            <label className="label">De</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label">Até</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="input"
            />
          </div>
          <div className="ml-auto text-right">
            <div className="text-xs text-coco-700">Total no período</div>
            <div className="text-3xl font-bold text-red-700">{brl(total)}</div>
          </div>
        </div>
      )}

      {/* KPIs da aba Em Aberto */}
      {tab === "aberto" && (
        <div className="card flex flex-wrap gap-4">
          <div>
            <div className="text-xs text-coco-700">Total em aberto</div>
            <div className="text-2xl font-bold text-amber-700">
              {brl(totalAberto)}
            </div>
          </div>
          <div>
            <div className="text-xs text-coco-700">Itens</div>
            <div className="text-2xl font-bold">{expenses.length}</div>
          </div>
          <div>
            <div className="text-xs text-coco-700">Vencidas</div>
            <div className="text-2xl font-bold text-red-700">
              {
                expenses.filter(
                  (e) => e.status === "open" && e.due_date && e.due_date < todayStr()
                ).length
              }
            </div>
          </div>
        </div>
      )}

      {/* Por categoria */}
      {expenses.length > 0 && (
        <div className="card">
          <h2 className="font-bold mb-3">Por categoria</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {Object.entries(byCategory)
              .sort((a, b) => b[1] - a[1])
              .map(([cat, val]) => (
                <div
                  key={cat}
                  className="rounded-xl border border-coco-100 p-3"
                >
                  <div className="text-xs text-coco-700">{cat}</div>
                  <div className="font-bold">{brl(val)}</div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Tabela */}
      <div className="card">
        {expenses.length === 0 ? (
          <p className="text-coco-600">Nenhuma despesa encontrada.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Vencimento</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Doc. / Favorecido</th>
                <th>Status</th>
                <th className="text-right">Valor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => {
                const today = todayStr();
                const overdue =
                  e.status === "open" && e.due_date && e.due_date < today;
                return (
                  <tr
                    key={e.id}
                    className={overdue ? "bg-red-50" : undefined}
                  >
                    <td>
                      {e.due_date
                        ? new Date(e.due_date + "T12:00:00").toLocaleDateString(
                            "pt-BR"
                          )
                        : e.paid_at
                        ? fmtDate(e.paid_at)
                        : "—"}
                    </td>
                    <td>{e.description}</td>
                    <td>{e.category || "—"}</td>
                    <td className="text-xs text-coco-700">
                      {e.doc_number && (
                        <span>
                          {e.is_nf && (
                            <span className="bg-coco-100 text-coco-800 px-1.5 py-0.5 rounded mr-1 font-semibold">
                              NF
                            </span>
                          )}
                          #{e.doc_number}
                        </span>
                      )}
                      {e.doc_number && e.payee && <span> · </span>}
                      {e.payee}
                      {!e.doc_number && !e.payee && "—"}
                    </td>
                    <td>{statusBadge(e)}</td>
                    <td className="text-right font-semibold text-red-700">
                      {brl(Number(e.amount))}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {e.status === "open" && (
                        <button
                          onClick={() => markPaid(e)}
                          className="btn-ghost text-xs text-green-700 mr-1"
                          title="Marcar como paga"
                        >
                          ✓ Pagar
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(e)}
                        className="btn-ghost text-xs"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => remove(e.id)}
                        className="btn-ghost text-xs text-red-700"
                      >
                        🗑
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
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold mb-4">
              {editing.id ? "Editar despesa" : "Nova despesa"}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="label">Descrição *</label>
                <input
                  className="input"
                  value={editing.description ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Valor (R$) *</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    value={editing.amount ?? 0}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        amount: parseFloat(e.target.value || "0"),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="label">Categoria</label>
                  <select
                    className="input"
                    value={editing.category ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, category: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    {categories
                      .filter((c) => c.active)
                      .map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    {editing.category &&
                      !categories.some(
                        (c) => c.active && c.name === editing.category
                      ) && (
                        <option value={editing.category}>
                          {editing.category} (inativa)
                        </option>
                      )}
                  </select>
                  {categories.length === 0 && (
                    <p className="text-xs text-amber-700 mt-1">
                      Nenhuma categoria.{" "}
                      <Link
                        href="/configuracoes/categorias"
                        className="underline"
                      >
                        Cadastrar
                      </Link>
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Data de vencimento</label>
                  <input
                    type="date"
                    className="input"
                    value={dueDateStr}
                    onChange={(e) => setDueDateStr(e.target.value)}
                  />
                  <p className="text-xs text-coco-500 mt-1">
                    Se futuro → Conta a Pagar
                  </p>
                </div>
                <div>
                  <label className="label">
                    {dueDateStr && dueDateStr > todayStr()
                      ? "Data pagamento"
                      : "Data da despesa *"}
                  </label>
                  <input
                    type="datetime-local"
                    className="input"
                    value={paidAtLocal}
                    onChange={(e) => setPaidAtLocal(e.target.value)}
                    disabled={!!(dueDateStr && dueDateStr > todayStr())}
                  />
                  {dueDateStr && dueDateStr > todayStr() && (
                    <p className="text-xs text-amber-700 mt-1">
                      Será preenchido ao pagar.
                    </p>
                  )}
                </div>
              </div>
              <div>
                <label className="label">Forma de pagamento</label>
                <select
                  className="input"
                  value={editing.payment_method_id ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      payment_method_id: e.target.value || null,
                    })
                  }
                >
                  <option value="">—</option>
                  {methods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Nº do documento</label>
                  <input
                    className="input"
                    value={editing.doc_number ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, doc_number: e.target.value })
                    }
                    placeholder="Ex.: 0123 ou NF 4567"
                  />
                </div>
                <div>
                  <label className="label">Favorecido</label>
                  <input
                    className="input"
                    value={editing.payee ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, payee: e.target.value })
                    }
                    placeholder="Ex.: Posto Shell, João da Silva"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!editing.is_nf}
                  onChange={(e) =>
                    setEditing({ ...editing, is_nf: e.target.checked })
                  }
                />
                Documento é Nota Fiscal (NF)
              </label>
              <div>
                <label className="label">Observação</label>
                <textarea
                  className="input"
                  rows={2}
                  value={editing.notes ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, notes: e.target.value })
                  }
                />
              </div>
            </div>
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
