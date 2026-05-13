"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Item = { id: string; label: string; sublabel?: string };

// Select com busca embutida — pra listas com 10+ opções (clientes, vendedores).
// Mobile-first: input grande, lista vira fullscreen quando aberta no celular.
export default function SearchableSelect({
  value,
  onChange,
  items,
  placeholder = "— Selecione —",
  emptyLabel = "Nenhum resultado",
  allowClear = true,
  label,
  required = false,
  disabled = false,
  prepend,
}: {
  value: string;
  onChange: (id: string) => void;
  items: Item[];
  placeholder?: string;
  emptyLabel?: string;
  allowClear?: boolean;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  // Renderiza um item especial no topo (ex.: "+ Novo cliente")
  prepend?: { label: string; onSelect: () => void; icon?: string };
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => items.find((i) => i.id === value) ?? null,
    [items, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        (i.sublabel ?? "").toLowerCase().includes(q)
    );
  }, [items, query]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Lock body scroll quando aberto no mobile (bottom-sheet feel).
  useEffect(() => {
    if (!open) return;
    const w = window.innerWidth;
    if (w >= 640) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      {label && <label className="label">{label}{required && <span className="text-red-700"> *</span>}</label>}
      <button
        type="button"
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
        className="input flex items-center justify-between text-left disabled:opacity-50"
      >
        <span className={selected ? "text-coco-900" : "text-coco-500"}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="text-coco-500 ml-2" aria-hidden>▾</span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30 sm:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className="
              fixed sm:absolute z-50
              inset-x-0 bottom-0 sm:inset-auto sm:top-full sm:left-0 sm:right-0
              sm:mt-1
              bg-white shadow-xl
              rounded-t-2xl sm:rounded-xl
              border border-coco-200
              max-h-[75dvh] sm:max-h-80
              flex flex-col
            "
            role="listbox"
          >
            <div className="p-2 border-b border-coco-100 sticky top-0 bg-white">
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar…"
                className="input"
                enterKeyHint="search"
              />
            </div>
            <ul className="overflow-y-auto flex-1 py-1">
              {prepend && (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      setQuery("");
                      prepend.onSelect();
                    }}
                    className="w-full text-left px-4 py-3 min-h-[48px] hover:bg-coco-50 text-coco-700 font-semibold border-b border-coco-100"
                  >
                    {prepend.icon ?? "＋"} {prepend.label}
                  </button>
                </li>
              )}
              {allowClear && value && (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      onChange("");
                      setOpen(false);
                      setQuery("");
                    }}
                    className="w-full text-left px-4 py-3 min-h-[48px] hover:bg-coco-50 text-coco-600"
                  >
                    ✕ Limpar seleção
                  </button>
                </li>
              )}
              {filtered.length === 0 ? (
                <li className="px-4 py-6 text-center text-coco-500 text-sm">
                  {emptyLabel}
                </li>
              ) : (
                filtered.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(i.id);
                        setOpen(false);
                        setQuery("");
                      }}
                      className={`w-full text-left px-4 py-3 min-h-[48px] hover:bg-coco-50 ${
                        i.id === value ? "bg-coco-50 font-semibold" : ""
                      }`}
                    >
                      <div>{i.label}</div>
                      {i.sublabel && (
                        <div className="text-xs text-coco-600">
                          {i.sublabel}
                        </div>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="p-2 border-t border-coco-100 sm:hidden">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn-ghost w-full btn-touch"
              >
                Fechar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
