import { NextResponse } from 'next/server';
import pg from 'pg';

const { Pool } = pg;
function getPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { id } = await params;
  const pool = getPool();

  try {
    // Passo 1: verifica se existem transacoes com parcela no description
    const { rows: sample } = await pool.query(
      `SELECT description, amount, date
       FROM transactions
       WHERE client_id = $1
         AND (description ILIKE '%PARCELA%' OR description ILIKE '%DEBITO SEGURO%'
              OR description ILIKE '%FINANCIAMENTO%' OR description ILIKE '%PRESTACAO%')
       LIMIT 10`,
      [id]
    );

    // Passo 2: verifica quais tem o padrao XX/XX
    const { rows: withPattern } = await pool.query(
      `SELECT description, amount, date
       FROM transactions
       WHERE client_id = $1
         AND description ~ '\\d+/\\d+'
       LIMIT 10`,
      [id]
    );

    // Passo 3: testa a query de agrupamento
    let grouped = [];
    let groupError = null;
    try {
      const { rows } = await pool.query(
        `SELECT
           REGEXP_REPLACE(description, '\\s+\\d+/\\d+', '')        AS name,
           SUBSTRING(description FROM '\\d+/(\\d+)')::int           AS total_parcelas,
           MAX(SUBSTRING(description FROM '(\\d+)/\\d+')::int)      AS ultima_parcela,
           ROUND(AVG(ABS(amount))::numeric, 2)                      AS valor_medio,
           ROUND(SUM(ABS(amount))::numeric, 2)                      AS total_pago,
           ROUND((AVG(ABS(amount)) *
             (SUBSTRING(description FROM '\\d+/(\\d+)')::int
              - MAX(SUBSTRING(description FROM '(\\d+)/\\d+')::int)))::numeric, 2) AS saldo_estimado,
           pluggy_item_id
         FROM transactions
         WHERE client_id = $1
           AND description ~ '\\d+/\\d+'
           AND (description ILIKE '%PARCELA%' OR description ILIKE '%DEBITO SEGURO%'
                OR description ILIKE '%FINANCIAMENTO%' OR description ILIKE '%PRESTACAO%')
         GROUP BY
           REGEXP_REPLACE(description, '\\s+\\d+/\\d+', ''),
           SUBSTRING(description FROM '\\d+/(\\d+)')::int,
           pluggy_item_id`,
        [id]
      );
      grouped = rows;
    } catch (e) {
      groupError = e.message;
    }

    // Passo 4: o que já existe na tabela debts
    const { rows: debts } = await pool.query(
      `SELECT id, account_name, type, balance FROM debts WHERE client_id = $1`,
      [id]
    );

    return NextResponse.json({
      clientId: id,
      step1_transacoes_com_parcela: sample,
      step2_transacoes_com_padrao_xx_xx: withPattern,
      step3_agrupamento: grouped,
      step3_erro: groupError,
      step4_debts_atuais: debts,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
