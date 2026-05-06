"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { brl, fmtDate } from "@/lib/format";
import { useTenant } from "@/lib/useTenant";

type SaleHit = {
  id: string;
  code: number;
  total: number;
  created_at: string;
  customer_id: string | null;
};
type CustomerHit = { id: string; name: string; phone: string | null };
type CargaHit = { id: string; code: number; status: string; opened_at: string };

type Results = {
  sales: SaleHit[];
  customers: CustomerHit[];
  cargas: CargaHit[];
};

const EMPTY: Results = { sales: [], customers: [], cargas: [] };

export default function GlobalSearch() {
  const supabase = createClient();
  const router = useRouter();
  const { isAdmin, loading: tLoading } = useTenant();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>(EMPTY);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Atalho Cmd+K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else {
      setQuery("");
      setResults(EMPTY);
    }
  }, [open]);

  // Busca debounced
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(EMPTY);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const codeNum = q.replace(/^#/, "");
      const isNumeric = /^\d+$/.test(codeNum);

      // Vendas: por #code (se numérico) ou por observação
      const salesQ = isNumeric
        ? await supabase
            .from("sales")
            .select("id,code,total,created_at,customer_id")
            .eq("code", parseInt(codeNum, 10))
            .limit(5)
        : await supabase
            .from("sales")
            .select("id,code,total,created_at,customer_id")
            .ilike("notes", `%${q}%`)
            .order("created_at", { ascending: false })
            .limit(5);
      // Clientes: nome ou telefone
      const custsQ = await supabase
        .from("customers")
        .select("id,name,phone")
        .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
        .order("name")
        .limit(5);
      // Cargas: por #code
      const cargasQ = isNumeric
        ? await supabase
            .from("cargas")
            .select("id,code,status,opened_at")
            .eq("code", parseInt(codeNum, 10))
            .limit(3)
        : { data: [] as CargaHit[] };

      setResults({
        sales: (salesQ.data ?? []) as SaleHit[],
        customers: (custsQ.data ?? []) as CustomerHit[],
        cargas: (cargasQ.data ?? []) as CargaHit[],
      });
      setSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, supabase]);

  // Não mostra atalho/UI pra operador (escopo de busca não é relevante).
  if (tLoading || !isAdmin) return null;

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  const hasAny =
    results.sales.length + results.customers.length + results.cargas.length > 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-30 bg-coco-600 text-white rounded-full shadow-lg w-12 h-12 flex items-center justify-center hover:bg-coco-700 sm:hidden"
        aria-label="Abrir busca global"
        title="Buscar (Ctrl+K)"
      >
        🔎
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 pt-20"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3 border-b border-coco-100">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Busque por #venda, cliente, telefone, #carga…"
                className="input w-full"
                aria-label="Busca global"
              />
              <p className="text-xs text-coco-500 mt-1">
                Atalho: Ctrl+K (ou ⌘K). Esc fecha.
              </p>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {!query.trim() && (
                <p className="p-4 text-coco-600 text-sm">
                  Digite pra buscar. Use <code>#</code> + número pra ir
                  direto numa venda ou carga.
                </p>
              )}
              {query.trim() && searching && (
                <p className="p-4 text-coco-600 text-sm">Buscando…</p>
              )}
              {query.trim() && !searching && !hasAny && (
                <p className="p-4 text-coco-600 text-sm">
                  Nada encontrado pra "{query}".
                </p>
              )}
              {results.sales.length > 0 && (
                <Section title="Vendas">
                  {results.sales.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => go(`/recibo/${s.id}`)}
                      className="w-full text-left px-4 py-2 hover:bg-coco-50 flex items-center justify-between"
                    >
                      <span>
                        <span className="font-mono text-coco-500">
                          #{s.code}
                        </span>{" "}
                        · {fmtDate(s.created_at)}
                      </span>
                      <span className="font-semibold">
                        {brl(Number(s.total))}
                      </span>
                    </button>
                  ))}
                </Section>
              )}
              {results.customers.length > 0 && (
                <Section title="Clientes">
                  {results.customers.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => go(`/clientes/${c.id}`)}
                      className="w-full text-left px-4 py-2 hover:bg-coco-50 flex items-center justify-between"
                    >
                      <span>{c.name}</span>
                      <span className="text-xs text-coco-600">
                        {c.phone ?? "—"}
                      </span>
                    </button>
                  ))}
                </Section>
              )}
              {results.cargas.length > 0 && (
                <Section title="Cargas">
                  {results.cargas.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => go(`/cargas/${c.id}`)}
                      className="w-full text-left px-4 py-2 hover:bg-coco-50 flex items-center justify-between"
                    >
                      <span>
                        <span className="font-mono text-coco-500">
                          #{c.code}
                        </span>{" "}
                        · {fmtDate(c.opened_at)}
                      </span>
                      <span className="text-xs text-coco-600">{c.status}</span>
                    </button>
                  ))}
                </Section>
              )}
            </div>
            <div className="p-2 border-t border-coco-100 text-right">
              <Link
                href="/relatorios"
                onClick={() => setOpen(false)}
                className="text-xs text-coco-700 underline"
              >
                Busca avançada em /relatorios →
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-coco-100 last:border-b-0">
      <div className="px-4 py-1 bg-coco-50 text-xs uppercase tracking-wider text-coco-700 font-semibold">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}
