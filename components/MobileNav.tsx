"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useTenant } from "@/lib/useTenant";
import { usePayablesAlert } from "@/lib/usePayablesAlert";
import {
  Role,
  NavItem,
  isGroup,
  navEntries,
  filterNavForRole,
  findActiveHref,
  findActiveGroup,
} from "@/lib/navItems";

const STORAGE_KEY = "nav.openGroups";

function ItemLink({
  item,
  active,
  badge,
  onClick,
  indent,
}: {
  item: NavItem;
  active: boolean;
  badge?: number;
  onClick: () => void;
  indent?: boolean;
}) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2 rounded-xl ${
        indent ? "ml-3" : ""
      } ${active ? "bg-coco-600 text-white" : "hover:bg-coco-700"}`}
    >
      <span className="text-lg">{item.icon}</span>
      <span className="flex-1">{item.label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="bg-red-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
          {badge}
        </span>
      )}
    </Link>
  );
}

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { membership, isAdmin } = useTenant();
  const role: Role = (membership?.role ?? "operador") as Role;
  const visible = useMemo(() => filterNavForRole(navEntries, role), [role]);
  const quickHref = isAdmin ? "/vendas" : "/carga";
  const payablesAlert = usePayablesAlert();
  const activeHref = findActiveHref(visible, path);
  const activeGroup = findActiveGroup(visible, activeHref);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setOpenGroups(new Set(JSON.parse(raw)));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...openGroups]));
    } catch {}
  }, [openGroups]);

  useEffect(() => {
    if (activeGroup) {
      setOpenGroups((prev) => {
        if (prev.has(activeGroup)) return prev;
        const next = new Set(prev);
        next.add(activeGroup);
        return next;
      });
    }
  }, [activeGroup]);

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
              {visible.map((entry) => {
                if (!isGroup(entry)) {
                  return (
                    <ItemLink
                      key={entry.href}
                      item={entry}
                      active={entry.href === activeHref}
                      badge={entry.href === "/pagar" ? payablesAlert : undefined}
                      onClick={() => setOpen(false)}
                    />
                  );
                }
                const isOpen = openGroups.has(entry.key);
                const hasPagar = entry.items.some((i) => i.href === "/pagar");
                const groupBadge = !isOpen && hasPagar ? payablesAlert : 0;
                return (
                  <div key={entry.key}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(entry.key)}
                      aria-expanded={isOpen}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-coco-700"
                    >
                      <span className="text-lg">{entry.icon}</span>
                      <span className="flex-1 text-left font-medium">{entry.label}</span>
                      {groupBadge > 0 && (
                        <span className="bg-red-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                          {groupBadge}
                        </span>
                      )}
                      <span className="text-xs text-coco-300">{isOpen ? "▾" : "▸"}</span>
                    </button>
                    {isOpen && (
                      <div className="mt-1 space-y-1">
                        {entry.items.map((it) => (
                          <ItemLink
                            key={it.href}
                            item={it}
                            active={it.href === activeHref}
                            badge={it.href === "/pagar" ? payablesAlert : undefined}
                            onClick={() => setOpen(false)}
                            indent
                          />
                        ))}
                      </div>
                    )}
                  </div>
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
