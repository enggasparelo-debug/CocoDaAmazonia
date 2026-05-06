-- =============================================================
-- Coco da Amazônia · MIGRATION v19 · Inventory balance materialized
--
-- A view inventory_balance recalculava a equação inteira em cada
-- query (entradas + ajustes + carga_retorno - perdas - carga_saida -
-- carga_perda - vendas_avulsas). Com >100k vendas isso engasga.
--
-- Esta migration converte pra materialized view com refresh
-- concurrent. Triggers em inventory_movements e sales disparam o
-- refresh assincronamente — usando NOTIFY pra desacoplar.
--
-- Pra simplificar: o refresh é síncrono dentro do trigger. Se isso
-- ficar lento, troca pra NOTIFY + worker assíncrono numa próxima
-- iteração.
-- =============================================================

-- Drop view antiga e recria como matview
drop view if exists public.inventory_balance cascade;

create materialized view public.inventory_balance as
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

-- Índice unique pra refresh concurrently
create unique index if not exists inventory_balance_tenant_idx
  on public.inventory_balance (tenant_id);

-- Refresh inicial
refresh materialized view public.inventory_balance;

-- Função de refresh (concurrently pra não bloquear leituras)
create or replace function public.refresh_inventory_balance()
returns void language plpgsql security definer as $$
begin
  refresh materialized view concurrently public.inventory_balance;
exception
  when others then
    -- Fallback non-concurrent caso o índice não exista
    refresh materialized view public.inventory_balance;
end;
$$;

-- Trigger function: dispara refresh em INSERT/UPDATE/DELETE
create or replace function public.trg_refresh_inventory_balance()
returns trigger language plpgsql security definer as $$
begin
  perform public.refresh_inventory_balance();
  return null;
end;
$$;

-- Triggers em inventory_movements e sales
drop trigger if exists trg_inv_refresh on public.inventory_movements;
create trigger trg_inv_refresh
  after insert or update or delete on public.inventory_movements
  for each statement execute function public.trg_refresh_inventory_balance();

drop trigger if exists trg_sales_inv_refresh on public.sales;
create trigger trg_sales_inv_refresh
  after insert or update or delete on public.sales
  for each statement execute function public.trg_refresh_inventory_balance();

-- ✅ migration_v19 aplicada
