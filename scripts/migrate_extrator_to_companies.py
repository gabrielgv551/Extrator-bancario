#!/usr/bin/env python3
"""
Migra dados do banco central legado do Extrator Bancario (tabelas sem prefixo)
para os bancos por empresa do Have Gestor (tabelas extrator_*).

Preenche tambem as tabelas centrais de mapeamento:
  - extrator_portal_tokens (portal_token -> empresa_slug)
  - extrator_item_locations (pluggy_item_id / klavi_link_id / klavi_consent_id -> empresa_slug)

Requisitos de variaveis de ambiente:
  - DATABASE_URL: banco legado do Extrator (schema clients, items, transactions, ...)
  - CENTRAL_DB_HOST, CENTRAL_DB_NAME, CENTRAL_DB_USER, CENTRAL_DB_PASSWORD: banco have_gestor
  - POSTGRES_HOST/POSTGRES_PASSWORD: fallback para o central

Uso:
  python scripts/migrate_extrator_to_companies.py
"""

import os
import sys
import psycopg2
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))


def get_env(key, fallback=None):
    return os.environ.get(key, fallback)


def parse_database_url(url):
    if not url:
        return None
    from urllib.parse import urlparse, unquote
    u = urlparse(url)
    return {
        'host': u.hostname,
        'port': u.port or 5432,
        'dbname': unquote(u.path.lstrip('/')),
        'user': u.username,
        'password': u.password,
    }


def get_central_config():
    parsed = parse_database_url(get_env('DATABASE_URL'))
    fallback_host = parsed['host'] if parsed else None
    fallback_password = parsed['password'] if parsed else None
    return {
        'host': get_env('CENTRAL_DB_HOST', get_env('POSTGRES_HOST', fallback_host)),
        'port': int(get_env('CENTRAL_DB_PORT', get_env('POSTGRES_PORT', '5432'))),
        'dbname': get_env('CENTRAL_DB_NAME', 'have_gestor'),
        'user': get_env('CENTRAL_DB_USER', get_env('POSTGRES_USER', 'postgres')),
        'password': get_env('CENTRAL_DB_PASSWORD', get_env('POSTGRES_PASSWORD', fallback_password)),
    }


def get_legacy_config():
    cfg = parse_database_url(get_env('DATABASE_URL'))
    if not cfg:
        raise ValueError('DATABASE_URL nao configurada')
    return cfg


def connect_central():
    return psycopg2.connect(**get_central_config())


def connect_legacy():
    return psycopg2.connect(**get_legacy_config())


def get_company_config_from_central(conn, slug):
    cur = conn.cursor()
    cur.execute(
        """
        SELECT c.chave, c.valor, c.criptografado
        FROM configuracoes c
        JOIN empresas e ON e.id = c.empresa_id
        WHERE e.slug = %s
          AND c.chave IN ('db_host', 'db_port', 'db_name', 'db_user', 'db_password')
        """,
        [slug.lower().strip()]
    )
    rows = cur.fetchall()
    if not rows:
        return None

    central = get_central_config()
    cfg = {}
    for chave, valor, criptografado in rows:
        if criptografado and valor:
            raw = get_env('CONFIG_ENCRYPTION_KEY')
            if not raw:
                print(f'    [AVISO] CONFIG_ENCRYPTION_KEY ausente; usando fallback para {chave}')
                continue
            try:
                import hashlib
                import base64
                from cryptography.hazmat.primitives.ciphers.aead import AESGCM
                key = hashlib.sha256(raw.encode()).digest()
                parts = valor.split(':')
                if len(parts) != 3:
                    raise ValueError(f'formato invalido')
                iv = base64.b64decode(parts[0]) if len(parts[0]) > 32 else bytes.fromhex(parts[0])
                tag = base64.b64decode(parts[1]) if len(parts[1]) > 32 else bytes.fromhex(parts[1])
                ct = base64.b64decode(parts[2]) if len(parts[2]) > 32 else bytes.fromhex(parts[2])
                aesgcm = AESGCM(key)
                valor = aesgcm.decrypt(iv, ct + tag, None).decode('utf-8')
                cfg[chave] = valor
            except Exception as e:
                print(f'    [AVISO] falha ao descriptografar {chave}: {e}; usando fallback')
                continue
        else:
            cfg[chave] = valor

    return {
        'host': cfg.get('db_host') or central['host'],
        'port': int(cfg.get('db_port') or 5432),
        'dbname': cfg.get('db_name'),
        'user': cfg.get('db_user') or 'postgres',
        'password': cfg.get('db_password') or central['password'],
    }


