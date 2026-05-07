-- =============================================================
-- Coco da Amazônia · MIGRATION v14 · Audit de fiado_promissorias
--
-- Promissórias têm PII sensível (signer_document, signer_address,
-- signature_data_url) e estavam fora do audit_log. Adicionar o audit
-- direto via log_audit() iria gravar a assinatura completa (data URL
-- com base64) em cada UPDATE, inflando o audit_log absurdamente.
--
-- Solução: função custom que copia old/new mas substitui o campo
-- signature_data_url por um marker "[redacted: N bytes]". Mantém o
-- rastro de quem mudou o quê sem expor a assinatura.
-- =============================================================

create or replace function public.log_audit_promissoria()
returns trigger language plpgsql security definer as $$
declare
  v_tenant uuid;
  v_row_id uuid;
  v_before jsonb;
  v_after  jsonb;
begin
  if TG_OP = 'DELETE' then
    v_tenant := old.tenant_id;
    v_row_id := old.id;
    v_before := to_jsonb(old)
      - 'signature_data_url'
      || jsonb_build_object(
        'signature_redacted',
        '[redacted: ' || coalesce(length(old.signature_data_url), 0) || ' bytes]'
      );
  elsif TG_OP = 'UPDATE' then
    v_tenant := new.tenant_id;
    v_row_id := new.id;
    v_before := to_jsonb(old)
      - 'signature_data_url'
      || jsonb_build_object(
        'signature_redacted',
        '[redacted: ' || coalesce(length(old.signature_data_url), 0) || ' bytes]'
      );
    v_after := to_jsonb(new)
      - 'signature_data_url'
      || jsonb_build_object(
        'signature_redacted',
        '[redacted: ' || coalesce(length(new.signature_data_url), 0) || ' bytes]'
      );
  else
    v_tenant := new.tenant_id;
    v_row_id := new.id;
    v_after := to_jsonb(new)
      - 'signature_data_url'
      || jsonb_build_object(
        'signature_redacted',
        '[redacted: ' || coalesce(length(new.signature_data_url), 0) || ' bytes]'
      );
  end if;

  if v_tenant is not null and exists (
    select 1 from public.tenants where id = v_tenant
  ) then
    insert into public.audit_log
      (tenant_id, user_id, table_name, op, row_id, before_data, after_data)
    values
      (v_tenant, auth.uid(), TG_TABLE_NAME, TG_OP, v_row_id, v_before, v_after);
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_log_audit_promissoria on public.fiado_promissorias;
create trigger trg_log_audit_promissoria
  after insert or update or delete on public.fiado_promissorias
  for each row execute function public.log_audit_promissoria();

-- ✅ migration_v14 aplicada
