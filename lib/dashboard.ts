// Helpers puros para o painel. Mantidos fora do componente pra serem
// testáveis sem montar React.

import { fmtYmd, presetRange, type DateRangePreset } from "./dateRanges";

export type DashboardPreset = DateRangePreset | "mes";

export const DASHBOARD_PRESETS: { id: DashboardPreset; label: string }[] = [
  { id: "hoje", label: "Hoje" },
  { id: "ontem", label: "Ontem" },
  { id: "semana-atual", label: "Semana atual" },
  { id: "semana-passada", label: "Semana passada" },
  { id: "mes", label: "Mês" },
];

export type YmdRange = { from: string; to: string };

// Retorna intervalo (yyyy-mm-dd) do preset selecionado.
// Para "mês": do dia 1 até hoje.
export function dashboardRange(
  preset: DashboardPreset,
  ref: Date = new Date()
): YmdRange {
  if (preset === "mes") {
    const today = new Date(ref);
    today.setHours(0, 0, 0, 0);
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: fmtYmd(start), to: fmtYmd(today) };
  }
  return presetRange(preset, ref);
}

// Retorna intervalo equivalente imediatamente anterior (mesmo nº de dias).
// Usado pra calcular delta % de cada KPI.
export function previousRange(range: YmdRange): YmdRange {
  const start = ymdToDate(range.from);
  const end = ymdToDate(range.to);
  const days = daysBetween(start, end) + 1;
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  return { from: fmtYmd(prevStart), to: fmtYmd(prevEnd) };
}

// Converte yyyy-mm-dd para Date local 00:00.
export function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((s) => parseInt(s, 10));
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

// ISO de início do dia (00:00 local) e início do dia seguinte ao último dia.
// Útil pra filtros tipo `>= start && < endExclusive`.
export function rangeBoundsIso(range: YmdRange): { startIso: string; endIso: string } {
  const start = ymdToDate(range.from);
  const end = ymdToDate(range.to);
  end.setDate(end.getDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86_400_000);
}

// Distribui valores por dia. `dates` define o eixo (cada bucket).
export function bucketByDay<T>(
  rows: T[],
  dates: Date[],
  rowDate: (r: T) => Date,
  rowValue: (r: T) => number
): { date: string; value: number }[] {
  const buckets = dates.map((d) => ({
    date: fmtYmd(d),
    value: 0,
  }));
  for (const r of rows) {
    const key = fmtYmd(rowDate(r));
    const slot = buckets.find((b) => b.date === key);
    if (slot) slot.value += rowValue(r);
  }
  return buckets;
}

export type TopAgg = { key: string; value: number };

// Agrupa e ordena descendente. Retorna no máximo `limit` itens.
export function topBy<T>(
  rows: T[],
  keyFn: (r: T) => string | null | undefined,
  valueFn: (r: T) => number,
  limit = 3
): TopAgg[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + (valueFn(r) || 0));
  }
  return Array.from(map.entries())
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

// Constrói os N últimos dias (incluindo o de referência), do mais antigo
// pro mais novo.
export function lastNDays(n: number, ref: Date = new Date()): Date[] {
  const days: Date[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(ref);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  return days;
}

// Atalho histórico — mantém call sites antigos.
export function last14Days(ref?: Date): Date[] {
  return lastNDays(14, ref);
}

// Retorna horas inteiras (>=0) entre `iso` e agora. null se iso inválido.
export function hoursSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 3_600_000));
}
