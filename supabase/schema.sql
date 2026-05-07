-- =============================================================
-- Coco da Amazônia · schema completo (Supabase / Postgres)
--
-- INSTALAÇÃO NOVA: rode apenas este arquivo no SQL Editor.
-- BANCO EM v1: rode `migration_v2.sql`.
-- BANCO EM v2: rode `migration_v3.sql`.
-- =============================================================

create extension if not exists "pgcrypto";

-- ---------- 1. Tenants & memberships ------------------------
create table if not exists public.tenants (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
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

create or replace function public.user_tenants() returns setof uuid
language sql stable security definer as $$
  select tenant_id from public.memberships where user_id = auth.uid();
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer as $$
  select exists(
    select 1 from public.memberships
    where user_id = auth.uid() and role = 'admin'
  );
$$;

-- ---------- 2. Configurações do produto ---------------------
create table if not exists public.product_settings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) on delete cascade,
  name        text not null default 'Coco Verde',
  unit_price  numeric(12,2) not null default 3.00,
  min_stock   integer default 0,
  updated_at  timestamptz not null default now()
);

-- ---------- 3. Clientes -------------------------------------
create table if not exists public.customers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) on delete cascade,
  name         text not null,
  phone        text,
  email        text,
  document     text,
  address      text,
  notes        text,
  credit_limit numeric(12,2),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);
create index if not exists customers_name_idx on public.customers (lower(name));
create index if not exists customers_tenant_idx on public.customers (tenant_id);

-- ---------- 4. Formas de pagamento --------------------------
create table if not exists public.payment_methods (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) on delete cascade,
  name        text not null,
  is_credit   boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);
create index if not exists payment_methods_tenant_idx on public.payment_methods (tenant_id);

-- ---------- 5. Vendas ---------------------------------------
create table if not exists public.sales (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenants(id) on delete cascade,
  customer_id   uuid references public.customers(id) on delete set null,
  quantity      integer not null check (quantity > 0),
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  discount      numeric(12,2) not null default 0 check (discount >= 0),
  total         numeric(12,2) not null check (total >= 0),
  paid_amount   numeric(12,2) not null default 0,
  status        text not null default 'aberta',
  notes         text,
  canceled_at   timestamptz,
  cancel_reason text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id)
);
create index if not exists sales_customer_idx on public.sales (customer_id);
create index if not exists sales_created_idx  on public.sales (created_at desc);
create index if not exists sales_status_idx   on public.sales (status);
create index if not exists sales_tenant_idx   on public.sales (tenant_id);

-- ---------- 6. Pagamentos da venda --------------------------
create table if not exists public.sale_payments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references public.tenants(id) on delete cascade,
  sale_id           uuid not null references public.sales(id) on delete cascade,
  payment_method_id uuid not null references public.payment_methods(id),
  amount            numeric(12,2) not null check (amount > 0),
  paid_at           timestamptz not null default now(),
  notes             text,
  created_by        uuid references auth.users(id)
);
create index if not exists sale_payments_sale_idx   on public.sale_payments (sale_id);
create index if not exists sale_payments_method_idx on public.sale_payments (payment_method_id);
create index if not exists sale_payments_paid_idx   on public.sale_payments (paid_at desc);
create index if not exists sale_payments_tenant_idx on public.sale_payments (tenant_id);

-- ---------- 7. triggers de status ---------------------------
create or replace function public.refresh_sale_status(p_sale_id uuid)
returns void language plpgsql as $$
declare
  v_total numeric(12,2);
  v_paid  numeric(12,2);
  v_canceled timestamptz;
begin
  select total, canceled_at into v_total, v_canceled
    from public.sales where id = p_sale_id;
  select coalesce(sum(amount),0) into v_paid
    from public.sale_payments where sale_id = p_sale_id;

  update public.sales
     set paid_amount = v_paid,
         status = case
           when v_canceled is not null then 'cancelada'
           when v_paid <= 0 then 'aberta'
           when v_paid >= v_total then 'paga'
           else 'parcial'
         end
   where id = p_sale_id;
end;
$$;

create or replace function public.sale_payments_after_change()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'DELETE') then
    perform public.refresh_sale_status(old.sale_id);
    return old;
  else
    perform public.refresh_sale_status(new.sale_id);
    return new;
  end if;
