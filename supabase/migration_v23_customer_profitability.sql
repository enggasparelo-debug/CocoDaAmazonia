-- migration_v23: View de rentabilidade por cliente
-- Calcula LTV, ticket médio, frequência de compra e margem líquida estimada

drop view if exists public.customer_profitability cascade;

create view public.customer_profitability as
with avg_cost as (
  select
    tenant_id,
    avg(unit_cost) filter (where unit_cost > 0) as avg_unit_cost
  from public.inventory_movements
  where kind = 'entrada'
  group by tenant_id
),
customer_sales as (
  select
    s.customer_id,
    s.tenant_id,
    count(*) filter (where s.status != 'cancelada')                          as total_sales,
    coalesce(sum(s.total)       filter (where s.status != 'cancelada'), 0)   as ltv,
    coalesce(sum(s.quantity)    filter (where s.status != 'cancelada'), 0)   as total_qty,
    coalesce(sum(s.paid_amount) filter (where s.status != 'cancelada'), 0)   as total_paid,
    min(s.created_at) filter (where s.status != 'cancelada')                 as first_sale_at,
    max(s.created_at) filter (where s.status != 'cancelada')                 as last_sale_at
  from public.sales s
  where s.customer_id is not null
  group by s.customer_id, s.tenant_id
)
select
  cs.customer_id,
  cs.tenant_id,
  cs.total_sales,
  cs.ltv,
  cs.total_qty,
  cs.total_paid,
  cs.first_sale_at,
  cs.last_sale_at,
  case when cs.total_sales > 0 then cs.ltv / cs.total_sales else 0 end
    as avg_ticket,
  -- compras por mês: usa o intervalo real ou retorna total_sales se só há uma compra
  case
    when cs.first_sale_at is not null
      and cs.first_sale_at < cs.last_sale_at
    then cs.total_sales::numeric
         / nullif(
             extract(epoch from (cs.last_sale_at - cs.first_sale_at))
             / (30.0 * 24 * 3600),
             0
           )
    else cs.total_sales::numeric
  end as purchases_per_month,
  coalesce(ac.avg_unit_cost, 0) as avg_unit_cost,
  -- margem líquida estimada: (receita - custo estimado) / receita
  case
    when cs.ltv > 0 and ac.avg_unit_cost is not null and ac.avg_unit_cost > 0
    then (cs.ltv - cs.total_qty * ac.avg_unit_cost) / cs.ltv
    else null
  end as net_margin_pct
from customer_sales cs
left join avg_cost ac on ac.tenant_id = cs.tenant_id;

-- Sem RLS explícita: a segurança é herdada das tabelas base (sales e inventory_movements)
-- que já têm RLS por tenant_id.
comment on view public.customer_profitability is
  'Métricas de rentabilidade por cliente: LTV, ticket médio, frequência e margem estimada.';
