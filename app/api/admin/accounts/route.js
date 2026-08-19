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
      const empresaNome = nameMap.get(empresa) || empresa;
      const rawAccounts = [];

      for (const client of clients) {
        const items = await getItemsByClientId(pool, client.id);
        for (const item of items) {
          rawAccounts.push({
            empresa,
            empresaNome,
            clientId: client.id,
            clientName: client.name,
            businessTaxId: client.businessTaxId || null,
            item,
          });
        }
      }

      const groups = new Map();

      for (const raw of rawAccounts) {
        const item = raw.item;
        const consentId = item.klaviConsentId || item.pluggyItemId || item.id;
        const groupKey = `${raw.clientId}|${item.institutionName || ''}|${consentId}`;

        if (!groups.has(groupKey)) {
          groups.set(groupKey, []);
        }
        groups.get(groupKey).push(raw);
      }

      const accounts = [];
      for (const group of groups.values()) {
        const base = group[0];
        const items = group.map((g) => g.item);

        const contaItem = pickConta(items);
        const cartaoItem = pickCartao(items);
        const mainItem = contaItem || cartaoItem || items[0];
        const status = normalizeStatus(mainItem);

        accounts.push({
          empresa: base.empresa,
          empresaNome: base.empresaNome,
          clientId: base.clientId,
          clientName: base.clientName,
          businessTaxId: base.businessTaxId,
          bank: mainItem.institutionName || '—',
          conta: contaItem ? formatAccountNumber(contaItem.accountNumbers) : '—',
          cartao: cartaoItem ? formatAccountNumber(cartaoItem.accountNumbers) : '—',
          status: status.label,
          statusType: status.type,
          rawStatus: mainItem.status || '—',
          executionStatus: mainItem.executionStatus || '—',
          errorCode: mainItem.errorCode || null,
          lastSync: base.lastSync,
          itemIds: items.map((i) => i.id),
        });
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

function formatAccountNumber(value) {
  if (!value || value === '—') return '—';
  return String(value).trim();
}

function isCartao(value) {
  if (!value) return false;
  const trimmed = String(value).trim();
  return /^\d{4}$/.test(trimmed);
}

function pickConta(items) {
  const candidatos = items.filter((i) => {
    const num = formatAccountNumber(i.accountNumbers);
    return num !== '—' && !isCartao(num);
  });
  if (candidatos.length === 0) return null;
  // Prioriza o com maior número de syncs (mais estável)
  return candidatos.sort((a, b) => (b.syncCount || 0) - (a.syncCount || 0))[0];
}

function pickCartao(items) {
  const candidatos = items.filter((i) => isCartao(i.accountNumbers));
  return candidatos[0] || null;
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
