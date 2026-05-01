export const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(n) || 0);

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export const fmtDateOnly = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR");

export const todayISO = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

export const startOfMonthISO = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

// Variação % entre valor atual e valor anterior. Retorna null quando
// não dá pra calcular (anterior <= 0): evita "+Infinity" e "NaN%".
export const pctChange = (curr: number, prev: number): number | null => {
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return null;
  if (prev <= 0) return curr > 0 ? null : 0;
  return ((curr - prev) / prev) * 100;
};

export const fmtPct = (p: number | null, digits = 0): string => {
  if (p === null) return "—";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(digits)}%`;
};
