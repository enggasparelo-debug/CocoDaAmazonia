"use client";

import { useEffect, useState } from "react";
import { errorMessage } from "@/lib/ui";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "./Toast";

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = typeof window !== "undefined" ? window.atob(b) : Buffer.from(b, "base64").toString("binary");
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export default function PushOptIn() {
  const supabase = createClient();
  const toast = useToast();
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(ok);
    if (!ok) return;
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(!!sub);
    });
  }, []);

  async function subscribe() {
    if (!VAPID_KEY) {
      toast.error(
        "Push não configurado: defina NEXT_PUBLIC_VAPID_PUBLIC_KEY no Vercel."
      );
      return;
    }
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast.warn("Permissão de notificação negada.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
      });
      const json = sub.toJSON();
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          endpoint: json.endpoint!,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
        },
        { onConflict: "endpoint" }
      );
      if (error) throw error;
      setSubscribed(true);
      toast.success("Notificações ativadas.");
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast.info("Notificações desativadas.");
    } catch (e: unknown) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <p className="text-sm text-coco-700">
        Este dispositivo não suporta notificações push.
      </p>
    );
  }

  return (
    <div className="text-sm">
      <p className="text-coco-700 mb-2">
        Receba alertas de fiado vencido, estoque baixo e caixa aberto há muito
        tempo.
      </p>
      {subscribed ? (
        <button
          onClick={unsubscribe}
          disabled={busy}
          className="btn-secondary"
        >
          {busy ? "…" : "Desativar notificações"}
        </button>
      ) : (
        <button onClick={subscribe} disabled={busy} className="btn-primary">
          {busy ? "…" : "Ativar notificações"}
        </button>
      )}
      {!VAPID_KEY && (
        <p className="text-xs text-amber-700 mt-2">
          ⚠️ Variável NEXT_PUBLIC_VAPID_PUBLIC_KEY não definida. O push só fica
          disponível depois de configurar (veja README).
        </p>
      )}
    </div>
  );
}
