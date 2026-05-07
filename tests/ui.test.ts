import { describe, expect, it, vi } from "vitest";
import { assertOk, errorMessage, withToast } from "../lib/ui";

describe("errorMessage", () => {
  it("extrai message de Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });
  it("retorna string como está", () => {
    expect(errorMessage("texto")).toBe("texto");
  });
  it("converte outros valores via String()", () => {
    expect(errorMessage({ x: 1 })).toBe("[object Object]");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(42)).toBe("42");
  });
});

function fakeToast() {
  const success = vi.fn();
  const error = vi.fn();
  return { success, error };
}

describe("withToast", () => {
  it("chama success com a mensagem fixa quando a fn resolve", async () => {
    const t = fakeToast();
    const result = await withToast(t, async () => 42, {
      success: "Salvo!",
    });
    expect(result).toBe(42);
    expect(t.success).toHaveBeenCalledWith("Salvo!");
    expect(t.error).not.toHaveBeenCalled();
  });

  it("aceita função pra success que recebe o resultado", async () => {
    const t = fakeToast();
    const result = await withToast(t, async () => "X", {
      success: (r) => `Salvou ${r}`,
    });
    expect(result).toBe("X");
    expect(t.success).toHaveBeenCalledWith("Salvou X");
  });

  it("retorna null e chama error quando a fn rejeita", async () => {
    const t = fakeToast();
    const result = await withToast(
      t,
      async () => {
        throw new Error("falha de rede");
      },
      { success: "OK", failure: "Erro ao salvar" }
    );
    expect(result).toBeNull();
    expect(t.success).not.toHaveBeenCalled();
    expect(t.error).toHaveBeenCalledWith("Erro ao salvar: falha de rede");
  });

  it("usa 'Erro' como prefixo padrão quando failure não é dado", async () => {
    const t = fakeToast();
    await withToast(
      t,
      async () => {
        throw new Error("xx");
      },
      { success: "OK" }
    );
    expect(t.error).toHaveBeenCalledWith("Erro: xx");
  });

  it("converte exceção não-Error pra string", async () => {
    const t = fakeToast();
    await withToast(
      t,
      async () => {
        throw "string-throw";
      },
      { success: "OK" }
    );
    expect(t.error).toHaveBeenCalledWith("Erro: string-throw");
  });
});

describe("assertOk", () => {
  it("retorna data quando error é null", async () => {
    const result = await assertOk(
      Promise.resolve({ data: { x: 1 }, error: null })
    );
    expect(result).toEqual({ x: 1 });
  });

  it("joga Error quando error existe", async () => {
    await expect(
      assertOk(
        Promise.resolve({
          data: null,
          error: { message: "violou constraint" },
        })
      )
    ).rejects.toThrow("violou constraint");
  });
});
