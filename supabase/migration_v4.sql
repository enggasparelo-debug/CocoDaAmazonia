-- =============================================================
-- Coco da Amazônia · MIGRATION v4 · Carga / Operador
--
-- Acrescenta:
--   - Tabelas: vehicles, routes, cargas, fiado_promissorias
--   - Coluna carga_id em sales, expenses, inventory_movements, cash_movements
--   - View carga_summary com totais por carga
--   - View inventory_balance reescrita (vendas em carga já saem via carga_saida)
--   - Triggers: estoque automático (carga_saida / carga_retorno / carga_perda)
--   - Trigger: validação de transição de status
--   - Constraint: 1 carga aberta por operador
--   - RLS: operador só lê/escreve sua própria carga
--
-- Idempotente — pode rodar mais de uma vez sem efeitos colaterais.
-- =============================================================

create extension if not exists "pgcrypto";

-- ---------- 1. Veículos -------------------------------------
create table if not exists public.vehicles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) on delete cascade,
  plate       text not null,
  model       text,
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, plate)
);
create index if not exists vehicles_tenant_idx on public.vehicles (tenant_id);

-- ---------- 2. Rotas ----------------------------------------
create table if not exists public.routes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) on delete cascade,
  name        text not null,
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists routes_tenant_idx on public.routes (tenant_id);

-- ---------- 3. Cargas ---------------------------------------
create table if not exists public.cargas (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid references public.tenants(id) on delete cascade,
  operator_id              uuid not null references auth.users(id) on delete restrict,
  vehicle_id               uuid references public.vehicles(id) on delete set null,
  route_id                 uuid references public.routes(id) on delete set null,
  status                   text not null default 'aberta'
                              check (status in ('aberta','fechada','conferida')),
  opened_at                timestamptz not null default now(),
  opened_by                uuid references auth.users(id),
  opening_cocos            integer not null check (opening_cocos >= 0),
  closing_cocos_remaining  integer,
  closing_cash_declared    numeric(12,2),
  closing_notes            text,
  closed_at                timestamptz,
  closed_by                uuid references auth.users(id),
  conferred_at             timestamptz,
  conferred_by             uuid references auth.users(id),
  notes                    text
);
create index if not exists cargas_tenant_idx       on public.cargas (tenant_id);
create index if not exists cargas_operator_idx     on public.cargas (operator_id);
create index if not exists cargas_status_idx       on public.cargas (status);
create index if not exists cargas_opened_idx       on public.cargas (opened_at desc);

-- 1 carga aberta por operador
create unique index if not exists cargas_one_open_per_operator
  on public.cargas (operator_id) where status = 'aberta';

-- ---------- 4. Coluna carga_id em tabelas existentes --------
alter table public.sales               add column if not exists carga_id uuid references public.cargas(id) on delete set null;
alter table public.expenses            add column if not exists carga_id uuid references public.cargas(id) on delete set null;
alter table public.inventory_movements add column if not exists carga_id uuid references public.cargas(id) on delete set null;
alter table public.cash_movements      add column if not exists carga_id uuid references public.cargas(id) on delete set null;

create index if not exists sales_carga_idx               on public.sales (carga_id);
create index if not exists expenses_carga_idx            on public.expenses (carga_id);
create index if not exists inventory_movements_carga_idx on public.inventory_movements (carga_id);
create index if not exists cash_movements_carga_idx      on public.cash_movements (carga_id);

-- 4.1 Ampliar check em inventory_movements.kind
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.inventory_movements'::regclass
       and conname  = 'inventory_movements_kind_check'
  ) then
    alter table public.inventory_movements drop constraint inventory_movements_kind_check;
  end if;
end $$;

alter table public.inventory_movements
  add constraint inventory_movements_kind_check
  check (kind in ('entrada','perda','ajuste','carga_saida','carga_retorno','carga_perda'));

-- 4.2 Relaxar session_id em cash_movements e exigir session_id OU carga_id
alter table public.cash_movements alter column session_id drop not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.cash_movements'::regclass
       and conname  = 'cash_movements_session_or_carga_chk'
  ) then
    alter table public.cash_movements drop constraint cash_movements_session_or_carga_chk;
  end if;
end $$;

alter table public.cash_movements
  add constraint cash_movements_session_or_carga_chk
  check (session_id is not null or carga_id is not null);

