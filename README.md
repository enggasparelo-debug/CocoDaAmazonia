# 🥥 Coco da Amazônia · Controle de Vendas

Sistema completo para controle de venda de coco verde (produto único), com:

- 🔐 **Login** (Supabase Auth) — RLS por usuário autenticado
- 🥥 **Venda rápida** com preço editável, **desconto**, atalhos de teclado (`+/-`, F2, Ctrl+Enter), botão direto **"Lançar como Fiado"**
- 💳 **Pagamento múltiplo** (split Pix + Dinheiro + Cartão) e suporte a saldo em aberto (fiado)
- 🧾 **Comprovante** imprimível ou compartilhável
- 📲 **WhatsApp do saldo** — envia mensagem pronta com o débito
- ✏️ **Editar / cancelar venda** (com motivo) e reverter cancelamento
- 📒 **Contas a receber** com **aging** (alerta para fiado > 30 dias)
- 👤 **Histórico do cliente** — todas as compras, pagamentos e saldo
- 💵 **Caixa** — abertura, suprimento, sangria, fechamento com diferença
- 💸 **Despesas** por categoria
- 📦 **Estoque** com entrada por compra, perda, ajuste e baixa automática nas vendas
- 📊 **Painel** com gráfico dos últimos 7 dias, lucro estimado, estoque, status do caixa
- 📈 **Relatórios** com filtros + export CSV
- 📱 **PWA** — instalável no celular, funciona com cache do service worker
- 🌗 **Toasts**, modais de confirmação, menu mobile e skeletons

Stack: **Next.js 14 (App Router) + TypeScript + Tailwind CSS + Supabase** · deploy: **Vercel**.

---

## Setup rápido

### 1. Supabase

Crie um projeto em https://supabase.com e rode o SQL apropriado no **SQL Editor**:

- **Instalação nova:** rode `supabase/schema.sql` (idempotente — pode ser rodado em banco vazio).
- **Banco já existente em v1:** rode **`supabase/migration_v2.sql`** para acrescentar caixa, despesas, estoque, desconto, cancelamento, validações e RLS por usuário.

Em **Authentication → Providers**, ative *Email + Password* (já vem ativo por padrão).

> Se quiser bloquear cadastro público, vá em *Authentication → Settings → Sign up* e desative o *Allow new users to sign up* depois de criar o seu usuário.

Em **Project Settings → API**, copie:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 2. Local

```bash
cp .env.example .env.local
npm install
npm run dev
```

Acesse http://localhost:3000, crie sua conta e use.

### 3. Deploy no Vercel

1. Push do repositório
2. https://vercel.com/new → importar
3. Configurar variáveis: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Production + Preview)
4. Deploy

---

## Atalhos de teclado (tela de venda)

| Tecla | Ação |
|---|---|
| `+` | Aumentar quantidade |
| `−` | Diminuir quantidade |
| `F2` | Lançar como Fiado |
| `Ctrl+Enter` (Cmd+Enter no Mac) | Finalizar venda (abre o pagamento) |

---

## Estrutura

```
app/
  page.tsx                 # Painel + sparkline 7 dias + lucro estimado
  vendas/page.tsx          # Venda rápida + atalhos + desconto
  recibo/[id]/page.tsx     # Comprovante printable
  clientes/page.tsx
  clientes/[id]/page.tsx   # Histórico do cliente
  formas-pagamento/page.tsx
  receber/page.tsx         # Contas a receber + aging + WhatsApp
  caixa/page.tsx           # Abertura/fechamento + sangria/suprimento
  despesas/page.tsx        # Despesas por categoria
  estoque/page.tsx         # Estoque + entradas
  financeiro/page.tsx      # Fluxo de recebimentos
  relatorios/page.tsx      # Relatórios + edição/cancelamento de venda
  configuracoes/page.tsx
  login/page.tsx
components/
  AppShell.tsx · Sidebar.tsx · MobileNav.tsx
  PaymentModal.tsx · SaleEditor.tsx
  ConfirmModal.tsx · Toast.tsx · Skeleton.tsx · Sparkline.tsx
  StatusBadge.tsx · RegisterSW.tsx
lib/
  supabase/{client,server}.ts · types.ts · format.ts
middleware.ts              # protege rotas com auth.uid()
public/
  manifest.json · sw.js · icons/icon.svg
supabase/
  schema.sql               # instalação completa
  migration_v2.sql         # migração para bancos v1
```

## Modelo de dados (resumo)

| Tabela | Função |
|---|---|
| `product_settings` | preço padrão e nome do produto |
| `customers` | clientes |
| `payment_methods` | formas de pagamento (com flag `is_credit`) |
| `sales` | venda (qtd, preço, desconto, total, status, cancelamento) |
| `sale_payments` | recebimentos vinculados à venda (suporta split) |
| `cash_sessions` + `cash_movements` | caixa |
| `expenses` | despesas |
| `inventory_movements` + `inventory_balance` (view) | estoque |
| `customer_balances` (view) | saldo aberto + venda em aberto mais antiga (aging) |

Triggers automatizam:
- `paid_amount` e `status` da venda recalculam a cada pagamento
- Validação que pagamento não excede o total da venda
- Bloqueio de pagamento em venda cancelada
