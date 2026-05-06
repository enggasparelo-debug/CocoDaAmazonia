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

// Aceita "3", "3,5", "3.50", "1.234,56" etc. Retorna 0 se inválido.
export function parseBrNumber(s: string | null | undefined): number {
  if (s === null || s === undefined) return 0;
  const str = String(s).trim();
  if (!str) return 0;
  const norm = str.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(norm);
  return isNaN(n) ? 0 : n;
}

// Formata número como string brasileira: "1234.5" → "1234,50".
export function fmtBrNumber(n: number): string {
  if (!Number.isFinite(n)) return "0,00";
  return n.toFixed(2).replace(".", ",");
}

// Calcula a taxa cobrada pela operadora (cartão, etc.) em um pagamento.
// Devolve um número ≥ 0. Se a taxa percentual + fixa exceder o valor
// pago, satura no próprio valor (operadora nunca tira mais que isso).
export function computeFee(
  amount: number,
  feePercent: number | null | undefined,
  feeFixed: number | null | undefined
): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const pct = Math.max(0, Number(feePercent ?? 0));
  const fixed = Math.max(0, Number(feeFixed ?? 0));
  const fee = +(amount * (pct / 100) + fixed).toFixed(2);
  return Math.min(fee, amount);
}
