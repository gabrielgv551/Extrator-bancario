import { NextResponse } from 'next/server';
import { getClientById, getItemsByClientId } from '@/lib/storage';
import { getItem, updatePluggyItem, waitForItemUpdate } from '@/lib/pluggy';
import { buildItemStatusUpdates, isItemHealthy, isItemUpdating } from '@/lib/status';
import { syncItemData } from '@/lib/sync-processor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PLUGGY_MIN_UPDATE_FREQUENCY_MS = 60 * 60 * 1000;
const WAIT_FOR_UPDATE_MS = 30_000;

export async function POST(request, { params }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get('itemId') || null;

  try {
    const client = await getClientById(id);
    if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

    const items = await getItemsByClientId(id);
    const toProcess = itemId ? items.filter(i => i.id === itemId) : items;

    if (toProcess.length === 0) {
      return NextResponse.json({ error: 'Nenhuma conta encontrada para atualizar' }, { status: 400 });
    }

    const results = [];

    for (const item of toProcess) {
      let pluggyItem;
      try {
        pluggyItem = await getItem(item.pluggyItemId);
      } catch (err) {
        results.push({ itemId: item.id, bank: item.institutionName, success: false, reason: err.message });
        continue;
      }

      const norm = buildItemStatusUpdates(pluggyItem);

      if (norm.status === 'LOGIN_ERROR') {
        results.push({ itemId: item.id, bank: item.institutionName, success: false, requiresReconnect: true, reason: norm.errorMessage || norm.errorCode });
        continue;
      }

      const lastUpdatedAt = norm.lastUpdatedAt ? new Date(norm.lastUpdatedAt).getTime() : 0;
      const timeSinceUpdate = Date.now() - lastUpdatedAt;

      if (!isItemHealthy(norm.status) && norm.status !== 'OUTDATED') {
        results.push({ itemId: item.id, bank: item.institutionName, success: false, status: norm.status, reason: 'Status não permite atualização' });
        continue;
      }

      if (isItemHealthy(norm.status) && timeSinceUpdate < PLUGGY_MIN_UPDATE_FREQUENCY_MS) {
        results.push({ itemId: item.id, bank: item.institutionName, success: false, reason: `Atualizado há ${Math.round(timeSinceUpdate / 1000)}s. Tente novamente em ${Math.round((PLUGGY_MIN_UPDATE_FREQUENCY_MS - timeSinceUpdate) / 1000)}s.` });
        continue;
      }

      try {
        const patchResult = await updatePluggyItem(item.pluggyItemId);
        if (isItemUpdating(patchResult?.status)) {
          await waitForItemUpdate(item.pluggyItemId, { timeoutMs: WAIT_FOR_UPDATE_MS, intervalMs: 3000 });
        }
      } catch (err) {
        results.push({ itemId: item.id, bank: item.institutionName, success: false, reason: `Falha ao atualizar: ${err.message}` });
        continue;
      }

      const syncResult = await syncItemData(item, { skipIfNotHealthy: true });
      results.push({
        itemId: item.id,
        bank: item.institutionName,
        success: syncResult.success,
        status: syncResult.status,
        transactions: syncResult.transactions,
        reason: syncResult.reason,
      });
    }

    return NextResponse.json({ refreshed_at: new Date().toISOString(), results });
  } catch (error) {
    console.error('[refresh] erro:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
