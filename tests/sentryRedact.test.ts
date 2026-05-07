import { describe, expect, it } from "vitest";
import { redactPii, sentryBeforeSend } from "../lib/sentryRedact";

describe("redactPii", () => {
  it("redige chaves sensíveis no top-level", () => {
    const out = redactPii({ cpf: "123.456.789-00", name: "João" });
    expect(out).toEqual({ cpf: "[REDACTED]", name: "João" });
  });

  it("redige recursivamente", () => {
    const out = redactPii({
      user: { name: "Ana", senha: "abc123" },
      meta: { token: "sk-xxx" },
    });
    expect(out).toEqual({
      user: { name: "Ana", senha: "[REDACTED]" },
      meta: { token: "[REDACTED]" },
    });
  });

  it("redige em arrays", () => {
    const out = redactPii([{ password: "p" }, { name: "x" }]);
    expect(out).toEqual([{ password: "[REDACTED]" }, { name: "x" }]);
  });

  it("trunca data URLs longas", () => {
    const dataUrl = "data:image/png;base64," + "A".repeat(5000);
    const out = redactPii({ signature_data_url: dataUrl });
    // Chave está na blocklist, então vira REDACTED
    expect(out).toEqual({ signature_data_url: "[REDACTED]" });
  });

  it("trunca data URLs em chave NÃO sensível também", () => {
    const dataUrl = "data:image/png;base64," + "A".repeat(5000);
    const out = redactPii({ avatar: dataUrl });
    expect(out).toEqual({ avatar: "[REDACTED:data-url]" });
  });

  it("trunca strings muito longas", () => {
    const s = "x".repeat(3000);
    const out = redactPii({ note: s });
    expect((out as { note: string }).note.length).toBeLessThan(2100);
    expect((out as { note: string }).note.endsWith("…")).toBe(true);
  });

  it("é case-insensitive nas chaves", () => {
    const out = redactPii({ CPF: "123", Authorization: "Bearer x" });
    expect(out).toEqual({ CPF: "[REDACTED]", Authorization: "[REDACTED]" });
  });

  it("não modifica primitivos", () => {
    expect(redactPii(42)).toBe(42);
    expect(redactPii(null)).toBe(null);
    expect(redactPii(true)).toBe(true);
  });

  it("limita profundidade pra evitar recursão infinita", () => {
    const obj: Record<string, unknown> = {};
    let cur = obj;
    for (let i = 0; i < 20; i++) {
      cur.next = { cpf: "123" };
      cur = cur.next as Record<string, unknown>;
    }
    // Não deve estourar — só verifica que não joga
    expect(() => redactPii(obj)).not.toThrow();
  });
});

describe("sentryBeforeSend", () => {
  it("é wrapper de redactPii pra eventos Sentry", () => {
    const event = {
      message: "erro",
      extra: { signer_document: "111.222.333-44" },
      contexts: { user: { cpf: "123" } },
      request: {
        data: { senha: "secret" },
        headers: { Authorization: "Bearer x" },
      },
    };
    const out = sentryBeforeSend(event);
    expect(out).toEqual({
      message: "erro",
      extra: { signer_document: "[REDACTED]" },
      contexts: { user: { cpf: "[REDACTED]" } },
      request: {
        data: { senha: "[REDACTED]" },
        headers: { Authorization: "[REDACTED]" },
      },
    });
  });
});
