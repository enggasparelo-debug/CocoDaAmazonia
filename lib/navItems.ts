export type Role = "admin" | "operador";

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  roles: Role[];
};

export type NavGroup = {
  key: string;
  label: string;
  icon: string;
  items: NavItem[];
};

export type NavEntry = NavItem | NavGroup;

export function isGroup(entry: NavEntry): entry is NavGroup {
  return (entry as NavGroup).items !== undefined;
}

export const navEntries: NavEntry[] = [
  { href: "/", label: "Painel", icon: "📊", roles: ["admin"] },
  {
    key: "operacao",
    label: "Operação",
    icon: "🥥",
    items: [
      { href: "/vendas", label: "Venda Rápida", icon: "🥥", roles: ["admin"] },
      { href: "/carga", label: "Minha Carga", icon: "🚚", roles: ["operador", "admin"] },
      { href: "/cargas", label: "Cargas", icon: "📋", roles: ["admin"] },
      { href: "/estoque", label: "Estoque", icon: "📦", roles: ["admin"] },
      { href: "/vendas/importar", label: "Importar Excel", icon: "📥", roles: ["admin"] },
    ],
  },
  {
    key: "cadastros",
    label: "Cadastros",
    icon: "👥",
    items: [
      { href: "/clientes", label: "Clientes", icon: "👥", roles: ["admin", "operador"] },
      { href: "/fornecedores", label: "Fornecedores", icon: "🏭", roles: ["admin"] },
      { href: "/operadores", label: "Operadores", icon: "🧑‍💼", roles: ["admin"] },
      { href: "/formas-pagamento", label: "Formas de Pagamento", icon: "💳", roles: ["admin"] },
    ],
  },
  {
    key: "financeiro",
    label: "Financeiro",
    icon: "💰",
    items: [
      { href: "/caixa", label: "Caixa", icon: "💵", roles: ["admin"] },
      { href: "/receber", label: "Contas a Receber", icon: "📒", roles: ["admin"] },
      { href: "/pagar", label: "Contas a Pagar", icon: "🧾", roles: ["admin"] },
      { href: "/fluxo-caixa", label: "Fluxo de Caixa", icon: "📉", roles: ["admin"] },
      { href: "/conciliacao", label: "Conciliação Bancária", icon: "🏦", roles: ["admin"] },
      { href: "/financeiro", label: "Financeiro (KPIs)", icon: "💰", roles: ["admin"] },
      { href: "/financeiro/dre", label: "DRE", icon: "📊", roles: ["admin"] },
    ],
  },
  {
    key: "sistema",
    label: "Sistema",
    icon: "⚙️",
    items: [
      { href: "/relatorios", label: "Relatórios", icon: "📈", roles: ["admin"] },
      { href: "/exportar", label: "Exportar Contador", icon: "📤", roles: ["admin"] },
      { href: "/auditoria", label: "Auditoria", icon: "🔍", roles: ["admin"] },
      { href: "/configuracoes", label: "Configurações", icon: "⚙️", roles: ["admin"] },
    ],
  },
];

export function filterNavForRole(entries: NavEntry[], role: Role): NavEntry[] {
  const out: NavEntry[] = [];
  for (const e of entries) {
    if (!isGroup(e)) {
      if (e.roles.includes(role)) out.push(e);
      continue;
    }
    const items = e.items.filter((i) => i.roles.includes(role));
    if (items.length === 0) continue;
    if (items.length === 1) {
      out.push(items[0]);
    } else {
      out.push({ ...e, items });
    }
  }
  return out;
}

export function findActiveHref(entries: NavEntry[], path: string): string | undefined {
  const all: NavItem[] = entries.flatMap((e) => (isGroup(e) ? e.items : [e]));
  return all
    .filter((i) =>
      i.href === "/" ? path === "/" : path === i.href || path.startsWith(i.href + "/")
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function findActiveGroup(
  entries: NavEntry[],
  activeHref: string | undefined
): string | undefined {
  if (!activeHref) return undefined;
  for (const e of entries) {
    if (isGroup(e) && e.items.some((i) => i.href === activeHref)) return e.key;
  }
  return undefined;
}
