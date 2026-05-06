"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/format";
import type { AuditLog } from "@/lib/types";
import { useTenant } from "@/lib/useTenant";

const TABLES = [
  "sales",
  "sale_payments",
  "expenses",
  "cash_sessions",
  "cash_movements",
  "product_settings",
  "customers",
  "payment_methods",
];

type AuditValue = unknown;
type AuditRow = Record<string, AuditValue> | null;
type DiffEntry = { k: string; before: AuditValue; after: AuditValue };

function diff(before: AuditRow, after: AuditRow): DiffEntry[] {
  if (!before && after) {
    return Object.entries(after).map(([k, v]) => ({
      k,
      before: "—",
      after: v,
    }));
  }
  if (before && !after) {
    return Object.entries(before).map(([k, v]) => ({
      k,
      before: v,
      after: "—",
    }));
  }
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({ k, before: before[k], after: after[k] }));
}

export default function AuditoriaPage() {
  const supabase = createClient();
  const { isAdmin, loading: tenantLoading } = useTenant();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filterTable, setFilterTable] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [emails, setEmails] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    let q = supabase
      .from("audit_log")
      .select("*")
      .order("at", { ascending: false })
      .limit(200);
    if (filterTable) q = q.eq("table_name", filterTable);
    const { data } = await q;
    setLogs((data as AuditLog[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (!tenantLoading && isAdmin) load();
  }, [filterTable, isAdmin, tenantLoading]);

  if (tenantLoading) return <p className="text-coco-700">Carregando…</p>;

  if (!isAdmin) {
    return (
      <div className="card max-w-md">
        <h1 className="text-2xl font-bold text-coco-900 mb-2">
          Acesso restrito
        </h1>
        <p className="text-coco-700">
          Apenas administradores podem ver o log de auditoria.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-coco-900">Auditoria</h1>
        <p className="text-coco-600">
          Histórico de tudo que mudou no sistema (últimas 200 ações).
        </p>
      </header>

      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Tabela</label>
          <select
            value={filterTable}
            onChange={(e) => setFilterTable(e.target.value)}
            className="input"
          >
            <option value="">Todas</option>
            {TABLES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <button onClick={load} className="btn-secondary">
          Atualizar
        </button>
      </div>

      <div className="card">
        {loading ? (
          <p className="text-coco-600">Carregando…</p>
        ) : logs.length === 0 ? (
          <p className="text-coco-600">Sem registros.</p>
        ) : (
          <ul className="divide-y divide-coco-100">
            {logs.map((l) => (
              <li key={l.id} className="py-3 text-sm">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span
                      className={`badge ${
                        l.op === "INSERT"
                          ? "bg-green-100 text-green-800"
                          : l.op === "UPDATE"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {l.op}
                    </span>{" "}
                    <strong>{l.table_name}</strong>
                    {l.row_id && (
                      <span className="text-coco-500 ml-1 text-xs">
                        #{l.row_id.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  <div className="text-coco-500 text-xs">{fmtDate(l.at)}</div>
                </div>
                {l.op === "UPDATE" && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-coco-700 text-xs">
                      ver mudanças
                    </summary>
                    <table className="text-xs mt-2">
                      <thead>
                        <tr className="text-coco-600">
                          <th className="pr-3 text-left">campo</th>
                          <th className="pr-3 text-left">antes</th>
                          <th className="text-left">depois</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diff(l.before_data, l.after_data).map((d, i) => (
                          <tr key={i}>
                            <td className="pr-3">{d.k}</td>
                            <td className="pr-3 text-red-700">
                              {String(d.before)}
                            </td>
                            <td className="text-green-700">{String(d.after)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
                {l.op === "DELETE" && l.before_data && (
                  <pre className="text-xs text-coco-600 mt-1 truncate">
                    {JSON.stringify(l.before_data).slice(0, 200)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
