-- =============================================================
-- Coco da Amazônia · MIGRATION v3
-- Acrescenta:
--   - Multi-tenant (tenants + memberships) com RLS por tenant
--   - Papéis (admin / operador) e RLS por papel
--   - Audit log com triggers
--   - Configurações da empresa (logo, CNPJ, endereço, msg recibo)
--   - Janela de edição de venda (configurável)
--   - Limite de crédito por cliente
--   - Default de tenant_id automático no insert
--
-- Idempotente — pode rodar mais de uma vez sem efeitos colaterais.
-- =============================================================

create extension if not exists "pgcrypto";

-- ---------- 1. Tenants e memberships -------------------------
create table if not exists public.tenants (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  -- dados que aparecem no recibo
  cnpj         text,
  phone        text,
  address      text,
  logo_url     text,
  receipt_msg  text default 'Obrigado!',
  edit_window_hours integer not null default 24,
  created_at   timestamptz not null default now()
);

create table if not exists public.memberships (
  user_id      uuid not null references auth.users(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  role         text not null default 'operador' check (role in ('admin','operador')),
  created_at   timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

-- helper: tenants que o usuário atual participa
create or replace function public.user_tenants() returns setof uuid
language sql stable security definer as $$
  select tenant_id from public.memberships where user_id = auth.uid();
$$;

-- helper: papel do usuário no tenant ativo
create or replace function public.is_admin() returns boolean
language sql stable security definer as $$
  select exists(
    select 1 from public.memberships
    where user_id = auth.uid() and role = 'admin'
  );
$$;

-- ---------- 2. tenant_id em todas as tabelas -----------------
do $$
declare t text;
begin
  foreach t in array array[
    'product_settings','customers','payment_methods',
    'sales','sale_payments',
    'cash_sessions','cash_movements','expenses','inventory_movements'
  ] loop
    execute format(
      'alter table public.%I add column if not exists tenant_id uuid references public.tenants(id) on delete cascade', t);
  end loop;
end $$;

-- ---------- 3. Backfill: tenant default p/ dados existentes --
do $$
declare
  default_tenant uuid;
  first_user uuid;
begin
  select id into first_user from auth.users order by created_at limit 1;
  if first_user is null then
    -- nada a fazer; banco virgem
    return;
  end if;

  -- procura tenant existente do usuário ou cria
  select tenant_id into default_tenant
    from public.memberships where user_id = first_user limit 1;

  if default_tenant is null then
    insert into public.tenants (name) values ('Minha Loja')
      returning id into default_tenant;
    insert into public.memberships (user_id, tenant_id, role)
      values (first_user, default_tenant, 'admin')
      on conflict do nothing;
  end if;

  -- atribui tenant_id em registros legados
  update public.product_settings    set tenant_id = default_tenant where tenant_id is null;
  update public.customers           set tenant_id = default_tenant where tenant_id is null;
  update public.payment_methods     set tenant_id = default_tenant where tenant_id is null;
  update public.sales               set tenant_id = default_tenant where tenant_id is null;
  update public.sale_payments       set tenant_id = default_tenant where tenant_id is null;
  update public.cash_sessions       set tenant_id = default_tenant where tenant_id is null;
  update public.cash_movements      set tenant_id = default_tenant where tenant_id is null;
  update public.expenses            set tenant_id = default_tenant where tenant_id is null;
  update public.inventory_movements set tenant_id = default_tenant where tenant_id is null;
end $$;

-- ---------- 4. Trigger: signup → cria tenant + admin ---------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_tenant uuid;
begin
  insert into public.tenants (name) values ('Minha Loja')
    returning id into v_tenant;
  insert into public.memberships (user_id, tenant_id, role)
    values (new.id, v_tenant, 'admin');

  -- copia o produto padrão e formas de pagamento
  insert into public.product_settings (name, unit_price, tenant_id)
    values ('Coco Verde', 5.00, v_tenant);

  insert into public.payment_methods (name, is_credit, tenant_id) values
    ('Dinheiro', false, v_tenant),
    ('Pix', false, v_tenant),
    ('Cartão Débito', false, v_tenant),
    ('Cartão Crédito', false, v_tenant),
    ('A Prazo (Fiado)', true, v_tenant)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 5. Default de tenant_id automático ---------------
create or replace function public.set_tenant_id()
returns trigger language plpgsql security definer as $$
begin
  if new.tenant_id is null then
    select tenant_id into new.tenant_id
      from public.memberships where user_id = auth.uid() limit 1;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'product_settings','customers','payment_methods',
    'sales','sale_payments',
    'cash_sessions','cash_movements','expenses','inventory_movements'
  ] loop
    execute format(
      'drop trigger if exists trg_set_tenant_id on public.%I; ' ||
      'create trigger trg_set_tenant_id before insert on public.%I ' ||
      '  for each row execute function public.set_tenant_id()', t, t);
  end loop;
end $$;

-- relaxa NOT NULL: tenant_id é preenchido pelo trigger
-- (já criado nullable, ok)

-- índices para performance multi-tenant
do $$
declare t text;
begin
  foreach t in array array[
    'product_settings','customers','payment_methods',
    'sales','sale_payments',
    'cash_sessions','cash_movements','expenses','inventory_movements'
  ] loop
    execute format('create index if not exists %I on public.%I (tenant_id)',
      t || '_tenant_idx', t);
  end loop;
end $$;

-- ---------- 6. RLS por tenant -------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'product_settings','customers','payment_methods',
    'sales','sale_payments',
    'cash_sessions','cash_movements','expenses','inventory_movements'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    -- remove policies antigas
    execute format('drop policy if exists auth_all_%1$s on public.%1$s', t);
    execute format('drop policy if exists anon_all_%1$s on public.%1$s', t);
    execute format('drop policy if exists tenant_select_%1$s on public.%1$s', t);
    execute format('drop policy if exists tenant_modify_%1$s on public.%1$s', t);

    execute format(
      'create policy tenant_select_%1$s on public.%1$s ' ||
      '  for select to authenticated ' ||
      '  using (tenant_id in (select public.user_tenants()))', t);
    execute format(
      'create policy tenant_modify_%1$s on public.%1$s ' ||
      '  for all to authenticated ' ||
      '  using (tenant_id in (select public.user_tenants())) ' ||
      '  with check (tenant_id in (select public.user_tenants()))', t);
  end loop;
end $$;

-- tenants & memberships
alter table public.tenants enable row level security;
alter table public.memberships enable row level security;

drop policy if exists tenant_self_select on public.tenants;
create policy tenant_self_select on public.tenants
  for select to authenticated
  using (id in (select public.user_tenants()));

drop policy if exists tenant_self_update on public.tenants;
create policy tenant_self_update on public.tenants
  for update to authenticated
  using (id in (select public.user_tenants()) and public.is_admin())
  with check (id in (select public.user_tenants()));

drop policy if exists membership_select on public.memberships;
create policy membership_select on public.memberships
  for select to authenticated
  using (tenant_id in (select public.user_tenants()));

drop policy if exists membership_admin_modify on public.memberships;
create policy membership_admin_modify on public.memberships
  for all to authenticated
  using (tenant_id in (select public.user_tenants()) and public.is_admin())
  with check (tenant_id in (select public.user_tenants()));

-- ---------- 7. Audit log -------------------------------------
create table if not exists public.audit_log (
  id          bigserial primary key,
  tenant_id   uuid references public.tenants(id) on delete cascade,
  user_id     uuid references auth.users(id),
  table_name  text not null,
  op          text not null check (op in ('INSERT','UPDATE','DELETE')),
  row_id      uuid,
  before_data jsonb,
  after_data  jsonb,
  at          timestamptz not null default now()
);
create index if not exists audit_log_tenant_idx on public.audit_log (tenant_id, at desc);
create index if not exists audit_log_table_idx on public.audit_log (table_name, at desc);

alter table public.audit_log enable row level security;
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (tenant_id in (select public.user_tenants()));

create or replace function public.log_audit()
returns trigger language plpgsql security definer as $$
declare
  v_tenant uuid;
  v_row_id uuid;
  v_before jsonb;
  v_after  jsonb;
begin
  if (tg_op = 'DELETE') then
    v_tenant := old.tenant_id;
    v_row_id := old.id;
    v_before := to_jsonb(old);
  elsif (tg_op = 'UPDATE') then
    v_tenant := new.tenant_id;
    v_row_id := new.id;
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
  else
    v_tenant := new.tenant_id;
    v_row_id := new.id;
    v_after  := to_jsonb(new);
  end if;

  insert into public.audit_log (tenant_id, user_id, table_name, op, row_id, before_data, after_data)
    values (v_tenant, auth.uid(), tg_table_name, tg_op, v_row_id, v_before, v_after);

  if (tg_op = 'DELETE') then return old; else return new; end if;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'sales','sale_payments','cash_sessions','cash_movements',
    'expenses','product_settings','customers','payment_methods'
  ] loop
    execute format(
      'drop trigger if exists trg_audit_%1$s on public.%1$s; ' ||
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$s ' ||
      '  for each row execute function public.log_audit()', t);
  end loop;
