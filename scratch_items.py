import psycopg2
import os
from dotenv import load_dotenv

load_dotenv('.env.production')
DATABASE_URL = os.getenv('DATABASE_URL')

def run():
    conn = psycopg2.connect(
        host='37.60.236.200',
        port=5432,
        user='postgres',
        password=os.getenv('DB_PASSWORD', '131105Gv'),
        dbname='extratos'
    )
    cur = conn.cursor()
    cur.execute("""
        SELECT id, pluggy_item_id, date, description, type, amount, status
        FROM transactions
        WHERE id IN ('5f5b327d-fd86-4bd0-9709-4374c08b0f44', 'af988526-31fc-402d-aa08-1cb0eced5bf3')
        UNION ALL
        SELECT id, pluggy_item_id, date, description, type, amount, status
        FROM credit_transactions
        WHERE id IN ('5f5b327d-fd86-4bd0-9709-4374c08b0f44', 'af988526-31fc-402d-aa08-1cb0eced5bf3')
    """)
    rows = cur.fetchall()
    print("Transactions found:")
    for r in rows:
        print(f"ID: {r[0]} | Item: {r[1]} | Date: {r[2]} | Desc: {r[3]} | Type: {r[4]} | Amount: {r[5]} | Status: {r[6]}")

if __name__ == '__main__':
    run()
