# 🥥 Coco da Amazônia · Controle de Vendas

Sistema completo para controle de venda de coco verde (multi-tenant, auditado e PWA), com:

- 🔐 **Login + Multi-tenant** — cada conta tem sua própria loja, isolada por RLS
- 👮 **Papéis** (`admin`, `operador`) e **janela de edição** configurável
- 🔍 **Audit log** completo (quem alterou o quê e quando)
- 📡 **Funciona offline** (PWA + fila local com IndexedDB) — vende mesmo sem internet
- 🔔 **Lembretes in-app** + opt-in para **push notifications**
- 🥥 Venda rápida com desconto, atalhos de teclado, "lançar como fiado"
- 💳 Pagamento múltiplo (split Pix + Dinheiro + Cartão) com fiado
- 🧾 Comprovante imprimível com dados da empresa (CNPJ, endereço, mensagem)
- 📲 WhatsApp do saldo · 💵 Caixa · 💸 Despesas · 📦 Estoque · 📈 Relatórios
- 📒 Contas a receber com **aging** e **limite de crédito por cliente**
- ✏️ Editar / cancelar venda (limitado a janela de edição para operadores)
- 🧪 Testes (Vitest) + 🤖 CI (GitHub Actions)

Stack: **Next.js 14 (App Router) + TypeScript + Tailwind CSS + Supabase (Postgres + Auth)** · deploy: **Vercel**.

---

## Setup rápido

### 1. Supabase

Crie um projeto em https://supabase.com e rode o SQL apropriado no **SQL Editor**:

| Estado atual do banco | Rode |
|---|---|
| Banco vazio (instalação nova) | `supabase/schema.sql` |
| Já está em **v1** (anon all) | `supabase/migration_v2.sql` |
| Já está em **v2** (auth básico) | **`supabase/migration_v3.sql`** ← |

A v3 acrescenta multi-tenant + auditoria + dados de empresa + limite de crédito + janela de edição + push subscriptions.

Em **Authentication → Providers**, ative *Email + Password* (vem ativo por padrão).

Em **Project Settings → API**, copie:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 2. Local

```bash
cp .env.example .env.local
npm install
npm run dev
```

Acesse http://localhost:3000 → faça signup → o trigger cria automaticamente sua loja (tenant) e te coloca como **admin**.

### 3. Deploy no Vercel

1. Push do repositório (já configurado)
2. https://vercel.com/new → importar
3. Variáveis de ambiente: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy

### 4. Push notifications (opcional)

Para ativar o **opt-in** de push na tela de Configurações:

