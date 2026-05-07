-- =============================================================
-- Coco da Amazônia · MIGRATION v9 · Resync de movimentos da carga
--
-- O trigger cargas_apply_inventory cria carga_saida/retorno/perda só
-- na criação da carga e nas transições aberta↔fechada. Quando o admin
-- edita opening_cocos, closing_cocos_remaining ou as vendas de uma
-- carga já fechada, os movimentos ficam travados nos valores antigos
-- e o estoque dessincroniza.
--
-- Este RPC apaga os movimentos automáticos da carga e recria com base
-- no estado atual. Idempotente — pode ser chamado múltiplas vezes.
-- Apenas admin.
-- =============================================================

create or replace function public.resync_carga_inventory(p_carga_id uuid)
returns void language plpgsql security definer as $$
declare
  v_tenant uuid;
  v_status text;
  v_opening int;
  v_remaining int;
  v_opened_by uuid;
  v_closed_by uuid;
  v_vendidos int;
  v_perda int;
begin
  if not public.is_admin() then
    raise exception 'Apenas admin pode recalcular movimentos.';
  end if;

  select tenant_id, status, opening_cocos, closing_cocos_remaining,
         opened_by, closed_by
    into v_tenant, v_status, v_opening, v_remaining, v_opened_by, v_closed_by
    from public.cargas
    where id = p_carga_id
      and tenant_id in (select public.user_tenants());
  if not found then
    raise exception 'Carga não encontrada.';
  end if;

  -- Limpa movimentos automáticos existentes da carga
  delete from public.inventory_movements
   where carga_id = p_carga_id
     and kind in ('carga_saida','carga_retorno','carga_perda');

  -- Saída: sempre baseado em opening_cocos atual
  insert into public.inventory_movements
    (tenant_id, kind, quantity, notes, carga_id, created_by)
  values
    (v_tenant, 'carga_saida', v_opening,
     'Saída (resincronização) carga ' || substr(p_carga_id::text,1,8),
     p_carga_id, v_opened_by);

  -- Retorno e perda: só se carga não estiver aberta
  if v_status in ('fechada','conferida') then
    insert into public.inventory_movements
      (tenant_id, kind, quantity, notes, carga_id, created_by)
    values
      (v_tenant, 'carga_retorno', coalesce(v_remaining, 0),
       'Retorno (resincronização) carga ' || substr(p_carga_id::text,1,8),
       p_carga_id, coalesce(v_closed_by, v_opened_by));

    select coalesce(sum(quantity), 0) into v_vendidos
      from public.sales
     where carga_id = p_carga_id and canceled_at is null;

    v_perda := v_opening - coalesce(v_remaining, 0) - v_vendidos;
    if v_perda > 0 then
      insert into public.inventory_movements
        (tenant_id, kind, quantity, notes, carga_id, created_by)
      values
        (v_tenant, 'carga_perda', v_perda,
         'Perda (resincronização) carga ' || substr(p_carga_id::text,1,8),
         p_carga_id, coalesce(v_closed_by, v_opened_by));
    end if;
  end if;
end;
$$;

-- ✅ migration_v9 aplicada
