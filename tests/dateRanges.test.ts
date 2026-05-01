import { describe, it, expect } from "vitest";
import { presetRange, startOfWeekMonday, fmtYmd } from "@/lib/dateRanges";

// Datas de referência fixas pra testar (cada dia da semana)
const MON = new Date(2026, 3, 27); // 2026-04-27 segunda
const TUE = new Date(2026, 3, 28); // 2026-04-28 terça
const SAT = new Date(2026, 4, 2); // 2026-05-02 sábado
const SUN = new Date(2026, 4, 3); // 2026-05-03 domingo

describe("startOfWeekMonday", () => {
  it("retorna a própria data se for segunda", () => {
    expect(fmtYmd(startOfWeekMonday(MON))).toBe("2026-04-27");
  });
  it("retorna a segunda anterior se for terça", () => {
    expect(fmtYmd(startOfWeekMonday(TUE))).toBe("2026-04-27");
  });
  it("retorna a segunda anterior se for sábado", () => {
    expect(fmtYmd(startOfWeekMonday(SAT))).toBe("2026-04-27");
  });
  it("retorna a segunda anterior se for domingo (não pula a semana)", () => {
    expect(fmtYmd(startOfWeekMonday(SUN))).toBe("2026-04-27");
  });
});

describe("presetRange — Hoje/Ontem/Amanhã", () => {
  it("hoje", () => {
    expect(presetRange("hoje", TUE)).toEqual({
      from: "2026-04-28",
      to: "2026-04-28",
    });
  });
  it("ontem", () => {
    expect(presetRange("ontem", TUE)).toEqual({
      from: "2026-04-27",
      to: "2026-04-27",
    });
  });
  it("amanhã", () => {
    expect(presetRange("amanha", TUE)).toEqual({
      from: "2026-04-29",
      to: "2026-04-29",
    });
  });
});

describe("presetRange — Semana atual (seg→dom)", () => {
  it("seg → semana corrente", () => {
    expect(presetRange("semana-atual", MON)).toEqual({
      from: "2026-04-27",
      to: "2026-05-03",
    });
  });
  it("ter → semana corrente", () => {
    expect(presetRange("semana-atual", TUE)).toEqual({
      from: "2026-04-27",
      to: "2026-05-03",
    });
  });
  it("sáb → semana corrente", () => {
    expect(presetRange("semana-atual", SAT)).toEqual({
      from: "2026-04-27",
      to: "2026-05-03",
    });
  });
  it("dom → mesma semana (não pula pra próxima)", () => {
    expect(presetRange("semana-atual", SUN)).toEqual({
      from: "2026-04-27",
      to: "2026-05-03",
    });
  });
});

describe("presetRange — Semana passada (seg→dom anterior)", () => {
  it("seg da semana atual → seg/dom da semana anterior", () => {
    expect(presetRange("semana-passada", MON)).toEqual({
      from: "2026-04-20",
      to: "2026-04-26",
    });
  });
  it("dom da semana atual → seg/dom da semana anterior", () => {
    expect(presetRange("semana-passada", SUN)).toEqual({
      from: "2026-04-20",
      to: "2026-04-26",
    });
  });
});

describe("presetRange — virada de mês", () => {
  it("amanhã do dia 30/04 = 01/05", () => {
    const ref = new Date(2026, 3, 30);
    expect(presetRange("amanha", ref)).toEqual({
      from: "2026-05-01",
      to: "2026-05-01",
    });
  });
  it("ontem do dia 01/05 = 30/04", () => {
    const ref = new Date(2026, 4, 1);
    expect(presetRange("ontem", ref)).toEqual({
      from: "2026-04-30",
      to: "2026-04-30",
    });
  });
});