end;
$$;

drop trigger if exists trg_sale_payments_aiud on public.sale_payments;
create trigger trg_sale_payments_aiud
after insert or update or delete on public.sale_payments
for each row execute function public.sale_payments_after_change();

create or replace function public.check_sale_payment_amount()
returns trigger language plpgsql as $$
declare
  v_total numeric(12,2);
  v_paid  numeric(12,2);
  v_canceled timestamptz;
begin
  select total, canceled_at into v_total, v_canceled
    from public.sales where id = new.sale_id;
  if v_canceled is not null then
    raise exception 'Não é possível lançar pagamento em venda cancelada';
  end if;
  select coalesce(sum(amount),0) into v_paid
    from public.sale_payments
    where sale_id = new.sale_id and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_paid + new.amount > v_total + 0.001 then
    raise exception 'Valor recebido (%) excede o saldo da venda (% - já pago: %)',
      new.amount, v_total, v_paid;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sale_payments_check on public.sale_payments;
create trigger trg_sale_payments_check
before insert or update on public.sale_payments
for each row execute function public.check_sale_payment_amount();

-- check de limite de crédito (warning)
create or replace function public.check_credit_limit()
returns trigger language plpgsql as $$
declare
  v_limit numeric(12,2);
  v_open  numeric(12,2);
begin
  if new.customer_id is null then return new; end if;
  select credit_limit into v_limit from public.customers where id = new.customer_id;
  if v_limit is null then return new; end if;
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

-- ---------- 8. caixa ----------------------------------------
create table if not exists public.cash_sessions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) on delete cascade,
  opened_at    timestamptz not null default now(),
  opened_by    uuid references auth.users(id),
  opening_amt  numeric(12,2) not null default 0,
  closed_at    timestamptz,
  closed_by    uuid references auth.users(id),
  closing_amt  numeric(12,2),
  notes        text
);
create index if not exists cash_sessions_open_idx on public.cash_sessions (opened_at desc);
create index if not exists cash_sessions_tenant_idx on public.cash_sessions (tenant_id);

create table if not exists public.cash_movements (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) on delete cascade,
  session_id   uuid not null references public.cash_sessions(id) on delete cascade,
  kind         text not null check (kind in ('suprimento','sangria')),
  amount       numeric(12,2) not null check (amount > 0),
  notes        text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);
create index if not exists cash_movements_session_idx on public.cash_movements (session_id);
create index if not exists cash_movements_tenant_idx on public.cash_movements (tenant_id);

-- ---------- 9. despesas -------------------------------------
create table if not exists public.expenses (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references public.tenants(id) on delete cascade,
  description       text not null,
  category          text,
  amount            numeric(12,2) not null check (amount > 0),
  paid_at           timestamptz not null default now(),
  payment_method_id uuid references public.payment_methods(id),
  notes             text,
  created_by        uuid references auth.users(id)
);
create index if not exists expenses_paid_idx on public.expenses (paid_at desc);
create index if not exists expenses_tenant_idx on public.expenses (tenant_id);

-- ---------- 10. estoque -------------------------------------
create table if not exists public.inventory_movements (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) on delete cascade,
  kind         text not null check (kind in ('entrada','perda','ajuste')),
  quantity     integer not null check (quantity <> 0),
  unit_cost    numeric(12,2),
  notes        text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);
create index if not exists inventory_movements_created_idx on public.inventory_movements (created_at desc);
create index if not exists inventory_movements_tenant_idx on public.inventory_movements (tenant_id);

-- ---------- 11. Audit log -----------------------------------
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
  -- Só registra se o tenant ainda existe (evita FK violation em cascade delete)
  if v_tenant is not null and exists (select 1 from public.tenants where id = v_tenant) then
    insert into public.audit_log (tenant_id, user_id, table_name, op, row_id, before_data, after_data)
      values (v_tenant, auth.uid(), tg_table_name, tg_op, v_row_id, v_before, v_after);
  end if;
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

-- ---------- 12. Push subscriptions --------------------------
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  created_at   timestamptz not null default now()
);

