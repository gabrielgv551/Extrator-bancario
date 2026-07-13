import { NextResponse } from 'next/server';
import {
  getClients, getItemsByClientId, updateClient,
  acquireSyncLock, releaseSyncLock, refreshSyncLock,
} from '@/lib/storage';
import {
  getItem, updatePluggyItem, waitForItemUpdate,
} from '@/lib/pluggy';
import { buildItemStatusUpdates, isItemHealthy, isItemUpdating } from '@/lib/status';
import { syncItemData } from '@/lib/sync-processor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PLUGGY_MIN_UPDATE_FREQUENCY_MS = 60 * 60 * 1000;
const PATCH_DELAY_MS = 5000;
const LOCK_TTL_MINUTES = 30;
const WAIT_FOR_UPDATE_MS = 180_000; // 3 minutos

export async function GET(request) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const hasSecret = secret && authHeader === `Bearer ${secret}`;
  if (!isVercelCron && !hasSecret) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const filterClientId = searchParams.get('clientId') || null;
  const filterItemId = searchParams.get('itemId') || null;
  const fromOverride = searchParams.get('from') || null;

  // Lock distribuído
  const lock = await acquireSyncLock('sync-cron', LOCK_TTL_MINUTES);
  if (!lock.acquired) {
    return NextResponse.json({ error: 'Sync já está em execução', existing: lock.existing }, { status: 423 });
  }

  try {
    const to = new Date().toISOString().split('T')[0];

    let clients = await getClients();
    if (filterClientId) clients = clients.filter(c => c.id === filterClientId);

    const clientItemsMap = new Map();
    await Promise.all(clients.map(async c => {
      clientItemsMap.set(c.id, await getItemsByClientId(c.id));
    }));

    const work = [];
    for (const client of clients) {
      const items = clientItemsMap.get(client.id) ?? [];
      const filtered = filterItemId ? items.filter(i => i.pluggyItemId === filterItemId) : items;
      for (const item of filtered) work.push({ client, item });
    }

    // PATCH serial para respeitar rate limit de 20/min da Pluggy.
    // Nota: a Pluggy recomenda usar Auto-Sync em produção. Este PATCH é um fallback
    // para itens OUTDATED ou situações onde o Auto-Sync não está disponível.
    const skippedPatch = [];
    for (const { client, item } of work) {
      let pluggyItem;
      try {
        pluggyItem = await getItem(item.pluggyItemId);
      } catch (err) {
        skippedPatch.push({ client: client.name, bank: item.institutionName, reason: `getItem error: ${err.message}` });
        continue;
      }

      const norm = buildItemStatusUpdates(pluggyItem);
      const lastUpdatedAt = norm.lastUpdatedAt ? new Date(norm.lastUpdatedAt).getTime() : 0;
      const timeSinceUpdate = Date.now() - lastUpdatedAt;

      if (norm.status === 'LOGIN_ERROR') {
        skippedPatch.push({ client: client.name, bank: item.institutionName, reason: 'login_error' });
        continue;
      }

      if (isItemUpdating(norm.status)) {
        skippedPatch.push({ client: client.name, bank: item.institutionName, reason: 'already updating' });
        continue;
      }

      const isOutdatedEligible =
        norm.status === 'OUTDATED' &&
        item.consecutiveErrors < 5 &&
        (!item.lastErrorAt || Date.now() - new Date(item.lastErrorAt).getTime() > 60 * 60 * 1000);

      const isPatchable = isItemHealthy(norm.status) || isOutdatedEligible;
      if (!isPatchable) {
        skippedPatch.push({ client: client.name, bank: item.institutionName, reason: norm.status });
        continue;
      }

      if (isItemHealthy(norm.status) && timeSinceUpdate < PLUGGY_MIN_UPDATE_FREQUENCY_MS) {
        skippedPatch.push({ client: client.name, bank: item.institutionName, reason: `updated ${Math.round(timeSinceUpdate / 1000)}s ago` });
        continue;
      }

      try {
        const patchResult = await updatePluggyItem(item.pluggyItemId);
        if (isItemUpdating(patchResult?.status)) {
          await waitForItemUpdate(item.pluggyItemId, { timeoutMs: WAIT_FOR_UPDATE_MS, intervalMs: 3000 });
        }
      } catch (err) {
        skippedPatch.push({ client: client.name, bank: item.institutionName, reason: `patch error: ${err.message}` });
      }

      await new Promise(r => setTimeout(r, PATCH_DELAY_MS));
      await refreshSyncLock(lock.lockId).catch(() => {});
    }

    // Processa todos os itens em paralelo (busca dados e persiste)
    const results = [];
    const settled = await Promise.allSettled(
      work.map(({ item }) => syncItemData(item, { fromOverride, toOverride: to, skipIfNotHealthy: true }))
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(r.value);
      else results.push({ success: false, error: r.reason?.message });
    }

    const syncedClientIds = [...new Set(work.map(({ client }) => client.id))];
    await Promise.allSettled(syncedClientIds.map(async clientId => {
      await updateClient(clientId, { lastSync: new Date().toISOString() });
    }));

    return NextResponse.json({ synced_at: new Date().toISOString(), skipped_patch: skippedPatch, results });
  } finally {
    await releaseSyncLock(lock.lockId).catch(() => {});
  }
}
