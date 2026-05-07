-- =============================================================
-- Coco da Amazônia · MIGRATION v16 · Comissões de vendedor
--
-- Adiciona commission_pct (%) e commission_fixed (R$) em sellers.
-- O cálculo é feito no client (scorecard /operadores) — sem trigger
-- pra não engessar mudanças de regra futura.
-- =============================================================

alter table public.sellers
  add column if not exists commission_pct numeric(5,2) not null default 0
    check (commission_pct >= 0 and commission_pct < 100);
alter table public.sellers
  add column if not exists commission_fixed numeric(12,2) not null default 0
    check (commission_fixed >= 0);

comment on column public.sellers.commission_pct is
  'Comissão percentual sobre o faturado do vendedor no período.';
comment on column public.sellers.commission_fixed is
  'Comissão fixa por período (R$). Acumula com o percentual.';

-- ✅ migration_v16 aplicada