-- ---------- 5. Promissórias (fiado) -------------------------
create table if not exists public.fiado_promissorias (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references public.tenants(id) on delete cascade,
  sale_id           uuid not null unique references public.sales(id) on delete cascade,
  carga_id          uuid references public.cargas(id) on delete set null,
  signer_name       text not null,
  signer_document   text,
  signer_address    text,
  signature_data_url text not null,
  signed_at         timestamptz not null default now(),
  amount            numeric(12,2) not null check (amount > 0),
  created_by        uuid references auth.users(id)
);
create index if not exists fiado_promissorias_tenant_idx on public.fiado_promissorias (tenant_id);
create index if not exists fiado_promissorias_carga_idx  on public.fiado_promissorias (carga_id);

-- ---------- 6. set_tenant_id nas novas tabelas -------------
do $$
declare t text;
begin
  foreach t in array array['vehicles','routes','cargas','fiado_promissorias'] loop
    execute format(
      'drop trigger if exists trg_set_tenant_id on public.%I; ' ||
      'create trigger trg_set_tenant_id before insert on public.%I ' ||
      '  for each row execute function public.set_tenant_id()', t, t);
  end loop;
end $$;

-- ---------- 7. Audit log nas novas tabelas (exclui promissorias) --
do $$
declare t text;
begin
  foreach t in array array['vehicles','routes','cargas'] loop
    execute format(
      'drop trigger if exists trg_audit_%1$s on public.%1$s; ' ||
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$s ' ||
      '  for each row execute function public.log_audit()', t);
  end loop;
end $$;

-- ---------- 8. Triggers de estoque automático --------------
create or replace function public.cargas_apply_inventory()
returns trigger language plpgsql security definer as $$
declare
  v_vendidos integer;
  v_perda    integer;
begin
  if (tg_op = 'INSERT') then
    if new.status = 'aberta' and new.opening_cocos > 0 then
      -- saída do balcão para o veículo
      insert into public.inventory_movements
        (tenant_id, kind, quantity, notes, carga_id, created_by)
      values
        (new.tenant_id, 'carga_saida', new.opening_cocos,
         'Saída automática para carga ' || substr(new.id::text,1,8),
         new.id, new.opened_by);
    end if;
    return new;
  end if;

  if (tg_op = 'UPDATE') then
    -- transição aberta → fechada: gera retorno + perda
    if old.status = 'aberta' and new.status = 'fechada' then
      -- limpa eventuais retornos/perdas anteriores (idempotência)
      delete from public.inventory_movements
       where carga_id = new.id and kind in ('carga_retorno','carga_perda');

      if new.closing_cocos_remaining is not null and new.closing_cocos_remaining > 0 then
        insert into public.inventory_movements
          (tenant_id, kind, quantity, notes, carga_id, created_by)
        values
          (new.tenant_id, 'carga_retorno', new.closing_cocos_remaining,
           'Retorno automático no fechamento da carga ' || substr(new.id::text,1,8),
           new.id, new.closed_by);
      end if;

      select coalesce(sum(quantity),0) into v_vendidos
        from public.sales
       where carga_id = new.id and canceled_at is null;

      v_perda := new.opening_cocos - coalesce(new.closing_cocos_remaining, 0) - v_vendidos;
      if v_perda > 0 then
        insert into public.inventory_movements
          (tenant_id, kind, quantity, notes, carga_id, created_by)
        values
          (new.tenant_id, 'carga_perda', v_perda,
           'Perda automática (diferença entre saída e vendido+sobra) carga ' || substr(new.id::text,1,8),
           new.id, new.closed_by);
      end if;
      return new;
    end if;

    -- reabertura: limpa retorno/perda
    if (old.status in ('fechada','conferida')) and new.status = 'aberta' then
      delete from public.inventory_movements
       where carga_id = new.id and kind in ('carga_retorno','carga_perda');
      return new;
    end if;

    return new;
  end if;
end;
$$;

drop trigger if exists trg_cargas_apply_inventory on public.cargas;
create trigger trg_cargas_apply_inventory
  after insert or update on public.cargas
  for each row execute function public.cargas_apply_inventory();

