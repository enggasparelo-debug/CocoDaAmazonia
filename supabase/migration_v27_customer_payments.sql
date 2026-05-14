-- Migration v27: Customer Payments (recibos integrais)
--
-- Objetivo: um pix/dinheiro/etc. recebido do cliente vira UM registro
-- em `customer_payments` (o "documento"), que pode abater 1 ou N vendas
-- via `sale_payments.receipt_id`. Antes, um pix de R$ 5.980 que cobria
-- 4 vendas virava 4 rows soltas em sale_payments — péssimo pra
-- conciliação bancária e pra apresentar pro cliente.

-- 1. Tabela customer_payments
create table if not exists public.customer_payments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references public.tenants(id) on delete cascade,
  customer_id       uuid not null references public.customers(id) on delete cascade,
  payment_method_id uuid not null references public.payment_methods(id),
  amount            numeric(12,2) not null check (amount > 0),
  paid_at           timestamptz not null default now(),
  notes             text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id)
);
create index if not exists customer_payments_customer_idx on public.customer_payments (customer_id);
create index if not exists customer_payments_paid_idx     on public.customer_payments (paid_at desc);
create index if not exists customer_payments_tenant_idx   on public.customer_payments (tenant_id);

-- 2. FK opcional em sale_payments (nullable, pra retrocompat)
alter table public.sale_payments
  add column if not exists receipt_id uuid references public.customer_payments(id) on delete set null;
create index if not exists sale_payments_receipt_idx on public.sale_payments (receipt_id);

-- 3. Default tenant_id automático (segue padrão das outras tabelas)
drop trigger if exists trg_set_tenant_id on public.customer_payments;
create trigger trg_set_tenant_id before insert on public.customer_payments
  for each row execute function public.set_tenant_id();

-- 4. RLS por tenant
alter table public.customer_payments enable row level security;
drop policy if exists tenant_select_customer_payments on public.customer_payments;
drop policy if exists tenant_modify_customer_payments on public.customer_payments;
create policy tenant_select_customer_payments on public.customer_payments
  for select to authenticated using (tenant_id in (select public.user_tenants()));
create policy tenant_modify_customer_payments on public.customer_payments
  for all to authenticated using (tenant_id in (select public.user_tenants()))
  with check (tenant_id in (select public.user_tenants()));

-- 5. Audit log
drop trigger if exists trg_audit_customer_payments on public.customer_payments;
create trigger trg_audit_customer_payments
  after insert or update or delete on public.customer_payments
  for each row execute function public.log_audit();

-- 6. Backfill: pagamentos antigos com mesmo (customer, método, paid_at)
--    viram UM receipt agrupando o total. Heurística conservadora — só
--    agrupa quando timestamp é IDÊNTICO. Pagamentos avulsos viram
--    receipt de 1 abatimento (preserva semântica).
with grouped as (
  select
    sp.tenant_id,
    s.customer_id,
    sp.payment_method_id,
    sp.paid_at,
    sum(sp.amount)        as amount,
    min(sp.notes)         as notes,
    min(sp.created_by)    as created_by
  from public.sale_payments sp
  join public.sales s on s.id = sp.sale_id
  where sp.receipt_id is null
    and s.customer_id is not null
  group by sp.tenant_id, s.customer_id, sp.payment_method_id, sp.paid_at
)
insert into public.customer_payments
  (tenant_id, customer_id, payment_method_id, amount, paid_at, notes, created_by)
select tenant_id, customer_id, payment_method_id, amount, paid_at, notes, created_by
from grouped;

update public.sale_payments sp
   set receipt_id = cp.id
  from public.customer_payments cp,
       public.sales s
 where sp.sale_id = s.id
   and s.customer_id = cp.customer_id
   and sp.payment_method_id = cp.payment_method_id
   and sp.paid_at = cp.paid_at
   and sp.receipt_id is null;
