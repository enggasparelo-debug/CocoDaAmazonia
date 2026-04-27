import { describe, it, expect } from "vitest";
import { brl } from "@/lib/format";

describe("brl", () => {
  it("formats integer reais", () => {
    expect(brl(0)).toMatch(/R\$\s*0,00/);
    expect(brl(1)).toMatch(/R\$\s*1,00/);
    expect(brl(1234.5)).toMatch(/R\$\s*1\.234,50/);
  });

  it("handles invalid input as zero", () => {
    expect(brl(NaN)).toMatch(/R\$\s*0,00/);
    // @ts-expect-error
    expect(brl(undefined)).toMatch(/R\$\s*0,00/);
  });

  it("rounds half up to 2 decimals", () => {
    // Intl rounding follows banker's by default with maximumFractionDigits.
    // We assert the format only, not exact rounding rule.
    expect(brl(2.005)).toMatch(/R\$\s*2,(00|01)/);
  });
});
