-- =============================================================
-- RECOVERY: rode ISTO se a migration_v3.sql falhou em
-- "cannot change name of view column open_balance to tenant_id"
--
-- Faz só o que ficou pendente: recria as views (drop + create)
-- e cria a tabela push_subscriptions com policy/trigger.
-- =============================================================

drop view if exists public.customer_balances cascade;
drop view if exists public.inventory_balance cascade;

create view public.customer_balances as
select
  c.id   as customer_id,
  c.name as customer_name,
  c.tenant_id,
  c.credit_limit,
  coalesce(sum(case when s.status not in ('paga','cancelada') then s.total - s.paid_amount else 0 end), 0) as open_balance,
  count(s.id) filter (where s.status not in ('paga','cancelada')) as open_sales,
  min(s.created_at) filter (where s.status not in ('paga','cancelada')) as oldest_open_at
from public.customers c
left join public.sales s on s.customer_id = c.id and s.canceled_at is null
group by c.id, c.name, c.tenant_id, c.credit_limit;

create view public.inventory_balance as
select
  t.id as tenant_id,
  (
    coalesce((select sum(case when kind='entrada' then quantity
                              when kind='perda'   then -quantity
                              when kind='ajuste'  then quantity end)
              from public.inventory_movements im where im.tenant_id = t.id), 0)
    -
    coalesce((select sum(quantity) from public.sales s
              where s.tenant_id = t.id and s.canceled_at is null), 0)
  )::int as on_hand
from public.tenants t;

-- Push subscriptions
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  created_at   timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subs_owner on public.push_subscriptions;
create policy push_subs_owner on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists trg_set_tenant_id on public.push_subscriptions;
create trigger trg_set_tenant_id
  before insert on public.push_subscriptions
  for each row execute function public.set_tenant_id();
