// Helpers de intervalos de datas para os filtros rápidos.
// Semana = segunda a domingo (padrão BR).

export type DateRangePreset =
  | "hoje"
  | "ontem"
  | "amanha"
  | "semana-atual"
  | "semana-passada"
  | "7-dias"
  | "14-dias"
  | "21-dias"
  | "30-dias"
  | "ano-atual"
  | "tudo";

export const PRESET_LABELS: Record<DateRangePreset, string> = {
  hoje: "Hoje",
  ontem: "Ontem",
  amanha: "Amanhã",
  "semana-atual": "Semana atual",
  "semana-passada": "Semana passada",
  "7-dias": "7 dias",
  "14-dias": "14 dias",
  "21-dias": "21 dias",
  "30-dias": "30 dias",
  "ano-atual": "Ano atual",
  tudo: "Tudo",
};

// Data inicial usada pelo preset "Tudo" (sem limite inferior prático).
export const ALL_TIME_START = "2000-01-01";

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
  if (preset === "semana-passada") {
    const startThis = startOfWeekMonday(today);
    const start = new Date(startThis);
    start.setDate(startThis.getDate() - 7);
    const end = new Date(startThis);
    end.setDate(startThis.getDate() - 1);
    return { from: fmtYmd(start), to: fmtYmd(end) };
  }
  if (
    preset === "7-dias" ||
    preset === "14-dias" ||
    preset === "21-dias" ||
    preset === "30-dias"
  ) {
    const days =
      preset === "7-dias"
        ? 7
        : preset === "14-dias"
        ? 14
        : preset === "21-dias"
        ? 21
        : 30;
    const start = new Date(today);
    start.setDate(today.getDate() - (days - 1));
    return { from: fmtYmd(start), to: fmtYmd(today) };
  }
  if (preset === "ano-atual") {
    const start = new Date(today.getFullYear(), 0, 1);
    const end = new Date(today.getFullYear(), 11, 31);
    return { from: fmtYmd(start), to: fmtYmd(end) };
  }
  // tudo
  return { from: ALL_TIME_START, to: fmtYmd(today) };
}
