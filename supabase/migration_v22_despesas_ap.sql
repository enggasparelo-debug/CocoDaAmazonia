-- migration_v22: Evolução de Despesas para suportar Contas a Pagar (AP)
-- Adiciona due_date, status e torna paid_at nullable

-- 1. Tornar paid_at nullable (despesas futuras ainda não foram pagas)
--    Mantém DEFAULT NOW() para compatibilidade com inserções antigas (carga/page.tsx)
ALTER TABLE public.expenses ALTER COLUMN paid_at DROP NOT NULL;

-- 2. Coluna de vencimento
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS due_date DATE;

-- 3. Coluna de status — padrão 'paid' para preservar registros existentes
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'paid';
ALTER TABLE public.expenses ADD CONSTRAINT expenses_status_check
  CHECK (status IN ('open', 'paid'));

-- 4. Índices auxiliares
CREATE INDEX IF NOT EXISTS expenses_due_date_idx  ON public.expenses (tenant_id, due_date);
CREATE INDEX IF NOT EXISTS expenses_status_idx    ON public.expenses (tenant_id, status);