-- ---------- 13. Trigger de signup ---------------------------
-- Comportamento:
--   * Se já existe exatamente 1 loja, novo usuário entra nela como 'operador'.
--   * Se houver 0 ou >1 lojas, cria uma loja nova p/ esse usuário (admin).
-- Isso permite uso single-tenant (uma loja, vários operadores) sem
-- abrir mão da capacidade multi-tenant.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_tenant uuid;
  v_count int;
begin
  select count(*) into v_count from public.tenants;

  if v_count = 1 then
    select id into v_tenant from public.tenants limit 1;
    insert into public.memberships (user_id, tenant_id, role)
      values (new.id, v_tenant, 'operador');
  else
    insert into public.tenants (name) values ('Minha Loja') returning id into v_tenant;
    insert into public.memberships (user_id, tenant_id, role)
      values (new.id, v_tenant, 'admin');
    insert into public.product_settings (name, unit_price, tenant_id)
      values ('Coco Verde', 3.00, v_tenant);
    insert into public.payment_methods (name, is_credit, tenant_id) values
      ('Dinheiro', false, v_tenant),
      ('Pix', false, v_tenant),
      ('Cartão Débito', false, v_tenant),
      ('Cartão Crédito', false, v_tenant),
      ('A Prazo (Fiado)', true, v_tenant)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 14. Default tenant_id automático ---------------
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
    'cash_sessions','cash_movements','expenses','inventory_movements',
    'push_subscriptions'
  ] loop
    execute format(
      'drop trigger if exists trg_set_tenant_id on public.%I; ' ||
      'create trigger trg_set_tenant_id before insert on public.%I ' ||
      '  for each row execute function public.set_tenant_id()', t, t);
  end loop;
end $$;

-- ---------- 15. RLS por tenant ------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'product_settings','customers','payment_methods',
    'sales','sale_payments',
    'cash_sessions','cash_movements','expenses','inventory_movements'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_select_%1$s on public.%1$s', t);
    execute format('drop policy if exists tenant_modify_%1$s on public.%1$s', t);
    execute format(
      'create policy tenant_select_%1$s on public.%1$s ' ||
      '  for select to authenticated using (tenant_id in (select public.user_tenants()))', t);
    execute format(
      'create policy tenant_modify_%1$s on public.%1$s ' ||
      '  for all to authenticated ' ||
      '  using (tenant_id in (select public.user_tenants())) ' ||
      '  with check (tenant_id in (select public.user_tenants()))', t);
  end loop;
end $$;

alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.audit_log enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists tenant_self_select on public.tenants;
create policy tenant_self_select on public.tenants
  for select to authenticated using (id in (select public.user_tenants()));

drop policy if exists tenant_self_update on public.tenants;
create policy tenant_self_update on public.tenants
  for update to authenticated
  using (id in (select public.user_tenants()) and public.is_admin())
  with check (id in (select public.user_tenants()));

drop policy if exists membership_select on public.memberships;
create policy membership_select on public.memberships
  for select to authenticated using (tenant_id in (select public.user_tenants()));

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated using (tenant_id in (select public.user_tenants()));

drop policy if exists push_subs_owner on public.push_subscriptions;
create policy push_subs_owner on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- 16. Views finais --------------------------------
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

-- View do saldo de estoque por tenant. Mantida em sincronia com a versão
-- da migration_v4 (a antiga ignorava carga_saida/carga_retorno/carga_perda).
-- Vendas dentro de carga já saíram via 'carga_saida'; só vendas de balcão
-- (carga_id is null) entram como saída direta aqui.
drop view if exists public.inventory_balance cascade;
create view public.inventory_balance as
select
  t.id as tenant_id,
  (
    coalesce((
      select sum(case
                   when im.kind = 'entrada'       then  im.quantity
                   when im.kind = 'ajuste'        then  im.quantity
                   when im.kind = 'carga_retorno' then  im.quantity
                   when im.kind = 'perda'         then -im.quantity
                   when im.kind = 'carga_saida'   then -im.quantity
                   when im.kind = 'carga_perda'   then -im.quantity
                 end)
        from public.inventory_movements im
       where im.tenant_id = t.id
    ), 0)
    -
    coalesce((
      select sum(s.quantity)
        from public.sales s
       where s.tenant_id = t.id
         and s.canceled_at is null
         and s.carga_id is null
    ), 0)
  )::int as on_hand
from public.tenants t;
