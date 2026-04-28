-- =============================================================
-- Coco da Amazônia · MIGRATION v6 · Categorias de despesa
--
-- Acrescenta:
--   - Tabela expense_categories (cadastrável por tenant)
--   - RLS: select pro tenant; modify só admin
--   - Seed das 7 categorias padrão pra cada tenant existente
--
-- A coluna expenses.category continua text (sem FK) pra não
-- quebrar histórico se o admin renomear/excluir uma categoria.
--
-- Idempotente.
-- =============================================================

create extension if not exists "pgcrypto";

-- ---------- 1. Tabela expense_categories -------------------
create table if not exists public.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) on delete cascade,
  name        text not null,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

create index if not exists expense_categories_tenant_idx
  on public.expense_categories (tenant_id);

-- set_tenant_id automático no INSERT
drop trigger if exists trg_set_tenant_id on public.expense_categories;
create trigger trg_set_tenant_id
  before insert on public.expense_categories
  for each row execute function public.set_tenant_id();

-- audit
drop trigger if exists trg_audit_expense_categories on public.expense_categories;
create trigger trg_audit_expense_categories
  after insert or update or delete on public.expense_categories
  for each row execute function public.log_audit();

-- ---------- 2. RLS ------------------------------------------
alter table public.expense_categories enable row level security;

drop policy if exists expense_categories_select on public.expense_categories;
create policy expense_categories_select on public.expense_categories
  for select to authenticated
  using (tenant_id in (select public.user_tenants()));

drop policy if exists expense_categories_modify on public.expense_categories;
create policy expense_categories_modify on public.expense_categories
  for all to authenticated
  using (tenant_id in (select public.user_tenants()) and public.is_admin())
  with check (tenant_id in (select public.user_tenants()) and public.is_admin());

-- ---------- 3. Seed das categorias padrão -------------------
-- Roda pra cada tenant existente. ON CONFLICT pula se já tem.
insert into public.expense_categories (tenant_id, name, sort_order)
select t.id, c.name, c.ord
  from public.tenants t
  cross join (values
    ('Fornecedor', 1),
    ('Combustível', 2),
    ('Gelo', 3),
    ('Embalagem', 4),
    ('Salário', 5),
    ('Aluguel', 6),
    ('Outros', 99)
  ) as c(name, ord)
on conflict (tenant_id, name) do nothing;

-- ---------- 4. Fim ------------------------------------------
-- ✅ migration_v6 aplicada
