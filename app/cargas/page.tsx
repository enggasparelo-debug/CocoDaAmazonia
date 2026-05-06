"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import type {
  Carga,
  CargaStatus,
  CargaSummary,
  Vehicle,
} from "@/lib/types";

type Row = Carga & {
  total_vendido?: number;
  total_fiado?: number;
  cocos_vendidos?: number;
};

export default function CargasListPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [vehicles, setVehicles] = useState<Record<string, Vehicle>>({});
  const [status, setStatus] = useState<CargaStatus | "">("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    let q = supabase
      .from("cargas")
      .select("*")
      .order("opened_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data: cs } = await q;
    const cargas = (cs as Carga[]) ?? [];

    const ids = cargas.map((c) => c.id);
    const summaries: Record<string, CargaSummary> = {};
    if (ids.length > 0) {
      const { data: ss } = await supabase
        .from("carga_summary")
        .select("*")
        .in("carga_id", ids);
      ((ss as CargaSummary[]) ?? []).forEach((s) => {
        summaries[s.carga_id] = s;
      });
    }

    const merged: Row[] = cargas.map((c) => ({
      ...c,
      total_vendido: Number(summaries[c.id]?.total_vendido ?? 0),
      total_fiado: Number(summaries[c.id]?.total_fiado ?? 0),
      cocos_vendidos: Number(summaries[c.id]?.cocos_vendidos ?? 0),
    }));
    setRows(merged);

    const { data: vs } = await supabase.from("vehicles").select("*");
    const vmap: Record<string, Vehicle> = {};
    ((vs as Vehicle[]) ?? []).forEach((v) => (vmap[v.id] = v));
    setVehicles(vmap);

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        total: acc.total + (r.total_vendido ?? 0),
        fiado: acc.fiado + (r.total_fiado ?? 0),
        cocos: acc.cocos + (r.cocos_vendidos ?? 0),
      }),
      { total: 0, fiado: 0, cocos: 0 }
    );
  }, [rows]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-coco-900">Cargas</h1>
          <p className="text-coco-600">
            Vendas em rota por operador. Conferência ao final.
          </p>
        </div>
        <Link href="/carga/abrir" className="btn-primary">
          + Abrir carga
        </Link>
      </header>

      <div className="card flex items-center gap-3 flex-wrap">
        <label className="text-sm text-coco-700">Status:</label>
        <select
          className="input max-w-xs"
          value={status}
          onChange={(e) => setStatus(e.target.value as CargaStatus | "")}
        >
          <option value="">Todos</option>
          <option value="aberta">Abertas</option>
          <option value="fechada">Fechadas (a conferir)</option>
          <option value="conferida">Conferidas</option>
        </select>
        <div className="ml-auto text-sm text-coco-700">
          {rows.length} cargas · {totals.cocos} cocos · vendido{" "}
          <strong>{brl(totals.total)}</strong> · fiado{" "}
          <strong className="text-amber-700">{brl(totals.fiado)}</strong>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <p className="text-coco-600">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="text-coco-600">Sem cargas.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Aberta em</th>
                <th>Operador</th>
                <th>Veículo</th>
                <th>Cocos</th>
                <th>Vendido</th>
                <th>Fiado</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono font-semibold">#{c.code}</td>
                  <td>{fmtDate(c.opened_at)}</td>
                  <td className="font-mono text-xs">
                    {c.operator_id.slice(0, 8)}…
                  </td>
                  <td>
                    {c.vehicle_id ? vehicles[c.vehicle_id]?.plate ?? "—" : "—"}
                  </td>
                  <td>
                    {c.cocos_vendidos ?? 0} / {c.opening_cocos}
                  </td>
                  <td>{brl(c.total_vendido ?? 0)}</td>
                  <td className="text-amber-700">
                    {brl(c.total_fiado ?? 0)}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        c.status === "aberta"
                          ? "bg-green-100 text-green-800"
                          : c.status === "fechada"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-coco-100 text-coco-800"
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="text-right">
                    <Link
                      href={`/cargas/${c.id}`}
                      className="btn-ghost text-sm"
                    >
                      Detalhe
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
