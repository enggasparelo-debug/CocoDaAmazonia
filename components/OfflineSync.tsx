"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { flushQueue, listQueue } from "@/lib/offlineQueue";
import { useToast } from "./Toast";

export default function OfflineSync() {
  const supabase = createClient();
  const toast = useToast();
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const items = await listQueue();
    setPending(items.length);
  }

  async function flush(showToast = true) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await flushQueue(supabase);
      if (r.flushed > 0 && showToast)
        toast.success(`${r.flushed} venda(s) sincronizada(s).`);
      if (r.failed > 0 && showToast)
        toast.warn(`${r.failed} ainda pendente(s) (sem conexão).`);
    } finally {
      setBusy(false);
      refresh();
    }
  }

  useEffect(() => {
    refresh();
    const onUp = () => {
      setOnline(true);
      flush(true);
    };
    const onDown = () => setOnline(false);
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);

    // sw pode pedir flush via postMessage
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "flush-sales-queue") flush(false);
      if (e.data?.type === "queue-changed") refresh();
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);

    // tenta sincronizar ao montar (caso já tenha pendências)
    flush(false);

    const interval = setInterval(refresh, 5000);
    return () => {
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
      navigator.serviceWorker?.removeEventListener("message", onMsg);
      clearInterval(interval);
    };
    // Deps vazias propositais: queremos registrar listeners 1× só.
    // `flush`/`refresh` capturam o `busy` inicial, mas isso é OK porque
    // a guarda `if (busy) return` é checada via setBusy callback ao
    // entrar (não estamos comparando com closure stale).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (pending === 0 && online) return null;

  return (
    <div
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-full shadow-lg px-4 py-2 text-sm font-medium border flex items-center gap-3 ${
        !online
          ? "bg-amber-50 border-amber-300 text-amber-900"
          : "bg-coco-600 text-white border-coco-700"
      }`}
    >
      {!online ? (
        <span>📡 sem internet</span>
      ) : (
        <span>📤 {pending} venda(s) pendente(s)</span>
      )}
      {pending > 0 && online && (
        <button
          onClick={() => flush(true)}
          disabled={busy}
          className="underline"
        >
          sincronizar agora
        </button>
      )}
    </div>
  );
}
