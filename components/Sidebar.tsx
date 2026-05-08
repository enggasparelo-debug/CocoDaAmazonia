"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
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
  { href: "/pagar", label: "Contas a Pagar", icon: "🧾", roles: ["admin"] },
  { href: "/caixa", label: "Caixa", icon: "💵", roles: ["admin"] },
  { href: "/despesas", label: "Despesas", icon: "💸", roles: ["admin"] },
  { href: "/estoque", label: "Estoque", icon: "📦", roles: ["admin"] },
  { href: "/financeiro", label: "Financeiro", icon: "💰", roles: ["admin"] },
  { href: "/operadores", label: "Operadores", icon: "🧑‍💼", roles: ["admin"] },
  { href: "/relatorios", label: "Relatórios", icon: "📈", roles: ["admin"] },
  { href: "/exportar", label: "Exportar Contador", icon: "📤", roles: ["admin"] },
  { href: "/configuracoes", label: "Configurações", icon: "⚙️", roles: ["admin"] },
  { href: "/auditoria", label: "Auditoria", icon: "🔍", roles: ["admin"] },
];

export default function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState<string | null>(null);
  const { tenant, isAdmin, membership } = useTenant();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, [supabase]);

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const role: Role = (membership?.role ?? "operador") as Role;
  const visible = items.filter((i) => i.roles.includes(role));

  return (
    <aside className="w-60 bg-coco-800 text-coco-50 hidden md:flex flex-col py-6 px-4 sticky top-0 h-screen">
      <div className="px-2 mb-8">
        <div className="text-2xl font-bold">🥥 Coco</div>
        <div className="text-coco-200 text-xs uppercase tracking-widest">
          {tenant?.name ?? "da Amazônia"}
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto">
        {visible.map((it) => {
          const active =
            it.href === "/" ? path === "/" : path.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl transition ${
                active
                  ? "bg-coco-600 text-white"
                  : "text-coco-100 hover:bg-coco-700"
              }`}
            >
              <span className="text-lg">{it.icon}</span>
              <span className="font-medium text-sm">{it.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-coco-700 pt-3 mt-3 px-2">
        {email && (
          <div className="text-coco-200 text-xs truncate mb-1" title={email}>
            👤 {email}
            {isAdmin ? (
              <span className="ml-1 text-coco-300">(admin)</span>
            ) : (
              <span className="ml-1 text-coco-300">(operador)</span>
            )}
          </div>
        )}
        <button
          onClick={logout}
          className="text-coco-200 hover:text-white text-sm w-full text-left"
        >
          ↩ Sair
        </button>
        <div className="text-xs text-coco-300 mt-3">v0.4 · Supabase + Vercel</div>
      </div>
    </aside>
  );
}
