# Ordem das migrations · Coco da Amazônia

Aplique no **Supabase SQL Editor** na ordem abaixo. Todas são
idempotentes — rodar 2× produz o mesmo resultado, mas faça uma só vez
por ambiente.

## Pré-requisitos (uma vez por projeto)

1. **Storage bucket `attachments`** (pra anexos de pagamento):
   - Dashboard → Storage → New bucket → nome `attachments` → **Public** marcado.
   - Policies (SQL Editor):
     ```sql
     -- Authenticated pode upload
     create policy "auth_upload" on storage.objects
       for insert to authenticated
       with check (bucket_id = 'attachments');
     -- Authenticated pode ler
     create policy "auth_read" on storage.objects
       for select to authenticated
       using (bucket_id = 'attachments');
     ```

2. **VAPID keys** (pra push notifications, opcional):
   ```bash
   npx web-push generate-vapid-keys
   ```
   Configure no Supabase como secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

## Sequência

| # | Arquivo | O que faz |
|---|---|---|
| 1 | `schema.sql` | Schema base (tenants, sales, customers, etc.). Só em instalação fresca. |
| 2 | `migration_v2.sql` | Cash sessions, expenses, inventory_movements. |
| 3 | `migration_v3.sql` | Multi-tenant + RLS. |
| 4 | `migration_v3_recover.sql` | Hotfix de views v3. |
| 5 | `migration_v4.sql` | Cargas, vehicles, routes, fiado_promissorias. |
| 6 | `migration_v5.sql` | Sellers + seller_id em sales. |
| 7 | `migration_v6.sql` | Categorias de despesa. |
| 8 | `migration_v7.sql` | Numeração `code` em sales e cargas. |
| 9 | `migration_v8.sql` | RPC `delete_carga`. |
| 10 | `migration_v9.sql` | RPC `resync_carga_inventory`. |
| 11 | `migration_v10.sql` | Auto-sync trigger nos movimentos da carga. |
| 12 | `migration_v11_constraints.sql` | ON DELETE SET NULL + cash_sessions unique. |
| 13 | `migration_v12_cargas_version.sql` | Optimistic lock em cargas. |
| 14 | `migration_v13_memberships_admin.sql` | RPCs pra mudar role + audit. |
| 15 | `migration_v14_pii_audit.sql` | Audit de fiado_promissorias com PII redigida. |
| 16 | `migration_v15_money_and_history.sql` | paid_at validation, taxas, price history. |
| 17 | `migration_v16_comissoes.sql` | Comissão por vendedor (`%` + R$). |
| 18 | `migration_v17_returns.sql` | `sale_returns` + RPC `refund_sale`. |
| 19 | `migration_v18_attachments_and_notifications.sql` | `attachment_url` + `notification_log`. |
| 20 | `migration_v19_inventory_matview.sql` | inventory_balance vira matview. |

## Pós-migração (Edge Functions)

### Push notifications (opcional)

```bash
supabase functions deploy notify-admin --no-verify-jwt
supabase secrets set \
  VAPID_PUBLIC_KEY=... \
  VAPID_PRIVATE_KEY=... \
  VAPID_SUBJECT=mailto:admin@suaempresa.com
```

Configure cron (Dashboard → Edge Functions → notify-admin → Cron):
```
0 8-20/2 * * *
```
(a cada 2h entre 8h e 20h)

### Sentry (opcional)

Defina na Vercel:
```
NEXT_PUBLIC_SENTRY_DSN=https://...@.../...
```
Sem DSN: app funciona normal, sem telemetria.

## Notas

- **schema.sql** está parcialmente sincronizado mas não é fonte da
  verdade pós-v4. Use as migrations sequenciais pra ambientes
  existentes; pra fresh install rode todas em ordem.
- **Não rode migrations em paralelo** — algumas dependem de triggers
  da anterior.
- **Backup antes**: Supabase faz backup diário automático no plano
  Pro. Pra grátis, exporte via `pg_dump` antes de aplicar.
