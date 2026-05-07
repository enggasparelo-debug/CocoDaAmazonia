"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Atalhos globais (Cmd/Ctrl + Shift + tecla):
//   N → /vendas (nova venda)
//   R → /carga/abrir (abrir carga)
//   W → carga aberta atual ou /cargas
//
// Cmd+K já é tratado por GlobalSearch.

export default function KeyboardShortcuts() {
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function onKey(e: KeyboardEvent) {
      // Só escuta Cmd/Ctrl + Shift + letra. Sem Shift, não.
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      // Ignora se foco em input/textarea/select editável.
      const tag = (e.target as HTMLElement | null)?.tagName;
      const editable = (e.target as HTMLElement | null)?.isContentEditable;
      if (tag === "INPUT" || tag === "TEXTAREA" || editable) return;

      const key = e.key.toLowerCase();
      if (key === "n") {
        e.preventDefault();
        router.push("/vendas");
        return;
      }
      if (key === "r") {
        e.preventDefault();
        router.push("/carga/abrir");
        return;
      }
      if (key === "w") {
        e.preventDefault();
        // Tenta achar carga aberta atual; se não, vai pra lista
        const { data } = await supabase
          .from("cargas")
          .select("id")
          .eq("status", "aberta")
          .order("opened_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const id = (data as { id: string } | null)?.id;
        router.push(id ? `/cargas/${id}` : "/cargas");
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, supabase]);

  return null;
}
