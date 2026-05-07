import { describe, expect, it } from "vitest";
import { cobrancaMessage, obrigadoMessage, waLink } from "../lib/whatsapp";

describe("waLink", () => {
  it("retorna null se telefone tem menos de 10 dígitos", () => {
    expect(waLink("123", "oi")).toBeNull();
    expect(waLink(null, "oi")).toBeNull();
    expect(waLink("", "oi")).toBeNull();
  });

  it("monta URL com prefixo 55 + dígitos do número", () => {
    const url = waLink("(11) 98765-4321", "oi");
    expect(url).toBe("https://wa.me/5511987654321?text=oi");
  });

  it("não duplica prefixo 55 se já vier no número", () => {
    const url = waLink("55 11 98765-4321", "oi");
    expect(url).toBe("https://wa.me/5511987654321?text=oi");
  });

  it("encoda mensagem com caracteres especiais", () => {
    const url = waLink("11987654321", "Olá! 🥥 Saldo: R$ 50,00");
    expect(url).toContain("Ol%C3%A1");
    expect(url).toContain("R%24%2050%2C00");
  });

  it("ignora caracteres não-numéricos do telefone", () => {
    expect(waLink("+55 (11) 98765-4321", "x")).toBe(
      "https://wa.me/5511987654321?text=x"
    );
  });
});

describe("cobrancaMessage", () => {
  it("inclui nome do cliente, loja e valor total", () => {
    const m = cobrancaMessage({
      customerName: "João",
      storeName: "Coco Loja",
      totalOpen: 150,
    });
    expect(m).toContain("João");
    expect(m).toContain("Coco Loja");
    expect(m).toMatch(/R\$\s150,00/);
  });

  it("lista vendas em aberto quando fornecidas", () => {
    const m = cobrancaMessage({
      customerName: "Ana",
      storeName: "X",
      totalOpen: 200,
      openSales: [
        { created_at: "2025-01-15T12:00:00Z", total: 100, paid: 0 },
        { created_at: "2025-02-01T12:00:00Z", total: 150, paid: 50 },
      ],
    });
    expect(m).toMatch(/R\$\s100,00/); // 150 - 50 = 100
    expect(m).toMatch(/Vendas em aberto/);
  });

  it("trunca lista pra 8 vendas e mostra contagem extra", () => {
    const sales = Array.from({ length: 12 }, (_, i) => ({
      created_at: "2025-01-01T00:00:00Z",
      total: i + 1,
      paid: 0,
    }));
    const m = cobrancaMessage({
      customerName: "X",
      storeName: "Y",
      totalOpen: 100,
      openSales: sales,
    });
    expect(m).toContain("e mais 4 venda(s) anteriores");
  });

  it("usa oldestOpenAt como fallback quando não tem openSales", () => {
    const tenDaysAgo = new Date(
      Date.now() - 10 * 86400000
    ).toISOString();
    const m = cobrancaMessage({
      customerName: "X",
      storeName: "Y",
      totalOpen: 50,
      oldestOpenAt: tenDaysAgo,
    });
    expect(m).toMatch(/há 10 dia/);
  });
});

describe("obrigadoMessage", () => {
  it("agradece com nome do cliente, loja e valor", () => {
    const m = obrigadoMessage({
      customerName: "Maria",
      storeName: "Coco SA",
      amount: 75.5,
    });
    expect(m).toContain("Maria");
    expect(m).toContain("Coco SA");
    expect(m).toMatch(/R\$\s75,50/);
  });
});
