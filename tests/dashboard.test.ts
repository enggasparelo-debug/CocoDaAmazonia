import { describe, it, expect } from "vitest";
import { fmtPct, pctChange } from "@/lib/format";
import {
  bucketByDay,
  dashboardRange,
  hoursSince,
  last14Days,
  lastNDays,
  previousRange,
  rangeBoundsIso,
  topBy,
} from "@/lib/dashboard";

describe("pctChange", () => {
  it("retorna delta positivo", () => {
    expect(pctChange(150, 100)).toBe(50);
  });
  it("retorna delta negativo", () => {
    expect(pctChange(50, 100)).toBe(-50);
  });
  it("retorna null quando anterior <= 0 e atual > 0", () => {
    expect(pctChange(100, 0)).toBeNull();
    expect(pctChange(100, -10)).toBeNull();
  });
  it("retorna 0 quando ambos zero", () => {
    expect(pctChange(0, 0)).toBe(0);
  });
  it("trata input inválido", () => {
    expect(pctChange(NaN, 1)).toBeNull();
  });
});

describe("fmtPct", () => {
  it("formata positivo com sinal", () => {
    expect(fmtPct(12)).toBe("+12%");
  });
  it("formata negativo sem sinal extra", () => {
    expect(fmtPct(-12)).toBe("-12%");
  });
  it("retorna travessão quando null", () => {
    expect(fmtPct(null)).toBe("—");
  });
});

describe("dashboardRange", () => {
  it("hoje retorna intervalo do dia", () => {
    const ref = new Date(2026, 4, 1); // 2026-05-01 (mês 4 = maio)
    const r = dashboardRange("hoje", ref);
    expect(r.from).toBe("2026-05-01");
    expect(r.to).toBe("2026-05-01");
  });
  it("mes vai do dia 1 até hoje", () => {
    const ref = new Date(2026, 4, 15);
    const r = dashboardRange("mes", ref);
    expect(r.from).toBe("2026-05-01");
    expect(r.to).toBe("2026-05-15");
  });
});

describe("previousRange", () => {
  it("intervalo de 1 dia recua 1 dia", () => {
    const r = previousRange({ from: "2026-05-01", to: "2026-05-01" });
    expect(r.from).toBe("2026-04-30");
    expect(r.to).toBe("2026-04-30");
  });
  it("intervalo de 7 dias recua 7 dias", () => {
    const r = previousRange({ from: "2026-05-08", to: "2026-05-14" });
    expect(r.from).toBe("2026-05-01");
    expect(r.to).toBe("2026-05-07");
  });
  it("intervalo de 15 dias recua 15 dias", () => {
    const r = previousRange({ from: "2026-05-01", to: "2026-05-15" });
    expect(r.from).toBe("2026-04-16");
    expect(r.to).toBe("2026-04-30");
  });
});

describe("rangeBoundsIso", () => {
  it("endIso é exclusive (00:00 do dia seguinte)", () => {
    const { startIso, endIso } = rangeBoundsIso({
      from: "2026-05-01",
      to: "2026-05-01",
    });
    expect(new Date(startIso).getDate()).toBe(1);
    // endIso deve ser dia 2 às 00:00 local
    const end = new Date(endIso);
    expect(end.getTime() - new Date(startIso).getTime()).toBe(86_400_000);
  });
});

describe("bucketByDay", () => {
  it("distribui valores e zera dias vazios", () => {
    const days = [new Date(2026, 4, 1), new Date(2026, 4, 2), new Date(2026, 4, 3)];
    const rows = [
      { d: new Date(2026, 4, 1, 10), v: 100 },
      { d: new Date(2026, 4, 1, 14), v: 50 },
      { d: new Date(2026, 4, 3), v: 30 },
    ];
    const out = bucketByDay(rows, days, (r) => r.d, (r) => r.v);
    expect(out).toEqual([
      { date: "2026-05-01", value: 150 },
      { date: "2026-05-02", value: 0 },
      { date: "2026-05-03", value: 30 },
    ]);
  });
});

describe("topBy", () => {
  it("agrupa, soma e ordena descendente", () => {
    const rows = [
      { k: "a", v: 10 },
      { k: "b", v: 20 },
      { k: "a", v: 5 },
      { k: "c", v: 30 },
    ];
    const out = topBy(rows, (r) => r.k, (r) => r.v, 3);
    expect(out).toEqual([
      { key: "c", value: 30 },
      { key: "b", value: 20 },
      { key: "a", value: 15 },
    ]);
  });
  it("ignora chaves nulas", () => {
    const rows = [
      { k: null, v: 10 },
      { k: "a", v: 5 },
    ];
    const out = topBy(rows, (r) => r.k, (r) => r.v, 3);
    expect(out).toEqual([{ key: "a", value: 5 }]);
  });
  it("respeita o limite", () => {
    const rows = [
      { k: "a", v: 1 },
      { k: "b", v: 2 },
      { k: "c", v: 3 },
      { k: "d", v: 4 },
    ];
    expect(topBy(rows, (r) => r.k, (r) => r.v, 2)).toHaveLength(2);
  });
});

describe("last14Days / lastNDays", () => {
  it("retorna 14 dias terminando no de referência", () => {
    const ref = new Date(2026, 4, 15, 23);
    const days = last14Days(ref);
    expect(days).toHaveLength(14);
    expect(days[13].getDate()).toBe(15);
    expect(days[0].getDate()).toBe(2); // 15 - 13
    // todos zerados pra meia-noite
    days.forEach((d) => expect(d.getHours()).toBe(0));
  });
  it("lastNDays(7) retorna 7 dias", () => {
    const ref = new Date(2026, 4, 15);
    const days = lastNDays(7, ref);
    expect(days).toHaveLength(7);
    expect(days[6].getDate()).toBe(15);
    expect(days[0].getDate()).toBe(9);
  });
  it("lastNDays(30) retorna 30 dias e cruza mês", () => {
    const ref = new Date(2026, 4, 15);
    const days = lastNDays(30, ref);
    expect(days).toHaveLength(30);
    expect(days[29].getMonth()).toBe(4);
    expect(days[0].getMonth()).toBe(3); // abril
  });
});

describe("hoursSince", () => {
  it("retorna horas inteiras desde iso", () => {
    const now = new Date(2026, 4, 1, 12, 0, 0);
    const past = new Date(2026, 4, 1, 9, 30, 0).toISOString();
    expect(hoursSince(past, now)).toBe(2);
  });
  it("null pra entrada falsy", () => {
    expect(hoursSince(null)).toBeNull();
    expect(hoursSince(undefined)).toBeNull();
    expect(hoursSince("")).toBeNull();
  });
  it("nunca negativo", () => {
    const now = new Date(2026, 4, 1, 9);
    const future = new Date(2026, 4, 1, 12).toISOString();
    expect(hoursSince(future, now)).toBe(0);
  });
});
