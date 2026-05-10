import { describe, it, expect } from "vitest";
import {
  findCustomerId,
  findMethodId,
  isEmptyRow,
  parseRow,
  suggestCustomerMatches,
  summarize,
  type ImportRawRow,
} from "@/lib/salesImport";

const baseRow = (
  o: Partial<ImportRawRow> = {}
): ImportRawRow => ({
  rowNumber: 2,
  date: new Date(2026, 3, 27),
  customer: "CABEÇA BRANCA",
  quantity: 500,
  unitPrice: 2.8,
  total: 1400,
  pix: 1190,
  cash: 210,
  card: 0,
  fiado: 0,
  notes: "",
  ...o,
});

describe("isEmptyRow", () => {
  it("considera linha toda nula como vazia", () => {
    expect(
      isEmptyRow({
        rowNumber: 5,
        date: null,
        customer: "",
        quantity: null,
        unitPrice: null,
        total: null,
        pix: null,
        cash: null,
        card: null,
        fiado: null,
      })
    ).toBe(true);
  });
  it("considera linha com cliente como não-vazia", () => {
    expect(
      isEmptyRow({
        rowNumber: 5,
        date: null,
        customer: "X",
        quantity: null,
        unitPrice: null,
        total: null,
        pix: null,
        cash: null,
        card: null,
        fiado: null,
      })
    ).toBe(false);
  });
});

describe("parseRow", () => {
  it("parseia linha válida sem erros nem warnings", () => {
    const r = parseRow(baseRow());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.quantity).toBe(500);
    expect(r.total).toBe(1400);
    expect(r.payments).toEqual([
      { methodKey: "PIX", amount: 1190 },
      { methodKey: "DINHEIRO", amount: 210 },
    ]);
    expect(r.fiado).toBe(0);
  });

  it("aceita data no formato dd/mm/aaaa", () => {
    const r = parseRow(baseRow({ date: "27/04/2026" }));
    expect(r.errors).toEqual([]);
    expect(r.date.getFullYear()).toBe(2026);
    expect(r.date.getMonth()).toBe(3);
    expect(r.date.getDate()).toBe(27);
  });

  it("aceita números com vírgula brasileira", () => {
    const r = parseRow(
      baseRow({
        unitPrice: "2,80",
        total: "1.400,00",
        pix: "1.190,00",
        cash: "210,00",
      })
    );
    expect(r.errors).toEqual([]);
    expect(r.unitPrice).toBe(2.8);
    expect(r.total).toBe(1400);
  });

  it("erro quando soma de pagamentos != total", () => {
    const r = parseRow(
      baseRow({ pix: 100, cash: 0, card: 0, fiado: 0, total: 200 })
    );
    expect(r.errors.some((e) => e.includes("Soma"))).toBe(true);
  });

  it("warning quando total != qty * preço (mas linha continua válida)", () => {
    const r = parseRow(
      baseRow({
        quantity: 100,
        unitPrice: 3,
        total: 350, // 100*3 = 300
        pix: 0,
        cash: 0,
        card: 0,
        fiado: 350,
      })
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.includes("Qnt × Preço"))).toBe(true);
  });

  it("erro com cliente vazio", () => {
    const r = parseRow(baseRow({ customer: "  " }));
    expect(r.errors.some((e) => e.includes("Cliente"))).toBe(true);
  });

  it("erro com qty 0", () => {
    const r = parseRow(baseRow({ quantity: 0 }));
    expect(r.errors.some((e) => e.includes("Quantidade"))).toBe(true);
  });

  it("erro com preço 0", () => {
    const r = parseRow(baseRow({ unitPrice: 0 }));
    expect(r.errors.some((e) => e.includes("Preço"))).toBe(true);
  });

  it("erro com data inválida", () => {
    const r = parseRow(baseRow({ date: "abc" }));
    expect(r.errors.some((e) => e.includes("Data"))).toBe(true);
  });

  it("venda só fiado: sem pagamentos, fiado = total", () => {
    const r = parseRow(
      baseRow({
        quantity: 150,
        unitPrice: 3,
        total: 450,
        pix: 0,
        cash: 0,
        card: 0,
        fiado: 450,
      })
    );
    expect(r.errors).toEqual([]);
    expect(r.payments).toEqual([]);
    expect(r.fiado).toBe(450);
  });

  it("aceita serial number do Excel como data", () => {
    // Serial Excel = dias desde 1899-12-30 UTC. Pra não depender do fuso
    // do runner, montamos com Date.UTC (mesma convenção do .xlsx).
    const ref = Date.UTC(2026, 3, 27);
    const serial = ref / 86_400_000 + 25569;
    const r = parseRow(baseRow({ date: serial }));
    expect(r.errors).toEqual([]);
    expect(r.date.getDate()).toBe(27);
  });

  it("Date em UTC midnight (estilo ExcelJS) não escorrega 1 dia em fuso negativo", () => {
    // ExcelJS entrega "06/05/2026" como 2026-05-06T00:00:00Z. Em UTC-3
    // os getters locais voltariam dia 5 — o fix força componentes UTC.
    const r = parseRow(baseRow({ date: new Date(Date.UTC(2026, 4, 6)) }));
    expect(r.errors).toEqual([]);
    expect(r.date.getDate()).toBe(6);
    expect(r.date.getMonth()).toBe(4);
    expect(r.date.getFullYear()).toBe(2026);
  });

  it("erro com pagamento negativo", () => {
    const r = parseRow(baseRow({ pix: -10, cash: 0, card: 0, fiado: 1410 }));
    expect(r.errors.some((e) => e.includes("PIX não pode ser negativo"))).toBe(
      true
    );
  });
});

