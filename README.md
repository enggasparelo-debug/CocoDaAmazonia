# 🥥 Coco da Amazônia · Controle de Vendas

Aplicativo web para controle de vendas de **coco verde** (produto único), com:

- **Venda rápida** (PDV) com botões de quantidade e preço editável pelo operador.
- **Modal de pagamento** após finalizar a venda, aceitando **Pix, Dinheiro, Cartão** e qualquer forma cadastrada — incluindo **split** (parte em uma forma, parte em outra) e **venda a prazo (fiado)**.
- **Cadastro de clientes** com saldo aberto.
- **Cadastro de formas de pagamento** (ative/desative o que quiser).
- **Contas a receber**: lista de clientes com fiado e lançamento de recebimentos.
- **Financeiro**: fluxo de recebimentos por forma e período.
- **Relatórios**: vendas com filtros (período, cliente, status), totais e exportação CSV.
- **Configurações**: nome do produto e preço padrão.

Stack: **Next.js 14 (App Router) + TypeScript + Tailwind CSS + Supabase**, pronto para deploy no **Vercel**.

---

## 1. Configurar o Supabase

1. Crie um projeto em <https://supabase.com>.
2. Abra o **SQL Editor** e execute o arquivo [`supabase/schema.sql`](./supabase/schema.sql) (cria tabelas, view, triggers, formas de pagamento padrão e o produto inicial "Coco Verde" a R$ 5,00).
3. Em **Project Settings → API**, copie:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public key` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

> O schema já habilita RLS com policies abertas (`anon all`) para uso interno. Em produção, troque por policies baseadas em `auth.uid()` e use Supabase Auth.

## 2. Rodar localmente

```bash
cp .env.example .env.local
# preencha as duas variáveis com os valores do Supabase

npm install
npm run dev
```

Acesse <http://localhost:3000>.

## 3. Deploy no Vercel

1. Faça push deste repositório para o GitHub.
2. Em <https://vercel.com/new>, importe o repositório.
3. Configure as variáveis de ambiente:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy. O Vercel detecta o Next.js automaticamente.

---

## Estrutura

```
app/
  page.tsx                 # Painel
  vendas/page.tsx          # Venda rápida + modal de pagamento
  clientes/page.tsx        # Cadastro de clientes
  formas-pagamento/page.tsx
  receber/page.tsx         # Contas a receber (fiado)
  financeiro/page.tsx      # Fluxo de recebimentos
  relatorios/page.tsx      # Relatórios + export CSV
  configuracoes/page.tsx   # Preço padrão do produto
components/
  Sidebar.tsx
  PaymentModal.tsx
  StatusBadge.tsx
lib/
  supabase/{client,server}.ts
  types.ts
  format.ts
supabase/
  schema.sql               # rode no SQL Editor do Supabase
```

## Modelo de dados

| Tabela              | Função                                            |
| ------------------- | ------------------------------------------------- |
| `product_settings`  | Linha única com nome e preço padrão do produto.   |
| `customers`         | Clientes (nome, telefone, documento, endereço…).  |
| `payment_methods`   | Formas de pagamento, com flag `is_credit`.        |
| `sales`             | Cabeçalho da venda (qtd, preço, total, status).   |
| `sale_payments`     | Recebimentos lançados em cada venda (split/parcela). |
| `customer_balances` | View com saldo em aberto por cliente.             |

Triggers em `sale_payments` recalculam automaticamente `paid_amount` e `status` (`aberta` / `parcial` / `paga`) na venda.

## Fluxo típico

1. **Configurações** → defina o preço do coco.
2. **Formas de pagamento** → confira/edite Pix, Dinheiro, Cartão, Fiado…
3. **Clientes** → cadastre quem compra a prazo.
4. **Venda Rápida** → ajuste a quantidade, finalize, escolha as formas no modal (pode ficar saldo em aberto = fiado).
5. **Contas a Receber** → quando o cliente pagar, lance o recebimento.
6. **Financeiro / Relatórios** → acompanhe entradas, saldos e exporte CSV.
