-- =============================================================
-- Single-tenant fix (versão 2 — corrige FK violation no audit_log):
--   1. Atualiza log_audit() para ignorar tenant deletado
--   2. Atualiza handle_new_user() — novos signups entram na loja existente
--   3. Move outros usuários para o tenant mais antigo (admin) e apaga
--      lojas órfãs
-- Idempotente: pode rodar mais de uma vez.
-- =============================================================

-- 1) Trigger de auditoria robusto (não quebra em cascade delete)
create or replace function public.log_audit()
returns trigger language plpgsql security definer as $$
declare
  v_tenant uuid;
  v_row_id uuid;
  v_before jsonb;
  v_after  jsonb;
begin
  if (tg_op = 'DELETE') then
    v_tenant := old.tenant_id;
    v_row_id := old.id;
    v_before := to_jsonb(old);
  elsif (tg_op = 'UPDATE') then
    v_tenant := new.tenant_id;
    v_row_id := new.id;
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
  else
    v_tenant := new.tenant_id;
    v_row_id := new.id;
    v_after  := to_jsonb(new);
  end if;

  if v_tenant is not null and exists (select 1 from public.tenants where id = v_tenant) then
    insert into public.audit_log (tenant_id, user_id, table_name, op, row_id, before_data, after_data)
      values (v_tenant, auth.uid(), tg_table_name, tg_op, v_row_id, v_before, v_after);
  end if;

  if (tg_op = 'DELETE') then return old; else return new; end if;
end;
$$;

-- 2) Trigger de signup: entra na loja existente quando há apenas 1
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_tenant uuid;
  v_count int;
begin
  select count(*) into v_count from public.tenants;

  if v_count = 1 then
    select id into v_tenant from public.tenants limit 1;
    insert into public.memberships (user_id, tenant_id, role)
      values (new.id, v_tenant, 'operador');
  else
    insert into public.tenants (name) values ('Minha Loja') returning id into v_tenant;
    insert into public.memberships (user_id, tenant_id, role)
      values (new.id, v_tenant, 'admin');
    insert into public.product_settings (name, unit_price, tenant_id)
      values ('Coco Verde', 3.00, v_tenant);
    insert into public.payment_methods (name, is_credit, tenant_id) values
      ('Dinheiro', false, v_tenant),
      ('Pix', false, v_tenant),
      ('Cartão Débito', false, v_tenant),
      ('Cartão Crédito', false, v_tenant),
      ('A Prazo (Fiado)', true, v_tenant)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

-- 3) Move usuários para o tenant mais antigo e apaga lojas órfãs
do $$
declare
  v_target_tenant uuid;
  v_user_id uuid;
  v_orphan_tenant uuid;
begin
  select m.tenant_id into v_target_tenant
  from auth.users u
  join public.memberships m on m.user_id = u.id
  order by u.created_at asc
  limit 1;

  if v_target_tenant is null then
    raise notice 'Nenhum tenant encontrado — nada a fazer.';
    return;
  end if;

  for v_user_id, v_orphan_tenant in
    select u.id, m.tenant_id
    from auth.users u
    left join public.memberships m on m.user_id = u.id
    where u.id <> (select id from auth.users order by created_at asc limit 1)
  loop
    insert into public.memberships (user_id, tenant_id, role)
      values (v_user_id, v_target_tenant, 'admin')
      on conflict (user_id, tenant_id) do update set role = 'admin';

    if v_orphan_tenant is not null and v_orphan_tenant <> v_target_tenant then
      delete from public.memberships
      where user_id = v_user_id and tenant_id = v_orphan_tenant;

      if not exists (
        select 1 from public.memberships where tenant_id = v_orphan_tenant
      ) then
        delete from public.tenants where id = v_orphan_tenant;
      end if;
    end if;
  end loop;
end $$;

-- 4) Conferência
select u.email, m.role, t.name as tenant
from auth.users u
join public.memberships m on m.user_id = u.id
join public.tenants t on t.id = m.tenant_id
order by u.created_at;
