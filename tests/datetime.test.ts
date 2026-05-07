import { describe, it, expect } from "vitest";
import { isoToLocal, nowLocalIso } from "@/lib/datetime";

describe("nowLocalIso", () => {
  it("retorna formato YYYY-MM-DDTHH:mm", () => {
    const out = nowLocalIso();
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe("isoToLocal", () => {
  it("converte ISO com timezone pra string local sem TZ", () => {
    // ISO em UTC: 2026-05-02T15:00:00Z
    const out = isoToLocal("2026-05-02T15:00:00Z");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // O dia é preservado (não é UTC parsing direto)
    // Se o sistema rodar em BR (UTC-3), seria "2026-05-02T12:00".
    // Em qualquer fuso, o comprimento deve ser 16.
    expect(out.length).toBe(16);
  });

  it("retorna nowLocalIso pra null/undefined/empty", () => {
    const a = isoToLocal(null);
    const b = isoToLocal(undefined);
    const c = isoToLocal("");
    expect(a).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(b).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(c).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("aceita ISO inválido sem quebrar", () => {
    expect(() => isoToLocal("nao-eh-iso")).not.toThrow();
  });
});
