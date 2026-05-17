"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useMemo, useState } from "react";
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
  indent,
}: {
  item: NavItem;
  active: boolean;
  badge?: number;
  indent?: boolean;
}) {
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 px-3 py-2 rounded-xl transition ${
        indent ? "ml-3" : ""
      } ${active ? "bg-coco-600 text-white" : "text-coco-100 hover:bg-coco-700"}`}
    >
      <span className="text-lg">{item.icon}</span>
      <span className="font-medium text-sm flex-1">{item.label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="bg-red-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
          {badge}
        </span>
      )}
    </Link>
  );
}

export default function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState<string | null>(null);
  const { tenant, isAdmin, membership } = useTenant();
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, [supabase]);

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

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const role: Role = (membership?.role ?? "operador") as Role;
  const visible = useMemo(() => filterNavForRole(navEntries, role), [role]);
  const activeHref = findActiveHref(visible, path);
  const activeGroup = findActiveGroup(visible, activeHref);
  const payablesAlert = usePayablesAlert();

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

  return (
    <aside className="w-60 bg-coco-800 text-coco-50 hidden md:flex flex-col py-6 px-4 sticky top-0 h-screen">
      <div className="px-2 mb-8">
        <div className="text-2xl font-bold">🥥 Coco</div>
        <div className="text-coco-200 text-xs uppercase tracking-widest">
          {tenant?.name ?? "da Amazônia"}
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto">
        {visible.map((entry) => {
          if (!isGroup(entry)) {
            const badge = entry.href === "/pagar" ? payablesAlert : undefined;
            return (
              <ItemLink
                key={entry.href}
                item={entry}
                active={entry.href === activeHref}
                badge={badge}
              />
            );
          }
          const open = openGroups.has(entry.key);
          const hasPagar = entry.items.some((i) => i.href === "/pagar");
          const groupBadge = !open && hasPagar ? payablesAlert : 0;
          return (
            <div key={entry.key}>
              <button
                type="button"
                onClick={() => toggleGroup(entry.key)}
                aria-expanded={open}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-coco-100 hover:bg-coco-700 transition"
              >
                <span className="text-lg">{entry.icon}</span>
                <span className="font-medium text-sm flex-1 text-left">{entry.label}</span>
                {groupBadge > 0 && (
                  <span className="bg-red-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                    {groupBadge}
                  </span>
                )}
                <span className="text-xs text-coco-300">{open ? "▾" : "▸"}</span>
              </button>
              {open && (
                <div className="mt-1 space-y-1">
                  {entry.items.map((it) => (
                    <ItemLink
                      key={it.href}
                      item={it}
                      active={it.href === activeHref}
                      badge={it.href === "/pagar" ? payablesAlert : undefined}
                      indent
                    />
                  ))}
                </div>
              )}
            </div>
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