end $$;

-- ---------- 8. Limite de crédito por cliente -----------------
alter table public.customers add column if not exists credit_limit numeric(12,2);

create or replace function public.check_credit_limit()
returns trigger language plpgsql as $$
declare
  v_limit numeric(12,2);
  v_open  numeric(12,2);
begin
  if new.customer_id is null then return new; end if;
  select credit_limit into v_limit from public.customers where id = new.customer_id;
  if v_limit is null then return new; end if;
  -- aviso apenas: se exceder, nem assim bloqueamos no banco; só informamos
  -- Para bloquear, troque o NOTICE por RAISE EXCEPTION.
  select coalesce(sum(s.total - s.paid_amount), 0) into v_open
    from public.sales s
   where s.customer_id = new.customer_id
     and s.canceled_at is null
     and s.status <> 'paga';
  if v_open + (new.total - new.paid_amount) > v_limit then
    raise notice 'Cliente excedeu limite de crédito';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_credit_limit on public.sales;
create trigger trg_check_credit_limit
  before insert on public.sales
  for each row execute function public.check_credit_limit();

-- ---------- 9. View customer_balances com aging + limite ----
drop view if exists public.customer_balances cascade;
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

-- ---------- 10. View de inventário por tenant ---------------
drop view if exists public.inventory_balance cascade;
create view public.inventory_balance as
select
  t.id as tenant_id,
  (
    coalesce((select sum(case when kind='entrada' then quantity
                              when kind='perda'   then -quantity
                              when kind='ajuste'  then quantity end)
              from public.inventory_movements im
              where im.tenant_id = t.id), 0)
    -
    coalesce((select sum(quantity) from public.sales s
              where s.tenant_id = t.id and s.canceled_at is null), 0)
  )::int as on_hand
from public.tenants t;

-- ---------- 11. Push subscriptions (para PWA push) ----------
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