def connect_company(central_conn, slug):
    cfg = get_company_config_from_central(central_conn, slug)
    if not cfg or not cfg.get('dbname'):
        central = get_central_config()
        cfg = {
            'host': central['host'],
            'port': central['port'],
            'dbname': f"have_{slug.lower().strip()}",
            'user': central['user'],
            'password': central['password'],
        }
    return psycopg2.connect(**cfg)


def list_active_companies(conn):
    cur = conn.cursor()
    cur.execute("SELECT slug FROM empresas WHERE status = 'ativo' ORDER BY slug")
    return [row[0] for row in cur.fetchall()]


def ensure_central_token_map(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS extrator_portal_tokens (
          portal_token VARCHAR(64) PRIMARY KEY,
          empresa_slug VARCHAR(50) NOT NULL,
          client_id UUID NOT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_extrator_portal_tokens_empresa ON extrator_portal_tokens(empresa_slug)")
    cur.execute("""
        CREATE TABLE IF NOT EXISTS extrator_item_locations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_slug VARCHAR(50) NOT NULL,
          client_id UUID NOT NULL,
          item_id UUID NOT NULL,
          pluggy_item_id VARCHAR(255),
          klavi_link_id VARCHAR(255),
          klavi_consent_id VARCHAR(255),
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (item_id)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_extrator_item_locations_pluggy ON extrator_item_locations(pluggy_item_id) WHERE pluggy_item_id IS NOT NULL")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_extrator_item_locations_link ON extrator_item_locations(klavi_link_id) WHERE klavi_link_id IS NOT NULL")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_extrator_item_locations_consent ON extrator_item_locations(klavi_consent_id) WHERE klavi_consent_id IS NOT NULL")
    conn.commit()


def migrate_table(src_cur, dst_cur, src_sql, src_params, dst_insert_sql, label):
    src_cur.execute(src_sql, src_params)
    rows = src_cur.fetchall()
    if not rows:
        print(f'  [OK] {label}: nenhum registro para migrar')
        return 0
    for row in rows:
        dst_cur.execute(dst_insert_sql, row)
    print(f'  [OK] {label}: {len(rows)} registros migrados')
    return len(rows)


def migrate_company(central_conn, legacy_conn, slug):
    print(f'\n=== {slug} ===')
    try:
        company_conn = connect_company(central_conn, slug)
        company_cur = company_conn.cursor()
    except Exception as e:
        print(f'  [ERRO] conexao com banco da empresa: {e}')
        return

    legacy_cur = legacy_conn.cursor()

    # 1) clients com gestor_empresa = slug
    legacy_cur.execute(
        "SELECT id, name, portal_token, COALESCE(last_sync, created_at), business_tax_id, gestor_empresa, created_at FROM clients WHERE LOWER(gestor_empresa) = LOWER(%s)",
        [slug]
    )
    clients = legacy_cur.fetchall()
    print(f'  [OK] clients encontrados: {len(clients)}')

    for client in clients:
        (cid, name, portal_token, last_sync, business_tax_id, gestor_empresa, created_at) = client
        company_cur.execute(
            """
            INSERT INTO extrator_clients (id, name, portal_token, last_sync, business_tax_id, gestor_empresa, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              portal_token = EXCLUDED.portal_token,
              last_sync = EXCLUDED.last_sync,
              business_tax_id = EXCLUDED.business_tax_id,
              gestor_empresa = EXCLUDED.gestor_empresa,
              created_at = EXCLUDED.created_at
            """,
            [cid, name, portal_token, last_sync, business_tax_id, gestor_empresa, created_at]
        )

        # Mapeamento central portal_token -> empresa
        if portal_token:
            central_conn.cursor().execute(
                """
                INSERT INTO extrator_portal_tokens (portal_token, empresa_slug, client_id)
                VALUES (%s, %s, %s)
                ON CONFLICT (portal_token) DO UPDATE SET empresa_slug = EXCLUDED.empresa_slug, client_id = EXCLUDED.client_id
                """,
                [portal_token, slug.lower().strip(), cid]
            )

    # 2) items desses clients
    client_ids = [c[0] for c in clients]
    if client_ids:
        placeholders = ','.join(['%s'] * len(client_ids))
        legacy_cur.execute(
            f"""
            SELECT id, client_id, pluggy_item_id, institution_name, institution_logo, account_numbers, provider,
                   klavi_link_id, klavi_consent_id, business_tax_id, personal_tax_id, tax_type, institution_code,
                   status, execution_status, error_code, error_message, last_updated_at, last_error_at,
                   sync_count, consecutive_errors, requires_reconnect, deleted_at, consent_expires_at,
                   notification_sent_at, created_at
            FROM items WHERE client_id IN ({placeholders})
            """,
            client_ids
        )
        items = legacy_cur.fetchall()
        print(f'  [OK] items encontrados: {len(items)}')
        for item in items:
            company_cur.execute(
                """
                INSERT INTO extrator_items
                  (id, client_id, pluggy_item_id, institution_name, institution_logo, account_numbers, provider,
                   klavi_link_id, klavi_consent_id, business_tax_id, personal_tax_id, tax_type, institution_code,
                   status, execution_status, error_code, error_message, last_updated_at, last_error_at,
                   sync_count, consecutive_errors, requires_reconnect, deleted_at, consent_expires_at,
                   notification_sent_at, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO UPDATE SET
                  pluggy_item_id = EXCLUDED.pluggy_item_id,
                  institution_name = EXCLUDED.institution_name,
                  institution_logo = EXCLUDED.institution_logo,
                  account_numbers = EXCLUDED.account_numbers,
                  provider = EXCLUDED.provider,
                  klavi_link_id = EXCLUDED.klavi_link_id,
                  klavi_consent_id = EXCLUDED.klavi_consent_id,
                  business_tax_id = EXCLUDED.business_tax_id,
                  personal_tax_id = EXCLUDED.personal_tax_id,
                  tax_type = EXCLUDED.tax_type,
                  institution_code = EXCLUDED.institution_code,
                  status = EXCLUDED.status,
                  execution_status = EXCLUDED.execution_status,
                  error_code = EXCLUDED.error_code,
                  error_message = EXCLUDED.error_message,
                  last_updated_at = EXCLUDED.last_updated_at,
                  last_error_at = EXCLUDED.last_error_at,
                  sync_count = EXCLUDED.sync_count,
                  consecutive_errors = EXCLUDED.consecutive_errors,
                  requires_reconnect = EXCLUDED.requires_reconnect,
                  deleted_at = EXCLUDED.deleted_at,
                  consent_expires_at = EXCLUDED.consent_expires_at,
                  notification_sent_at = EXCLUDED.notification_sent_at,
                  created_at = EXCLUDED.created_at
                """,
                item
            )

            # Mapeamento central item -> empresa
            central_conn.cursor().execute(
                """
                INSERT INTO extrator_item_locations
                  (empresa_slug, client_id, item_id, pluggy_item_id, klavi_link_id, klavi_consent_id)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (item_id) DO UPDATE SET
                  empresa_slug = EXCLUDED.empresa_slug,
                  client_id = EXCLUDED.client_id,
                  pluggy_item_id = EXCLUDED.pluggy_item_id,
                  klavi_link_id = EXCLUDED.klavi_link_id,
                  klavi_consent_id = EXCLUDED.klavi_consent_id
                """,
                [slug.lower().strip(), item[1], item[0], item[2], item[7], item[8]]
            )

        # 3) transactions, credit_transactions, investments, debts, sync_logs, webhook_events
        if client_ids:
            migrate_table(
                legacy_cur, company_cur,
                f"SELECT id, client_id, client_name, pluggy_item_id, date, description, type, amount, balance, category, category_l1, category_l2, category_l3, account_name, account_number, account_type, institution_name, counterparty_name, counterparty_document, status, date_transacted, synced_at FROM transactions WHERE client_id IN ({placeholders})",
                client_ids,
                """
                INSERT INTO extrator_transactions
                  (id, client_id, client_name, pluggy_item_id, date, description, type, amount, balance, category, category_l1, category_l2, category_l3, account_name, account_number, account_type, institution_name, counterparty_name, counterparty_document, status, date_transacted, synced_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
                """,
                'transactions'
            )
            migrate_table(
                legacy_cur, company_cur,
                f"SELECT id, client_id, client_name, pluggy_item_id, date, description, type, amount, balance, category, category_l1, category_l2, category_l3, account_name, account_number, account_type, institution_name, counterparty_name, counterparty_document, status, date_transacted, synced_at FROM credit_transactions WHERE client_id IN ({placeholders})",
                client_ids,
                """
                INSERT INTO extrator_credit_transactions
                  (id, client_id, client_name, pluggy_item_id, date, description, type, amount, balance, category, category_l1, category_l2, category_l3, account_name, account_number, account_type, institution_name, counterparty_name, counterparty_document, status, date_transacted, synced_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
                """,
                'credit_transactions'
            )
            migrate_table(
                legacy_cur, company_cur,
                f"SELECT id, client_id, pluggy_item_id, name, type, subtype, balance, value, quantity, due_date, issuer, status, synced_at FROM investments WHERE client_id IN ({placeholders})",
                client_ids,
                """
                INSERT INTO extrator_investments
                  (id, client_id, pluggy_item_id, name, type, subtype, balance, value, quantity, due_date, issuer, status, synced_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
                """,
                'investments'
            )
            migrate_table(
                legacy_cur, company_cur,
                f"SELECT id, client_id, pluggy_item_id, account_name, type, balance, credit_limit, institution_name, synced_at FROM debts WHERE client_id IN ({placeholders})",
                client_ids,
                """
                INSERT INTO extrator_debts
                  (id, client_id, pluggy_item_id, account_name, type, balance, credit_limit, institution_name, synced_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
                """,
                'debts'
            )
            migrate_table(
                legacy_cur, company_cur,
                f"SELECT id, client_id, item_id, started_at, finished_at, status, error_message, transactions_count FROM sync_logs WHERE client_id IN ({placeholders})",
                client_ids,
                """
                INSERT INTO extrator_sync_logs
                  (id, client_id, item_id, started_at, finished_at, status, error_message, transactions_count)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
                """,
                'sync_logs'
            )
            if os.environ.get('MIGRATE_WEBHOOK_EVENTS') == '1':
                migrate_table(
                    legacy_cur, company_cur,
                    f"SELECT id, event_id, event, item_id, payload, received_at FROM webhook_events WHERE item_id IN (SELECT id::text FROM items WHERE client_id IN ({placeholders}))",
                    client_ids,
                    """
                    INSERT INTO extrator_webhook_events
                      (id, event_id, event, item_id, payload, received_at)
                    VALUES (%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (event_id) DO NOTHING
                    """,
                    'webhook_events'
                )

    central_conn.commit()
    company_conn.commit()
    company_cur.close()
    company_conn.close()
    print(f'  [OK] {slug} migrado com sucesso')


def main():
    print('Iniciando migracao do Extrator Bancario para bancos por empresa...')
    legacy_conn = connect_legacy()
    central_conn = connect_central()
    ensure_central_token_map(central_conn)

    companies = list_active_companies(central_conn)
    print(f'Empresas ativas encontradas: {len(companies)}')

    for slug in companies:
        migrate_company(central_conn, legacy_conn, slug)

    legacy_conn.close()
    central_conn.close()
    print('\nMigracao concluida.')


if __name__ == '__main__':
    main()
