-- =============================================================
-- Coco da Amazônia · MIGRATION v18 · Anexos + log de notificações
--
-- 1) sale_payments.attachment_url: URL pública do comprovante
--    armazenado no Storage. RLS já protege via policies do bucket.
-- 2) notification_log: usado pela Edge Function notify-admin pra
--    evitar spam (não envia 2x o mesmo alerta dentro de 24h).
--
-- O bucket "attachments" precisa ser criado manualmente no dashboard
-- com policy de upload "authenticated only" — Storage policies não
-- são parte do schema SQL nativo. Veja MIGRATIONS_ORDER.md.
-- =============================================================

-- ---------- 1. Anexos em sale_payments -----------------------
alter table public.sale_payments
  add column if not exists attachment_url text;

comment on column public.sale_payments.attachment_url is
  'URL pública do comprovante de pagamento (PIX print, foto promissória, etc.) armazenado no Supabase Storage bucket "attachments".';

-- ---------- 2. Log de notificações pra suprimir spam ---------
create table if not exists public.notification_log (
  id         bigserial primary key,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  kind       text not null,
  key        text not null,
  sent_at    timestamptz not null default now()
);
create index if not exists notification_log_lookup_idx
  on public.notification_log (tenant_id, kind, key, sent_at desc);

alter table public.notification_log enable row level security;
-- Service role bypass; nenhum usuário lê isso direto.
drop policy if exists nl_no_select on public.notification_log;
create policy nl_no_select on public.notification_log
  for select to authenticated using (false);

-- ✅ migration_v18 aplicada
