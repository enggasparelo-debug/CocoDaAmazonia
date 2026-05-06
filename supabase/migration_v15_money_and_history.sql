-- =============================================================
-- Coco da Amazônia · MIGRATION v15 · Validação, taxas e histórico
--
-- Cobre 3 lacunas identificadas na 2ª análise:
--   1) sale_payments: validar que paid_at >= sale.created_at (evita
--      "pagar venda no passado").
--   2) payment_methods: colunas fee_percent + fee_fixed pra modelar
--      taxa de cartão (etc.) e calcular recebido líquido.
--   3) product_settings: histórico de preço via tabela
--      product_price_history + trigger que insere ao mudar
--      unit_price.
-- =============================================================

-- ---------- 1. Validação paid_at >= created_at -----------------
-- Estende o trigger existente check_sale_payment_amount.
create or replace function public.check_sale_payment_amount()
returns trigger language plpgsql as $$
declare
  v_total numeric(12,2);
  v_paid  numeric(12,2);
  v_canceled timestamptz;
  v_created  timestamptz;
begin
  select total, canceled_at, created_at
    into v_total, v_canceled, v_created
    from public.sales where id = new.sale_id;
  if v_canceled is not null then
    raise exception 'Não é possível lançar pagamento em venda cancelada';
  end if;
  if new.paid_at < v_created then
    raise exception
      'Data de pagamento (%) não pode ser anterior à data da venda (%)',
      new.paid_at, v_created;
  end if;
  select coalesce(sum(amount),0) into v_paid
    from public.sale_payments
    where sale_id = new.sale_id
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_paid + new.amount > v_total + 0.001 then
    raise exception 'Valor recebido (%) excede o saldo da venda (% - já pago: %)',
      new.amount, v_total, v_paid;
  end if;
  return new;
end;
$$;

-- ---------- 2. Taxas em payment_methods ------------------------
alter table public.payment_methods
  add column if not exists fee_percent numeric(5,2) not null default 0
    check (fee_percent >= 0 and fee_percent < 100);
alter table public.payment_methods
  add column if not exists fee_fixed numeric(12,2) not null default 0
    check (fee_fixed >= 0);

comment on column public.payment_methods.fee_percent is
  'Taxa percentual cobrada pela operadora (ex.: 3.5 pra 3.5%).';
comment on column public.payment_methods.fee_fixed is
  'Taxa fixa por transação (R$). Aplicada por sale_payment.';

-- ---------- 3. Histórico de preço do produto -------------------
create table if not exists public.product_price_history (
  id         bigserial primary key,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  unit_price numeric(12,2) not null check (unit_price > 0),
  started_at timestamptz not null default now(),
  changed_by uuid references auth.users(id) on delete set null
);
create index if not exists product_price_history_tenant_idx
  on public.product_price_history (tenant_id, started_at desc);

alter table public.product_price_history enable row level security;
drop policy if exists pph_select on public.product_price_history;
create policy pph_select on public.product_price_history
  for select to authenticated
  using (tenant_id in (select public.user_tenants()));
drop policy if exists pph_modify on public.product_price_history;
create policy pph_modify on public.product_price_history
  for all to authenticated
  using (tenant_id in (select public.user_tenants()) and public.is_admin())
  with check (
    tenant_id in (select public.user_tenants()) and public.is_admin()
  );

create or replace function public.product_price_history_capture()
returns trigger language plpgsql security definer as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.product_price_history
      (tenant_id, unit_price, changed_by)
    values
      (new.tenant_id, new.unit_price, auth.uid());
    return new;
  end if;
  if TG_OP = 'UPDATE' and old.unit_price is distinct from new.unit_price then
    insert into public.product_price_history
      (tenant_id, unit_price, changed_by)
    values
      (new.tenant_id, new.unit_price, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_product_price_history on public.product_settings;
create trigger trg_product_price_history
  after insert or update on public.product_settings
  for each row execute function public.product_price_history_capture();

-- Backfill: cria 1 entry de histórico pra preço atual de cada tenant
-- que ainda não tem histórico. Idempotente.
insert into public.product_price_history (tenant_id, unit_price, started_at)
  select ps.tenant_id, ps.unit_price, ps.updated_at
    from public.product_settings ps
   where not exists (
     select 1 from public.product_price_history h
       where h.tenant_id = ps.tenant_id
   );

-- ✅ migration_v15 aplicada
