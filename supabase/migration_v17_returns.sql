-- =============================================================
-- Coco da Amazônia · MIGRATION v17 · Devolução parcial de venda
--
-- Quando o cliente devolve N cocos de uma venda já realizada:
--   1) Registra evento em sale_returns.
--   2) Joga N cocos de volta no estoque via inventory_movements
--      (kind='ajuste'), pra refletir no saldo da view.
--   3) NÃO altera a sale original (preserva histórico). O lado
--      financeiro (devolver dinheiro / virar crédito) fica a critério
--      do admin via /caixa.
--
-- O RPC refund_sale é a forma única de criar a devolução — garante
-- que o ajuste de estoque entre numa transação só.
-- =============================================================

create table if not exists public.sale_returns (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  sale_id      uuid not null references public.sales(id) on delete cascade,
  quantity     integer not null check (quantity > 0),
  amount       numeric(12,2) not null check (amount >= 0),
  reason       text,
  returned_at  timestamptz not null default now(),
  returned_by  uuid references auth.users(id) on delete set null,
  inventory_movement_id uuid references public.inventory_movements(id) on delete set null
);
create index if not exists sale_returns_sale_idx on public.sale_returns (sale_id);
create index if not exists sale_returns_tenant_idx on public.sale_returns (tenant_id, returned_at desc);

alter table public.sale_returns enable row level security;
drop policy if exists sale_returns_select on public.sale_returns;
create policy sale_returns_select on public.sale_returns
  for select to authenticated
  using (tenant_id in (select public.user_tenants()));
drop policy if exists sale_returns_modify on public.sale_returns;
create policy sale_returns_modify on public.sale_returns
  for all to authenticated
  using (tenant_id in (select public.user_tenants()) and public.is_admin())
  with check (
    tenant_id in (select public.user_tenants()) and public.is_admin()
  );

drop trigger if exists trg_log_audit on public.sale_returns;
create trigger trg_log_audit
  after insert or update or delete on public.sale_returns
  for each row execute function public.log_audit();

create or replace function public.refund_sale(
  p_sale_id uuid,
  p_quantity int,
  p_reason text default null
) returns uuid language plpgsql security definer as $$
declare
  v_tenant uuid;
  v_qty_orig int;
  v_qty_returned int;
  v_unit_price numeric(12,2);
  v_canceled timestamptz;
  v_inv_id uuid;
  v_ret_id uuid;
  v_amount numeric(12,2);
begin
  if not public.is_admin() then
    raise exception 'Apenas admin pode lançar devolução.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantidade da devolução deve ser > 0.';
  end if;

  select tenant_id, quantity, unit_price, canceled_at
    into v_tenant, v_qty_orig, v_unit_price, v_canceled
    from public.sales
    where id = p_sale_id
      and tenant_id in (select public.user_tenants());
  if not found then
    raise exception 'Venda não encontrada.';
  end if;
  if v_canceled is not null then
    raise exception 'Não dá pra devolver de venda cancelada.';
  end if;

  -- Soma devoluções anteriores
  select coalesce(sum(quantity), 0) into v_qty_returned
    from public.sale_returns where sale_id = p_sale_id;

  if v_qty_returned + p_quantity > v_qty_orig then
    raise exception 'Devolução (%) excede o saldo da venda. Já devolvido: %, total: %.',
      p_quantity, v_qty_returned, v_qty_orig;
  end if;

  v_amount := round(p_quantity * v_unit_price, 2);

  -- Cria movimento de inventário (ajuste +) pra cocos voltarem ao estoque
  insert into public.inventory_movements
    (tenant_id, kind, quantity, notes, created_by)
  values
    (v_tenant, 'ajuste', p_quantity,
     'Devolução de venda ' || substr(p_sale_id::text, 1, 8) ||
     coalesce(' · ' || p_reason, ''),
     auth.uid())
  returning id into v_inv_id;

  insert into public.sale_returns
    (tenant_id, sale_id, quantity, amount, reason, returned_by,
     inventory_movement_id)
  values
    (v_tenant, p_sale_id, p_quantity, v_amount, p_reason, auth.uid(), v_inv_id)
  returning id into v_ret_id;

  return v_ret_id;
end;
$$;

-- ✅ migration_v17 aplicada
