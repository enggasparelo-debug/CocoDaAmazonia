-- =============================================================
-- Single-tenant fix:
--   1. Move o usuário NOVO para a loja do usuário ORIGINAL (admin)
--   2. Apaga a loja órfã que foi criada para o segundo signup
--   3. Atualiza o trigger handle_new_user: novos signups entram na
--      loja existente como 'operador' (em vez de criar nova loja)
-- Idempotente: pode rodar mais de uma vez.
-- =============================================================

-- 1) Move o usuário mais recente p/ o tenant do mais antigo (como admin)
do $$
declare
  v_target_tenant uuid;
  v_user_id uuid;
  v_orphan_tenant uuid;
begin
  -- tenant do usuário mais antigo (loja "principal", com seus dados)
  select m.tenant_id into v_target_tenant
  from auth.users u
  join public.memberships m on m.user_id = u.id
  order by u.created_at asc
  limit 1;

  if v_target_tenant is null then
    raise notice 'Nenhum tenant encontrado — nada a fazer.';
    return;
  end if;

  -- para cada usuário diferente do mais antigo, move para o tenant principal
  for v_user_id, v_orphan_tenant in
    select u.id, m.tenant_id
    from auth.users u
    left join public.memberships m on m.user_id = u.id
    where u.id <> (select id from auth.users order by created_at asc limit 1)
  loop
    -- adiciona como admin no tenant principal (se ainda não estiver)
    insert into public.memberships (user_id, tenant_id, role)
      values (v_user_id, v_target_tenant, 'admin')
      on conflict (user_id, tenant_id) do update set role = 'admin';

    -- remove o vínculo antigo (se for outro tenant)
    if v_orphan_tenant is not null and v_orphan_tenant <> v_target_tenant then
      delete from public.memberships
      where user_id = v_user_id and tenant_id = v_orphan_tenant;

      -- se ninguém mais usa esse tenant, apaga (cascade leva produto/formas)
      if not exists (
        select 1 from public.memberships where tenant_id = v_orphan_tenant
      ) then
        delete from public.tenants where id = v_orphan_tenant;
      end if;
    end if;
  end loop;
end $$;

-- 2) Atualiza o trigger handle_new_user p/ não criar mais lojas novas
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
    insert into public.tenants (name) values ('Minha Loja')
      returning id into v_tenant;
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

-- 3) Conferência: deve listar todos os usuários no MESMO tenant
select u.email, m.role, t.name as tenant
from auth.users u
join public.memberships m on m.user_id = u.id
join public.tenants t on t.id = m.tenant_id
order by u.created_at;
