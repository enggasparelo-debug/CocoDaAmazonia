-- migration_v25: View de analytics de fornecedores
-- Calcula total de compras, PMF (prazo médio de pagamento) e última compra por fornecedor.
-- A concentração (% do total) é calculada no cliente após buscar todos os registros.

drop view if exists public.supplier_analytics cascade;

create view public.supplier_analytics as
with supplier_stats as (
  select
    p.supplier_id,
    p.tenant_id,
    count(p.id)::int                                            as num_compras,
    coalesce(sum(p.amount), 0)                                  as total_compras,
    -- PMF: dias entre due_date e paid_at (positivo = atrasado, negativo = antecipado)
    round(
      avg(
        case
          when p.status = 'paid'
           and p.paid_at  is not null
           and p.due_date is not null
          then extract(epoch from (p.paid_at - p.due_date::timestamptz)) / 86400.0
        end
      )::numeric,
      1
    )                                                           as pmf_dias,
    max(p.expense_date)                                         as ultima_compra
  from public.payables p
  where p.supplier_id is not null
  group by p.supplier_id, p.tenant_id
)
select
  s.id              as supplier_id,
  s.tenant_id,
  s.name            as supplier_name,
  s.document,
  s.active,
  coalesce(ss.num_compras,   0)  as num_compras,
  coalesce(ss.total_compras, 0)  as total_compras,
  ss.pmf_dias,
  ss.ultima_compra
from public.suppliers s
left join supplier_stats ss
  on ss.supplier_id = s.id
 and ss.tenant_id   = s.tenant_id;

comment on view public.supplier_analytics is
  'KPIs de compras por fornecedor: total, quantidade, PMF e data da última compra.';
