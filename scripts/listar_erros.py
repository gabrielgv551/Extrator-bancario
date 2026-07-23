import os, json, urllib.request

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

# Auth Pluggy
req = urllib.request.Request(
    'https://api.pluggy.ai/auth',
    data=json.dumps({'clientId': os.environ['PLUGGY_CLIENT_ID'], 'clientSecret': os.environ['PLUGGY_CLIENT_SECRET']}).encode(),
    headers={'Content-Type': 'application/json'},
    method='POST'
)
api_key = json.loads(urllib.request.urlopen(req).read())['apiKey']

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
    try:
        req = urllib.request.Request(
            f'https://api.pluggy.ai/items/{item_id}',
            headers={'X-API-KEY': api_key}
        )
        data = json.loads(urllib.request.urlopen(req).read())
        if data['status'] not in ('UPDATED', 'PARTIAL_SUCCESS'):
            problemas.append({
                'cliente': cliente,
                'banco': banco,
                'status': data['status'],
                'executionStatus': data.get('executionStatus', 'N/A'),
                'lastUpdatedAt': data.get('lastUpdatedAt', 'N/A')
            })
    except Exception as e:
        problemas.append({
            'cliente': cliente,
            'banco': banco,
            'status': 'ERRO_CONSULTA',
            'executionStatus': str(e),
            'lastUpdatedAt': 'N/A'
        })

print(json.dumps(problemas, indent=2, ensure_ascii=False))
