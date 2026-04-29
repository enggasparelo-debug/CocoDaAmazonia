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
  CashMovement,
  Vehicle,
  Route,
  AuditLog,
} from "@/lib/types";
import CargaSummaryCards from "@/components/CargaSummaryCards";
import ConfirmModal from "@/components/ConfirmModal";
import { useToast } from "@/components/Toast";

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
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
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

    const [vs, rs] = await Promise.all([
      supabase.from("vehicles").select("*").order("plate"),
      supabase.from("routes").select("*").order("name"),
    ]);
    setVehicles((vs.data as Vehicle[]) ?? []);
    setRoutes((rs.data as Route[]) ?? []);
  }

  function openEdit() {
    if (!carga) return;
    setEditForm({
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
    setSaving(true);
    const hasSales = sales.length > 0;
    const updates: Record<string, unknown> = {
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
          <span className="font-mono text-xs">{carga.operator_id}</span>
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
        <h2 className="font-bold text-coco-900 mb-2">
          Vendas ({sales.length})
        </h2>
        {sales.length === 0 ? (
          <p className="text-coco-600 text-sm">Sem vendas.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Qtd</th>
                <th>Total</th>
                <th>Pago</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr
                  key={s.id}
                  className={s.canceled_at ? "opacity-50 line-through" : ""}
                >
                  <td>{fmtDate(s.created_at)}</td>
                  <td>{s.quantity}</td>
                  <td>{brl(Number(s.total))}</td>
                  <td>{brl(Number(s.paid_amount))}</td>
                  <td>{s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 className="font-bold text-coco-900 mb-2">
          Despesas ({expenses.length})
        </h2>
        {expenses.length === 0 ? (
          <p className="text-coco-600 text-sm">Sem despesas.</p>
        ) : (
          expenses.map((e) => (
            <div
              key={e.id}
              className="flex justify-between text-sm py-1 border-b border-coco-100"
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
