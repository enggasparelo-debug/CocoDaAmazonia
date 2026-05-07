-- =============================================================
-- Coco da Amazônia · MIGRATION v20 · Audit retention + índices
--
-- 1) `audit_log` cresce indefinidamente. Esta migration adiciona uma
--    função `prune_audit_log(months)` que deleta registros antigos.
--    O agendamento deve ser feito via pg_cron (se disponível no
--    plano) ou rodado manualmente 1×/mês:
--
--      select public.prune_audit_log(12);
--
-- 2) Índices compostos pra acelerar queries comuns:
--    - audit_log: filtro por tenant_id + ordenação por at desc
--    - inventory_movements: filtro por tenant_id + ordenação por
--      created_at desc (usado em /estoque)
--    - sale_payments: lookup por (sale_id, payment_method_id)
--      usado no Dashboard ao agregar pagamentos.
--
-- Idempotente.
-- =============================================================

-- 1) Função de retenção
create or replace function public.prune_audit_log(months int default 12)
returns bigint language plpgsql security definer as $$
declare
  deleted_count bigint;
begin
  if months <= 0 then
    raise exception 'months deve ser > 0';
  end if;
  delete from public.audit_log
    where at < now() - (months || ' months')::interval;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

comment on function public.prune_audit_log(int) is
  'Deleta entradas de audit_log com mais de N meses. Retorna contagem deletada. Rodar via pg_cron 1×/mês.';

-- 2) Tentativa de agendar via pg_cron (silencioso se extensão não
--    estiver disponível). No Supabase free tier pg_cron pode não
--    estar habilitado — neste caso, rode manualmente.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Remove jobs anteriores com mesmo nome pra ser idempotente
    perform cron.unschedule(jobid)
      from cron.job
      where jobname = 'prune_audit_log_monthly';
    perform cron.schedule(
      'prune_audit_log_monthly',
      '0 3 1 * *',  -- 1º dia do mês às 3h
      $cron$ select public.prune_audit_log(12); $cron$
    );
  end if;
exception
  when others then
    -- pg_cron não disponível ou sem permissão; segue silencioso
    null;
end;
$$;

-- 3) Índices compostos
create index if not exists audit_log_tenant_at_idx
  on public.audit_log (tenant_id, at desc);

create index if not exists inventory_movements_tenant_created_idx
  on public.inventory_movements (tenant_id, created_at desc);

create index if not exists sale_payments_sale_method_idx
  on public.sale_payments (sale_id, payment_method_id);

-- ✅ migration_v20 aplicada
