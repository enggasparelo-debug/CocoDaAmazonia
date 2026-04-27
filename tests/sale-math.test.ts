import { describe, it, expect } from "vitest";

// Lógicas isoladas que aparecem em vendas/page.tsx e SaleEditor.
// Mantidas como funções aqui para podermos testá-las sem montar o React.

function calcSubtotal(quantity: number, unitPrice: number) {
  return Number((quantity * unitPrice).toFixed(2));
}
function calcTotal(subtotal: number, discount: number) {
  return Math.max(0, +(subtotal - (Number(discount) || 0)).toFixed(2));
}
function exceedsCreditLimit(open: number, total: number, limit: number | null) {
  return limit != null && open + total > limit;
}
function isOutsideEditWindow(createdAtMs: number, hours: number) {
  return (Date.now() - createdAtMs) / 3_600_000 > hours;
}

describe("subtotal and total", () => {
  it("subtotal multiplies and rounds to 2", () => {
    expect(calcSubtotal(3, 7.5)).toBe(22.5);
  });
  it("discount cannot push total below zero", () => {
    expect(calcTotal(20, 25)).toBe(0);
  });
  it("total subtracts discount", () => {
    expect(calcTotal(50, 5)).toBe(45);
  });
});

describe("credit limit check", () => {
  it("no limit means never exceeds", () => {
    expect(exceedsCreditLimit(100, 50, null)).toBe(false);
  });
  it("flags when open + total exceeds limit", () => {
    expect(exceedsCreditLimit(80, 30, 100)).toBe(true);
    expect(exceedsCreditLimit(80, 20, 100)).toBe(false);
  });
});

describe("edit window", () => {
  it("recently created is inside window", () => {
    expect(isOutsideEditWindow(Date.now(), 24)).toBe(false);
  });
  it("old sale is outside window", () => {
    expect(isOutsideEditWindow(Date.now() - 25 * 3_600_000, 24)).toBe(true);
  });
  it("zero hours always outside (admin only)", () => {
    expect(isOutsideEditWindow(Date.now() - 1000, 0)).toBe(true);
  });
});
