// Helper pra upload de anexos no bucket "attachments" do Supabase
// Storage. O bucket precisa existir e ter policy permitindo
// authenticated uploadar / ler dentro do prefixo do tenant.
//
// Estrutura de path: <tenant_id>/<table>/<row_id>/<filename>
// (ex.: "abc123/sale_payments/xyz/comprovante.jpg")

import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "attachments";

export async function uploadAttachment(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    table: string;
    rowId: string;
    file: File;
  }
): Promise<{ url: string | null; error: string | null }> {
  const { tenantId, table, rowId, file } = args;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${tenantId}/${table}/${rowId}/${Date.now()}_${safeName}`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });
  if (upErr) return { url: null, error: upErr.message };
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}