1. Gere chaves VAPID (você pode usar https://vapidkeys.com/ ou `npx web-push generate-vapid-keys`)
2. No Vercel adicione as variáveis:
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (chave pública)
3. Para **enviar** as notificações, você precisará de uma function/cron com a chave privada (não incluído neste PR — fica como próximo passo). Ver **"Próximos passos"** abaixo.

---

## Multi-tenant: como funciona

- Tabela `tenants` representa cada loja
- Tabela `memberships` liga `auth.users` a `tenants` com um `role`
- Trigger em `auth.users` cria, no signup, um tenant + admin membership + produto + formas de pagamento padrão
- Trigger `set_tenant_id()` preenche `tenant_id` automaticamente em qualquer insert
- Funções `public.user_tenants()` e `public.is_admin()` são usadas nas RLS policies
- **Toda tabela de dados tem RLS por `tenant_id`**: o usuário só vê o que é da sua loja

### Convidar outro operador

Hoje a UI de convite ainda não existe (próximo PR). Para adicionar manualmente um usuário existente como operador, rode no SQL Editor:

```sql
insert into public.memberships (user_id, tenant_id, role)
values (
  (select id from auth.users where email = 'operador@exemplo.com'),
  (select tenant_id from public.memberships where user_id = auth.uid() limit 1),
  'operador'
);
```

---

## Offline-first

A tela de **Lançar como Fiado** já funciona offline:

- Sem conexão, a venda vai para uma **fila no IndexedDB**
- Aparece a barrinha "📡 sem internet · X venda(s) pendente(s)"
- Quando voltar a conexão, a fila é sincronizada automaticamente

> Limitação: vendas via "Finalizar Venda → Modal de Pagamento" exigem conexão (precisamos de `sale_id` retornado para lançar pagamentos). O fluxo "Lançar como Fiado" cobre o caso típico de venda na praia: você lança e cobra depois.

---

## Audit log

Toda mudança em `sales`, `sale_payments`, `expenses`, `cash_*`, `customers`, `payment_methods`, `product_settings` é gravada em `audit_log`. Apenas **admins** veem a página `/auditoria`.

---

## Janela de edição

Na **Configurações → Empresa**, defina `Janela de edição (horas)`. Operadores só conseguem editar/cancelar vendas dentro dessa janela; admins editam sempre.

---

## Atalhos de teclado (tela de venda)

| Tecla | Ação |
|---|---|
| `+` / `−` | Aumentar / diminuir quantidade |
| `F2` | Lançar como Fiado |
| `Ctrl+Enter` | Finalizar venda (abre o pagamento) |

---

## CI

```yaml
# .github/workflows/ci.yml
- npm ci
- npm run test    # vitest (lib/format, regras de venda, limite, edit window)
- npm run build   # next build
```

Roda em todo PR para `main`.

---

## Estrutura

```
app/
  page.tsx                 # Painel + sparkline + lucro estimado
  vendas/page.tsx          # Venda rápida + atalhos + desconto + offline + limite
  recibo/[id]/page.tsx     # Comprovante printable com dados da empresa
  clientes/page.tsx        # CRUD com limite de crédito
  clientes/[id]/page.tsx   # Histórico do cliente
  formas-pagamento/page.tsx
  receber/page.tsx         # Contas a receber + aging + WhatsApp
  caixa/page.tsx
  despesas/page.tsx
  estoque/page.tsx
  financeiro/page.tsx
  relatorios/page.tsx      # Editar/cancelar venda
  configuracoes/page.tsx   # Empresa + produto + push opt-in
  auditoria/page.tsx       # 🔒 admin only
  login/page.tsx
components/
  AppShell.tsx · Sidebar.tsx · MobileNav.tsx
  PaymentModal.tsx · SaleEditor.tsx
  ConfirmModal.tsx · Toast.tsx · Skeleton.tsx · Sparkline.tsx
  StatusBadge.tsx · RegisterSW.tsx
  Reminders.tsx · OfflineSync.tsx · PushOptIn.tsx
lib/
  supabase/{client,server}.ts
  types.ts · format.ts
  useTenant.ts             # hook de tenant + papel
  offlineQueue.ts          # IndexedDB queue
middleware.ts              # protege rotas
public/
  manifest.json · sw.js · icons/icon.svg
supabase/
  schema.sql               # instalação completa
  migration_v2.sql         # v1 → v2 (auth básico)
  migration_v3.sql         # v2 → v3 (multi-tenant, audit, etc)
tests/
  format.test.ts · sale-math.test.ts
.github/workflows/ci.yml
vitest.config.ts
```

---

## Próximos passos sugeridos

- **Convidar operadores pela UI** — page `/equipe` com role e e-mail
- **Cron de push** — Vercel Cron + Edge Function que verifica caixa aberto > 12h, fiado > 60d, estoque baixo e dispara web push (chave privada VAPID)
- **Pix QR** dinâmico no recibo
- **Cobrança por link** público (`/cobrar/[hash]`)
- **Recebimento múltiplas vendas** em um único pagamento (FIFO)
- **Multi-produto** (modelar `products` em vez de `product_settings` linha única)
- **Reset de senha** via Supabase Auth (UI: `/forgot-password`)
- **Sentry** para observabilidade
