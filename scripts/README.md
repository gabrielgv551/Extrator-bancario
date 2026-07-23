# Scripts do Extrator Bancário

## 🔄 Sincronização

### `sync.mjs` — Sincronização principal
Sincroniza transações da Pluggy para o PostgreSQL.

```bash
# Uso básico (todos os clientes)
node scripts/sync.mjs

# Um cliente específico
node scripts/sync.mjs <CLIENT_ID>

# Sem PATCH (só lê dados já syncados)
SYNC_SKIP_PATCH=1 node scripts/sync.mjs

# Sem deletar órfãs
SYNC_SKIP_ORPHAN_DELETE=1 node scripts/sync.mjs

# Combinado
SYNC_SKIP_PATCH=1 SYNC_SKIP_ORPHAN_DELETE=1 node scripts/sync.mjs
```

**Variáveis de ambiente necessárias:**
- `DATABASE_URL` — PostgreSQL
- `PLUGGY_CLIENT_ID` — Credencial Pluggy
- `PLUGGY_CLIENT_SECRET` — Credencial Pluggy

---

## 🔍 Diagnóstico

### `diagnose.mjs` — Diagnóstico avançado
Compara transações da Pluggy com o banco de dados em detalhes.

```bash
# Um cliente específico
node scripts/diagnose.mjs <CLIENT_ID>

# Com período customizado
node scripts/diagnose.mjs <CLIENT_ID> --from 2026-05-01 --to 2026-06-10

# Todos os clientes
node scripts/diagnose.mjs --all
```

**O que ele mostra:**
- Status atual do item na Pluggy
- Quantidade de transações em cada fonte
- **Transações faltantes no banco** (estão na Pluggy, não no DB)
- **Transações órfãs no banco** (estão no DB, não na Pluggy)
- **Divergências** (mesmo ID, mas dados diferentes: valor, data, descrição, tipo)

---

## 🚀 Deploy

### `deploy.sh` — Deploy para a VPS
Copia o `sync.mjs` (e opcionalmente `.env`) para a VPS.

```bash
# Deploy rápido (só sync.mjs)
./scripts/deploy.sh

# Deploy completo (sync.mjs + .env + verificação)
./scripts/deploy.sh --full

# Simulação (não executa nada)
./scripts/deploy.sh --dry-run

# Só o .env
./scripts/deploy.sh --env-only
```

**Requisitos:**
- Acesso SSH configurado para `root@37.60.236.200`
- `scp` e `ssh` disponíveis

---

## 🛠️ Utilitários

### `validar_extrato.py` — Validador Python
Versão Python do diagnóstico (requer `requests` e `psycopg2-binary`).

```bash
pip install requests psycopg2-binary python-dotenv
python scripts/validar_extrato.py --cliente "Nome" --from 2026-01-01 --to 2026-06-10
```

### `backfill.mjs` — Carga histórica
Preenche dados históricos de um período maior.

### `setup-db.mjs` — Setup do banco
Cria tabelas e índices iniciais.

### `link-empresas.mjs` — Vincula empresas
Associa transações a empresas conhecidas.

---

## 📋 Fluxo de trabalho recomendado

1. **Desenvolver/testar localmente:**
   ```bash
   node scripts/sync.mjs <CLIENT_ID>
   ```

2. **Verificar divergências:**
   ```bash
   node scripts/diagnose.mjs <CLIENT_ID>
   ```

3. **Deploy para VPS:**
   ```bash
   ./scripts/deploy.sh
   ```

4. **Testar na VPS:**
   ```bash
   ssh root@37.60.236.200
   source /root/.sync.env
   node /root/sync.mjs <CLIENT_ID>
   ```
