"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";

const items = [
  { href: "/", label: "Painel", icon: "📊" },
  { href: "/vendas", label: "Venda Rápida", icon: "🥥" },
  { href: "/clientes", label: "Clientes", icon: "👥" },
  { href: "/formas-pagamento", label: "Formas de Pagamento", icon: "💳" },
  { href: "/receber", label: "Contas a Receber", icon: "📒" },
  { href: "/caixa", label: "Caixa", icon: "💵" },
  { href: "/despesas", label: "Despesas", icon: "💸" },
  { href: "/estoque", label: "Estoque", icon: "📦" },
  { href: "/financeiro", label: "Financeiro", icon: "💰" },
  { href: "/relatorios", label: "Relatórios", icon: "📈" },
  { href: "/configuracoes", label: "Configurações", icon: "⚙️" },
];

export default function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState<string | null>(null);

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

  return (
    <aside className="w-60 bg-coco-800 text-coco-50 hidden md:flex flex-col py-6 px-4 sticky top-0 h-screen">
      <div className="px-2 mb-8">
        <div className="text-2xl font-bold">🥥 Coco</div>
        <div className="text-coco-200 text-xs uppercase tracking-widest">
          da Amazônia
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto">
        {items.map((it) => {
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
          <div className="text-coco-200 text-xs truncate mb-2" title={email}>
            👤 {email}
          </div>
        )}
        <button
          onClick={logout}
          className="text-coco-200 hover:text-white text-sm w-full text-left"
        >
          ↩ Sair
        </button>
        <div className="text-xs text-coco-300 mt-3">v0.2 · Supabase + Vercel</div>
      </div>
    </aside>
  );
}
