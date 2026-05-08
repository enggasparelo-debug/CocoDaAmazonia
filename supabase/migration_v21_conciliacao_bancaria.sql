-- =============================================================
-- Coco da Amazônia · MIGRATION v21 · Conciliação Bancária
--
-- 1) bank_accounts   — contas bancárias por tenant
-- 2) bank_reconciliations — sessões de conciliação (período + status)
-- 3) bank_reconciliation_items — lançamentos do extrato por sessão
-- =============================================================

-- ─── 1. Contas bancárias ─────────────────────────────────────

create table if not exists public.bank_accounts (
  id              uuid        default gen_random_uuid() primary key,
  tenant_id       uuid        not null references public.tenants(id) on delete cascade,
  name            text        not null,          -- ex: "Conta Corrente Principal"
  bank_name       text        not null,          -- ex: "Sicoob", "Itaú", "Bradesco"
  account_number  text,
  agency          text,
  notes           text,
  active          boolean     not null default true,
  created_at      timestamptz not null default now()
);

alter table public.bank_accounts enable row level security;

create policy "tenant_isolation_bank_accounts"
  on public.bank_accounts
  using (tenant_id in (select public.user_tenants()));

-- ─── 2. Sessões de conciliação ───────────────────────────────

create table if not exists public.bank_reconciliations (
  id                      uuid        default gen_random_uuid() primary key,
  tenant_id               uuid        not null references public.tenants(id) on delete cascade,
  bank_account_id         uuid        not null references public.bank_accounts(id) on delete cascade,
  period_start            date        not null,
  period_end              date        not null,
  statement_ending_balance numeric(15,2),        -- saldo final do extrato
  status                  text        not null default 'open'
                            check (status in ('open', 'closed')),
  notes                   text,
  created_by              uuid,
  closed_at               timestamptz,
  closed_by               uuid,
  created_at              timestamptz not null default now()
);

alter table public.bank_reconciliations enable row level security;

create policy "tenant_isolation_bank_reconciliations"
  on public.bank_reconciliations
  using (tenant_id in (select public.user_tenants()));

-- ─── 3. Itens da conciliação ─────────────────────────────────

create table if not exists public.bank_reconciliation_items (
  id                  uuid        default gen_random_uuid() primary key,
  tenant_id           uuid        not null references public.tenants(id) on delete cascade,
  reconciliation_id   uuid        not null references public.bank_reconciliations(id) on delete cascade,
  bank_date           date        not null,
  bank_description    text        not null,
  bank_amount         numeric(15,2) not null,   -- positivo = débito (saída), negativo = crédito
  expense_id          uuid        references public.expenses(id) on delete set null,
  status              text        not null default 'pending'
                        check (status in ('pending', 'matched', 'ignored')),
  created_at          timestamptz not null default now()
);

alter table public.bank_reconciliation_items enable row level security;

create policy "tenant_isolation_bank_reconciliation_items"
  on public.bank_reconciliation_items
  using (tenant_id in (select public.user_tenants()));

-- ─── Triggers (set_tenant_id automático no insert) ──────────

drop trigger if exists trg_set_tenant_id on public.bank_accounts;
create trigger trg_set_tenant_id before insert on public.bank_accounts
  for each row execute function public.set_tenant_id();

drop trigger if exists trg_set_tenant_id on public.bank_reconciliations;
create trigger trg_set_tenant_id before insert on public.bank_reconciliations
  for each row execute function public.set_tenant_id();

drop trigger if exists trg_set_tenant_id on public.bank_reconciliation_items;
create trigger trg_set_tenant_id before insert on public.bank_reconciliation_items
  for each row execute function public.set_tenant_id();

-- ─── Índices ─────────────────────────────────────────────────

create index if not exists bank_accounts_tenant_idx
  on public.bank_accounts(tenant_id);

create index if not exists bank_reconciliations_account_idx
  on public.bank_reconciliations(bank_account_id, created_at desc);

create index if not exists bank_reconciliation_items_reconciliation_idx
  on public.bank_reconciliation_items(reconciliation_id);
