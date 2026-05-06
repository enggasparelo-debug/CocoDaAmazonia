// Helpers pra gerar links wa.me com mensagens pré-preenchidas.
// Click-to-WhatsApp gratuito (sem API). Usuário clica e o WhatsApp Web
// ou app abre com a mensagem pronta — ele só revisa e envia.

import { brl, fmtDateOnly } from "./format";

const COUNTRY_PREFIX = "55"; // Brasil

function digits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

export function waLink(
  phone: string | null | undefined,
  message: string
): string | null {
  const d = digits(phone);
  if (d.length < 10) return null;
  // Adiciona prefixo do país se não estiver já presente.
  const num = d.startsWith(COUNTRY_PREFIX) ? d : COUNTRY_PREFIX + d;
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
}

// Mensagem de cobrança detalhada com lista de vendas em aberto.
export function cobrancaMessage(args: {
  customerName: string;
  storeName: string;
  totalOpen: number;
  openSales?: { created_at: string; total: number; paid: number }[];
  oldestOpenAt?: string | null;
}): string {
  const { customerName, storeName, totalOpen, openSales, oldestOpenAt } = args;
  const lines: string[] = [];
  lines.push(`Olá ${customerName}! 👋`);
  lines.push(``);
  lines.push(
    `Aqui é da ${storeName}. Você tem um saldo em aberto de ${brl(totalOpen)}.`
  );
  if (openSales && openSales.length > 0) {
    lines.push(``);
    lines.push(`Vendas em aberto:`);
    for (const s of openSales.slice(0, 8)) {
      const remaining = +(s.total - s.paid).toFixed(2);
      lines.push(`• ${fmtDateOnly(s.created_at)} — ${brl(remaining)}`);
    }
    if (openSales.length > 8) {
      lines.push(`(e mais ${openSales.length - 8} venda(s) anteriores)`);
    }
  } else if (oldestOpenAt) {
    const days = Math.floor(
      (Date.now() - new Date(oldestOpenAt).getTime()) / 86400000
    );
    lines.push(``);
    lines.push(`Venda mais antiga em aberto: há ${days} dia(s).`);
  }
  lines.push(``);
  lines.push(`Quando puder acertar, me avise. Obrigado! 🥥`);
  return lines.join("\n");
}

// Mensagem de agradecimento após receber pagamento.
export function obrigadoMessage(args: {
  customerName: string;
  storeName: string;
  amount: number;
}): string {
  const { customerName, storeName, amount } = args;
  return [
    `Olá ${customerName}!`,
    ``,
    `Confirmamos o recebimento de ${brl(amount)} na ${storeName}.`,
    `Obrigado! 🥥`,
  ].join("\n");
}
