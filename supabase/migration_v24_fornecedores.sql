-- migration_v24: Cadastro de Fornecedores + novos campos em payables

-- 1. Tabela de fornecedores
CREATE TABLE IF NOT EXISTS public.suppliers (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES public.tenants(id),
  name         TEXT        NOT NULL,
  document     TEXT,
  phone        TEXT,
  email        TEXT,
  notes        TEXT,
  active       BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON public.suppliers
  USING (
    tenant_id = (
      SELECT tenant_id FROM public.memberships
      WHERE user_id = auth.uid() LIMIT 1
    )
  );

CREATE OR REPLACE TRIGGER set_supplier_tenant
  BEFORE INSERT ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE INDEX IF NOT EXISTS suppliers_tenant_idx ON public.suppliers (tenant_id, active, name);

-- 2. Novos campos em payables
ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS expense_date    DATE;
ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS document_number TEXT;
ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS supplier_id     UUID REFERENCES public.suppliers(id);
