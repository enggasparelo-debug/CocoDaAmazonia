-- v25: Despesas ganham 3 campos opcionais — número de documento, flag
-- "é nota fiscal" e nome do favorecido. Idempotente.

alter table public.expenses
  add column if not exists doc_number text,
  add column if not exists is_nf boolean not null default false,
  add column if not exists payee text;

create index if not exists expenses_doc_number_idx
  on public.expenses (tenant_id, doc_number)
  where doc_number is not null;

create index if not exists expenses_payee_idx
  on public.expenses (tenant_id, payee)
  where payee is not null;
