-- =============================================================
-- Coco da Amazônia · MIGRATION v10 · Auto-sync de movimentos da carga
--
-- O trigger v4 só criava carga_saida/retorno/perda em INSERT e em
-- transições de status. Edições de opening_cocos, closing_cocos_remaining
-- ou de vendas dentro de uma carga já fechada deixavam os movimentos
-- travados nos valores antigos (bug visível na auditoria por carga).
--
-- Esta migration:
--   1) Centraliza a lógica num helper interno
--      `_apply_carga_inventory_state(p_carga_id)` (sem admin check, usado
--      por triggers e pelo RPC explícito).
--   2) Reescreve o trigger `cargas_apply_inventory` pra chamar o helper
--      sempre que opening_cocos, closing_cocos_remaining ou status
--      mudarem.
--   3) Adiciona trigger novo `sales_apply_carga_perda` em public.sales
--      que recomputa carga_perda quando vendas com carga_id são
--      inseridas/editadas/apagadas (incluindo cancelamento e mudança de
--      carga_id).
--   4) Reescreve o RPC `resync_carga_inventory` pra usar o helper.
--
-- Idempotente: o helper apaga e recria os movimentos automáticos. Se
-- chamado várias vezes no mesmo estado, produz o mesmo resultado.
-- =============================================================

-- ---------- 1. Helper interno -------------------------------
create or replace function public._apply_carga_inventory_state(p_carga_id uuid)
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
  select tenant_id, status, opening_cocos, closing_cocos_remaining,
         opened_by, closed_by
    into v_tenant, v_status, v_opening, v_remaining, v_opened_by, v_closed_by
    from public.cargas
   where id = p_carga_id;
  if not found then
    return;
  end if;

  -- Apaga todos os movimentos automáticos da carga
  delete from public.inventory_movements
   where carga_id = p_carga_id
     and kind in ('carga_saida','carga_retorno','carga_perda');

  -- carga_saida: sempre cria com opening_cocos atual (se > 0)
  if coalesce(v_opening, 0) > 0 then
    insert into public.inventory_movements
      (tenant_id, kind, quantity, notes, carga_id, created_by)
    values
      (v_tenant, 'carga_saida', v_opening,
       'Saída automática carga ' || substr(p_carga_id::text,1,8),
       p_carga_id, v_opened_by);
  end if;

  -- Retorno e perda só pra cargas fechadas/conferidas
  if v_status in ('fechada','conferida') then
    if v_remaining is not null and v_remaining > 0 then
      insert into public.inventory_movements
        (tenant_id, kind, quantity, notes, carga_id, created_by)
      values
        (v_tenant, 'carga_retorno', v_remaining,
         'Retorno automático carga ' || substr(p_carga_id::text,1,8),
         p_carga_id, coalesce(v_closed_by, v_opened_by));
    end if;

    select coalesce(sum(quantity), 0) into v_vendidos
      from public.sales
     where carga_id = p_carga_id and canceled_at is null;

    v_perda := coalesce(v_opening, 0) - coalesce(v_remaining, 0) - v_vendidos;
    if v_perda > 0 then
      insert into public.inventory_movements
        (tenant_id, kind, quantity, notes, carga_id, created_by)
      values
        (v_tenant, 'carga_perda', v_perda,
         'Perda automática (diferença entre saída e vendido+sobra) carga '
           || substr(p_carga_id::text,1,8),
         p_carga_id, coalesce(v_closed_by, v_opened_by));
    end if;
  end if;
end;
$$;

-- ---------- 2. Trigger nas cargas ----------------------------
-- Reescrita: chama o helper em INSERT e em UPDATEs que afetam estoque.
create or replace function public.cargas_apply_inventory()
returns trigger language plpgsql security definer as $$
begin
  if TG_OP = 'INSERT' then
    perform public._apply_carga_inventory_state(new.id);
    return new;
  end if;

  if TG_OP = 'UPDATE' then
    if old.opening_cocos is distinct from new.opening_cocos
       or old.closing_cocos_remaining is distinct from new.closing_cocos_remaining
       or old.status is distinct from new.status then
      perform public._apply_carga_inventory_state(new.id);
    end if;
    return new;
  end if;

  return null;
end;
$$;

-- Trigger já existe (criado em migration_v4); reapontamos pra função
-- atualizada por garantia.
drop trigger if exists trg_cargas_apply_inventory on public.cargas;
create trigger trg_cargas_apply_inventory
  after insert or update on public.cargas
  for each row execute function public.cargas_apply_inventory();

-- ---------- 3. Trigger nas vendas ----------------------------
-- Recomputa carga_perda quando vendas com carga_id mudam (incluindo
-- cancelamento, edição de quantity e troca de carga_id entre cargas).
create or replace function public.sales_apply_carga_perda()
returns trigger language plpgsql security definer as $$
declare
  v_old_carga uuid;
  v_new_carga uuid;
begin
  v_old_carga := case when TG_OP in ('UPDATE','DELETE') then old.carga_id else null end;
  v_new_carga := case when TG_OP in ('INSERT','UPDATE') then new.carga_id else null end;

  if v_old_carga is not null then
    perform public._apply_carga_inventory_state(v_old_carga);
  end if;
  if v_new_carga is not null and v_new_carga is distinct from v_old_carga then
    perform public._apply_carga_inventory_state(v_new_carga);
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sales_apply_carga_perda on public.sales;
create trigger trg_sales_apply_carga_perda
  after insert or update or delete on public.sales
  for each row execute function public.sales_apply_carga_perda();

-- ---------- 4. RPC explícito (continua disponível) -----------
-- Mantém o botão "🔄 Recalcular movimentos" funcional. Mesmo com o
-- auto-sync, é útil pra forçar uma reconferência ou consertar dados
-- legados.
create or replace function public.resync_carga_inventory(p_carga_id uuid)
returns void language plpgsql security definer as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas admin pode recalcular movimentos.';
  end if;
  if not exists (
    select 1 from public.cargas
     where id = p_carga_id
       and tenant_id in (select public.user_tenants())
  ) then
    raise exception 'Carga não encontrada.';
  end if;
  perform public._apply_carga_inventory_state(p_carga_id);
end;
$$;

-- ---------- 5. Backfill: ressincroniza todas as cargas existentes
-- Roda o helper pra cada carga uma vez, garantindo que o estado fique
-- consistente em ambientes que já tinham dados dessincronizados.
do $$
declare
  r record;
begin
  for r in select id from public.cargas loop
    perform public._apply_carga_inventory_state(r.id);
  end loop;
end $$;

-- ✅ migration_v10 aplicada
