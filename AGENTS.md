# Extrator Bancário — Pluggy

Web app para gestão de extratos bancários de múltiplos clientes via [Pluggy](https://pluggy.ai).
O projeto é um dashboard administrativo protegido por senha, com portal público por cliente (token único) para conexão de contas bancárias via Open Finance.

---

## Technology Stack

- **Framework:** Next.js 15 (App Router, React 18)
- **Language:** JavaScript (JSX), Node.js 18+
- **Styling:** Tailwind CSS 3 + PostCSS + Autoprefixer
- **Icons:** lucide-react
- **Database:** PostgreSQL (via `pg` driver nativo)
- **External API:** Pluggy.ai (Open Finance / Open Banking)
- **Utilities:** uuid v4

---

## Project Structure

```
app/
  page.jsx                          → Dashboard administrativo (lista de clientes)
  login/page.jsx                    → Tela de login do admin
  clients/[id]/page.jsx             → Extrato detalhado do cliente (admin)
  portal/[token]/page.jsx           → Portal público do cliente (conectar bancos)
  layout.jsx                        → Root layout (lang="pt-BR")
  not-found.jsx                     → Página 404
  globals.css                       → Tailwind directives

  api/
    connect-token/route.js          → Gera Connect Token Pluggy (server-side)
    clients/route.js                → CRUD de clientes
    clients/[id]/route.js           → GET/PUT/DELETE de cliente
    clients/[id]/transactions/route.js   → Busca e persiste transações via Pluggy
    clients/[id]/export/route.js    → Exporta extrato para CSV
    clients/[id]/export-json/route.js    → Exporta extrato para JSON (protegido por CRON_SECRET)
    clients/[id]/loans/route.js     → Lista empréstimos e parcelas do cliente
    clients/[id]/loans/debug/route.js    → Debug das queries de empréstimo
    portal/[token]/route.js         → Dados do portal público
    portal/[token]/connect-token/route.js → Connect token para portal
    portal/[token]/items/route.js   → GET/POST itens Pluggy do cliente
    portal/[token]/items/[itemId]/route.js → DELETE item Pluggy
    admin/login/route.js            → Autenticação admin (cookie HMAC)
    admin/logout/route.js           → Logout admin
    cron/sync/route.js              → Sincronização automática (cron)
    cron/backfill/route.js          → Backfill histórico de transações
    debug/pagination/route.js       → Debug de paginação da Pluggy
    gestor-companies/route.js       → Lista empresas do Have Gestor
    webhooks/pluggy/route.js        → Recebe webhooks da Pluggy

lib/
  cron-sync.js                      → Motor de sincronização multi-tenant (Klavi + Pluggy) reutilizável entre cron, scripts e AWS Batch
  pluggy.js                         → Wrapper da API Pluggy (auth, contas, transações, investimentos, dívidas)
  storage.js                        → Camada de persistência PostgreSQL (clients, items, transactions, investments, debts, sync_logs, sync_locks)

scripts/
  setup-db.mjs                      → Cria banco e tabelas PostgreSQL
  setup-db.mjs                      → Cria banco e tabelas PostgreSQL
  migrate-items-status.mjs          → Migra schema para status/erro dos itens
  sync.mjs                          → Sincronização standalone Pluggy single-tenant (sem timeout Vercel)
  batch-sync.mjs                    → Sincronização standalone multi-tenant (Klavi + Pluggy) para AWS Batch
  backfill.mjs                      → Backfill histórico de transações
  link-empresas.mjs                 → Vincula clientes a empresas do Have Gestor
  debug_pagination.mjs              → Debug de paginação da Pluggy
  validar_extrato.py                → Valida extrato Pluggy vs banco de dados (Python)

airflow/dags/
  extrator_bancario_sync.py        → DAG que submete o sync diário ao AWS Batch
  extrator_bancario_sync_ssh.py    → DAG que roda o sync via SSH na EC2 dos motores

aws/
  batch-job-definition.json        → Template de AWS Batch Job Definition

.github/workflows/
  build-batch-image.yml            → Builda a imagem Docker no push e publica no ECR

Dockerfile.batch                   → Imagem Docker para execução no AWS Batch

gestor.config.js                    → Lista de empresas do Have Gestor
middleware.js                       → Proteção de rotas administrativas
```

---

## Environment Variables

Copie `.env.example` para `.env.local` e preencha:

```bash
PLUGGY_CLIENT_ID=seu_client_id_aqui
PLUGGY_CLIENT_SECRET=seu_client_secret_aqui
DATABASE_URL=postgresql://postgres:sua_senha@host:5432/extratos
CRON_SECRET=uma_senha_secreta_aleatoria
ADMIN_PASSWORD=sua_senha_admin          # obrigatória (não há mais padrão)
PLUGGY_WEBHOOK_URL=https://seu-dominio.com/api/webhooks/pluggy   # opcional, recomendado
PLUGGY_WEBHOOK_SECRET=uma_senha_secreta_aleatoria                # opcional, recomendado
```

> **Segurança:** `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` ficam **somente** no servidor. O frontend recebe apenas um `connectToken` temporário (válido por ~30 min).

---

## Build and Run Commands

```bash
# Instalar dependências
npm install

# Rodar localmente (Next.js dev server)
npm run dev

# Build de produção
npm run build

# Iniciar servidor de produção
npm start

# Setup do banco de dados PostgreSQL
npm run setup-db        # equivale a: node scripts/setup-db.mjs
```

Acesse localmente: [http://localhost:3000](http://localhost:3000)

---

## Database Schema

O banco `extratos` roda em PostgreSQL. O script `scripts/setup-db.mjs` cria/atualiza:

- `clients` — clientes (id, name, portal_token, last_sync, created_at, gestor_empresa)
- `items` — conexões Pluggy (id, client_id, pluggy_item_id, institution_name, institution_logo, account_numbers)
- `transactions` — transações bancárias (débito/conta corrente)
- `credit_transactions` — transações de cartão de crédito
- `investments` — investimentos
- `debts` — empréstimos e dívidas (contas LOAN + derivadas de transações parceladas)
- `all_transactions` — view que une `transactions` + `credit_transactions`

Índices importantes: `client_id + date DESC` em ambas as tabelas de transações.

---

## Authentication

- **Admin:** cookie `admin_session` com token HMAC-SHA256 da senha. Middleware (`middleware.js`) protege todas as rotas exceto `/login`, `/portal/*`, `/api/portal/*`, `/api/admin/login`, `/api/cron/*`, `/api/debug/*`, `/api/webhooks/pluggy`.
  - `ADMIN_PASSWORD` é obrigatória; não há mais senha padrão.
  - `/api/clients` não é mais público; exige autenticação admin.
  - `/api/cron/backfill` exige `CRON_SECRET` ou header `x-vercel-cron: 1`.
- **Portal:** acesso por token aleatório de 64 hex chars (`portalToken`) na URL `/portal/{token}`. Sem senha.

---

## Key Business Logic

### Sincronização de Transações
- A rota `/api/clients/[id]/transactions` busca todas as contas e transações paginadas (500 por página) da Pluggy.
- Transações são separadas em `transactions` (conta bancária) e `credit_transactions` (cartão de crédito).
- Upsert em batch de 200 registros por vez (`upsertTransactionsBatch` / `upsertCreditTransactionsBatch`).
- Após o upsert, transações órfãs (IDs que sumiram da Pluggy no período) são removidas (`deleteOrphanTransactions`).
- Empréstimos são extraídos de duas fontes: contas do tipo LOAN na Pluggy, e transações com padrão de parcelas (`\d+/\d+` + palavras-chave como PARCELA, FINANCIAMENTO, etc.).
- A camada Pluggy (`lib/pluggy.js`) implementa timeout, retry com exponential backoff e respeito a rate-limits (`Retry-After` / `RateLimit-Reset`).
- Syncs usam lock distribuído (`sync_locks`) para evitar execuções concorrentes.
- PATCH em itens é serializado e respeita `lastUpdatedAt` (mínimo 1h entre updates, conforme Pluggy).
- Status, `executionStatus`, `error.code` e `lastUpdatedAt` dos itens são persistidos na tabela `items`.
- Itens com `LOGIN_ERROR`/`INVALID_CREDENTIALS`/`USER_AUTHORIZATION_REVOKED` são marcados com `requires_reconnect = true` e exibem alerta no dashboard e portal.

### Cron de Sincronização
- Configurado no `vercel.json` para rodar diariamente às 12:00 (UTC-3 / horário de Brasília) no path `/api/cron/sync`.
- O cron adquire lock distribuído antes de executar.
- PATCH em itens é feito de forma serial com delay entre chamadas (rate-limit de 20 PATCH/min da Pluggy).
- Após PATCH, aguarda até 30s o item sair de `UPDATING` antes de buscar transações.
- Primeira carga usa `from='2026-05-01'`; cargas subsequentes usam os últimos 7 dias.
- Autenticação: header `x-vercel-cron: 1` ou `Authorization: Bearer {CRON_SECRET}`.

### Portal do Cliente
- Cada cliente tem um link único `/portal/{portalToken}`.
- O cliente pode conectar/desconectar bancos sozinho via widget Pluggy.
- O admin pode copiar o link do portal no dashboard.
- Itens com problema de credencial exibem aviso "Reconectar necessário" e destacam o botão de reconexão.

### Exportação
- CSV com BOM UTF-8 (`\ufeff`), separado por vírgula, compatível com Excel.
- Colunas: ID, Data, Data Transação, Descrição, Tipo, Valor, Saldo, Categoria, Conta, Agência/Número, Tipo de Conta, Banco, Razão Social, CNPJ/CPF, Origem, Status.

---

## Code Style Guidelines

- JavaScript puro (sem TypeScript). Arquivos React usam `.jsx`, APIs usam `.js`.
- Componentes React são funções default export.
- Client components usam `'use client';` no topo.
- Rotas de API usam `export const dynamic = 'force-dynamic';` para evitar cache estático.
- Rotas que podem demorar usam `export const maxDuration = 60;` (limite Vercel).
- Tratamento de erro padrão: `try/catch` retornando `{ error: error.message }` com status 500.
- Strings e comentários em **português do Brasil**.
- Tailwind para todo o CSS; não há CSS modules adicionais.

---

## Testing and Validation

Não há suite de testes automatizados (Jest/Vitest). A validação é feita via scripts utilitários:

```bash
# Validar extrato Pluggy vs banco de dados
pip install requests psycopg2-binary python-dotenv
python scripts/validar_extrato.py --cliente "Nome Cliente" --from 2026-01-01 --to 2026-06-01

# Debug de paginação da Pluggy
node scripts/debug_pagination.mjs [from] [to]

# Sincronização manual fora do Vercel (sem timeout)
node scripts/sync.mjs [clientIdOpcional]

# Backfill histórico
node scripts/backfill.mjs [from] [to]

# Vincular cliente a empresa do Have Gestor
node scripts/link-empresas.mjs set "Nome Cliente" empresa
```

---

## Deployment

### Vercel (recomendado)
- Configure as variáveis de ambiente `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `DATABASE_URL`, `CRON_SECRET`, `ADMIN_PASSWORD` no painel.
- O `vercel.json` define o cron diário.
- Atenção: em deploy serverless, o `maxDuration = 60` limita rotas longas. Para sincronização pesada, use `scripts/sync.mjs` fora da Vercel.

### Netlify
- Configurado via `netlify.toml` com `@netlify/plugin-nextjs`.
- Node version 20.

### AWS Batch + Airflow (sync pesado)
Para sincronizações que extrapolam o timeout serverless da Vercel, use o motor standalone containerizado:

```bash
# Build da imagem Docker
npm run docker:build:batch

# Rodar localmente (todas as empresas ativas)
node scripts/batch-sync.mjs

# Rodar localmente para uma empresa específica
EMPRESA=marcon node scripts/batch-sync.mjs
```

Passos de deploy:
1. Configure os secrets/vars do repositório GitHub:
   - `AWS_ROLE_ARN` (OIDC role para publicar no ECR)
   - `vars.AWS_REGION`, `vars.ECR_REPOSITORY`, `vars.BATCH_JOB_DEFINITION`
2. Ajuste `aws/batch-job-definition.json` com os ARNs corretos das roles e secrets do Secrets Manager.
3. A cada push na `main`, o workflow `.github/workflows/build-batch-image.yml` builda a imagem, publica no ECR e registra uma nova revisão da job definition.
4. Crie uma fila de jobs no AWS Batch (ex: `extrator-bancario-queue`).
5. Copie `airflow/dags/extrator_bancario_sync.py` para o bucket/pasta de DAGs do Airflow.
6. Configure as variáveis do Airflow: `EXTRATOR_BATCH_JOB_DEFINITION` e `EXTRATOR_BATCH_JOB_QUEUE`.

O DAG dispara o job diariamente às 07:00 UTC (04:00 BRT), preservando a mesma cadência do `vercel.json`.

#### Airflow + SSH (sem AWS Batch)
Se já tiver uma EC2 rodando os motores e quiser orquestrar o sync pelo Airflow sem montar AWS Batch:

1. Clone o repo na EC2 e configure o `.env`.
2. Copie `airflow/dags/extrator_bancario_sync_ssh.py` para o Airflow.
3. Configure a conexão SSH `ssh_extrator_bancario` apontando para a EC2.
4. (Opcional) Configure a variável `EXTRATOR_SYNC_REPO_DIR` (padrão `/opt/Extrator-bancario`).
5. (Opcional) Configure `EXTRATOR_SYNC_EMPRESA` para sincronizar só uma empresa.

O DAG dá `git pull` antes de cada execução e roda `node scripts/batch-sync.mjs` via SSH.

---

## Webhooks

- Endpoint: `POST /api/webhooks/pluggy`.
- Configure `PLUGGY_WEBHOOK_URL` (URL pública HTTPS) e `PLUGGY_WEBHOOK_SECRET`.
- O connect token e a criação/atualização de items podem incluir `webhookUrl`.
- Eventos processados:
  - `item/updated`, `item/created` → atualiza status do item.
  - `item/error`, `item/login_error` → marca `requires_reconnect = true` quando apropriado.
  - `item/waiting_user_input`, `item/waiting_user_action` → atualiza status.
- O endpoint sempre responde 2XX rapidamente para evitar retries indesejados da Pluggy.

## Security Considerations

- Credenciais Pluggy nunca chegam ao browser.
- O cookie de admin é `httpOnly`, `secure` em produção, `sameSite: 'lax'`.
- O arquivo `.env.local` e a pasta `data/` estão no `.gitignore`.
- A rota `/api/clients/[id]/export-json` exige `Authorization: Bearer {CRON_SECRET}`.
- O middleware bloqueia acesso não autenticado a todas as rotas administrativas.

---

## Melhorias de Robustez (desconexões automáticas)

Para reduzir desconexões automáticas das contas Pluggy, o projeto adota as seguintes práticas:

1. **Webhooks obrigatórios em produção:** `PLUGGY_WEBHOOK_URL` e `PLUGGY_WEBHOOK_SECRET` são necessários. O endpoint `/api/webhooks/pluggy` processa `item/updated`, `item/deleted`, `item/error`, `transactions/created`, `transactions/updated` e `transactions/deleted`.
2. **Auto-Sync da Pluggy:** o mecanismo principal de atualização é o Auto-Sync da Pluggy (produção). O cron `/api/cron/sync` e a rota `/api/clients/[id]/refresh` funcionam como fallback / gatilho manual.
3. **Separação de responsabilidades no dashboard:**
   - **"Buscar Extrato"** (`GET /api/clients/[id]/transactions`) apenas lê transações já sincronizadas no banco local.
   - **"Atualizar Conexões"** (`POST /api/clients/[id]/refresh`) dispara PATCH e sincronização de dados sob demanda.
4. **Idempotência de webhooks:** eventos são registrados na tabela `webhook_events` pelo `eventId` e ignorados se duplicados.
5. **Soft delete de itens:** ao receber `item/deleted`, o item local é marcado com `deleted_at` em vez de ser removido fisicamente.
6. **Retentativa para itens `OUTDATED`:** a cron tenta atualizar itens `OUTDATED` desde que não tenham muitos erros consecutivos.
7. **Timeout aumentado:** a cron aguarda até 3 minutos após PATCH para itens que entram em `UPDATING`.
8. **Módulos compartilhados:** `lib/status.js` centraliza a normalização de status; `lib/sync-processor.js` centraliza a lógica de sincronização de transações.

## Have Gestor Integration

O arquivo `gestor.config.js` exporta `GESTOR_COMPANIES`, uma lista de empresas que podem ser vinculadas a clientes via campo `gestor_empresa` na tabela `clients`.

A integração ativa com o Have Gestor usa as rotas abaixo, protegidas por `GESTOR_API_TOKEN`:

- `POST /api/gestor/client` — recebe `{ empresa, nome, businessTaxId }`, cria ou atualiza o cliente vinculado à empresa e retorna o `portalUrl`.
- `GET /api/gestor/client?empresa=...` — retorna o cliente vinculado à empresa, se existir.
- `GET /api/gestor/client/items?empresa=...` — retorna os itens/conexões bancárias do cliente vinculado à empresa, incluindo `diagnostics` com status, erros e `requiresReconnect`.

O Have Gestor chama essas APIs para abrir o portal e listar o status das contas conectadas; o usuário conecta os bancos no Extrator; os dados sincronizados são consumidos pelo Have através do banco `extratos` (`motor/pluggy_extrato.py`) ou leitura direta em `caixa_extrato`.

### Variáveis de ambiente

```
GESTOR_API_TOKEN=<mesmo_valor_de_EXTRATOR_API_TOKEN_no_Have_SOP>
```
