-- =============================================================
-- Coco da Amazônia · MIGRATION v13 · Admin de memberships
--
-- Hoje, mudar a role de um operador ou removê-lo exige SQL direto no
-- Supabase. Esta migration adiciona:
--   1) RPC set_membership_role(p_user_id, p_role) — admin only.
--   2) RPC remove_membership(p_user_id) — admin only. Bloqueia remover
--      o último admin do tenant pra não deixar o tenant sem dono.
--   3) Trigger de audit em public.memberships (mudança de role é
--      sensível).
-- =============================================================

create or replace function public.set_membership_role(
  p_user_id uuid,
  p_role text
) returns void language plpgsql security definer as $$
declare
  v_tenant uuid;
  v_admins int;
begin
  if not public.is_admin() then
    raise exception 'Apenas admin pode mudar role.';
  end if;
  if p_role not in ('admin', 'operador') then
    raise exception 'Role inválida: %', p_role;
  end if;

  select tenant_id into v_tenant
    from public.memberships
    where user_id = p_user_id
      and tenant_id in (select public.user_tenants())
    limit 1;
  if v_tenant is null then
    raise exception 'Membro não encontrado.';
  end if;

  -- Bloqueia rebaixar o último admin
  if p_role = 'operador' then
    select count(*) into v_admins
      from public.memberships
      where tenant_id = v_tenant and role = 'admin';
    if v_admins <= 1 then
      raise exception 'Não dá pra rebaixar o último admin do tenant.';
    end if;
  end if;

  update public.memberships
    set role = p_role
    where user_id = p_user_id and tenant_id = v_tenant;
end;
$$;

create or replace function public.remove_membership(p_user_id uuid)
returns void language plpgsql security definer as $$
declare
  v_tenant uuid;
  v_role text;
  v_admins int;
begin
  if not public.is_admin() then
    raise exception 'Apenas admin pode remover membro.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Não dá pra remover você mesmo.';
  end if;

  select tenant_id, role into v_tenant, v_role
    from public.memberships
    where user_id = p_user_id
      and tenant_id in (select public.user_tenants())
    limit 1;
  if v_tenant is null then
    raise exception 'Membro não encontrado.';
  end if;

  if v_role = 'admin' then
    select count(*) into v_admins
      from public.memberships
      where tenant_id = v_tenant and role = 'admin';
    if v_admins <= 1 then
      raise exception 'Não dá pra remover o último admin do tenant.';
    end if;
  end if;

  delete from public.memberships
    where user_id = p_user_id and tenant_id = v_tenant;
end;
$$;

-- Audit em memberships (idempotente: drop se existir)
drop trigger if exists trg_log_audit on public.memberships;
create trigger trg_log_audit
  after insert or update or delete on public.memberships
  for each row execute function public.log_audit();

-- ✅ migration_v13 aplicada
