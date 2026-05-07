"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import type { Carga, InventoryMovement } from "@/lib/types";
import { useToast } from "@/components/Toast";
import ConfirmModal from "@/components/ConfirmModal";

type ManualKind = "entrada" | "perda" | "ajuste";

type RecentAvulsa = {
  id: string;
  code: number;
  quantity: number;
  created_at: string;
};
const MANUAL_KINDS: ManualKind[] = ["entrada", "perda", "ajuste"];

function isManual(k: string): k is ManualKind {
  return (MANUAL_KINDS as string[]).includes(k);
}

type CargaAudit = {
  id: string;
  code: number;
  status: Carga["status"];
  opening_cocos: number;
  closing_cocos_remaining: number | null;
  saida_mov: number;
  retorno_mov: number;
  perda_mov: number;
  vendidos: number;
  expected_perda: number | null; // null pra carga aberta
  diff_saida: number;
  diff_retorno: number;
  diff_perda: number;
  hasDiscrepancy: boolean;
};

type Breakdown = {
  entrada: number;
  ajuste: number;
  perda: number;
  carga_saida: number;
  carga_retorno: number;
  carga_perda: number;
  vendas_avulsas: number;
  vendas_em_carga: number;
};

const ZERO_BREAKDOWN: Breakdown = {
  entrada: 0,
  ajuste: 0,
  perda: 0,
  carga_saida: 0,
  carga_retorno: 0,
  carga_perda: 0,
  vendas_avulsas: 0,
  vendas_em_carga: 0,
};

