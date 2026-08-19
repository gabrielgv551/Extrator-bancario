import { NextResponse } from 'next/server';
import { forEachCompany, listActiveCompanies } from '@/lib/company-db';
import { getClients, getItemsByClientId } from '@/lib/storage-company';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const activeCompanies = await listActiveCompanies();
    const nameMap = new Map(activeCompanies.map((c) => [c.slug, c.name || c.slug]));

    const results = await forEachCompany(async ({ empresa, pool }) => {
      const clients = await getClients(pool);
      const accounts = [];
      const empresaNome = nameMap.get(empresa) || empresa;

      for (const client of clients) {
        const items = await getItemsByClientId(pool, client.id);
        for (const item of items) {
          const status = normalizeStatus(item);
          accounts.push({
            empresa,
            empresaNome,
            clientId: client.id,
            clientName: client.name,
            businessTaxId: client.businessTaxId || null,
            bank: item.institutionName || '—',
            status: status.label,
            statusType: status.type,
            rawStatus: item.status || '—',
            executionStatus: item.executionStatus || '—',
            errorCode: item.errorCode || null,
            lastSync: client.lastSync,
            itemId: item.id,
          });
        }
      }

      return { empresa, empresaNome, accounts };
    });

    const allAccounts = results.flatMap((r) => (r.accounts ? r.accounts : []));

    return NextResponse.json({ accounts: allAccounts });
  } catch (error) {
    console.error('[admin/accounts] erro:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function normalizeStatus(item) {
  if (item.requiresReconnect || item.status === 'LOGIN_ERROR') {
    const label = item.errorCode && item.errorCode !== 'UNKNOWN'
      ? `Reconectar: ${item.errorCode}`
      : 'Reconectar';
    return { label, type: 'error' };
  }
  if (item.status === 'UPDATING' || item.executionStatus === 'UPDATING') {
    return { label: 'Atualizando', type: 'updating' };
  }
  if (item.status === 'UPDATED' || item.status === 'PARTIAL_SUCCESS') {
    return { label: 'OK', type: 'ok' };
  }
  if (item.status === 'OUTDATED') {
    return { label: 'Desatualizado', type: 'warning' };
  }
  if (item.status === 'WAITING_DATA') {
    return { label: 'Aguardando dados', type: 'waiting' };
  }
  return { label: item.status || 'Pendente', type: 'unknown' };
}
