"""
Validador de Extrato Bancário - Pluggy API
Busca o extrato direto da Pluggy e compara com o banco de dados local.

Uso:
    pip install requests psycopg2-binary python-dotenv
    python validar_extrato.py --cliente "Lanzi" --from 2026-01-01 --to 2026-05-08
"""

import argparse
import requests
import psycopg2
import os
from datetime import datetime
from dotenv import load_dotenv

# Tenta .env.local primeiro, depois .env.production
for env_file in ['.env.local', '.env.production', '.env']:
    path = os.path.join(os.path.dirname(__file__), '..', env_file)
    if os.path.exists(path):
        load_dotenv(path, override=False)

PLUGGY_BASE    = 'https://api.pluggy.ai'
CLIENT_ID      = os.getenv('PLUGGY_CLIENT_ID')
CLIENT_SECRET  = os.getenv('PLUGGY_CLIENT_SECRET')
DATABASE_URL   = os.getenv('DATABASE_URL')

# Fallback: conexão direta com o servidor
DB_PARAMS = None
if not DATABASE_URL:
    DB_PARAMS = {
        'host':     '37.60.236.200',
        'port':     5432,
        'user':     'postgres',
        'password': os.getenv('DB_PASSWORD', '131105Gv'),
        'dbname':   'extratos',
    }


# ── Pluggy ────────────────────────────────────────────────────────────────────

def get_api_key():
    r = requests.post(f'{PLUGGY_BASE}/auth', json={
        'clientId': CLIENT_ID,
        'clientSecret': CLIENT_SECRET,
    })
    r.raise_for_status()
    return r.json()['apiKey']


def get_accounts(api_key, item_id):
    r = requests.get(f'{PLUGGY_BASE}/accounts?itemId={item_id}',
                     headers={'X-API-KEY': api_key})
    r.raise_for_status()
    return r.json()['results']


def get_transactions_pluggy(api_key, account_id, from_date, to_date):
    txs = []
    page, total_pages = 1, 1
    while page <= total_pages:
        r = requests.get(
            f'{PLUGGY_BASE}/transactions',
            params={'accountId': account_id, 'from': from_date, 'to': to_date,
                    'page': page, 'pageSize': 500},
            headers={'X-API-KEY': api_key}
        )
        r.raise_for_status()
        data = r.json()
        total_pages = data['totalPages']
        txs.extend(data['results'])
        page += 1
    return txs


# ── Banco de Dados ────────────────────────────────────────────────────────────

def connect_db():
    if DATABASE_URL:
        return psycopg2.connect(DATABASE_URL)
    return psycopg2.connect(**DB_PARAMS)

def get_items_by_client_name(client_name):
    conn = connect_db()
    cur  = conn.cursor()
    cur.execute("""
        SELECT i.pluggy_item_id, i.institution_name, c.name
        FROM items i
        JOIN clients c ON c.id = i.client_id
        WHERE LOWER(c.name) LIKE LOWER(%s)
    """, (f'%{client_name}%',))
    rows = cur.fetchall()
    conn.close()
    return rows


