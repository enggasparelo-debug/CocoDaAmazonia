import { describe, it, expect } from "vitest";

// Lógica espelhando carga_summary do banco e o cálculo de perda no fechamento.
// Mantida como funções puras pra testar sem subir Postgres.

function expectedCash(input: {
  total_dinheiro: number;
  total_suprimento: number;
  total_sangria: number;
  total_despesas: number;
}) {
  return (
    input.total_dinheiro +
    input.total_suprimento -
    input.total_sangria -
    input.total_despesas
  );
}

function cashDiff(declared: number, expected: number) {
  return +(declared - expected).toFixed(2);
}

function lossOnClose(opening: number, sold: number, remaining: number) {
  return Math.max(0, opening - sold - remaining);
}

function totalsByMethod(
  payments: { method: string; amount: number; canceled?: boolean }[]
) {
  const out = { dinheiro: 0, pix: 0, cartao: 0, outros: 0 };
  for (const p of payments) {
    if (p.canceled) continue;
    const m = p.method.toLowerCase();
    if (m.includes("dinheiro")) out.dinheiro += p.amount;
    else if (m.includes("pix")) out.pix += p.amount;
    else if (m.includes("cart")) out.cartao += p.amount;
    else out.outros += p.amount;
  }
  return out;
}

describe("carga summary — expected_cash", () => {
  it("only cash sales", () => {
    expect(
      expectedCash({
        total_dinheiro: 100,
        total_suprimento: 0,
        total_sangria: 0,
        total_despesas: 0,
      })
    ).toBe(100);
  });

  it("subtracts sangria and despesas, adds suprimento", () => {
    expect(
      expectedCash({
        total_dinheiro: 200,
        total_suprimento: 50,
        total_sangria: 30,
        total_despesas: 40,
      })
    ).toBe(180);
  });

  it("can be negative if despesas exceed cash", () => {
    expect(
      expectedCash({
        total_dinheiro: 10,
        total_suprimento: 0,
        total_sangria: 0,
        total_despesas: 100,
      })
    ).toBe(-90);
  });
});

describe("carga summary — cash_diff", () => {
  it("zero diff when declared matches expected", () => {
    expect(cashDiff(150, 150)).toBe(0);
  });
  it("positive diff means surplus (operator declared more)", () => {
    expect(cashDiff(160, 150)).toBe(10);
  });
  it("negative diff means missing money", () => {
    expect(cashDiff(140, 150)).toBe(-10);
  });
});

describe("carga close — perda calculation", () => {
  it("zero loss when opening = sold + remaining", () => {
    expect(lossOnClose(100, 80, 20)).toBe(0);
  });
  it("positive loss when stock disappears", () => {
    expect(lossOnClose(100, 80, 15)).toBe(5);
  });
  it("never negative (operator brought back too many)", () => {
    expect(lossOnClose(100, 80, 25)).toBe(0);
  });
});

describe("payment method buckets", () => {
  it("buckets cash, pix, cartão case-insensitively", () => {
    const r = totalsByMethod([
      { method: "Dinheiro", amount: 50 },
      { method: "PIX", amount: 30 },
      { method: "Cartão Débito", amount: 20 },
      { method: "Cartão Crédito", amount: 10 },
      { method: "A Prazo (Fiado)", amount: 5 },
    ]);
    expect(r.dinheiro).toBe(50);
    expect(r.pix).toBe(30);
    expect(r.cartao).toBe(30);
    expect(r.outros).toBe(5);
  });

  it("ignores canceled payments", () => {
    const r = totalsByMethod([
      { method: "Dinheiro", amount: 50 },
      { method: "Dinheiro", amount: 20, canceled: true },
    ]);
    expect(r.dinheiro).toBe(50);
  });
});
