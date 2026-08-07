import { NextResponse } from 'next/server';
import { getClientById } from '@/lib/storage-company';
import { getCompanyPool, requireEmpresaFromHeader } from '@/lib/company-db';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { id } = await params;

  try {
    const empresa = requireEmpresaFromHeader(request);
    const pool = await getCompanyPool(empresa);
    const client = await getClientById(pool, id);
    if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

    // 1. Empréstimos da tabela extrator_debts (bancos que expõem conta LOAN)
    const { rows: debtRows } = await pool.query(
      `SELECT id, account_name AS name, type, balance, credit_limit AS creditLimit,
              synced_at AS syncedAt, 'debt_account' AS source
       FROM extrator_debts WHERE client_id = $1`,
      [id]
    );

    // 2. Empréstimos extraídos das transações (ex: Itaú PARCELA GIRO)
    const { rows: txRows } = await pool.query(
      `SELECT
         REGEXP_REPLACE(description, '\\s+\\d+/\\d+', '')        AS "name",
         SUBSTRING(description FROM '\\d+/(\\d+)')::int           AS "totalParcelas",
         MAX(SUBSTRING(description FROM '(\\d+)/\\d+')::int)      AS "ultimaParcelaPaga",
         ROUND(AVG(ABS(amount))::numeric, 2)                      AS "valorMedioParcela",
         ROUND(SUM(ABS(amount))::numeric, 2)                      AS "totalPago",
         ROUND((AVG(ABS(amount)) *
           (SUBSTRING(description FROM '\\d+/(\\d+)')::int
           - MAX(SUBSTRING(description FROM '(\\d+)/\\d+')::int)))::numeric, 2) AS "saldoEstimado",
         MIN(date::date)       AS "inicioParcelas",
         MAX(date::date)       AS "ultimoDebito",
         institution_name      AS "institutionName",
         'transaction_derived' AS source
       FROM extrator_transactions
       WHERE client_id = $1
         AND description ~ '\\d+/\\d+'
         AND (description ILIKE '%PARCELA%' OR description ILIKE '%DEBITO SEGURO%'
              OR description ILIKE '%FINANCIAMENTO%' OR description ILIKE '%PRESTACAO%')
       GROUP BY
         REGEXP_REPLACE(description, '\\s+\\d+/\\d+', ''),
         SUBSTRING(description FROM '\\d+/(\\d+)')::int,
         institution_name
       ORDER BY "saldoEstimado" DESC NULLS LAST`,
      [id]
    );

    return NextResponse.json({
      client: client.name,
      debtAccounts: debtRows,
      loanInstallments: txRows,
      total: debtRows.length + txRows.length,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
