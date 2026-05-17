"use client";

import { useEffect, useState } from "react";
import { listQueue, flushQueue } from "@/lib/offlineQueue";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "./Toast";

function timeAgo(ts: number | null): string {
  if (!ts) return "nunca";
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "agora há pouco";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  return `${d} dia${d === 1 ? "" : "s"} atrás`;
}

export default function SyncStatus() {
  const supabase = createClient();
  const toast = useToast();
  const [pending, setPending] = useState(0);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [busy, setBusy] = useState(false);

  function readLastSync() {
    try {
      const raw = localStorage.getItem("offline.lastSyncAt");
      setLastSync(raw ? Number(raw) : null);
    } catch {
      setLastSync(null);
    }
  }

  async function refresh() {
    const items = await listQueue();
    setPending(items.length);
    readLastSync();
  }

  async function syncNow() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await flushQueue(supabase);
      if (r.flushed > 0) toast.success(`${r.flushed} venda(s) sincronizada(s).`);
      else if (r.failed === 0) toast.info("Tudo sincronizado.");
      if (r.failed > 0) toast.warn(`${r.failed} pendente(s) — sem conexão.`);
      if (r.failed === 0) {
        try {
          localStorage.setItem("offline.lastSyncAt", String(Date.now()));
          window.dispatchEvent(new Event("offline-sync-changed"));
        } catch {}
      }
    } finally {
      setBusy(false);
      refresh();
    }
  }

  useEffect(() => {
    refresh();
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    const onChange = () => refresh();
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    window.addEventListener("offline-sync-changed", onChange);
    const interval = setInterval(refresh, 15000);
    return () => {
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
      window.removeEventListener("offline-sync-changed", onChange);
      clearInterval(interval);
    };
  }, []);

  const trouble = pending > 0 || !online;

  return (
    <div
      className={`rounded-xl border p-3 flex items-center justify-between gap-3 text-sm ${
        trouble
          ? "bg-amber-50 border-amber-200 text-amber-900"
          : "bg-green-50 border-green-200 text-green-900"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-lg" aria-hidden="true">
          {trouble ? "⏳" : "✅"}
        </span>
        <div className="min-w-0">
          <div className="font-semibold">
            {!online
              ? "Sem conexão"
              : pending > 0
              ? `${pending} venda(s) na fila`
              : "Tudo sincronizado"}
          </div>
          <div className="text-xs opacity-80 truncate">
            Última sync: {timeAgo(lastSync)}
          </div>
        </div>
      </div>
      <button
        onClick={syncNow}
        disabled={busy || !online}
        className="btn-secondary text-xs px-3 py-1 whitespace-nowrap"
      >
        {busy ? "Sincronizando…" : "Sincronizar agora"}
      </button>
    </div>
  );
}
