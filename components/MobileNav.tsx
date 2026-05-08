"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useTenant } from "@/lib/useTenant";

type Role = "admin" | "operador";
type NavItem = {
  href: string;
  label: string;
  icon: string;
  roles: Role[];
};

const items: NavItem[] = [
  { href: "/", label: "Painel", icon: "📊", roles: ["admin"] },
  { href: "/carga", label: "Minha Carga", icon: "🚚", roles: ["operador", "admin"] },
  { href: "/vendas", label: "Venda Rápida", icon: "🥥", roles: ["admin"] },
  { href: "/cargas", label: "Cargas", icon: "📋", roles: ["admin"] },
  { href: "/clientes", label: "Clientes", icon: "👥", roles: ["admin", "operador"] },
  { href: "/formas-pagamento", label: "Formas de Pagamento", icon: "💳", roles: ["admin"] },
  { href: "/receber", label: "Contas a Receber", icon: "📒", roles: ["admin"] },
  { href: "/caixa", label: "Caixa", icon: "💵", roles: ["admin"] },
  { href: "/despesas", label: "Despesas", icon: "💸", roles: ["admin"] },
  { href: "/conciliacao", label: "Conciliação Bancária", icon: "🏦", roles: ["admin"] },
  { href: "/estoque", label: "Estoque", icon: "📦", roles: ["admin"] },
  { href: "/financeiro", label: "Financeiro", icon: "💰", roles: ["admin"] },
  { href: "/operadores", label: "Operadores", icon: "🧑‍💼", roles: ["admin"] },
  { href: "/relatorios", label: "Relatórios", icon: "📈", roles: ["admin"] },
  { href: "/configuracoes", label: "Configurações", icon: "⚙️", roles: ["admin"] },
  { href: "/auditoria", label: "Auditoria", icon: "🔍", roles: ["admin"] },
];

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { membership, isAdmin } = useTenant();
  const role: Role = (membership?.role ?? "operador") as Role;
  const visible = items.filter((i) => i.roles.includes(role));
  const quickHref = isAdmin ? "/vendas" : "/carga";

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <header className="md:hidden fixed top-0 inset-x-0 z-30 bg-coco-800 text-white flex items-center justify-between px-4 h-14">
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          className="text-2xl"
        >
          ☰
        </button>
        <div className="font-bold">🥥 Coco da Amazônia</div>
        <Link href={quickHref} className="text-2xl" aria-label="Atalho">
          ＋
        </Link>
      </header>

      {open && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setOpen(false)}>
          <div
            className="absolute left-0 top-0 bottom-0 w-72 bg-coco-800 text-coco-50 flex flex-col p-4 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="text-xl font-bold">🥥 Coco</div>
              <button
                onClick={() => setOpen(false)}
                className="text-2xl min-h-[44px] min-w-[44px]"
                aria-label="Fechar menu"
              >
                ×
              </button>
            </div>
            <nav className="space-y-1 flex-1">
              {visible.map((it) => {
                const active =
                  it.href === "/" ? path === "/" : path.startsWith(it.href);
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-xl ${
                      active ? "bg-coco-600 text-white" : "hover:bg-coco-700"
                    }`}
                  >
                    <span className="text-lg">{it.icon}</span>
                    <span>{it.label}</span>
                  </Link>
                );
              })}
            </nav>
            <button onClick={logout} className="btn-secondary mt-4">
              Sair
            </button>
          </div>
        </div>
      )}
    </>
  );
}
