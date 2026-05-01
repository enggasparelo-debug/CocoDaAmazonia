// Helpers de intervalos de datas para os filtros rápidos.
// Semana = segunda a domingo (padrão BR).

export type DateRangePreset =
  | "hoje"
  | "ontem"
  | "amanha"
  | "semana-atual"
  | "semana-passada";

export const PRESET_LABELS: Record<DateRangePreset, string> = {
  hoje: "Hoje",
  ontem: "Ontem",
  amanha: "Amanhã",
  "semana-atual": "Semana atual",
  "semana-passada": "Semana passada",
};

export function fmtYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Retorna a segunda-feira da semana de `d` (00:00 local).
export function startOfWeekMonday(d: Date): Date {
  const day = d.getDay(); // 0=dom, 1=seg, ..., 6=sab
  const diff = day === 0 ? -6 : 1 - day;
  const x = new Date(d);
  x.setDate(d.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function presetRange(
  preset: DateRangePreset,
  ref: Date = new Date()
): { from: string; to: string } {
  const today = new Date(ref);
  today.setHours(0, 0, 0, 0);

  if (preset === "hoje") {
    return { from: fmtYmd(today), to: fmtYmd(today) };
  }
  if (preset === "ontem") {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return { from: fmtYmd(d), to: fmtYmd(d) };
  }
  if (preset === "amanha") {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return { from: fmtYmd(d), to: fmtYmd(d) };
  }
  if (preset === "semana-atual") {
    const start = startOfWeekMonday(today);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: fmtYmd(start), to: fmtYmd(end) };
  }
  // semana-passada
  const startThis = startOfWeekMonday(today);
  const start = new Date(startThis);
  start.setDate(startThis.getDate() - 7);
  const end = new Date(startThis);
  end.setDate(startThis.getDate() - 1);
  return { from: fmtYmd(start), to: fmtYmd(end) };
}
