import os, json, urllib.request, urllib.error
from datetime import datetime

# Carregar env
with open('/root/.sync.env') as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if '=' not in line:
            continue
        k, v = line.split('=', 1)
        k = k.replace('export ', '').strip()
        v = v.strip().strip('"').strip("'")
        os.environ[k] = v

PLUGGY_BASE = 'https://api.pluggy.ai'

def pluggy_request(path, method='GET', body=None):
    req = urllib.request.Request(
        f'{PLUGGY_BASE}{path}',
        data=json.dumps(body).encode() if body else None,
        headers={'Content-Type': 'application/json'},
        method=method
    )
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e.code, json.loads(body)
        except:
            return e.code, {'raw': body.decode('utf-8', errors='replace')}

# Auth
_, auth_data = pluggy_request('/auth', 'POST', {
    'clientId': os.environ['PLUGGY_CLIENT_ID'],
    'clientSecret': os.environ['PLUGGY_CLIENT_SECRET']
})
api_key = auth_data['apiKey']

def item_request(path, method='GET', body=None):
    req = urllib.request.Request(
        f'{PLUGGY_BASE}{path}',
        data=json.dumps(body).encode() if body else None,
        headers={'Content-Type': 'application/json', 'X-API-KEY': api_key},
        method=method
    )
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e.code, json.loads(body)
        except:
            return e.code, {'raw': body.decode('utf-8', errors='replace')}

# Conectar banco
import psycopg2
conn = psycopg2.connect(os.environ['DATABASE_URL'])
cur = conn.cursor()
cur.execute("""
    SELECT c.name, i.pluggy_item_id, i.institution_name
    FROM items i
    JOIN clients c ON c.id = i.client_id
    ORDER BY c.name, i.institution_name
""")
items = cur.fetchall()
cur.close()
conn.close()

problemas = []
for cliente, item_id, banco in items:
    status, data = item_request(f'/items/{item_id}')
    if status != 200:
        problemas.append({
            'cliente': cliente, 'banco': banco, 'item_id': item_id,
            'erro_consulta': data
        })
        continue
    if data['status'] not in ('UPDATED', 'PARTIAL_SUCCESS'):
        # Tentar PATCH para ver erro exato
        patch_status, patch_data = item_request(f'/items/{item_id}', 'PATCH', {})
        # Tentar listar contas para ver se alguma responde
        acc_status, acc_data = item_request(f'/accounts?itemId={item_id}')
        problemas.append({
            'cliente': cliente,
            'banco': banco,
            'item_id': item_id,
            'status': data.get('status'),
            'execution_status': data.get('executionStatus'),
            'last_updated_at': data.get('lastUpdatedAt'),
            'connector': data.get('connector', {}).get('name'),
            'connector_id': data.get('connector', {}).get('id'),
            'parameter': data.get('parameter'),
            'error_message': data.get('error', {}).get('message') if data.get('error') else None,
            'patch_status': patch_status,
            'patch_error': patch_data if patch_status >= 400 else None,
            'accounts_status': acc_status,
            'accounts_count': len(acc_data.get('results', [])) if isinstance(acc_data, dict) else 0,
        })

print(json.dumps(problemas, indent=2, ensure_ascii=False, default=str))
