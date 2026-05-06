-- =============================================================
-- Coco da Amazônia · MIGRATION v12 · Optimistic locking em cargas
--
-- Risco identificado no audit: 2 admins podem fechar a mesma carga
-- ao mesmo tempo. O segundo UPDATE sobrescreve o primeiro
-- silenciosamente.
--
-- Solução: coluna `lock_version`. Trigger BEFORE UPDATE incrementa
-- automaticamente. Se o cliente quiser proteger uma operação contra
-- atualização concorrente, deve enviar o lock_version atual no UPDATE
-- (lock_version = old.lock_version) e checar via WHERE.
--
-- Implementação minimalista: o trigger sempre incrementa. O cliente
-- pode opcionalmente usar `eq("lock_version", n)` no .update() do
-- Supabase pra detectar conflito (rowCount = 0).
-- =============================================================

alter table public.cargas
  add column if not exists lock_version int not null default 1;

create or replace function public.cargas_bump_lock_version()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'UPDATE' and new.lock_version = old.lock_version then
    new.lock_version := old.lock_version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cargas_bump_lock_version on public.cargas;
create trigger trg_cargas_bump_lock_version
  before update on public.cargas
  for each row execute function public.cargas_bump_lock_version();

-- ✅ migration_v12 aplicada
