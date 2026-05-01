import { describe, it, expect } from "vitest";

// Lógica espelhando regras de Vendedor (sellers) testáveis sem subir banco.

type SellerLite = { id: string; user_id: string | null; active: boolean };
type SaleDraft = {
  qty: number;
  unitPrice: number;
  sellerId: string | null;
  saleDate?: string;
};

// Replica do validate() de app/vendas/page.tsx
function validateAdminSale(s: SaleDraft): string | null {
  if (s.qty <= 0) return "Informe a quantidade.";
  if (s.unitPrice <= 0) return "Informe o valor unitário.";
  if (!s.sellerId) return "Selecione um vendedor.";
  return null;
}

// "Operador sem vendedor vinculado" — espelha o guard de CargaSaleForm
function operatorBlocked(seller: SellerLite | null): boolean {
  return !seller;
}

// Sellers ativos disponíveis pra select
function activeSellers(all: SellerLite[]): SellerLite[] {
  return all.filter((s) => s.active);
}

// user_ids já vinculados a outros vendedores (pra esconder do select de "vincular login")
function usedUserIds(
  sellers: SellerLite[],
  excludingSellerId: string | null
): Set<string> {
  return new Set(
    sellers
      .filter((s) => s.user_id && s.id !== excludingSellerId)
      .map((s) => s.user_id as string)
  );
}

describe("validateAdminSale — vendedor obrigatório", () => {
  it("falha se não tem vendedor", () => {
    expect(
      validateAdminSale({ qty: 1, unitPrice: 5, sellerId: null })
    ).toBe("Selecione um vendedor.");
    expect(
      validateAdminSale({ qty: 1, unitPrice: 5, sellerId: "" })
    ).toBe("Selecione um vendedor.");
  });
  it("passa quando todos os campos estão preenchidos", () => {
    expect(
      validateAdminSale({ qty: 2, unitPrice: 3.5, sellerId: "s1" })
    ).toBeNull();
  });
  it("ainda valida quantidade/preço antes do vendedor", () => {
    expect(
      validateAdminSale({ qty: 0, unitPrice: 5, sellerId: "s1" })
    ).toBe("Informe a quantidade.");
  });
});

describe("operatorBlocked — sem vendedor vinculado", () => {
  it("bloqueia operador sem seller", () => {
    expect(operatorBlocked(null)).toBe(true);
  });
  it("libera operador com seller ativo", () => {
    expect(
      operatorBlocked({ id: "s1", user_id: "u1", active: true })
    ).toBe(false);
  });
});

describe("activeSellers", () => {
  it("filtra inativos", () => {
    const all: SellerLite[] = [
      { id: "a", user_id: "u1", active: true },
      { id: "b", user_id: "u2", active: false },
      { id: "c", user_id: null, active: true },
    ];
    expect(activeSellers(all).map((s) => s.id)).toEqual(["a", "c"]);
  });
});

describe("usedUserIds — evita duplicar vínculo", () => {
  const sellers: SellerLite[] = [
    { id: "a", user_id: "u1", active: true },
    { id: "b", user_id: "u2", active: true },
    { id: "c", user_id: null, active: true },
  ];
  it("retorna user_ids ocupados", () => {
    expect(usedUserIds(sellers, null)).toEqual(new Set(["u1", "u2"]));
  });
  it("ignora o próprio vendedor sendo editado", () => {
    expect(usedUserIds(sellers, "a")).toEqual(new Set(["u2"]));
  });
});