def get_transactions_db(client_name, from_date, to_date):
    conn = connect_db()
    cur  = conn.cursor()
    cur.execute("""
        SELECT t.id, t.date::date, t.description, t.type, t.amount, t.status, 'bank' AS source
        FROM transactions t
        JOIN clients c ON c.id = t.client_id
        WHERE LOWER(c.name) LIKE LOWER(%s)
          AND t.date::date >= %s AND t.date::date <= %s
        UNION ALL
        SELECT ct.id, ct.date::date, ct.description, ct.type, ct.amount, ct.status, 'credit'
        FROM credit_transactions ct
        JOIN clients c ON c.id = ct.client_id
        WHERE LOWER(c.name) LIKE LOWER(%s)
          AND ct.date::date >= %s AND ct.date::date <= %s
        ORDER BY 2 DESC
    """, (f'%{client_name}%', from_date, to_date,
          f'%{client_name}%', from_date, to_date))
    rows = cur.fetchall()
    conn.close()
    return rows


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Valida extrato Pluggy vs Banco de Dados')
    parser.add_argument('--cliente',    required=True, help='Nome do cliente (ex: Lanzi)')
    parser.add_argument('--from',        dest='from_date', default='2026-01-01')
    parser.add_argument('--to',          dest='to_date',
                        default=datetime.today().strftime('%Y-%m-%d'))
    parser.add_argument('--client-id',   dest='client_id',     default=None)
    parser.add_argument('--client-secret', dest='client_secret', default=None)
    args = parser.parse_args()

    if args.client_id:     os.environ['PLUGGY_CLIENT_ID']     = args.client_id
    if args.client_secret: os.environ['PLUGGY_CLIENT_SECRET'] = args.client_secret

    global CLIENT_ID, CLIENT_SECRET
    CLIENT_ID     = os.getenv('PLUGGY_CLIENT_ID')
    CLIENT_SECRET = os.getenv('PLUGGY_CLIENT_SECRET')

    if not CLIENT_ID or not CLIENT_SECRET:
        print('❌ Faltam as credenciais Pluggy. Use --client-id e --client-secret')
        return

    print(f'\n{"="*60}')
    print(f'Cliente : {args.cliente}')
    print(f'Período : {args.from_date} → {args.to_date}')
    print(f'{"="*60}\n')

    # Items no banco
    items = get_items_by_client_name(args.cliente)
    if not items:
        print('❌ Nenhum item encontrado para esse cliente no banco de dados.')
        return

    api_key = get_api_key()
    print(f'✅ API Key Pluggy obtida\n')

    total_pluggy = 0
    pluggy_ids   = set()

    for pluggy_item_id, institution_name, client_name in items:
        print(f'🏦 Banco: {institution_name} (item: {pluggy_item_id[:8]}...)')
        accounts = get_accounts(api_key, pluggy_item_id)
        print(f'   Contas encontradas: {len(accounts)}')

        for acc in accounts:
            txs = get_transactions_pluggy(api_key, acc['id'], args.from_date, args.to_date)
            total_pluggy += len(txs)
            for t in txs:
                pluggy_ids.add(t['id'])
            print(f'   → {acc["name"]} ({acc["type"]}): {len(txs)} transações')

    # Banco de dados
    db_rows = get_transactions_db(args.cliente, args.from_date, args.to_date)
    total_db = len(db_rows)
    db_ids   = {r[0] for r in db_rows}

    print(f'\n{"="*60}')
    print(f'📊 RESULTADO DA COMPARAÇÃO')
    print(f'{"="*60}')
    print(f'Pluggy (fonte real) : {total_pluggy} transações')
    print(f'Banco de dados      : {total_db} transações')
    diff = total_pluggy - total_db
    if diff == 0:
        print(f'✅ BATEU PERFEITAMENTE!')
    else:
        print(f'⚠️  DIFERENÇA: {abs(diff)} transações {"a mais na Pluggy" if diff > 0 else "a mais no banco"}')

    # IDs que estão na Pluggy mas não no banco
    missing_in_db = pluggy_ids - db_ids
    if missing_in_db:
        print(f'\n❌ {len(missing_in_db)} IDs da Pluggy NÃO estão no banco:')
        for mid in list(missing_in_db)[:10]:
            print(f'   {mid}')
        if len(missing_in_db) > 10:
            print(f'   ... e mais {len(missing_in_db) - 10}')

    # IDs que estão no banco mas não na Pluggy (órfãos)
    orphans = db_ids - pluggy_ids
    if orphans:
        print(f'\n🗑️  {len(orphans)} IDs no banco NÃO estão mais na Pluggy (órfãos):')
        for oid in list(orphans)[:10]:
            print(f'   {oid}')
        if len(orphans) > 10:
            print(f'   ... e mais {len(orphans) - 10}')

    print()


if __name__ == '__main__':
    main()
