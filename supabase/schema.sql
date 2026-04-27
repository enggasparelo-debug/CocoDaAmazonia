-- =============================================================
-- Coco da Amazônia · schema completo (Supabase / Postgres)
-- Para INSTALAÇÃO NOVA: rode apenas este arquivo no SQL Editor.
-- Para BANCO JÁ EXISTENTE em v1: rode `migration_v2.sql` (idempotente).
-- =============================================================

create extension if not exists "pgcrypto";

-- ---------- Configurações do produto (linha única) -----------
create table if not exists public.product_settings (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Coco Verde',
  unit_price  numeric(12,2) not null default 5.00,
  updated_at  timestamptz not null default now()
);

insert into public.product_settings (name, unit_price)
select 'Coco Verde', 5.00
where not exists (select 1 from public.product_settings);

-- ---------- Clientes -----------------------------------------
create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text,
  email       text,
  document    text,
  address     text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id)
);
create index if not exists customers_name_idx on public.customers (lower(name));

-- ---------- Formas de pagamento ------------------------------
create table if not exists public.payment_methods (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  is_credit   boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
insert into public.payment_methods (name, is_credit) values
  ('Dinheiro', false),
  ('Pix', false),
  ('Cartão Débito', false),
  ('Cartão Crédito', false),
  ('A Prazo (Fiado)', true)
on conflict (name) do nothing;

-- ---------- Vendas -------------------------------------------
-- status: 'paga' | 'parcial' | 'aberta' | 'cancelada'
create table if not exists public.sales (
  id            uuid primary key default gen_random_uuid(),
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

-- ---------- Pagamentos lançados em uma venda -----------------
create table if not exists public.sale_payments (
  id                  uuid primary key default gen_random_uuid(),
  sale_id             uuid not null references public.sales(id) on delete cascade,
  payment_method_id   uuid not null references public.payment_methods(id),
  amount              numeric(12,2) not null check (amount > 0),
  paid_at             timestamptz not null default now(),
  notes               text,
  created_by          uuid references auth.users(id)
);
create index if not exists sale_payments_sale_idx   on public.sale_payments (sale_id);
create index if not exists sale_payments_method_idx on public.sale_payments (payment_method_id);
create index if not exists sale_payments_paid_idx   on public.sale_payments (paid_at desc);

-- ---------- triggers -----------------------------------------
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

-- check: o valor não pode exceder o saldo da venda
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

-- ---------- caixa --------------------------------------------
create table if not exists public.cash_sessions (
  id           uuid primary key default gen_random_uuid(),
  opened_at    timestamptz not null default now(),
  opened_by    uuid references auth.users(id),
  opening_amt  numeric(12,2) not null default 0,
  closed_at    timestamptz,
  closed_by    uuid references auth.users(id),
  closing_amt  numeric(12,2),
  notes        text
);
create index if not exists cash_sessions_open_idx on public.cash_sessions (opened_at desc);

create table if not exists public.cash_movements (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.cash_sessions(id) on delete cascade,
  kind         text not null check (kind in ('suprimento','sangria')),
  amount       numeric(12,2) not null check (amount > 0),
  notes        text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);
create index if not exists cash_movements_session_idx on public.cash_movements (session_id);

-- ---------- despesas -----------------------------------------
create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  description  text not null,
  category     text,
  amount       numeric(12,2) not null check (amount > 0),
  paid_at      timestamptz not null default now(),
  payment_method_id uuid references public.payment_methods(id),
  notes        text,
  created_by   uuid references auth.users(id)
);
create index if not exists expenses_paid_idx on public.expenses (paid_at desc);

-- ---------- estoque -----------------------------------------
create table if not exists public.inventory_movements (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('entrada','perda','ajuste')),
  quantity     integer not null check (quantity <> 0),
  unit_cost    numeric(12,2),
  notes        text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);
create index if not exists inventory_movements_created_idx on public.inventory_movements (created_at desc);

create or replace view public.inventory_balance as
select
  (
    coalesce((select sum(case when kind='entrada' then quantity
                              when kind='perda'   then -quantity
                              when kind='ajuste'  then quantity end)
              from public.inventory_movements), 0)
    -
    coalesce((select sum(quantity) from public.sales where canceled_at is null), 0)
  )::int as on_hand;

-- ---------- saldo aberto por cliente (com aging) -------------
create or replace view public.customer_balances as
select
  c.id   as customer_id,
  c.name as customer_name,
  coalesce(sum(case when s.status not in ('paga','cancelada') then s.total - s.paid_amount else 0 end), 0) as open_balance,
  count(s.id) filter (where s.status not in ('paga','cancelada')) as open_sales,
  min(s.created_at) filter (where s.status not in ('paga','cancelada')) as oldest_open_at
from public.customers c
left join public.sales s on s.customer_id = c.id and s.canceled_at is null
group by c.id, c.name;

-- ---------- RLS para usuários autenticados ------------------
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
    execute format(
      'drop policy if exists auth_all_%1$s on public.%1$s; ' ||
      'create policy auth_all_%1$s on public.%1$s ' ||
      '  for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
