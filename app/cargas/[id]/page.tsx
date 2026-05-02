"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import type {
  Carga,
  CargaSummary,
  Sale,
  Expense,
  ExpenseCategory,
  CashMovement,
  Vehicle,
  Route,
  AuditLog,
  Customer,
  Membership,
  PaymentMethod,
  ProductSettings,
  Seller,
} from "@/lib/types";
import CargaSummaryCards from "@/components/CargaSummaryCards";
import ConfirmModal from "@/components/ConfirmModal";
import SaleEditor from "@/components/SaleEditor";
import { useToast } from "@/components/Toast";

function nowLocalIso(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return nowLocalIso();
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

type NewSaleForm = {
  seller_id: string;
  customer_id: string;
  quantity: number;
  unit_price: number;
  discount: number;
  notes: string;
  created_at_local: string;
};

const emptyNewSale: NewSaleForm = {
  seller_id: "",
  customer_id: "",
  quantity: 0,
  unit_price: 0,
  discount: 0,
  notes: "",
  created_at_local: "",
};

export default function CargaDetailPage() {
  const supabase = createClient();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const toast = useToast();

  const [carga, setCarga] = useState<Carga | null>(null);
  const [summary, setSummary] = useState<CargaSummary | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [movs, setMovs] = useState<CashMovement[]>([]);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [reopenNotes, setReopenNotes] = useState("");
  const [showReopen, setShowReopen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [operators, setOperators] = useState<Membership[]>([]);

  // Aux data pra os modais de venda/despesa
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [productSettings, setProductSettings] =
    useState<ProductSettings | null>(null);

  // Editor de venda (clica numa linha)
  const [editingSale, setEditingSale] = useState<Sale | null>(null);

  // Modal de nova venda
  const [showNewSale, setShowNewSale] = useState(false);
  const [newSale, setNewSale] = useState<NewSaleForm>(emptyNewSale);
  const [savingSale, setSavingSale] = useState(false);

  // Modal de despesa (nova ou edição)
  const [editingExpense, setEditingExpense] =
    useState<Partial<Expense> | null>(null);
  const [expensePaidAtLocal, setExpensePaidAtLocal] =
    useState<string>(nowLocalIso());
  const [savingExpense, setSavingExpense] = useState(false);

  // Modal de fechamento (admin pode fechar a carga aqui)
  const [showClose, setShowClose] = useState(false);
  const [closeForm, setCloseForm] = useState({
    remaining: "",
    declared: "",
    notes: "",
  });
  const [savingClose, setSavingClose] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    operator_id: "",
    vehicle_id: "",
    route_id: "",
    notes: "",
    closing_notes: "",
    opening_cocos: 0,
    closing_cocos_remaining: 0,
    closing_cash_declared: 0,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function load() {
    const { data: c } = await supabase
      .from("cargas")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    const cur = (c as Carga | null) ?? null;
    setCarga(cur);
    if (!cur) return;
    const [s, e, m, sum, v, r, a] = await Promise.all([
      supabase
        .from("sales")
        .select("*")
        .eq("carga_id", id)
        .order("created_at"),
      supabase
        .from("expenses")
        .select("*")
        .eq("carga_id", id)
        .order("paid_at"),
      supabase
        .from("cash_movements")
        .select("*")
        .eq("carga_id", id)
        .order("created_at"),
      supabase
        .from("carga_summary")
        .select("*")
        .eq("carga_id", id)
        .maybeSingle(),
      cur.vehicle_id
        ? supabase
            .from("vehicles")
            .select("*")
            .eq("id", cur.vehicle_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      cur.route_id
        ? supabase
            .from("routes")
            .select("*")
            .eq("id", cur.route_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("audit_log")
        .select("*")
        .eq("table_name", "cargas")
        .eq("row_id", id)
        .order("at", { ascending: false }),
    ]);
    setSales((s.data as Sale[]) ?? []);
    setExpenses((e.data as Expense[]) ?? []);
    setMovs((m.data as CashMovement[]) ?? []);
    setSummary((sum.data as CargaSummary | null) ?? null);
    setVehicle((v.data as Vehicle | null) ?? null);
    setRoute((r.data as Route | null) ?? null);
    setAudit((a.data as AuditLog[]) ?? []);

    const [vs, rs, cs, sl, pm, cat, ps, ops] = await Promise.all([
      supabase.from("vehicles").select("*").order("plate"),
      supabase.from("routes").select("*").order("name"),
      supabase.from("customers").select("*").order("name"),
      supabase.from("sellers").select("*").order("name"),
      supabase
        .from("payment_methods")
        .select("*")
        .eq("active", true)
        .order("name"),
      supabase
        .from("expense_categories")
        .select("*")
        .order("sort_order")
        .order("name"),
      supabase.from("product_settings").select("*").limit(1).maybeSingle(),
      supabase.from("memberships").select("*").eq("role", "operador"),
    ]);
    setVehicles((vs.data as Vehicle[]) ?? []);
    setRoutes((rs.data as Route[]) ?? []);
    setCustomers((cs.data as Customer[]) ?? []);
    setSellers((sl.data as Seller[]) ?? []);
    setMethods((pm.data as PaymentMethod[]) ?? []);
    setCategories((cat.data as ExpenseCategory[]) ?? []);
    setProductSettings((ps.data as ProductSettings | null) ?? null);
    setOperators((ops.data as Membership[]) ?? []);
  }

  function openEdit() {
    if (!carga) return;
    setEditForm({
      operator_id: carga.operator_id,
      vehicle_id: carga.vehicle_id ?? "",
      route_id: carga.route_id ?? "",
      notes: carga.notes ?? "",
      closing_notes: carga.closing_notes ?? "",
      opening_cocos: carga.opening_cocos,
      closing_cocos_remaining: carga.closing_cocos_remaining ?? 0,
      closing_cash_declared: Number(carga.closing_cash_declared ?? 0),
    });
    setEditing(true);
  }

  async function saveEdit() {
    if (!carga) return;
    if (!editForm.operator_id) {
      toast.error("Selecione um operador.");
      return;
    }
    setSaving(true);
    const hasSales = sales.length > 0;
    const updates: Record<string, unknown> = {
      operator_id: editForm.operator_id,
      vehicle_id: editForm.vehicle_id || null,
      route_id: editForm.route_id || null,
      notes: editForm.notes || null,
      closing_notes: editForm.closing_notes || null,
    };
    // Só permite editar opening_cocos se NÃO houver vendas (caso contrário
    // o estoque calculado fica inconsistente com o histórico).
    if (!hasSales) {
      updates.opening_cocos = editForm.opening_cocos;
    }
    if (carga.status !== "aberta") {
      updates.closing_cocos_remaining = editForm.closing_cocos_remaining;
      updates.closing_cash_declared = editForm.closing_cash_declared;
    }
    const { error } = await supabase
      .from("cargas")
      .update(updates)
      .eq("id", carga.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Carga atualizada.");
    setEditing(false);
    load();
  }

  async function apagarCarga() {
    if (!carga) return;
    setSaving(true);
    const { error } = await supabase.rpc("delete_carga", {
      p_carga_id: carga.id,
    });
    setSaving(false);
    setConfirmDelete(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Carga apagada.");
    router.push("/cargas");
  }

  // ---------- Nova venda na carga (admin) ----------------------
  function openNewSale() {
    if (!carga) return;
    const opSeller = sellers.find((s) => s.user_id === carga.operator_id);
    setNewSale({
      seller_id: opSeller?.id ?? "",
      customer_id: "",
      quantity: 0,
      unit_price: Number(productSettings?.unit_price ?? 0),
      discount: 0,
      notes: "",
      created_at_local: nowLocalIso(),
    });
    setShowNewSale(true);
  }

  async function saveNewSale() {
    if (!carga) return;
    if (!newSale.seller_id) return toast.error("Selecione o vendedor.");
    if (newSale.quantity <= 0) return toast.error("Quantidade inválida.");
    if (newSale.unit_price <= 0)
      return toast.error("Valor unitário inválido.");
    if (!newSale.created_at_local)
      return toast.error("Informe a data da venda.");
    const createdAtIso = new Date(newSale.created_at_local).toISOString();
    if (new Date(createdAtIso).getTime() > Date.now() + 60_000) {
      return toast.error("A data da venda não pode ser no futuro.");
    }
    const subtotal = newSale.quantity * newSale.unit_price;
    const total = Math.max(0, +(subtotal - newSale.discount).toFixed(2));
    setSavingSale(true);
    try {
      const { data, error } = await supabase
        .from("sales")
        .insert({
          carga_id: carga.id,
          seller_id: newSale.seller_id,
          customer_id: newSale.customer_id || null,
          quantity: newSale.quantity,
          unit_price: newSale.unit_price,
          discount: newSale.discount,
          total,
          notes: newSale.notes || null,
          created_at: createdAtIso,
        })
        .select("*")
        .single();
      if (error) throw error;
      toast.success("Venda criada. Lance os pagamentos.");
      setShowNewSale(false);
      await load();
      // Abre o editor pra lançar pagamentos na nova venda.
      setEditingSale(data as Sale);
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setSavingSale(false);
    }
  }

  // ---------- Despesa na carga --------------------------------
  function openNewExpense() {
    setEditingExpense({
      description: "",
      category: "",
      amount: 0,
      notes: "",
      payment_method_id: null,
    });
    setExpensePaidAtLocal(nowLocalIso());
  }

  function openEditExpense(e: Expense) {
    setEditingExpense(e);
    setExpensePaidAtLocal(isoToLocal(e.paid_at));
  }

  async function saveExpense() {
    if (!carga) return;
    if (!editingExpense?.description?.trim())
      return toast.error("Descrição obrigatória.");
    if (!editingExpense.amount || editingExpense.amount <= 0)
      return toast.error("Valor inválido.");
    if (!expensePaidAtLocal) return toast.error("Informe a data da despesa.");
    const paidAtIso = new Date(expensePaidAtLocal).toISOString();
    if (new Date(paidAtIso).getTime() > Date.now() + 60_000)
      return toast.error("A data da despesa não pode ser no futuro.");
    const payload = {
      description: editingExpense.description.trim(),
      category: editingExpense.category || null,
      amount: editingExpense.amount,
      payment_method_id: editingExpense.payment_method_id || null,
      notes: editingExpense.notes || null,
      paid_at: paidAtIso,
      carga_id: carga.id,
    };
    setSavingExpense(true);
    const op = editingExpense.id
      ? supabase.from("expenses").update(payload).eq("id", editingExpense.id)
      : supabase.from("expenses").insert(payload);
    const { error } = await op;
    setSavingExpense(false);
    if (error) return toast.error(error.message);
    toast.success("Despesa salva.");
    setEditingExpense(null);
    load();
  }

  async function deleteExpense() {
    if (!editingExpense?.id) return;
    setSavingExpense(true);
    const { error } = await supabase
      .from("expenses")
      .delete()
      .eq("id", editingExpense.id);
    setSavingExpense(false);
    if (error) return toast.error(error.message);
    toast.success("Despesa apagada.");
    setEditingExpense(null);
    load();
  }

  // ---------- Fechar carga (admin direto na tela) -------------
  function openClose() {
    setCloseForm({ remaining: "", declared: "", notes: "" });
    setShowClose(true);
  }

  async function fecharCarga() {
    if (!carga || !summary) return;
    if (closeForm.remaining === "")
      return toast.error("Informe a sobra de cocos.");
    if (closeForm.declared === "")
      return toast.error("Informe o dinheiro em mão.");
    const remaining = Math.max(
      0,
      parseInt(closeForm.remaining || "0", 10) || 0
    );
    const declared =
      parseFloat((closeForm.declared || "0").replace(",", ".")) || 0;
    setSavingClose(true);
    const { error } = await supabase
      .from("cargas")
      .update({
        status: "fechada",
        closing_cocos_remaining: remaining,
        closing_cash_declared: declared,
        closing_notes: closeForm.notes.trim() || null,
      })
      .eq("id", carga.id);
    setSavingClose(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Carga fechada.");
    setShowClose(false);
    load();
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function conferir() {
    if (!carga) return;
    setSaving(true);
    const { error } = await supabase
      .from("cargas")
      .update({ status: "conferida" })
      .eq("id", carga.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Carga conferida.");
    load();
  }

  async function reabrir() {
    if (!carga) return;
    if (!reopenNotes.trim()) {
      toast.error("Notas obrigatórias para reabertura.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("cargas")
      .update({ status: "aberta", notes: reopenNotes.trim() })
      .eq("id", carga.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Carga reaberta.");
    setShowReopen(false);
    setReopenNotes("");
    load();
  }

  if (!carga || !summary) {
    return <div className="p-6 text-coco-700">Carregando…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link href="/cargas" className="text-coco-700 underline text-sm">
            ← Voltar
          </Link>
          <h1 className="text-3xl font-bold text-coco-900">
            Carga #{carga.code}
          </h1>
          <p className="text-coco-600">
            {fmtDate(carga.opened_at)} ·{" "}
            <span
              className={`badge ${
                carga.status === "aberta"
                  ? "bg-green-100 text-green-800"
                  : carga.status === "fechada"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-coco-100 text-coco-800"
              }`}
            >
              {carga.status}
            </span>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {carga.status === "fechada" && (
            <>
              <Link
                href={`/carga/fechamento/${carga.id}`}
                className="btn-secondary"
              >
                🖨 PDF
              </Link>
              <button
                onClick={conferir}
                disabled={saving}
                className="btn-primary"
              >
                Conferir
              </button>
              <button
                onClick={() => setShowReopen(true)}
                className="btn-ghost"
              >
                Reabrir
              </button>
            </>
          )}
          {carga.status === "conferida" && (
            <>
              <Link
                href={`/carga/fechamento/${carga.id}`}
                className="btn-secondary"
              >
                🖨 PDF
              </Link>
              <button
                onClick={() => setShowReopen(true)}
                className="btn-ghost"
              >
                Reabrir
              </button>
            </>
          )}
          {carga.status === "aberta" && (
            <button onClick={openClose} className="btn-primary">
              🔒 Fechar carga
            </button>
          )}
          <button onClick={openEdit} className="btn-ghost">
            ✏️ Editar
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="btn-ghost text-red-700"
            title="Apagar carga"
          >
            🗑 Apagar
          </button>
        </div>
      </div>

      <div className="card text-sm space-y-1">
        <div>
          <strong>Operador:</strong>{" "}
          {(() => {
            const sl = sellers.find((s) => s.user_id === carga.operator_id);
            return sl ? (
              <span>{sl.name}</span>
            ) : (
              <span className="font-mono text-xs">{carga.operator_id}</span>
            );
          })()}
        </div>
        <div>
          <strong>Veículo:</strong> {vehicle?.plate ?? "—"}{" "}
          {vehicle?.model ? `· ${vehicle.model}` : ""}
        </div>
        <div>
          <strong>Rota:</strong> {route?.name ?? "—"}
        </div>
        {carga.notes && (
          <div>
            <strong>Notas:</strong> {carga.notes}
          </div>
        )}
        {carga.closing_notes && (
          <div>
            <strong>Fechamento:</strong> {carga.closing_notes}
          </div>
        )}
      </div>

      <CargaSummaryCards
        summary={summary}
        closed={carga.status !== "aberta"}
      />

      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-coco-900">
            Vendas ({sales.length})
          </h2>
          {carga.status !== "conferida" && (
            <button onClick={openNewSale} className="btn-secondary text-sm">
              + Nova venda
            </button>
          )}
        </div>
        {sales.length === 0 ? (
          <p className="text-coco-600 text-sm">Sem vendas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th>Vendedor</th>
                  <th>Qtd</th>
                  <th>Total</th>
                  <th>Pago</th>
                  <th>Em aberto</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => {
                  const cust = s.customer_id
                    ? customers.find((c) => c.id === s.customer_id)?.name ??
                      "—"
                    : "Consumidor";
                  const sl = s.seller_id
                    ? sellers.find((x) => x.id === s.seller_id)?.name ?? "—"
                    : "—";
                  const open = s.canceled_at
                    ? 0
                    : Math.max(
                        0,
                        Number(s.total) - Number(s.paid_amount)
                      );
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setEditingSale(s)}
                      className={`cursor-pointer hover:bg-coco-50 ${
                        s.canceled_at ? "opacity-50 line-through" : ""
                      }`}
                    >
                      <td className="text-coco-500">#{s.code}</td>
                      <td>{fmtDate(s.created_at)}</td>
                      <td>{cust}</td>
                      <td>{sl}</td>
                      <td>{s.quantity}</td>
                      <td>{brl(Number(s.total))}</td>
                      <td>{brl(Number(s.paid_amount))}</td>
                      <td
                        className={
                          open > 0 ? "text-amber-700 font-semibold" : ""
                        }
                      >
                        {brl(open)}
                      </td>
                      <td>{s.status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-coco-900">
            Despesas ({expenses.length})
          </h2>
          {carga.status !== "conferida" && (
            <button
              onClick={openNewExpense}
              className="btn-secondary text-sm"
            >
              + Nova despesa
            </button>
          )}
        </div>
        {expenses.length === 0 ? (
          <p className="text-coco-600 text-sm">Sem despesas.</p>
        ) : (
          expenses.map((e) => (
            <div
              key={e.id}
              onClick={() =>
                carga.status !== "conferida" && openEditExpense(e)
              }
              className={`flex justify-between text-sm py-1 border-b border-coco-100 ${
                carga.status !== "conferida"
                  ? "cursor-pointer hover:bg-coco-50"
                  : ""
              }`}
            >
              <span>
                {e.category ?? "—"} · {e.description}
              </span>
              <span className="text-red-700">{brl(Number(e.amount))}</span>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2 className="font-bold text-coco-900 mb-2">Caixa ({movs.length})</h2>
        {movs.length === 0 ? (
          <p className="text-coco-600 text-sm">Sem movimentos.</p>
        ) : (
          movs.map((m) => (
            <div
              key={m.id}
              className="flex justify-between text-sm py-1 border-b border-coco-100"
            >
              <span>
                {m.kind} · {m.notes ?? "—"}
              </span>
              <span
                className={
                  m.kind === "suprimento" ? "text-green-700" : "text-red-700"
                }
              >
                {brl(Number(m.amount))}
              </span>
            </div>
          ))
        )}
      </div>

      <details className="card">
        <summary className="font-bold text-coco-900 cursor-pointer">
          Auditoria desta carga ({audit.length})
        </summary>
        <div className="mt-2 space-y-1 text-xs">
          {audit.length === 0 ? (
            <p className="text-coco-600">Sem registros.</p>
          ) : (
            audit.map((a) => (
              <div key={a.id} className="border-b border-coco-100 py-1">
                <div className="flex justify-between">
                  <span>
                    <strong>{a.op}</strong> ·{" "}
                    <span className="font-mono">
                      {a.user_id?.slice(0, 8) ?? "—"}…
                    </span>
                  </span>
                  <span>{fmtDate(a.at)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </details>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 my-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-coco-900">
                Editar carga #{carga.code}
              </h2>
              <button onClick={() => setEditing(false)} className="btn-ghost">
                Fechar
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Operador *</label>
                <select
                  className="input"
                  value={editForm.operator_id}
                  onChange={(e) =>
                    setEditForm({ ...editForm, operator_id: e.target.value })
                  }
                >
                  {/* Mantém o operador atual selecionável mesmo se ele não
                      estiver mais na lista de memberships ativas. */}
                  {!operators.some(
                    (o) => o.user_id === editForm.operator_id
                  ) &&
                    editForm.operator_id && (
                      <option value={editForm.operator_id}>
                        {(() => {
                          const sl = sellers.find(
                            (s) => s.user_id === editForm.operator_id
                          );
                          return sl
                            ? `${sl.name} (atual)`
                            : `${editForm.operator_id.slice(0, 8)}… (atual)`;
                        })()}
                      </option>
                    )}
                  {operators.map((o) => {
                    const sl = sellers.find((s) => s.user_id === o.user_id);
                    return (
                      <option key={o.user_id} value={o.user_id}>
                        {sl ? sl.name : `${o.user_id.slice(0, 8)}…`} (operador)
                      </option>
                    );
                  })}
                </select>
                {carga.status === "aberta" && (
                  <p className="text-xs text-amber-700 mt-1">
                    Trocar operador numa carga aberta falha se o novo já tiver
                    outra carga aberta.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Veículo</label>
                  <select
                    className="input"
                    value={editForm.vehicle_id}
                    onChange={(e) =>
                      setEditForm({ ...editForm, vehicle_id: e.target.value })
                    }
                  >
                    <option value="">— Sem veículo —</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plate}
                        {v.model ? ` · ${v.model}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Rota</label>
                  <select
                    className="input"
                    value={editForm.route_id}
                    onChange={(e) =>
                      setEditForm({ ...editForm, route_id: e.target.value })
                    }
                  >
                    <option value="">— Sem rota —</option>
                    {routes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Cocos de abertura</label>
                <input
                  type="number"
                  min={0}
                  className="input"
                  value={editForm.opening_cocos}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      opening_cocos: parseInt(e.target.value || "0"),
                    })
                  }
                  disabled={sales.length > 0}
                />
                {sales.length > 0 && (
                  <p className="text-xs text-amber-700 mt-1">
                    Carga já tem vendas — abertura travada para não
                    desencaixar o estoque.
                  </p>
                )}
              </div>

              {carga.status !== "aberta" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Cocos restantes (sobra)</label>
                    <input
                      type="number"
                      min={0}
                      className="input"
                      value={editForm.closing_cocos_remaining}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          closing_cocos_remaining: parseInt(
                            e.target.value || "0"
                          ),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="label">Caixa declarado</label>
                    <input
                      type="number"
                      step="0.01"
                      className="input"
                      value={editForm.closing_cash_declared}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          closing_cash_declared: parseFloat(
                            e.target.value || "0"
                          ),
                        })
                      }
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="label">Notas (abertura)</label>
                <input
                  className="input"
                  value={editForm.notes}
                  onChange={(e) =>
                    setEditForm({ ...editForm, notes: e.target.value })
                  }
                />
              </div>

              {carga.status !== "aberta" && (
                <div>
                  <label className="label">Notas de fechamento</label>
                  <input
                    className="input"
                    value={editForm.closing_notes}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        closing_notes: e.target.value,
                      })
                    }
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setEditing(false)}
                className="btn-ghost"
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="btn-primary"
              >
                {saving ? "…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Apagar esta carga?"
          danger
          confirmText="Apagar"
          message={
            <>
              {sales.length > 0 ? (
                <>
                  Esta carga tem <strong>{sales.length} venda(s)</strong>{" "}
                  vinculada(s). Apague ou desvincule as vendas em{" "}
                  <strong>Relatórios</strong> antes de apagar a carga.
                </>
              ) : (
                <>
                  Vai apagar a carga <strong>#{carga.code}</strong> e seus
                  movimentos automáticos de estoque/caixa. Despesas vinculadas
                  ficam preservadas (sem carga). Não dá pra desfazer.
                </>
              )}
            </>
          }
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => sales.length === 0 && apagarCarga()}
        />
      )}

      {editingSale && (
        <SaleEditor
          sale={editingSale}
          customers={customers}
          onClose={() => setEditingSale(null)}
          onSaved={() => {
            setEditingSale(null);
            load();
          }}
        />
      )}

      {showNewSale && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 my-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-coco-900">
                Nova venda na carga #{carga.code}
              </h2>
              <button
                onClick={() => setShowNewSale(false)}
                className="btn-ghost"
              >
                Fechar
              </button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Vendedor *</label>
                  <select
                    className="input"
                    value={newSale.seller_id}
                    onChange={(e) =>
                      setNewSale({ ...newSale, seller_id: e.target.value })
                    }
                  >
                    <option value="">— Selecione —</option>
                    {sellers
                      .filter((s) => s.active || s.id === newSale.seller_id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.active ? "" : " (inativo)"}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="label">Data *</label>
                  <input
                    type="datetime-local"
                    className="input"
                    value={newSale.created_at_local}
                    onChange={(e) =>
                      setNewSale({
                        ...newSale,
                        created_at_local: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div>
                <label className="label">Cliente</label>
                <select
                  className="input"
                  value={newSale.customer_id}
                  onChange={(e) =>
                    setNewSale({ ...newSale, customer_id: e.target.value })
                  }
                >
                  <option value="">— Consumidor —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Quantidade *</label>
                  <input
                    type="number"
                    min={1}
                    className="input"
                    value={newSale.quantity || ""}
                    onChange={(e) =>
                      setNewSale({
                        ...newSale,
                        quantity: parseInt(e.target.value || "0", 10),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="label">Unitário *</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    value={newSale.unit_price || ""}
                    onChange={(e) =>
                      setNewSale({
                        ...newSale,
                        unit_price: parseFloat(e.target.value || "0"),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="label">Desconto</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    value={newSale.discount || ""}
                    onChange={(e) =>
                      setNewSale({
                        ...newSale,
                        discount: parseFloat(e.target.value || "0"),
                      })
                    }
                  />
                </div>
              </div>
              <div>
                <label className="label">Observação</label>
                <input
                  className="input"
                  value={newSale.notes}
                  onChange={(e) =>
                    setNewSale({ ...newSale, notes: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="card !p-2">
                  <div className="text-coco-700 text-xs">Subtotal</div>
                  <div className="font-bold">
                    {brl(newSale.quantity * newSale.unit_price)}
                  </div>
                </div>
                <div className="card !p-2 bg-coco-600 text-white border-coco-600">
                  <div className="text-coco-100 text-xs">Total</div>
                  <div className="font-bold">
                    {brl(
                      Math.max(
                        0,
                        newSale.quantity * newSale.unit_price -
                          newSale.discount
                      )
                    )}
                  </div>
                </div>
              </div>
              <p className="text-xs text-coco-600">
                A venda é criada em aberto. Os pagamentos podem ser lançados em
                seguida no editor.
              </p>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowNewSale(false)}
                className="btn-ghost"
                disabled={savingSale}
              >
                Cancelar
              </button>
              <button
                onClick={saveNewSale}
                disabled={savingSale}
                className="btn-primary"
              >
                {savingSale ? "…" : "Criar venda"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingExpense && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 my-6">
            <h2 className="text-xl font-bold mb-4">
              {editingExpense.id ? "Editar despesa" : "Nova despesa"} · Carga #
              {carga.code}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="label">Descrição *</label>
                <input
                  className="input"
                  value={editingExpense.description ?? ""}
                  onChange={(ev) =>
                    setEditingExpense({
                      ...editingExpense,
                      description: ev.target.value,
                    })
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
                    value={editingExpense.amount ?? 0}
                    onChange={(ev) =>
                      setEditingExpense({
                        ...editingExpense,
                        amount: parseFloat(ev.target.value || "0"),
                      })
                    }
                  />
                </div>
                <div>
                  <label className="label">Categoria</label>
                  <select
                    className="input"
                    value={editingExpense.category ?? ""}
                    onChange={(ev) =>
                      setEditingExpense({
                        ...editingExpense,
                        category: ev.target.value,
                      })
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
                    {editingExpense.category &&
                      !categories.some(
                        (c) =>
                          c.active && c.name === editingExpense.category
                      ) && (
                        <option value={editingExpense.category}>
                          {editingExpense.category} (inativa)
                        </option>
                      )}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Data *</label>
                  <input
                    type="datetime-local"
                    className="input"
                    value={expensePaidAtLocal}
                    onChange={(ev) => setExpensePaidAtLocal(ev.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Pago em</label>
                  <select
                    className="input"
                    value={editingExpense.payment_method_id ?? ""}
                    onChange={(ev) =>
                      setEditingExpense({
                        ...editingExpense,
                        payment_method_id: ev.target.value || null,
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
              </div>
              <div>
                <label className="label">Observação</label>
                <textarea
                  className="input"
                  rows={2}
                  value={editingExpense.notes ?? ""}
                  onChange={(ev) =>
                    setEditingExpense({
                      ...editingExpense,
                      notes: ev.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div className="flex justify-between gap-2 mt-5">
              {editingExpense.id ? (
                <button
                  onClick={deleteExpense}
                  className="btn-danger"
                  disabled={savingExpense}
                >
                  Apagar
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingExpense(null)}
                  className="btn-ghost"
                  disabled={savingExpense}
                >
                  Cancelar
                </button>
                <button
                  onClick={saveExpense}
                  className="btn-primary"
                  disabled={savingExpense}
                >
                  {savingExpense ? "…" : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showClose && summary && (() => {
        const remainingNum = Math.max(
          0,
          parseInt(closeForm.remaining || "0", 10) || 0
        );
        const declaredNum =
          parseFloat((closeForm.declared || "0").replace(",", ".")) || 0;
        const lossPreview = Math.max(
          0,
          summary.opening_cocos - summary.cocos_vendidos - remainingNum
        );
        const cashDiff = declaredNum - Number(summary.expected_cash);
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 my-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-coco-900">
                  Fechar carga #{carga.code}
                </h2>
                <button
                  onClick={() => setShowClose(false)}
                  className="btn-ghost"
                  disabled={savingClose}
                >
                  Fechar
                </button>
              </div>
              <div className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Sobra de cocos</label>
                    <input
                      className="input text-2xl font-bold text-center"
                      inputMode="numeric"
                      value={closeForm.remaining}
                      onChange={(ev) =>
                        setCloseForm({
                          ...closeForm,
                          remaining: ev.target.value.replace(/[^0-9]/g, ""),
                        })
                      }
                      placeholder="0"
                    />
                    <p className="text-xs text-coco-600 mt-1">
                      Saída: {summary.opening_cocos} · Vendidos:{" "}
                      {summary.cocos_vendidos}
                    </p>
                  </div>
                  <div>
                    <label className="label">Dinheiro em mão (R$)</label>
                    <input
                      className="input text-2xl font-bold text-center"
                      inputMode="decimal"
                      value={closeForm.declared}
                      onChange={(ev) =>
                        setCloseForm({
                          ...closeForm,
                          declared: ev.target.value.replace(/[^0-9.,]/g, ""),
                        })
                      }
                      placeholder="0,00"
                    />
                    <p className="text-xs text-coco-600 mt-1">
                      Esperado: {brl(Number(summary.expected_cash))}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="card !p-3 bg-amber-50 border-amber-200">
                    <div className="text-xs">Perda calculada</div>
                    <div className="text-xl font-bold text-amber-800">
                      {lossPreview} cocos
                    </div>
                  </div>
                  <div
                    className={`card !p-3 ${
                      Math.abs(cashDiff) < 0.01
                        ? "bg-green-50 border-green-200"
                        : cashDiff > 0
                        ? "bg-amber-50 border-amber-200"
                        : "bg-red-50 border-red-200"
                    }`}
                  >
                    <div className="text-xs">Diferença caixa</div>
                    <div className="text-xl font-bold">{brl(cashDiff)}</div>
                  </div>
                </div>

                <div>
                  <label className="label">Observações de fechamento</label>
                  <textarea
                    className="input"
                    rows={2}
                    value={closeForm.notes}
                    onChange={(ev) =>
                      setCloseForm({ ...closeForm, notes: ev.target.value })
                    }
                    placeholder="Ex.: cocos quebraram no caminho…"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button
                  onClick={() => setShowClose(false)}
                  className="btn-ghost"
                  disabled={savingClose}
                >
                  Cancelar
                </button>
                <button
                  onClick={fecharCarga}
                  disabled={
                    savingClose ||
                    closeForm.remaining === "" ||
                    closeForm.declared === ""
                  }
                  className="btn-primary"
                >
                  {savingClose ? "Fechando…" : "Fechar carga →"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showReopen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full">
            <h3 className="font-bold text-lg mb-2">Reabrir carga?</h3>
            <p className="text-sm text-coco-700 mb-3">
              A reabertura reverte os movimentos automáticos de retorno e perda.
              Pode causar saldo de estoque negativo se já houver outras
              movimentações posteriores.
            </p>
            <label className="label">Motivo (obrigatório)</label>
            <textarea
              className="input mb-3"
              rows={3}
              value={reopenNotes}
              onChange={(e) => setReopenNotes(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowReopen(false)}
                className="btn-ghost"
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                onClick={reabrir}
                disabled={saving || !reopenNotes.trim()}
                className="btn-danger"
              >
                {saving ? "…" : "Reabrir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
