// Helpers puros pra import de vendas via Excel.
// Tudo testável sem DOM/Supabase: o ImportClient passa as listas e
// recebe linhas validadas + erros prontos pra exibir.

export type ImportRawRow = {
  rowNumber: number; // linha na planilha (1-based, com header sendo 1)
  date: unknown;
  customer: unknown;
  quantity: unknown;
  unitPrice: unknown;
  total: unknown;
  pix: unknown;
  cash: unknown;
  card: unknown;
  fiado: unknown;
  seller?: unknown;
  notes?: unknown;
};

export type ParsedPayment = {
  methodKey: "PIX" | "DINHEIRO" | "CARTAO";
  amount: number;
};

export type ParsedRow = {
  rowNumber: number;
  date: Date;
  customerName: string; // já trimmed
  quantity: number;
  unitPrice: number;
  total: number;
  payments: ParsedPayment[];
  fiado: number;
  notes: string | null;
  errors: string[];
  warnings: string[];
};

export const EXPECTED_HEADERS = [
  "Data",
  "Cliente",
  "Qnt",
  "Preço Unit.",
  "Valor Total",
  "PIX",
  "DINHEIRO",
  "Cartão",
  "Fiado",
  "Observação",
] as const;

const ABS_TOL = 0.02;

function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    // Aceita "1.234,56" e "1234.56"
    const norm = v.trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
    const n = parseFloat(norm);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    // Coloca no meio-dia local pra evitar deslizes de fuso na hora de salvar.
    const d = new Date(v.getFullYear(), v.getMonth(), v.getDate(), 12, 0, 0, 0);
    return d;
  }
  if (typeof v === "string") {
    const s = v.trim();
    // dd/mm/yyyy
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const day = parseInt(m[1], 10);
      const mon = parseInt(m[2], 10);
      const yr = parseInt(m[3], 10);
      const d = new Date(yr, mon - 1, day, 12, 0, 0, 0);
      return isNaN(d.getTime()) ? null : d;
    }
    // yyyy-mm-dd
    const m2 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m2) {
      const yr = parseInt(m2[1], 10);
      const mon = parseInt(m2[2], 10);
      const day = parseInt(m2[3], 10);
      const d = new Date(yr, mon - 1, day, 12, 0, 0, 0);
      return isNaN(d.getTime()) ? null : d;
    }
  }
  if (typeof v === "number") {
    // Excel serial (dias desde 1899-12-30). ExcelJS já converte com cellDates,
    // mas no caso do número cru fazemos a conversão.
    const ms = Math.round((v - 25569) * 86_400_000);
    const d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
  }
  return null;
}

function eqTol(a: number, b: number, tol = ABS_TOL): boolean {
  return Math.abs(a - b) < tol;
}

// Verifica se a linha está vazia (todos os campos nulos / vazios).
export function isEmptyRow(r: ImportRawRow): boolean {
  const vals = [
    r.date,
    r.customer,
    r.quantity,
    r.unitPrice,
    r.total,
    r.pix,
    r.cash,
    r.card,
    r.fiado,
  ];
  return vals.every(
    (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "")
  );
}

export function parseRow(r: ImportRawRow): ParsedRow {
  const errors: string[] = [];
  const warnings: string[] = [];

  const date = toDate(r.date);
  if (!date) errors.push("Data inválida (use dd/mm/aaaa)");

  const customerName =
    typeof r.customer === "string" ? r.customer.trim() : String(r.customer ?? "").trim();
  if (!customerName) errors.push("Cliente é obrigatório");

  const quantity = Math.trunc(toNumber(r.quantity));
  if (quantity <= 0) errors.push("Quantidade precisa ser > 0");

  const unitPrice = toNumber(r.unitPrice);
  if (unitPrice <= 0) errors.push("Preço unitário precisa ser > 0");

  const total = toNumber(r.total);
  if (total <= 0) errors.push("Total precisa ser > 0");

  const calcTotal = +(quantity * unitPrice).toFixed(2);
  if (total > 0 && quantity > 0 && unitPrice > 0 && !eqTol(total, calcTotal, 0.05)) {
    warnings.push(
      `Total (${total.toFixed(2)}) ≠ Qnt × Preço (${calcTotal.toFixed(2)})`
    );
  }

  const pix = toNumber(r.pix);
  const cash = toNumber(r.cash);
  const card = toNumber(r.card);
  const fiado = toNumber(r.fiado);

  for (const [name, n] of [
    ["PIX", pix],
    ["DINHEIRO", cash],
    ["CARTÃO", card],
    ["FIADO", fiado],
  ] as const) {
    if (n < 0) errors.push(`${name} não pode ser negativo`);
  }

  const sumAll = +(pix + cash + card + fiado).toFixed(2);
  if (total > 0 && !eqTol(sumAll, total, 0.05)) {
    errors.push(
      `Soma PIX+DIN+CARTÃO+FIADO (${sumAll.toFixed(2)}) ≠ Total (${total.toFixed(2)})`
    );
  }

  const payments: ParsedPayment[] = [];
  if (pix > 0) payments.push({ methodKey: "PIX", amount: +pix.toFixed(2) });
  if (cash > 0)
    payments.push({ methodKey: "DINHEIRO", amount: +cash.toFixed(2) });
  if (card > 0) payments.push({ methodKey: "CARTAO", amount: +card.toFixed(2) });

  const notes =
    typeof r.notes === "string" && r.notes.trim() ? r.notes.trim() : null;

  return {
    rowNumber: r.rowNumber,
    date: date ?? new Date(),
    customerName,
    quantity,
    unitPrice,
    total: total > 0 ? total : calcTotal,
    payments,
    fiado: +fiado.toFixed(2),
    notes,
    errors,
    warnings,
  };
}