-- ---------- 9. Validação de transição de status -------------
create or replace function public.cargas_validate_transition()
returns trigger language plpgsql security definer as $$
begin
  if (tg_op = 'UPDATE') and old.status is distinct from new.status then
    -- aberta → fechada
    if old.status = 'aberta' and new.status = 'fechada' then
      if new.closing_cocos_remaining is null then
        raise exception 'Sobra de cocos é obrigatória para fechar a carga';
      end if;
      if new.closing_cash_declared is null then
        raise exception 'Dinheiro declarado é obrigatório para fechar a carga';
      end if;
      if new.closed_at is null then new.closed_at := now(); end if;
      if new.closed_by is null then new.closed_by := auth.uid(); end if;

    -- fechada → conferida (apenas admin)
    elsif old.status = 'fechada' and new.status = 'conferida' then
      if not public.is_admin() then
        raise exception 'Apenas admin pode conferir uma carga';
      end if;
      if new.conferred_at is null then new.conferred_at := now(); end if;
      if new.conferred_by is null then new.conferred_by := auth.uid(); end if;

    -- reabertura (qualquer estado → aberta) só admin com nota
    elsif new.status = 'aberta' and old.status in ('fechada','conferida') then
      if not public.is_admin() then
        raise exception 'Apenas admin pode reabrir uma carga';
      end if;
      if coalesce(trim(new.notes), '') = '' then
        raise exception 'Reabertura exige preencher o campo notas';
      end if;
      new.closed_at := null;
      new.closed_by := null;
      new.conferred_at := null;
      new.conferred_by := null;
      new.closing_cocos_remaining := null;
      new.closing_cash_declared := null;

    else
      raise exception 'Transição de status inválida: % → %', old.status, new.status;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cargas_validate_transition on public.cargas;
create trigger trg_cargas_validate_transition
  before update on public.cargas
  for each row execute function public.cargas_validate_transition();

-- ---------- 10. View carga_summary --------------------------
drop view if exists public.carga_summary cascade;
create view public.carga_summary as
with vendas as (
  select
    s.carga_id,
    coalesce(sum(s.quantity), 0)::int as cocos_vendidos,
    coalesce(sum(s.total), 0)         as total_vendido,
    coalesce(sum(s.paid_amount), 0)   as total_recebido,
    coalesce(sum(s.total - s.paid_amount), 0) as total_fiado
  from public.sales s
  where s.canceled_at is null
  group by s.carga_id
),
pagos as (
  select
    s.carga_id,
    pm.is_credit,
    lower(pm.name) as method_lower,
    coalesce(sum(sp.amount), 0) as amount
  from public.sale_payments sp
  join public.sales s on s.id = sp.sale_id and s.canceled_at is null
  join public.payment_methods pm on pm.id = sp.payment_method_id
  group by s.carga_id, pm.is_credit, lower(pm.name)
),
pagos_pivot as (
  select
    p.carga_id,
    sum(case when p.method_lower like '%dinheiro%' then p.amount else 0 end) as total_dinheiro,
    sum(case when p.method_lower like '%pix%'      then p.amount else 0 end) as total_pix,
    sum(case when p.method_lower like '%cart%'     then p.amount else 0 end) as total_cartao,
    sum(case when p.method_lower not like '%dinheiro%'
              and p.method_lower not like '%pix%'
              and p.method_lower not like '%cart%' then p.amount else 0 end) as total_outros
  from pagos p
  group by p.carga_id
),
mov as (
  select
    cm.carga_id,
    sum(case when cm.kind = 'suprimento' then cm.amount else 0 end) as total_suprimento,
    sum(case when cm.kind = 'sangria'    then cm.amount else 0 end) as total_sangria
  from public.cash_movements cm
  where cm.carga_id is not null
  group by cm.carga_id
),
desp as (
  select
    e.carga_id,
    coalesce(sum(e.amount), 0) as total_despesas
  from public.expenses e
  where e.carga_id is not null
  group by e.carga_id
),
perdas as (
  select
    im.carga_id,
    coalesce(sum(im.quantity), 0)::int as cocos_perda
  from public.inventory_movements im
  where im.carga_id is not null and im.kind = 'carga_perda'
  group by im.carga_id
)
select
  c.id          as carga_id,
  c.tenant_id,
  c.operator_id,
  c.status,
  c.opening_cocos,
  c.closing_cocos_remaining,
  c.closing_cash_declared,
  coalesce(v.cocos_vendidos, 0)   as cocos_vendidos,
  coalesce(p.cocos_perda, 0)      as cocos_perda,
  coalesce(v.total_vendido, 0)    as total_vendido,
  coalesce(v.total_recebido, 0)   as total_recebido,
  coalesce(v.total_fiado, 0)      as total_fiado,
  coalesce(pp.total_dinheiro, 0)  as total_dinheiro,
  coalesce(pp.total_pix, 0)       as total_pix,
  coalesce(pp.total_cartao, 0)    as total_cartao,
  coalesce(pp.total_outros, 0)    as total_outros,
  coalesce(m.total_suprimento, 0) as total_suprimento,
  coalesce(m.total_sangria, 0)    as total_sangria,
  coalesce(d.total_despesas, 0)   as total_despesas,
  (
    coalesce(pp.total_dinheiro, 0)
    + coalesce(m.total_suprimento, 0)
    - coalesce(m.total_sangria, 0)
    - coalesce(d.total_despesas, 0)
  ) as expected_cash,
  (
    coalesce(c.closing_cash_declared, 0)
    - (
      coalesce(pp.total_dinheiro, 0)
      + coalesce(m.total_suprimento, 0)
      - coalesce(m.total_sangria, 0)
      - coalesce(d.total_despesas, 0)
    )
  ) as cash_diff
