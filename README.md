# Extrator Bancário — Open Finance

Web app para gestão de extratos bancários de múltiplos clientes via **Pluggy** e **Klavi** (Open Finance), integrado ao **Have Gestor**.

Cada empresa (tenant) do Have Gestor possui seus próprios dados isolados no respectivo banco PostgreSQL. A aplicação resolve o banco correto a partir do slug da empresa.

## Pré-requisitos

- [Node.js](https://nodejs.org) versão 18 ou superior
- PostgreSQL (banco central `have_gestor` + um banco por empresa)
- Conta ativa na **Pluggy** (legado) e/ou **Klavi** (Open Finance)

## Instalação

```bash
# 1. Instalar dependências
npm install

# 2. Criar o arquivo de variáveis de ambiente
cp .env.example .env.local
```

Abra o arquivo `.env.local` e preencha todas as credenciais (Pluggy, Klavi, banco central e banco legado).

## Variáveis de ambiente principais

- `DATABASE_URL` — banco legado do Extrator (usado apenas na migração de dados históricos).
- `CENTRAL_DB_*` — banco central `have_gestor` (lista de empresas e credenciais de cada tenant).
- `GESTOR_API_TOKEN` — token compartilhado com o Have Gestor.
- `PLUGGY_*` e `KLAVI_*` — credenciais dos provedores Open Finance.

Veja `.env.example` para a lista completa.

## Rodando localmente

```bash
npm run dev
```

Acesse: [http://localhost:3000](http://localhost:3000)

## Arquitetura multi-tenant

- `lib/company-db.js` — resolve o pool PostgreSQL do banco da empresa a partir do slug.
- `lib/storage-company.js` — todas as operações de banco usam tabelas prefixadas `extrator_*` no banco da empresa.
- `lib/central-token-map.js` — mantém no banco central os mapeamentos:
  - `portal_token → empresa_slug` (para rotas públicas do portal)
  - `item_id / pluggy_item_id / klavi_link_id / klavi_consent_id → empresa_slug` (para webhooks)
- `middleware.js` — injeta o header `x-extrator-empresa` para rotas protegidas do admin.

## Como usar

### 1. Login
- Na tela de login informe o **slug da empresa** (ex: `lanzi`) e a senha de admin.
- O middleware passa a empresa para todas as rotas protegidas.

### 2. Cadastrar um cliente
- Clique em **Novo Cliente** no dashboard
- Digite o nome do cliente

### 3. Conectar a conta bancária
- Clique em **Ver Extrato** do cliente desejado
- Clique em **Conectar Banco**
- O widget do provedor abrirá — o cliente autentica na instituição bancária
- O `itemId` é salvo automaticamente no banco da empresa

### 4. Baixar o extrato
- Selecione o período (De / Até)
- Clique em **Buscar Extrato**
- Visualize as transações com resumo de entradas, saídas e saldo
- Clique em **Exportar CSV** para baixar o arquivo

### 5. Reconectar banco
Se o banco exigir nova autenticação, clique em **Reconectar Banco** — o mesmo `itemId` será reutilizado.

## Estrutura do projeto

```
app/
  login/page.jsx                  → Login por empresa
  page.jsx                        → Dashboard (lista de clientes da empresa)
  clients/[id]/page.jsx           → Extrato do cliente
  api/
    admin/login/                  → Autenticação e cookie de empresa
    gestor/client/*               → API usada pelo Have Gestor
    portal/[token]/*              → Rotas públicas do portal do cliente
    clients/*                     → CRUD e operações do dashboard
    cron/*                        → Sincronização automática (por empresa)
    webhooks/*                    → Webhooks Pluggy/Klavi

lib/
  company-db.js                   → Resolve pool do banco da empresa
  central-token-map.js            → Mapeamentos centrais token/item → empresa
  storage-company.js              → Persistência por tenant (tabelas extrator_*)
  pluggy.js / klavi.js            → Wrappers das APIs
  sync-processor.js               → Sincronização Pluggy

scripts/
  migrate_extrator_to_companies.py → Migra dados do banco legado para tenants
```

## Migração de dados históricos

Se você já usava o Extrator com um banco central único (`DATABASE_URL`), execute:

```bash
python scripts/migrate_extrator_to_companies.py
```

O script migra clientes, itens, transações, investimentos, dívidas, sync logs e webhook events para o banco de cada empresa e preenche as tabelas centrais de mapeamento.

## Produção

```bash
npm run build
npm start
```

Para deploy em nuvem (Vercel, Railway, etc.), configure todas as variáveis de ambiente listadas em `.env.example`.

> **Atenção:** Certifique-se de que a migration `093_extrator_tables_per_empresa.sql` foi aplicada em cada banco de empresa antes de ativar o app.
