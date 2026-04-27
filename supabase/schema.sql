-- =============================================================
-- Coco da Amazônia · schema completo (Supabase / Postgres)
-- Execute este arquivo no SQL Editor do Supabase.
-- =============================================================

create extension if not exists "pgcrypto";

-- ---------- Configurações do produto (tabela de uma linha) ----
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
  created_at  timestamptz not null default now()
);

create index if not exists customers_name_idx on public.customers (lower(name));

-- ---------- Formas de pagamento ------------------------------
create table if not exists public.payment_methods (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  is_credit   boolean not null default false, -- "venda a prazo"
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
-- status: 'paga' | 'parcial' | 'aberta'
create table if not exists public.sales (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid references public.customers(id) on delete set null,
  quantity      integer not null check (quantity > 0),
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  total         numeric(12,2) not null check (total >= 0),
  paid_amount   numeric(12,2) not null default 0,
  status        text not null default 'aberta',
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists sales_customer_idx on public.sales (customer_id);
create index if not exists sales_created_idx  on public.sales (created_at desc);
create index if not exists sales_status_idx   on public.sales (status);

-- ---------- Pagamentos lançados em uma venda -----------------
-- Permite split (ex.: parte em Pix, parte em dinheiro) e parcelas.
create table if not exists public.sale_payments (
  id                  uuid primary key default gen_random_uuid(),
  sale_id             uuid not null references public.sales(id) on delete cascade,
  payment_method_id   uuid not null references public.payment_methods(id),
  amount              numeric(12,2) not null check (amount > 0),
  paid_at             timestamptz not null default now(),
  notes               text
);

create index if not exists sale_payments_sale_idx   on public.sale_payments (sale_id);
create index if not exists sale_payments_method_idx on public.sale_payments (payment_method_id);
create index if not exists sale_payments_paid_idx   on public.sale_payments (paid_at desc);

-- ---------- Trigger: atualizar status/paid_amount da venda ----
create or replace function public.refresh_sale_status(p_sale_id uuid)
returns void language plpgsql as $$
declare
  v_total numeric(12,2);
  v_paid  numeric(12,2);
begin
  select total into v_total from public.sales where id = p_sale_id;
  select coalesce(sum(amount),0) into v_paid
    from public.sale_payments where sale_id = p_sale_id;

  update public.sales
     set paid_amount = v_paid,
         status = case
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

-- ---------- View: saldo devedor por cliente ------------------
create or replace view public.customer_balances as
select
  c.id                as customer_id,
  c.name              as customer_name,
  coalesce(sum(s.total - s.paid_amount), 0) as open_balance,
  count(s.id) filter (where s.status <> 'paga') as open_sales
from public.customers c
left join public.sales s on s.customer_id = c.id
group by c.id, c.name;

-- ---------- RLS (acesso liberado p/ uso interno) -------------
-- Mantemos RLS habilitado por padrão e liberamos via policy "anon all".
-- Em produção, troque por policies baseadas em auth.uid().
alter table public.product_settings enable row level security;
alter table public.customers        enable row level security;
alter table public.payment_methods  enable row level security;
alter table public.sales            enable row level security;
alter table public.sale_payments    enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname='anon_all_settings') then
    create policy anon_all_settings on public.product_settings for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname='anon_all_customers') then
    create policy anon_all_customers on public.customers for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname='anon_all_methods') then
    create policy anon_all_methods on public.payment_methods for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname='anon_all_sales') then
    create policy anon_all_sales on public.sales for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname='anon_all_payments') then
    create policy anon_all_payments on public.sale_payments for all using (true) with check (true);
  end if;
end $$;
