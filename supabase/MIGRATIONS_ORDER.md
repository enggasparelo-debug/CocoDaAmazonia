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
| 21 | `migration_v20_audit_retention_and_indexes.sql` | `prune_audit_log()` + índices compostos. |
| 22 | `migration_v21_contas_a_pagar.sql` | Tabela `payables` (contas a pagar) + view `cash_flow_projection`. |
| 23 | `migration_v22_despesas_ap.sql` | Evolução de despesas com alertas de vencimento. |
| 24 | `migration_v23_customer_profitability.sql` | View `customer_profitability` com LTV, ticket médio, frequência e margem por cliente. |
| 25 | `migration_v24_fornecedores.sql` | Tabela `suppliers` (cadastro de fornecedores) + campos `expense_date`, `document_number`, `supplier_id` em `payables`. |
| 26 | `migration_v25_expense_doc_fields.sql` | Despesas ganham `doc_number`, `is_nf`, `payee`. |
| 27 | `migration_v26_supplier_analytics.sql` | View `supplier_analytics` com total de compras, PMF e última compra por fornecedor. |

## Pós-migração (Edge Functions)

### Push notifications (opcional)

```bash
# Gere um secret aleatório (uma vez por ambiente):
openssl rand -hex 32   # → guarda esse valor

supabase functions deploy notify-admin --no-verify-jwt
supabase secrets set \
  VAPID_PUBLIC_KEY=... \
  VAPID_PRIVATE_KEY=... \
  VAPID_SUBJECT=mailto:admin@suaempresa.com \
  NOTIFY_CRON_SECRET=<o-hex-de-32-bytes-acima>
```

Configure cron (Dashboard → Edge Functions → notify-admin → Cron) com
o **header customizado** `X-Cron-Secret: <mesmo-valor-acima>`:
```
0 8-20/2 * * *
```
(a cada 2h entre 8h e 20h)

> ⚠️ Sem `NOTIFY_CRON_SECRET` configurado a função retorna 500. Sem
> header `X-Cron-Secret` correto retorna 401. Isso protege contra
> abuso de quem descobrir a URL pública da função.

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
