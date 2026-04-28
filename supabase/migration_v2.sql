-- =============================================================
-- Coco da Amazônia · MIGRATION v2
-- Execute este arquivo no SQL Editor do Supabase para acrescentar:
--   - autenticação (RLS por auth.uid())
--   - desconto e cancelamento de venda
--   - auditoria (created_by, updated_at)
--   - sessões de caixa, sangria e suprimento
--   - despesas
--   - estoque (entradas/saídas)
--   - validação de valor pago
-- =============================================================

-- ---------- coluna de quem criou cada registro ----------------
alter table public.sales         add column if not exists created_by uuid references auth.users(id);
alter table public.sale_payments add column if not exists created_by uuid references auth.users(id);
alter table public.customers     add column if not exists created_by uuid references auth.users(id);

-- ---------- desconto e cancelamento na venda -----------------
alter table public.sales add column if not exists discount   numeric(12,2) not null default 0 check (discount >= 0);
alter table public.sales add column if not exists canceled_at timestamptz;
alter table public.sales add column if not exists cancel_reason text;

-- "paga" | "parcial" | "aberta" | "cancelada"
alter table public.sales drop constraint if exists sales_status_check;

-- recalcula status considerando cancelamento
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

-- ---------- view atualizada (ignora canceladas) --------------
create or replace view public.customer_balances as
select
  c.id   as customer_id,
  c.name as customer_name,
  coalesce(sum(s.total - s.paid_amount), 0)            as open_balance,
  count(s.id) filter (where s.status not in ('paga','cancelada')) as open_sales,
  max(s.created_at) filter (where s.status not in ('paga','cancelada')) as oldest_open_at
from public.customers c
left join public.sales s on s.customer_id = c.id and s.canceled_at is null
group by c.id, c.name;

-- Após a migração, o oldest_open_at trará a venda em aberto MAIS RECENTE.
-- Para aging precisamos da MAIS ANTIGA — recriamos abaixo.
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

-- ---------- check: pagamento não pode exceder o total --------
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

-- sangria (saída) e suprimento (entrada) durante a sessão
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
-- entrada por compra de fornecedor; saída automática a cada venda
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

-- saldo atual de estoque = entradas - perdas - vendas (não canceladas)
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

-- ---------- RLS por usuário autenticado ----------------------
-- substitui as policies "anon all" por "authenticated all"
do $$
declare
  t text;
  pol text;
begin
  foreach t in array array[
    'product_settings','customers','payment_methods',
    'sales','sale_payments',
    'cash_sessions','cash_movements','expenses','inventory_movements'
  ] loop
    -- cria policies só para tabelas que existem
    execute format('alter table public.%I enable row level security', t);

    for pol in
      select policyname from pg_policies
       where schemaname='public' and tablename=t and policyname like 'anon_all_%'
    loop
      execute format('drop policy if exists %I on public.%I', pol, t);
    end loop;

    execute format(
      'drop policy if exists auth_all_%1$s on public.%1$s; ' ||
      'create policy auth_all_%1$s on public.%1$s ' ||
      '  for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
