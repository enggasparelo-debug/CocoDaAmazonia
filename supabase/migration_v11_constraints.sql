-- =============================================================
-- Coco da Amazônia · MIGRATION v11 · Constraints faltando
--
-- Tier 1 do estudo de melhorias. Fecha 2 buracos modestos:
--   1) FK de payment_method_id em sale_payments e expenses sem ON
--      DELETE — apagar uma forma de pagamento deixa registros órfãos.
--   2) cash_sessions permite 2 caixas abertos pelo mesmo operador
--      (sem unique constraint).
--
-- Idempotente: usa DROP CONSTRAINT IF EXISTS antes do ADD, e CREATE
-- UNIQUE INDEX IF NOT EXISTS.
-- =============================================================

-- ---------- 1. ON DELETE SET NULL nas FKs --------------------
-- sale_payments.payment_method_id
do $$
declare
  c_name text;
begin
  select conname into c_name
    from pg_constraint
   where conrelid = 'public.sale_payments'::regclass
     and contype = 'f'
     and array_position(conkey,
       (select attnum from pg_attribute
         where attrelid = 'public.sale_payments'::regclass
           and attname = 'payment_method_id')) is not null;
  if c_name is not null then
    execute format('alter table public.sale_payments drop constraint %I', c_name);
  end if;
end $$;

alter table public.sale_payments
  add constraint sale_payments_payment_method_id_fkey
  foreign key (payment_method_id)
  references public.payment_methods(id)
  on delete set null;

-- expenses.payment_method_id
do $$
declare
  c_name text;
begin
  select conname into c_name
    from pg_constraint
   where conrelid = 'public.expenses'::regclass
     and contype = 'f'
     and array_position(conkey,
       (select attnum from pg_attribute
         where attrelid = 'public.expenses'::regclass
           and attname = 'payment_method_id')) is not null;
  if c_name is not null then
    execute format('alter table public.expenses drop constraint %I', c_name);
  end if;
end $$;

alter table public.expenses
  add constraint expenses_payment_method_id_fkey
  foreign key (payment_method_id)
  references public.payment_methods(id)
  on delete set null;

-- ---------- 2. cash_sessions: 1 sessão aberta por operador ----
create unique index if not exists cash_sessions_one_open_per_operator
  on public.cash_sessions (tenant_id, opened_by)
  where closed_at is null;

-- ✅ migration_v11 aplicada