from public.cargas c
left join vendas      v  on v.carga_id  = c.id
left join pagos_pivot pp on pp.carga_id = c.id
left join mov         m  on m.carga_id  = c.id
left join desp        d  on d.carga_id  = c.id
left join perdas      p  on p.carga_id  = c.id;

-- ---------- 11. View inventory_balance reescrita ------------
-- Vendas dentro de carga já saíram via 'carga_saida'; só vendas
-- de balcão (carga_id is null) entram como saída direta aqui.
drop view if exists public.inventory_balance cascade;
create view public.inventory_balance as
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

-- ---------- 12. RLS ----------------------------------------
alter table public.vehicles enable row level security;
alter table public.routes   enable row level security;
alter table public.cargas   enable row level security;
alter table public.fiado_promissorias enable row level security;

-- vehicles & routes: select aberto pro tenant; modify só admin
do $$
declare t text;
begin
  foreach t in array array['vehicles','routes'] loop
    execute format('drop policy if exists tenant_select_%1$s on public.%1$s', t);
    execute format('drop policy if exists tenant_modify_%1$s on public.%1$s', t);
    execute format(
      'create policy tenant_select_%1$s on public.%1$s ' ||
      '  for select to authenticated using (tenant_id in (select public.user_tenants()))', t);
    execute format(
      'create policy tenant_modify_%1$s on public.%1$s ' ||
      '  for all to authenticated ' ||
      '  using (tenant_id in (select public.user_tenants()) and public.is_admin()) ' ||
      '  with check (tenant_id in (select public.user_tenants()) and public.is_admin())', t);
  end loop;
end $$;

-- cargas: admin vê tudo do tenant; operador só vê as próprias
drop policy if exists carga_select on public.cargas;
create policy carga_select on public.cargas
  for select to authenticated
  using (
    tenant_id in (select public.user_tenants())
    and (public.is_admin() or operator_id = auth.uid())
  );

drop policy if exists carga_insert on public.cargas;
create policy carga_insert on public.cargas
  for insert to authenticated
  with check (
    tenant_id in (select public.user_tenants())
    and (public.is_admin() or operator_id = auth.uid())
  );

drop policy if exists carga_update on public.cargas;
create policy carga_update on public.cargas
  for update to authenticated
  using (
    tenant_id in (select public.user_tenants())
    and (public.is_admin() or operator_id = auth.uid())
  )
  with check (
    tenant_id in (select public.user_tenants())
    and (public.is_admin() or operator_id = auth.uid())
  );

drop policy if exists carga_delete on public.cargas;
create policy carga_delete on public.cargas
  for delete to authenticated
  using (
    tenant_id in (select public.user_tenants()) and public.is_admin()
  );

-- fiado_promissorias: operador só lê/escreve as da própria carga aberta;
-- admin tudo do tenant.
drop policy if exists promissoria_select on public.fiado_promissorias;
create policy promissoria_select on public.fiado_promissorias
  for select to authenticated
  using (
    tenant_id in (select public.user_tenants())
    and (
      public.is_admin()
      or carga_id in (
        select id from public.cargas
         where operator_id = auth.uid()
      )
    )
  );