// Casa nomes de cliente case-insensitive + trim.
export function findCustomerId(
  name: string,
  customers: { id: string; name: string }[]
): string | null {
  const k = name.trim().toLowerCase();
  if (!k) return null;
  const hit = customers.find((c) => c.name.trim().toLowerCase() === k);
  return hit?.id ?? null;
}

// Casa "PIX"/"DINHEIRO"/"CARTAO" no nome de payment_methods.
// Busca case-insensitive, ignora acentos/cedilha pra "cartão".
function deburr(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Levenshtein simples (suficiente pra nomes curtos de cliente).
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

// Sugere clientes mais parecidos com `name`. Ranking: substring exata >
// prefixo > Levenshtein normalizado. Retorna até `limit` itens.
export function suggestCustomerMatches(
  name: string,
  customers: { id: string; name: string }[],
  limit = 5
): { id: string; name: string; score: number }[] {
  const target = deburr(name).trim();
  if (!target) return [];
  const scored = customers
    .map((c) => {
      const cname = deburr(c.name).trim();
      if (!cname) return null;
      let score: number;
      if (cname === target) score = 0;
      else if (cname.startsWith(target) || target.startsWith(cname))
        score = 0.1;
      else if (cname.includes(target) || target.includes(cname)) score = 0.2;
      else {
        const dist = levenshtein(cname, target);
        const max = Math.max(cname.length, target.length);
        score = dist / max;
      }
      return { id: c.id, name: c.name, score };
    })
    .filter((x): x is { id: string; name: string; score: number } => !!x)
    .filter((x) => x.score <= 0.5)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
  return scored;
}

export function findMethodId(
  key: "PIX" | "DINHEIRO" | "CARTAO",
  methods: { id: string; name: string; is_credit?: boolean }[]
): string | null {
  const target =
    key === "PIX" ? "pix" : key === "DINHEIRO" ? "dinheiro" : "cartao";
  const hit = methods.find((m) => deburr(m.name).includes(target));
  return hit?.id ?? null;
}

export type ImportSummary = {
  total: number; // total faturado das linhas válidas
  rows: number; // linhas válidas
  withErrors: number;
  cocos: number;
  byMethod: { PIX: number; DINHEIRO: number; CARTAO: number };
  fiado: number;
};

export function summarize(rows: ParsedRow[]): ImportSummary {
  const valid = rows.filter((r) => r.errors.length === 0);
  const sum: ImportSummary = {
    total: 0,
    rows: valid.length,
    withErrors: rows.length - valid.length,
    cocos: 0,
    byMethod: { PIX: 0, DINHEIRO: 0, CARTAO: 0 },
    fiado: 0,
  };
  for (const r of valid) {
    sum.total += r.total;
    sum.cocos += r.quantity;
    sum.fiado += r.fiado;
    for (const p of r.payments) sum.byMethod[p.methodKey] += p.amount;
  }
  // arredondamento contra somas tipo 0.30000000000004
  sum.total = +sum.total.toFixed(2);
  sum.fiado = +sum.fiado.toFixed(2);
  sum.byMethod.PIX = +sum.byMethod.PIX.toFixed(2);
  sum.byMethod.DINHEIRO = +sum.byMethod.DINHEIRO.toFixed(2);
  sum.byMethod.CARTAO = +sum.byMethod.CARTAO.toFixed(2);
  return sum;
}
