# Extrator Bancário — Pluggy

Web app para gestão de extratos bancários de múltiplos clientes via [Pluggy](https://pluggy.ai).

## Pré-requisitos

- [Node.js](https://nodejs.org) versão 18 ou superior
- Conta ativa na Pluggy com `CLIENT_ID` e `CLIENT_SECRET`

## Instalação

```bash
# 1. Instalar dependências
npm install

# 2. Criar o arquivo de variáveis de ambiente
cp .env.example .env.local
```

Abra o arquivo `.env.local` e preencha com suas credenciais do dashboard Pluggy:

```
PLUGGY_CLIENT_ID=seu_client_id_aqui
PLUGGY_CLIENT_SECRET=seu_client_secret_aqui
```

## Rodando localmente

```bash
npm run dev
```

Acesse: [http://localhost:3000](http://localhost:3000)

## Como usar

### 1. Cadastrar um cliente
- Clique em **Novo Cliente** no dashboard
- Digite o nome do cliente

### 2. Conectar a conta bancária
- Clique em **Ver Extrato** do cliente desejado
- Clique em **Conectar Banco**
- O widget da Pluggy abrirá — o cliente autentica na instituição bancária
- O `itemId` é salvo automaticamente

### 3. Baixar o extrato
- Selecione o período (De / Até)
- Clique em **Buscar Extrato**
- Visualize as transações com resumo de entradas, saídas e saldo
- Clique em **Exportar CSV** para baixar o arquivo (compatível com Excel)

### 4. Reconectar banco
Se o banco exigir nova autenticação, clique em **Reconectar Banco** — o mesmo `itemId` será reutilizado.

## Estrutura do projeto

```
app/
  page.jsx                        → Dashboard (lista de clientes)
  clients/[id]/page.jsx           → Extrato do cliente
  api/
    connect-token/route.js        → Gera Connect Token (seguro, server-side)
    clients/route.js              → CRUD de clientes
    clients/[id]/route.js
    clients/[id]/transactions/    → Busca transações via Pluggy
    clients/[id]/export/          → Exporta CSV

lib/
  pluggy.js                       → Wrapper da Pluggy API
  storage.js                      → Persistência em JSON local

data/
  clients.json                    → Gerado automaticamente (não commitar)
```

## Segurança

- `CLIENT_ID` e `CLIENT_SECRET` ficam **somente** no servidor (`.env.local`)
- O frontend só recebe um `connectToken` temporário (válido por 30 min)
- O arquivo `data/clients.json` fica local na máquina (não sobe ao git)

## Produção

```bash
npm run build
npm start
```

Para deploy em nuvem (Vercel, Railway, etc.), configure as variáveis de ambiente
`PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` no painel da plataforma.
> **Atenção:** Em deploy na nuvem, o `data/clients.json` não persiste entre deploys.
> Considere migrar o storage para um banco de dados como PostgreSQL ou SQLite persistente.