drop policy if exists promissoria_insert on public.fiado_promissorias;
create policy promissoria_insert on public.fiado_promissorias
  for insert to authenticated
  with check (
    tenant_id in (select public.user_tenants())
    and (
      public.is_admin()
      or carga_id in (
        select id from public.cargas
         where operator_id = auth.uid() and status = 'aberta'
      )
    )
  );

-- ---------- 13. Reescrever RLS de tabelas existentes -------
-- Em vez de policy aberta pro tenant, exigir que escritas com carga_id
-- pertençam à carga aberta do operador (admin sempre passa).

-- helper inline em policies:
--   public.is_admin() OR carga_id IS NULL
--     OR carga_id IN (select id from cargas where operator_id = auth.uid() and status='aberta')

-- sales: operador só insere com carga_id apontando para a própria carga aberta;
-- admin pode tudo (inclusive vendas de balcão sem carga_id)
drop policy if exists tenant_modify_sales on public.sales;
create policy tenant_modify_sales on public.sales
  for all to authenticated
  using (tenant_id in (select public.user_tenants()))
  with check (
    tenant_id in (select public.user_tenants())
    and (
      public.is_admin()
      or carga_id in (
        select id from public.cargas
         where operator_id = auth.uid() and status = 'aberta'
      )
    )
  );

-- expenses
drop policy if exists tenant_modify_expenses on public.expenses;
create policy tenant_modify_expenses on public.expenses
  for all to authenticated
  using (tenant_id in (select public.user_tenants()))
  with check (
    tenant_id in (select public.user_tenants())
    and (
      public.is_admin()
      or carga_id in (
        select id from public.cargas
         where operator_id = auth.uid() and status = 'aberta'
      )
    )
  );

-- cash_movements
drop policy if exists tenant_modify_cash_movements on public.cash_movements;
create policy tenant_modify_cash_movements on public.cash_movements
  for all to authenticated
  using (tenant_id in (select public.user_tenants()))
  with check (
    tenant_id in (select public.user_tenants())
    and (
      public.is_admin()
      or carga_id in (
        select id from public.cargas
         where operator_id = auth.uid() and status = 'aberta'
      )
    )
  );

-- inventory_movements
drop policy if exists tenant_modify_inventory_movements on public.inventory_movements;
create policy tenant_modify_inventory_movements on public.inventory_movements
  for all to authenticated
  using (tenant_id in (select public.user_tenants()))
  with check (
    tenant_id in (select public.user_tenants())
    and (
      public.is_admin()
      or carga_id in (
        select id from public.cargas
         where operator_id = auth.uid() and status = 'aberta'
      )
    )
  );

-- sale_payments: operador pode lançar pagamento se a venda for da própria carga aberta
drop policy if exists tenant_modify_sale_payments on public.sale_payments;
create policy tenant_modify_sale_payments on public.sale_payments
  for all to authenticated
  using (tenant_id in (select public.user_tenants()))
  with check (
    tenant_id in (select public.user_tenants())
    and (
      public.is_admin()
      or sale_id in (
        select s.id from public.sales s
         join public.cargas c on c.id = s.carga_id
        where c.operator_id = auth.uid() and c.status = 'aberta'
      )
    )
  );

-- customers: operador pode INSERT/SELECT, mas não DELETE/UPDATE sensíveis
drop policy if exists tenant_modify_customers on public.customers;
drop policy if exists customers_select   on public.customers;
drop policy if exists customers_insert   on public.customers;
drop policy if exists customers_update   on public.customers;
drop policy if exists customers_delete   on public.customers;

create policy customers_select on public.customers
  for select to authenticated
  using (tenant_id in (select public.user_tenants()));

create policy customers_insert on public.customers
  for insert to authenticated
  with check (tenant_id in (select public.user_tenants()));

create policy customers_update on public.customers
  for update to authenticated
  using (tenant_id in (select public.user_tenants()) and public.is_admin())
  with check (tenant_id in (select public.user_tenants()) and public.is_admin());

create policy customers_delete on public.customers
  for delete to authenticated
  using (tenant_id in (select public.user_tenants()) and public.is_admin());

-- ---------- 14. Fim ----------------------------------------
-- ✅ migration_v4 aplicada
