-- =============================================================
-- Coco da Amazônia · MIGRATION v8 · Apagar carga
--
-- Cria o RPC delete_carga que apaga uma carga e seus movimentos
-- automáticos (estoque/caixa) numa transação só.
--
-- Bloqueia se a carga tem vendas vinculadas (mesmo canceladas) —
-- nesse caso o admin precisa primeiro apagar/desvincular as
-- vendas em /relatorios ou /clientes/[id].
--
-- Idempotente.
-- =============================================================

create or replace function public.delete_carga(p_carga_id uuid)
returns void language plpgsql security definer as $$
declare
  v_sales_count int;
begin
  if not public.is_admin() then
    raise exception 'Apenas admin pode apagar carga.';
  end if;
  -- Tenant scoping: confirma que a carga existe num tenant do usuário
  if not exists (
    select 1 from public.cargas c
     where c.id = p_carga_id
       and c.tenant_id in (select public.user_tenants())
  ) then
    raise exception 'Carga não encontrada.';
  end if;
  -- Bloqueia se há vendas vinculadas (mesmo canceladas)
  select count(*) into v_sales_count
    from public.sales where carga_id = p_carga_id;
  if v_sales_count > 0 then
    raise exception
      'Carga tem % vendas vinculadas. Apague/desvincule as vendas primeiro.',
      v_sales_count;
  end if;
  -- Limpa movimentos automáticos (carga_saida/retorno/perda) e caixa da carga
  delete from public.inventory_movements where carga_id = p_carga_id;
  delete from public.cash_movements      where carga_id = p_carga_id;
  -- Limpa despesas vinculadas? Não — despesas têm valor próprio. Só desvincula via FK SET NULL.
  -- A FK em expenses.carga_id já é ON DELETE SET NULL, então a despesa fica órfã (sem carga) mas preservada.
  delete from public.cargas where id = p_carga_id;
end;
$$;

-- ✅ migration_v8 aplicada