describe("findCustomerId", () => {
  const list = [
    { id: "1", name: "Cabeça Branca" },
    { id: "2", name: "Stephano" },
  ];
  it("acha case-insensitive", () => {
    expect(findCustomerId("CABEÇA BRANCA", list)).toBe("1");
    expect(findCustomerId("  stephano  ", list)).toBe("2");
  });
  it("retorna null quando não acha", () => {
    expect(findCustomerId("Wilds", list)).toBeNull();
  });
});

describe("findMethodId", () => {
  const list = [
    { id: "p", name: "Pix" },
    { id: "d", name: "Dinheiro" },
    { id: "c", name: "Cartão Débito" },
    { id: "f", name: "Fiado", is_credit: true },
  ];
  it("PIX", () => expect(findMethodId("PIX", list)).toBe("p"));
  it("DINHEIRO", () => expect(findMethodId("DINHEIRO", list)).toBe("d"));
  it("CARTAO casa com 'Cartão'", () =>
    expect(findMethodId("CARTAO", list)).toBe("c"));
});

describe("summarize", () => {
  it("conta válidas, totais e por forma", () => {
    const rows = [
      parseRow(baseRow()), // 1400, pix 1190, din 210
      parseRow(
        baseRow({
          customer: "PIAUI",
          quantity: 150,
          unitPrice: 3,
          total: 450,
          pix: 0,
          cash: 0,
          card: 0,
          fiado: 450,
        })
      ),
      parseRow(baseRow({ customer: "" })), // erro
    ];
    const s = summarize(rows);
    expect(s.rows).toBe(2);
    expect(s.withErrors).toBe(1);
    expect(s.cocos).toBe(650);
    expect(s.total).toBe(1850);
    expect(s.byMethod.PIX).toBe(1190);
    expect(s.byMethod.DINHEIRO).toBe(210);
    expect(s.byMethod.CARTAO).toBe(0);
    expect(s.fiado).toBe(450);
  });
});

describe("suggestCustomerMatches", () => {
  const customers = [
    { id: "1", name: "MINEIRO" },
    { id: "2", name: "CABEÇA BRANCA" },
    { id: "3", name: "PIAUÍ" },
    { id: "4", name: "STEPHANO" },
    { id: "5", name: "STEFANO" },
  ];

  it("retorna o match exato com score 0", () => {
    const r = suggestCustomerMatches("mineiro", customers);
    expect(r[0].id).toBe("1");
    expect(r[0].score).toBe(0);
  });

  it("ignora acentos", () => {
    const r = suggestCustomerMatches("PIAUI", customers);
    expect(r[0].id).toBe("3");
  });

  it("acha o mais parecido por Levenshtein", () => {
    const r = suggestCustomerMatches("STEFANO", customers);
    expect(r[0].id).toBe("5");
    expect(r[1]?.id).toBe("4");
  });

  it("retorna vazio quando nada se aproxima", () => {
    const r = suggestCustomerMatches("ZZZZZZZ", customers);
    expect(r).toEqual([]);
  });

  it("respeita limite", () => {
    const r = suggestCustomerMatches("ST", customers, 1);
    expect(r.length).toBeLessThanOrEqual(1);
  });
});
