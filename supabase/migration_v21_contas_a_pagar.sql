-- migration_v21: Contas a Pagar + Projeção de Caixa
-- Tabela de contas a pagar com RLS por tenant

create table if not exists public.payables (
  id            uuid          default gen_random_uuid() primary key,
  tenant_id     uuid          not null references public.tenants(id) on delete cascade,
  supplier_name text          not null,
  description   text          not null,
  amount        numeric(15,2) not null check (amount > 0),
  due_date      date          not null,
  paid_at       timestamptz,
  paid_amount   numeric(15,2),
  status        text          not null default 'pendente'
                  check (status in ('pendente', 'pago', 'vencido', 'cancelado')),
  category      text,
  notes         text,
  recurrent     boolean       not null default false,
  created_at    timestamptz   not null default now(),
  created_by    uuid
);

alter table public.payables enable row level security;

create policy "tenant_isolation_payables"
  on public.payables
  using (tenant_id in (select public.user_tenants()));

-- Trigger para preencher tenant_id automaticamente
drop trigger if exists trg_set_tenant_id on public.payables;
create trigger trg_set_tenant_id before insert on public.payables
  for each row execute function public.set_tenant_id();

-- Índices
create index if not exists payables_tenant_due_idx
  on public.payables(tenant_id, due_date);
create index if not exists payables_tenant_status_idx
  on public.payables(tenant_id, status);

-- View auxiliar: projeção de caixa 90 dias
-- Combina C/R (sales em aberto) e C/P (payables pendentes)
create or replace view public.cash_flow_projection as
select
  'receber'::text as tipo,
  s.tenant_id,
  s.id,
  s.created_at::date as data_referencia,
  null::date as due_date,
  (s.total - s.paid_amount) as valor,
  c.name as contraparte,
  s.notes
from public.sales s
left join public.customers c on c.id = s.customer_id
where s.status != 'paga'
  and s.canceled_at is null
  and (s.total - s.paid_amount) > 0

union all

select
  'pagar'::text as tipo,
  p.tenant_id,
  p.id,
  p.created_at::date as data_referencia,
  p.due_date,
  -p.amount as valor,
  p.supplier_name as contraparte,
  p.notes
from public.payables p
where p.status in ('pendente', 'vencido');
