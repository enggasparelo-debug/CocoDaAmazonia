// Edge Function: notify-admin
//
// Roda periodicamente (configurar via supabase cron schedule) e
// dispara push notifications pros admins de cada tenant baseado em 4
// gatilhos:
//   1) Estoque ≤ mínimo
//   2) Carga aberta há mais de 24h
//   3) Caixa aberto há mais de 24h
//   4) Cliente com fiado em aberto há mais de 30 dias
//
// Pra evitar spam, mantém uma tabela `notification_log` com a
// combinação (tenant_id, kind, key) e a última hora que foi notificado.
// Se o gatilho for re-disparado dentro de 24h, ignora.
//
// SCHEDULE (configurar no dashboard Supabase → Edge Functions → cron):
//   0 8-20/2 * * *   (a cada 2 horas, das 8h às 20h)
//
// VARIÁVEIS DE AMBIENTE NECESSÁRIAS:
//   SUPABASE_URL                  (default do runtime)
//   SUPABASE_SERVICE_ROLE_KEY     (default do runtime)
//   VAPID_PUBLIC_KEY              (gere com web-push generate-vapid-keys)
//   VAPID_PRIVATE_KEY
//   VAPID_SUBJECT                 (mailto: ou URL)
//
// DEPLOY:
//   supabase functions deploy notify-admin --no-verify-jwt
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:...
//
// Esta function NÃO é chamada pelo client — só pelo cron interno do
// Supabase (que invoca via service role).

// @ts-expect-error Deno runtime types resolvem só no deploy
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-expect-error Deno runtime types resolvem só no deploy
import webpush from "https://esm.sh/web-push@3.6.6";

type Subscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

type NotificationKind =
  | "estoque_baixo"
  | "carga_aberta_24h"
  | "caixa_aberto_24h"
  | "fiado_velho";

const SUPRESSION_HOURS = 24;

// @ts-expect-error Deno runtime
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
// @ts-expect-error Deno runtime
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// @ts-expect-error Deno runtime
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
// @ts-expect-error Deno runtime
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
// @ts-expect-error Deno runtime
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@coco";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

// @ts-expect-error Deno runtime
Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const tenants = await supabase.from("tenants").select("id, name");
  const events: {
    tenant_id: string;
    kind: NotificationKind;
    key: string;
    title: string;
    body: string;
    url: string;
  }[] = [];

  for (const t of (tenants.data ?? []) as { id: string; name: string }[]) {
    // 1) Estoque baixo
    const { data: stock } = await supabase
      .from("inventory_balance")
      .select("on_hand")
      .eq("tenant_id", t.id)
      .maybeSingle();
    const { data: prod } = await supabase
      .from("product_settings")
      .select("min_stock")
      .eq("tenant_id", t.id)
      .maybeSingle();
    const onHand = Number((stock as { on_hand: number } | null)?.on_hand ?? 0);
    const minStock = Number(
      (prod as { min_stock: number } | null)?.min_stock ?? 0
    );
    if (minStock > 0 && onHand <= minStock) {
      events.push({
        tenant_id: t.id,
        kind: "estoque_baixo",
        key: "global",
        title: "Estoque baixo 🥥",
        body:
          onHand <= 0
            ? `Estoque zerado.`
            : `${onHand} cocos (mínimo: ${minStock}).`,
        url: "/estoque",
      });
    }

    // 2) Cargas abertas há mais de 24h
    const isoCutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: cargas } = await supabase
      .from("cargas")
      .select("id, code, opened_at")
      .eq("tenant_id", t.id)
      .eq("status", "aberta")
      .lt("opened_at", isoCutoff);
    for (const c of (cargas ?? []) as {
      id: string;
      code: number;
      opened_at: string;
    }[]) {
      const h = Math.floor(
        (Date.now() - new Date(c.opened_at).getTime()) / 3_600_000
      );
      events.push({
        tenant_id: t.id,
        kind: "carga_aberta_24h",
        key: c.id,
        title: `Carga #${c.code} aberta há ${h}h 🚚`,
        body: `Verifique se já pode fechar.`,
        url: `/cargas/${c.id}`,
      });
    }

    // 3) Caixa aberto há mais de 24h
    const { data: cash } = await supabase
      .from("cash_sessions")
      .select("id, opened_at")
      .eq("tenant_id", t.id)
      .is("closed_at", null)
      .lt("opened_at", isoCutoff)
      .limit(1)
      .maybeSingle();
    if (cash) {
      const h = Math.floor(
        (Date.now() -
          new Date((cash as { opened_at: string }).opened_at).getTime()) /
          3_600_000
      );
      events.push({
        tenant_id: t.id,
        kind: "caixa_aberto_24h",
        key: (cash as { id: string }).id,
        title: `Caixa aberto há ${h}h 💵`,
        body: `Feche o caixa e abra um novo turno.`,
        url: "/caixa",
      });
    }

    // 4) Fiado em aberto há mais de 30 dias
    const isoFiadoCutoff = new Date(
      Date.now() - 30 * 86400 * 1000
    ).toISOString();
    const { data: fiado } = await supabase
      .from("customer_balances")
      .select("customer_id, customer_name, open_balance, oldest_open_at")
      .eq("tenant_id", t.id)
      .gt("open_balance", 0)
      .lt("oldest_open_at", isoFiadoCutoff)
      .limit(5);
    if (fiado && fiado.length > 0) {
      events.push({
        tenant_id: t.id,
        kind: "fiado_velho",
        key: "summary",
        title: `${fiado.length} fiado(s) com mais de 30 dias 📒`,
        body: (fiado as { customer_name: string }[])
          .map((c) => c.customer_name)
          .slice(0, 3)
          .join(", "),
        url: "/receber",
      });
    }
  }

  // Filtra eventos suprimidos pelo log de notificação recente
  const fresh: typeof events = [];
  for (const e of events) {
    const { data: last } = await supabase
      .from("notification_log")
      .select("sent_at")
      .eq("tenant_id", e.tenant_id)
      .eq("kind", e.kind)
      .eq("key", e.key)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastIso = (last as { sent_at: string } | null)?.sent_at;
    if (
      !lastIso ||
      Date.now() - new Date(lastIso).getTime() > SUPRESSION_HOURS * 3600 * 1000
    ) {
      fresh.push(e);
    }
  }

  // Pra cada evento, busca subs dos admins do tenant e envia push
  let sent = 0;
  for (const e of fresh) {
    const { data: admins } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("tenant_id", e.tenant_id)
      .eq("role", "admin");
    if (!admins || admins.length === 0) continue;
    const userIds = (admins as { user_id: string }[]).map((m) => m.user_id);
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth, user_id")
      .in("user_id", userIds);

    for (const s of (subs ?? []) as {
      endpoint: string;
      p256dh: string;
      auth: string;
    }[]) {
      const sub: Subscription = {
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
      };
      try {
        await webpush.sendNotification(
          sub,
          JSON.stringify({
            title: e.title,
            body: e.body,
            url: e.url,
          })
        );
        sent++;
      } catch {
        // Sub possivelmente inválida; ignora silencioso por enquanto.
      }
    }
    // Registra no log pra suprimir repetições
    await supabase.from("notification_log").insert({
      tenant_id: e.tenant_id,
      kind: e.kind,
      key: e.key,
    });
  }

  return new Response(
    JSON.stringify({ events_total: events.length, events_sent: fresh.length, push_count: sent }),
    { headers: { "content-type": "application/json" } }
  );
});
