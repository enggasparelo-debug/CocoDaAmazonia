import { describe, expect, it } from "vitest";
import { rowsToCsv } from "../lib/export";

describe("rowsToCsv", () => {
  it("retorna string vazia se sem linhas e sem headers", () => {
    expect(rowsToCsv([])).toBe("");
  });

  it("usa headers das chaves da primeira linha", () => {
    const csv = rowsToCsv([{ a: 1, b: 2 }]);
    expect(csv).toBe('"a";"b"\n"1";"2"');
  });

  it("usa separador ; (padrão pt-BR)", () => {
    const csv = rowsToCsv([{ x: "a", y: "b" }]);
    expect(csv.includes(";")).toBe(true);
    expect(csv.split("\n")[0]).toBe('"x";"y"');
  });

  it("escapa aspas duplicando-as", () => {
    const csv = rowsToCsv([{ note: 'ele disse "oi"' }]);
    expect(csv).toContain('"ele disse ""oi"""');
  });

  it("trata null/undefined como string vazia", () => {
    const csv = rowsToCsv([{ a: null, b: undefined, c: 1 }]);
    expect(csv).toBe('"a";"b";"c"\n"";"";"1"');
  });

  it("preserva ; dentro de células", () => {
    const csv = rowsToCsv([{ x: "a;b;c" }]);
    expect(csv).toContain('"a;b;c"');
    // O parser CSV vai tratar como uma única célula porque está entre aspas
  });

  it("preserva quebras de linha dentro de células (entre aspas)", () => {
    const csv = rowsToCsv([{ note: "linha1\nlinha2" }]);
    expect(csv).toContain('"linha1\nlinha2"');
  });

  it("aceita headers explícitos", () => {
    const csv = rowsToCsv(
      [{ name: "X", age: 30 }],
      ["age", "name"]
    );
    expect(csv).toBe('"age";"name"\n"30";"X"');
  });

  it("mantém ordem de colunas dos headers", () => {
    const csv = rowsToCsv([{ b: 2, a: 1, c: 3 }], ["c", "a", "b"]);
    expect(csv).toBe('"c";"a";"b"\n"3";"1";"2"');
  });

  it("preserva números como string (sem formatação)", () => {
    const csv = rowsToCsv([{ valor: 1234.5 }]);
    expect(csv).toContain('"1234.5"');
  });
});