function nowLocalIso(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function isoToLocal(iso: string): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function EstoquePage() {
  const supabase = createClient();
  const toast = useToast();
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [onHand, setOnHand] = useState<number>(0);
  const [breakdown, setBreakdown] = useState<Breakdown>(ZERO_BREAKDOWN);
  const [recentAvulsas, setRecentAvulsas] = useState<RecentAvulsa[]>([]);
  const [cargaAudits, setCargaAudits] = useState<CargaAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    kind: "entrada" as ManualKind,
    quantity: 0,
    unit_cost: 0,
    notes: "",
  });
  const [editing, setEditing] = useState<InventoryMovement | null>(null);
  const [editForm, setEditForm] = useState({
    quantity: 0,
    unit_cost: 0,
    notes: "",
    created_at: nowLocalIso(),
  });
  const [confirmDelete, setConfirmDelete] = useState<InventoryMovement | null>(
    null
  );

  async function load() {
    setLoading(true);
    // Agregados por tipo (PostgREST aggregate — não trunca em 1000)
    const sumMov = (kind: InventoryMovement["kind"]) =>
      supabase
        .from("inventory_movements")
        .select("quantity.sum()")
        .eq("kind", kind);
    const [
      m,
      b,
      ent,
      aj,
      pe,
      cs,
      cr,
      cp,
      vAv,
      vCa,
      avList,
    ] = await Promise.all([
      supabase
        .from("inventory_movements")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("inventory_balance").select("*").single(),
      sumMov("entrada"),
      sumMov("ajuste"),
      sumMov("perda"),
      sumMov("carga_saida"),
      sumMov("carga_retorno"),
      sumMov("carga_perda"),
      supabase
        .from("sales")
        .select("quantity.sum()")
        .is("canceled_at", null)
        .is("carga_id", null),
      supabase
        .from("sales")
        .select("quantity.sum()")
        .is("canceled_at", null)
        .not("carga_id", "is", null),
      supabase
        .from("sales")
        .select("id,code,quantity,created_at")
        .is("canceled_at", null)
        .is("carga_id", null)
        .order("created_at", { ascending: false })
        .limit(8),
    ]);
    const pick = (q: { data: { sum: number | string }[] | null }) =>
      Number(q.data?.[0]?.sum ?? 0);
    setMovements((m.data as InventoryMovement[]) ?? []);
    setOnHand((b.data as { on_hand: number } | null)?.on_hand ?? 0);
    setBreakdown({
      entrada: pick(ent),
      ajuste: pick(aj),
      perda: pick(pe),
      carga_saida: pick(cs),
      carga_retorno: pick(cr),
      carga_perda: pick(cp),
      vendas_avulsas: pick(vAv),
      vendas_em_carga: pick(vCa),
    });
    setRecentAvulsas(
      (avList.data as RecentAvulsa[] | null) ?? []
    );

    // Auditoria por carga: pega últimas 30 cargas e cruza movimentos
    // de inventário com vendas dela e os campos da carga.
    const cargasQ = await supabase
      .from("cargas")
      .select(
        "id,code,status,opening_cocos,closing_cocos_remaining"
      )
      .order("opened_at", { ascending: false })
      .limit(30);
    const cargas = (cargasQ.data as Carga[]) ?? [];
    const cargaIds = cargas.map((c) => c.id);
    let movByCarga: Record<
      string,
      { saida: number; retorno: number; perda: number }
    > = {};
    let salesByCarga: Record<string, number> = {};
    if (cargaIds.length > 0) {
      const [mvQ, slQ] = await Promise.all([
        supabase
          .from("inventory_movements")
          .select("carga_id,kind,quantity")
          .in("carga_id", cargaIds),
        supabase
          .from("sales")
          .select("carga_id,quantity")
          .in("carga_id", cargaIds)
          .is("canceled_at", null),
      ]);
      type MvRow = {
        carga_id: string;
        kind: InventoryMovement["kind"];
        quantity: number | string;
      };
      type SaleRow = { carga_id: string; quantity: number | string };
      for (const m of (mvQ.data as MvRow[] | null) ?? []) {
        const id = m.carga_id;
        if (!movByCarga[id])
          movByCarga[id] = { saida: 0, retorno: 0, perda: 0 };
        if (m.kind === "carga_saida")
          movByCarga[id].saida += Number(m.quantity);
        else if (m.kind === "carga_retorno")
          movByCarga[id].retorno += Number(m.quantity);
        else if (m.kind === "carga_perda")
          movByCarga[id].perda += Number(m.quantity);
      }
      for (const s of (slQ.data as SaleRow[] | null) ?? []) {
        const id = s.carga_id;
        salesByCarga[id] = (salesByCarga[id] ?? 0) + Number(s.quantity);
      }
    }
    const audits: CargaAudit[] = cargas.map((c) => {
      const mv = movByCarga[c.id] ?? { saida: 0, retorno: 0, perda: 0 };
      const vendidos = salesByCarga[c.id] ?? 0;
      const opening = c.opening_cocos ?? 0;
      const sobra = c.closing_cocos_remaining ?? 0;
      const isClosed = c.status !== "aberta";
      const expected_perda = isClosed
        ? Math.max(0, opening - vendidos - sobra)
        : null;
      const diff_saida = mv.saida - opening;
      const diff_retorno = isClosed ? mv.retorno - sobra : 0;
      const diff_perda =
        isClosed && expected_perda !== null
          ? mv.perda - expected_perda
          : 0;
      const hasDiscrepancy =
        diff_saida !== 0 || diff_retorno !== 0 || diff_perda !== 0;
      return {
        id: c.id,
        code: c.code,
        status: c.status,
        opening_cocos: opening,
        closing_cocos_remaining: c.closing_cocos_remaining,
        saida_mov: mv.saida,
        retorno_mov: mv.retorno,
        perda_mov: mv.perda,
        vendidos,
        expected_perda,
        diff_saida,
        diff_retorno,
        diff_perda,
        hasDiscrepancy,
      };
    });
    setCargaAudits(audits);

    setLoading(false);
  }

  const conferido = useMemo(() => {
    const b = breakdown;
    return (
      b.entrada +
      b.ajuste +
      b.carga_retorno -
      b.perda -
      b.carga_saida -
      b.carga_perda -
      b.vendas_avulsas
    );
  }, [breakdown]);
  const diff = conferido - onHand;

  useEffect(() => {
    load();
  }, []);

  const totalCost = useMemo(() => {
    return movements
      .filter((m) => m.kind === "entrada" && m.unit_cost)
      .reduce((s, m) => s + m.quantity * Number(m.unit_cost), 0);
  }, [movements]);

  async function save() {
    if (form.quantity <= 0) return toast.error("Quantidade deve ser positiva.");
    const { error } = await supabase.from("inventory_movements").insert({
      kind: form.kind,
      quantity: form.quantity,
      unit_cost:
        form.kind === "entrada" && form.unit_cost > 0 ? form.unit_cost : null,
      notes: form.notes || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Movimento registrado.");
    setForm({ kind: "entrada", quantity: 0, unit_cost: 0, notes: "" });
    load();
  }

  function openEdit(m: InventoryMovement) {
    setEditing(m);
    setEditForm({
      quantity: m.quantity,
      unit_cost: Number(m.unit_cost ?? 0),
      notes: m.notes ?? "",
      created_at: isoToLocal(m.created_at),
    });
  }

  async function saveEdit() {
    if (!editing) return;
    if (editForm.quantity <= 0)
      return toast.error("Quantidade deve ser positiva.");
    const { error } = await supabase
      .from("inventory_movements")
      .update({
        quantity: editForm.quantity,
        unit_cost:
          editing.kind === "entrada" && editForm.unit_cost > 0
            ? editForm.unit_cost
            : null,
        notes: editForm.notes || null,
        created_at: new Date(editForm.created_at).toISOString(),
      })
      .eq("id", editing.id);
    if (error) return toast.error(error.message);
    toast.success("Movimento atualizado.");
    setEditing(null);
    load();
  }

  async function deleteMovement(m: InventoryMovement) {
    const { error } = await supabase
      .from("inventory_movements")
      .delete()
      .eq("id", m.id);
    setConfirmDelete(null);
    if (error) return toast.error(error.message);
    toast.success("Movimento apagado.");
    load();
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-coco-900">Estoque</h1>
        <p className="text-coco-600">
          Controle de cocos. Vendas (não canceladas) baixam automaticamente.
        </p>
      </header>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card bg-coco-600 text-white border-coco-600">
          <div className="text-coco-100 text-xs uppercase">Saldo atual</div>
          <div className="text-4xl font-extrabold">{onHand}</div>
          <div className="text-coco-200 text-xs mt-1">cocos disponíveis</div>
        </div>
        <div className="card">
          <div className="text-coco-700 text-xs uppercase">
            Custo total das entradas
          </div>
          <div className="text-2xl font-bold">{brl(totalCost)}</div>
        </div>
        <div className="card">
          <div className="text-coco-700 text-xs uppercase">Movimentos</div>
          <div className="text-2xl font-bold">{movements.length}</div>
        </div>
      </div>

      <div className="card">
        <h2 className="font-bold text-coco-900 mb-3">
          Conferência do saldo
        </h2>
        <p className="text-xs text-coco-600 mb-3">
          Cada linha vem direto do banco. Vendas dentro de carga não aparecem
          aqui porque já saíram quando o <code>carga_saida</code> registrou.
        </p>
        <div className="text-sm">
          <ConfRow
            label="Entradas (compras)"
            sign="+"
            value={breakdown.entrada}
          />
          <ConfRow
            label="Ajustes manuais"
            sign="+"
            value={breakdown.ajuste}
          />
          <ConfRow
            label="Retornos de carga"
            sign="+"
            value={breakdown.carga_retorno}
          />
          <ConfRow
            label="Perdas manuais"
            sign="−"
            value={breakdown.perda}
            negative
          />
          <ConfRow
            label="Saídas para cargas"
            sign="−"
            value={breakdown.carga_saida}
            negative
          />
          <ConfRow
            label="Perdas em carga"
            sign="−"
            value={breakdown.carga_perda}
            negative
          />
          <ConfRow
            label="Vendas avulsas (sem carga)"
            sign="−"
            value={breakdown.vendas_avulsas}
            negative
          />
          <div className="border-t border-coco-200 mt-2 pt-2 flex items-center justify-between font-bold">
            <span>Saldo conferido</span>
            <span>{conferido}</span>
          </div>
          <div className="flex items-center justify-between text-coco-700">
            <span>Saldo atual da view (inventory_balance)</span>
            <span>{onHand}</span>
          </div>
          <div
            className={`mt-2 p-2 rounded-lg text-sm font-semibold ${
              diff === 0
                ? "bg-green-50 text-green-800 border border-green-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {diff === 0
              ? "✓ Conta fecha — saldo da view bate com a soma manual."
              : `⚠ Diferença de ${diff} cocos entre a view e a soma manual.`}
          </div>
          <div className="text-xs text-coco-600 mt-3">
            Vendas dentro de carga (informativo, não entram no saldo):{" "}
            <strong>{breakdown.vendas_em_carga}</strong> cocos vendidos via
            cargas até hoje.
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="font-bold text-coco-900 mb-2">
          Auditoria por carga
        </h2>
        <p className="text-xs text-coco-600 mb-3">
          Compara movimentos do estoque (carga_saida / retorno / perda)
          com os campos atuais da carga e a soma das vendas. Cargas em
          vermelho têm valores que dessincronizaram (ex.: edição de
          opening_cocos depois da abertura, edição de venda em carga
          fechada). Pra consertar, abra a carga e clique em{" "}
          <strong>🔄 Recalcular movimentos</strong>. Mostra as 30 mais
          recentes.
        </p>
        {cargaAudits.length === 0 ? (
          <p className="text-coco-600 text-sm">Sem cargas registradas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table text-xs">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Status</th>
                  <th className="text-right">Saída</th>
                  <th className="text-right">vs Opening</th>
                  <th className="text-right">Retorno</th>
                  <th className="text-right">vs Sobra</th>
                  <th className="text-right">Vendidos</th>
                  <th className="text-right">Perda</th>
                  <th className="text-right">Esperada</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cargaAudits.map((a) => {
                  const cellRed = "text-red-700 font-semibold";
                  return (
                    <tr
                      key={a.id}
                      className={
                        a.hasDiscrepancy ? "bg-red-50" : ""
                      }
                    >
                      <td>
                        <Link
                          href={`/cargas/${a.id}`}
                          className="text-coco-700 underline"
                        >
                          #{a.code}
                        </Link>
                      </td>
                      <td>{a.status}</td>
                      <td className="text-right">
                        {a.saida_mov} / {a.opening_cocos}
                      </td>
                      <td
                        className={`text-right ${
                          a.diff_saida !== 0 ? cellRed : ""
                        }`}
                      >
                        {a.diff_saida === 0 ? "✓" : a.diff_saida > 0 ? `+${a.diff_saida}` : a.diff_saida}
                      </td>
                      <td className="text-right">
                        {a.status === "aberta"
                          ? "—"
                          : `${a.retorno_mov} / ${
                              a.closing_cocos_remaining ?? "—"
                            }`}
                      </td>
                      <td
                        className={`text-right ${
                          a.diff_retorno !== 0 ? cellRed : ""
                        }`}
                      >
                        {a.status === "aberta"
                          ? "—"
                          : a.diff_retorno === 0
                          ? "✓"
                          : a.diff_retorno > 0
                          ? `+${a.diff_retorno}`
                          : a.diff_retorno}
                      </td>
                      <td className="text-right">{a.vendidos}</td>
                      <td className="text-right">
                        {a.status === "aberta" ? "—" : a.perda_mov}
                      </td>
                      <td
                        className={`text-right ${
                          a.diff_perda !== 0 ? cellRed : ""
                        }`}
                      >
                        {a.status === "aberta"
                          ? "—"
                          : a.expected_perda ?? "—"}
                        {a.status !== "aberta" && a.diff_perda !== 0 && (
                          <span className="ml-1 text-xs">
                            ({a.diff_perda > 0 ? "+" : ""}
                            {a.diff_perda})
                          </span>
                        )}
                      </td>
                      <td className="text-right">
                        {a.hasDiscrepancy ? "⚠" : "✓"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 text-xs text-coco-600 space-y-1">
          <p>
            <strong>Saída vs Opening</strong>: o movimento{" "}
            <code>carga_saida</code> deve ser igual a{" "}
            <code>opening_cocos</code>. Diferença geralmente vem de
            edição de <code>opening_cocos</code> depois da abertura.
          </p>
          <p>
            <strong>Retorno vs Sobra</strong>: o movimento{" "}
            <code>carga_retorno</code> deve ser igual a{" "}
            <code>closing_cocos_remaining</code>. Diferença vem de
            edição da sobra na carga fechada.
          </p>
          <p>
            <strong>Esperada</strong>:{" "}
            <code>opening − vendidos − sobra</code>. Se{" "}
            <code>carga_perda</code> ≠ esperada, é porque vendas foram
            editadas/canceladas após o fechamento.
          </p>
        </div>
      </div>

      {recentAvulsas.length > 0 && (
        <div className="card">
          <h2 className="font-bold text-coco-900 mb-2">
            Últimas vendas avulsas (sem carga)
          </h2>
          <p className="text-xs text-coco-600 mb-2">
            Estas reduzem o saldo direto. Total acumulado:{" "}
            <strong>{breakdown.vendas_avulsas} cocos</strong>.
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Data</th>
                <th className="text-right">Qtd</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recentAvulsas.map((s) => (
                <tr key={s.id}>
                  <td className="text-coco-500">#{s.code}</td>
                  <td>{fmtDate(s.created_at)}</td>
                  <td className="text-right font-semibold">{s.quantity}</td>
                  <td className="text-right">
                    <Link
                      href="/relatorios"
                      className="text-coco-700 underline text-xs"
                    >
                      ver em relatórios
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2 className="font-bold mb-3">Novo movimento</h2>
        <div className="grid sm:grid-cols-4 gap-3">
          <div>
            <label className="label">Tipo</label>
            <select
              className="input"
              value={form.kind}
              onChange={(e) =>
                setForm({
                  ...form,
                  kind: e.target.value as ManualKind,
                })
              }
            >
              <option value="entrada">Entrada (compra)</option>
              <option value="perda">Perda</option>
              <option value="ajuste">Ajuste manual</option>
            </select>
          </div>
          <div>
            <label className="label">Quantidade</label>
            <input
              type="number"
              min={1}
              className="input"
              value={form.quantity}
              onChange={(e) =>
                setForm({ ...form, quantity: parseInt(e.target.value || "0") })
              }
            />
          </div>
          {form.kind === "entrada" && (
            <div>
              <label className="label">Custo unitário (R$)</label>
              <input
                type="number"
                step="0.01"
                className="input"
                value={form.unit_cost}
                onChange={(e) =>
                  setForm({
                    ...form,
                    unit_cost: parseFloat(e.target.value || "0"),
                  })
                }
              />
            </div>
          )}
          <div className={form.kind === "entrada" ? "" : "sm:col-span-2"}>
            <label className="label">Observação</label>
            <input
              className="input"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Ex.: nota fiscal #123"
            />
          </div>
        </div>
        <button onClick={save} className="btn-primary mt-3">
          Registrar movimento
        </button>
      </div>

      <div className="card">
        <h2 className="font-bold mb-3">Últimos movimentos</h2>
        {loading ? (
          <p className="text-coco-600">Carregando…</p>
        ) : movements.length === 0 ? (
          <p className="text-coco-600">Sem movimentos ainda.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th className="text-right">Qtd</th>
                <th className="text-right">Custo unit.</th>
                <th>Observação</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const manual = isManual(m.kind);
                return (
                  <tr key={m.id}>
                    <td>{fmtDate(m.created_at)}</td>
                    <td>
                      <span
                        className={`badge ${
                          m.kind === "entrada"
                            ? "bg-green-100 text-green-800"
                            : m.kind === "perda"
                            ? "bg-red-100 text-red-800"
                            : "bg-gray-200 text-gray-700"
                        }`}
                      >
                        {m.kind}
                      </span>
                    </td>
                    <td className="text-right font-semibold">{m.quantity}</td>
                    <td className="text-right">
                      {m.unit_cost ? brl(Number(m.unit_cost)) : "—"}
                    </td>
                    <td className="text-coco-700 text-xs">{m.notes ?? ""}</td>
                    <td className="text-right whitespace-nowrap">
                      {manual ? (
                        <>
                          <button
                            onClick={() => openEdit(m)}
                            className="btn-ghost text-xs px-2"
                            title="Editar"
                            aria-label="Editar movimento"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => setConfirmDelete(m)}
                            className="btn-ghost text-xs px-2 text-red-700"
                            title="Apagar"
                            aria-label="Apagar movimento"
                          >
                            🗑
                          </button>
                        </>
                      ) : (
                        <span
                          className="text-xs text-coco-500"
                          title="Movimento gerado automaticamente pelo fechamento da carga. Edite/cancele a carga em vez disso."
                        >
                          🔒
                        </span>
                      )}
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
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-coco-900">
                Editar movimento
              </h2>
              <button onClick={() => setEditing(null)} className="btn-ghost">
                Fechar
              </button>
            </div>
            <p className="text-xs text-coco-600 mb-3">
              Tipo: <strong>{editing.kind}</strong> (não pode ser alterado)
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Data</label>
                  <input
                    type="datetime-local"
                    className="input"
                    value={editForm.created_at}
                    onChange={(e) =>
                      setEditForm({ ...editForm, created_at: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="label">Quantidade</label>
                  <input
                    type="number"
                    min={1}
                    className="input"
                    value={editForm.quantity}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        quantity: parseInt(e.target.value || "0"),
                      })
                    }
                  />
                </div>
              </div>
              {editing.kind === "entrada" && (
                <div>
                  <label className="label">Custo unitário (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    value={editForm.unit_cost}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        unit_cost: parseFloat(e.target.value || "0"),
                      })
                    }
                  />
                </div>
              )}
              <div>
                <label className="label">Observação</label>
                <input
                  className="input"
                  value={editForm.notes}
                  onChange={(e) =>
                    setEditForm({ ...editForm, notes: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="btn-ghost">
                Cancelar
              </button>
              <button onClick={saveEdit} className="btn-primary">
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Apagar movimento?"
          danger
          confirmText="Apagar"
          message={
            <>
              Vai apagar o movimento de <strong>{confirmDelete.kind}</strong> de{" "}
              <strong>{confirmDelete.quantity}</strong> cocos em{" "}
              {fmtDate(confirmDelete.created_at)}. O saldo do estoque é
              recalculado automaticamente.
            </>
          }
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => deleteMovement(confirmDelete)}
        />
      )}
    </div>
  );
}

function ConfRow({
  label,
  sign,
  value,
  negative,
}: {
  label: string;
  sign: "+" | "−";
  value: number;
  negative?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-coco-50 last:border-b-0">
      <span className="text-coco-700">
        <span
          className={`inline-block w-4 text-center font-bold mr-1 ${
            negative ? "text-red-700" : "text-green-700"
          }`}
        >
          {sign}
        </span>
        {label}
      </span>
      <span
        className={`font-semibold ${
          negative ? "text-red-700" : "text-green-700"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
