-- =============================================================
-- Coco da Amazônia · MIGRATION v5 · Vendedores
--
-- Acrescenta:
--   - Tabela sellers (vendedor cadastrável, opcionalmente vinculado a um login)
--   - Coluna seller_id em sales (obrigatória em INSERTs novos)
--   - Trigger que exige seller_id em INSERTs (não em UPDATEs, pra preservar histórico)
--   - RPC link_seller_to_history pra backfill manual via UI
--   - RLS: select aberto pro tenant; modify só admin
--
-- Idempotente.
-- =============================================================

create extension if not exists "pgcrypto";

-- ---------- 1. Tabela sellers -------------------------------
create table if not exists public.sellers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 1 vendedor por user_id (vendedores sem user_id podem ser múltiplos)
create unique index if not exists sellers_user_unique
  on public.sellers (tenant_id, user_id) where user_id is not null;
create index if not exists sellers_tenant_idx on public.sellers (tenant_id);

-- set_tenant_id automático no INSERT (reusa função do schema.sql)
drop trigger if exists trg_set_tenant_id on public.sellers;
create trigger trg_set_tenant_id
  before insert on public.sellers
  for each row execute function public.set_tenant_id();

-- audit
drop trigger if exists trg_audit_sellers on public.sellers;
create trigger trg_audit_sellers
  after insert or update or delete on public.sellers
  for each row execute function public.log_audit();

-- ---------- 2. Coluna seller_id em sales --------------------
alter table public.sales
  add column if not exists seller_id uuid references public.sellers(id) on delete set null;
create index if not exists sales_seller_idx on public.sales (seller_id);

-- ---------- 3. Trigger: seller_id obrigatório em INSERT -----
create or replace function public.check_sale_seller_required()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') and new.seller_id is null then
    raise exception 'Venda exige vendedor. Cadastre em Configurações → Vendedores.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_sale_seller on public.sales;
create trigger trg_check_sale_seller
  before insert on public.sales
  for each row execute function public.check_sale_seller_required();

-- ---------- 4. RLS ------------------------------------------
alter table public.sellers enable row level security;

drop policy if exists sellers_select on public.sellers;
create policy sellers_select on public.sellers
  for select to authenticated
  using (tenant_id in (select public.user_tenants()));

drop policy if exists sellers_modify on public.sellers;
create policy sellers_modify on public.sellers
  for all to authenticated
  using (tenant_id in (select public.user_tenants()) and public.is_admin())
  with check (tenant_id in (select public.user_tenants()) and public.is_admin());

-- ---------- 5. RPC: backfill manual de sales históricas -----
-- Atribui seller_id (vinculado a um operador) em todas as vendas em
-- aberto que estavam em cargas daquele operador.
create or replace function public.link_seller_to_history(p_seller_id uuid)
returns int language plpgsql security definer as $$
declare
  v_user uuid;
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Apenas admin pode chamar link_seller_to_history';
  end if;
  select user_id into v_user from public.sellers where id = p_seller_id;
  if v_user is null then
    return 0;
  end if;
  update public.sales s
     set seller_id = p_seller_id
   where s.seller_id is null
     and s.carga_id in (
       select c.id from public.cargas c where c.operator_id = v_user
     );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------- 6. Fim ------------------------------------------
-- ✅ migration_v5 aplicada
