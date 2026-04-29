-- =============================================================
-- Coco da Amazônia · MIGRATION v7 · Numeração sequencial
--
-- Vendas e cargas passam a ter um número humano (`code`)
-- sequencial por tenant, em vez de UUID truncado.
--
--   - sales.code  começa em 10000
--   - cargas.code começa em 1000
--
-- O `id` UUID continua sendo a PK (várias FKs apontam pra ele).
-- `code` é só pra exibição.
--
-- Idempotente.
-- =============================================================

create extension if not exists "pgcrypto";

-- ---------- 1. Tabela de contadores por tenant -------------
create table if not exists public.tenant_counters (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  scope       text not null,
  last_value  int  not null,
  primary key (tenant_id, scope)
);

alter table public.tenant_counters enable row level security;
drop policy if exists tenant_counters_select on public.tenant_counters;
create policy tenant_counters_select on public.tenant_counters
  for select to authenticated
  using (tenant_id in (select public.user_tenants()));

-- ---------- 2. Função next_counter --------------------------
-- Atomic upsert + increment. Retorna o novo último valor.
-- Se for o primeiro INSERT do escopo, retorna p_start.
create or replace function public.next_counter(
  p_tenant uuid, p_scope text, p_start int
) returns int language plpgsql security definer as $$
declare v_value int;
begin
  insert into public.tenant_counters (tenant_id, scope, last_value)
  values (p_tenant, p_scope, p_start)
  on conflict (tenant_id, scope) do update
     set last_value = public.tenant_counters.last_value + 1
  returning last_value into v_value;
  return v_value;
end;
$$;

-- ---------- 3. Coluna code em sales e cargas ---------------
alter table public.sales  add column if not exists code int;
alter table public.cargas add column if not exists code int;

-- ---------- 4. Backfill em ordem cronológica ---------------
-- Sales: começa em 10000 por tenant
do $$
begin
  if exists (select 1 from public.sales where code is null) then
    with ordered as (
      select id, tenant_id,
             row_number() over (
               partition by tenant_id order by created_at, id
             ) - 1 as rn
        from public.sales
       where code is null
    )
    update public.sales s
       set code = 10000 + ordered.rn +
                  coalesce(
                    (select max(code) - 10000 + 1
                       from public.sales
                      where tenant_id = ordered.tenant_id and code is not null),
                    0
                  )
      from ordered
     where s.id = ordered.id;
  end if;
end $$;

-- Cargas: começa em 1000 por tenant
do $$
begin
  if exists (select 1 from public.cargas where code is null) then
    with ordered as (
      select id, tenant_id,
             row_number() over (
               partition by tenant_id order by opened_at, id
             ) - 1 as rn
        from public.cargas
       where code is null
    )
    update public.cargas c
       set code = 1000 + ordered.rn +
                  coalesce(
                    (select max(code) - 1000 + 1
                       from public.cargas
                      where tenant_id = ordered.tenant_id and code is not null),
                    0
                  )
      from ordered
     where c.id = ordered.id;
  end if;
end $$;

-- ---------- 5. Sincroniza tenant_counters com max atual ----
insert into public.tenant_counters (tenant_id, scope, last_value)
select tenant_id, 'sale', max(code)
  from public.sales
 where code is not null
 group by tenant_id
on conflict (tenant_id, scope) do update
   set last_value = greatest(public.tenant_counters.last_value, excluded.last_value);

insert into public.tenant_counters (tenant_id, scope, last_value)
select tenant_id, 'carga', max(code)
  from public.cargas
 where code is not null
 group by tenant_id
on conflict (tenant_id, scope) do update
   set last_value = greatest(public.tenant_counters.last_value, excluded.last_value);

-- ---------- 6. NOT NULL + UNIQUE ---------------------------
alter table public.sales  alter column code set not null;
alter table public.cargas alter column code set not null;

create unique index if not exists sales_code_unique  on public.sales  (tenant_id, code);
create unique index if not exists cargas_code_unique on public.cargas (tenant_id, code);

-- ---------- 7. Triggers BEFORE INSERT pra atribuir code ----
-- Nome com "z_" pra rodar DEPOIS de trg_set_tenant_id (ordem alfabética).
create or replace function public.set_sale_code() returns trigger
language plpgsql as $$
begin
  if new.code is null and new.tenant_id is not null then
    new.code := public.next_counter(new.tenant_id, 'sale', 10000);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_z_set_sale_code on public.sales;
create trigger trg_z_set_sale_code
  before insert on public.sales
  for each row execute function public.set_sale_code();

create or replace function public.set_carga_code() returns trigger
language plpgsql as $$
begin
  if new.code is null and new.tenant_id is not null then
    new.code := public.next_counter(new.tenant_id, 'carga', 1000);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_z_set_carga_code on public.cargas;
create trigger trg_z_set_carga_code
  before insert on public.cargas
  for each row execute function public.set_carga_code();

-- ---------- 8. Fim ------------------------------------------
-- ✅ migration_v7 aplicada
