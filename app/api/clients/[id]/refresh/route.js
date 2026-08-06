import { NextResponse } from 'next/server';
import { getClientById, getItemsByClientId, updateClient, updateItemStatus } from '@/lib/storage';
import { requestBusinessInstitutionData, requestPersonalInstitutionData, getActiveKlaviConsent } from '@/lib/klavi';
import { syncItemData } from '@/lib/sync-processor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request, { params }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get('itemId') || null;

  try {
    const client = await getClientById(id);
    if (!client) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 });

    const items = await getItemsByClientId(id);
    const toProcess = itemId ? items.filter(i => i.id === itemId) : items;
    const klaviItems = toProcess.filter(i => i.provider === 'klavi' || i.klaviLinkId);

    // Se o cliente ainda não tem CNPJ cadastrado, tenta usar o CNPJ dos itens Klavi PJ.
    let clientBusinessTaxId = client.businessTaxId;
    if (!clientBusinessTaxId) {
      const itemCnpjs = [...new Set(klaviItems.map(i => i.businessTaxId).filter(Boolean))];
      if (itemCnpjs.length === 1) {
        clientBusinessTaxId = itemCnpjs[0];
        await updateClient(id, { businessTaxId: clientBusinessTaxId });
        console.log('[refresh] CNPJ do cliente preenchido a partir do item:', clientBusinessTaxId);
      } else if (itemCnpjs.length > 1) {
        return NextResponse.json({ error: 'Itens conectados usam CNPJs diferentes. Cadastre o CNPJ correto no cliente.' }, { status: 400 });
      }
    }
    if (!clientBusinessTaxId) {
      return NextResponse.json({ error: 'Cliente não possui CNPJ cadastrado' }, { status: 400 });
    }

    const results = [];

    console.log('[refresh] cliente=%s totalItens=%d itensKlavi=%d itemIdFilter=%s', client.name, items.length, klaviItems.length, itemId || 'nenhum');
    for (const item of klaviItems) {
      console.log('[refresh] processando item id=%s bank=%s provider=%s taxType=%s linkId=%s consentId=%s institutionCode=%s businessTaxId=%s',
        item.id, item.institutionName, item.provider, item.taxType, item.klaviLinkId, item.klaviConsentId, item.institutionCode, item.businessTaxId || client.businessTaxId);
      const isPF = item.taxType === 'pf';
      const itemBusinessTaxId = item.businessTaxId || clientBusinessTaxId;
      if (!item.klaviLinkId || !item.institutionCode || (!isPF && !itemBusinessTaxId)) {
        results.push({
          itemId: item.id,
          bank: item.institutionName,
          success: false,
          reason: 'Item Klavi incompleto (link, cnpj/cpf ou instituição faltando)',
        });
        continue;
      }

      const activeConsent = await getActiveKlaviConsent({
        item,
        businessTaxId: itemBusinessTaxId,
        personalTaxId: item.personalTaxId || undefined,
      });
      console.log('[refresh] consentimento ativo item=%s consentId=%s linkId=%s products=%j',
        item.id, activeConsent.consentId, activeConsent.linkId, activeConsent.products);

      // Atualiza item local se o consentimento/link ativo mudou.
      const consentUpdates = {};
      if (activeConsent.consentId && activeConsent.consentId !== item.klaviConsentId) consentUpdates.klaviConsentId = activeConsent.consentId;
      if (activeConsent.linkId && activeConsent.linkId !== item.klaviLinkId) consentUpdates.klaviLinkId = activeConsent.linkId;
      if (Object.keys(consentUpdates).length > 0) {
        await updateItemStatus(item.id, consentUpdates);
        console.log('[refresh] item=%s atualizado com %j', item.id, consentUpdates);
      }

      if (!activeConsent.consentId) {
        results.push({
          itemId: item.id,
          bank: item.institutionName,
          success: false,
          reason: 'Nenhum consentimento ativo encontrado para este banco. Reconecte pelo portal.',
        });
        continue;
      }

      const requestBody = {
        institutionCode: item.institutionCode,
        linkId: activeConsent.linkId,
        consentIds: [activeConsent.consentId],
        products: activeConsent.products,
        productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
      };

      try {
        if (isPF) {
          const personalTaxId = item.personalTaxId;
          if (!personalTaxId) {
            results.push({
              itemId: item.id,
              bank: item.institutionName,
              success: false,
              reason: 'CPF não encontrado para conta PF. Reconecte pelo portal informando o CPF.',
            });
            continue;
          }
          console.log('[refresh] solicitando dados Klavi PF:', JSON.stringify({ ...requestBody, personalTaxId }));
          await requestPersonalInstitutionData({ ...requestBody, personalTaxId });
        } else {
          console.log('[refresh] solicitando dados Klavi PJ:', JSON.stringify({ ...requestBody, businessTaxId: itemBusinessTaxId }));
          await requestBusinessInstitutionData({ ...requestBody, businessTaxId: itemBusinessTaxId });
        }

        await updateItemStatus(item.id, { status: 'UPDATING' });

        results.push({
          itemId: item.id,
          bank: item.institutionName,
          success: true,
          status: 'REQUESTED',
          message: 'Solicitação de relatório enviada. Dados chegarão via webhook.',
        });
      } catch (err) {
        console.error('[refresh] erro ao solicitar dados:', err);
        results.push({
          itemId: item.id,
          bank: item.institutionName,
          success: false,
          reason: err.message,
          klaviStatus: err.status,
          klaviCode: err.code,
          klaviBody: err.body,
        });
      }
    }

    // Itens legados Pluggy também são sincronizados (se houver pluggyItemId).
    const legacyItems = toProcess.filter(i => i.provider === 'pluggy' && i.pluggyItemId);
    for (const item of legacyItems) {
      const localItem = {
        id: item.id,
        clientId: item.clientId,
        pluggyItemId: item.pluggyItemId,
        institutionName: item.institutionName,
        institutionLogo: item.institutionLogo,
        accountNumbers: item.accountNumbers,
        status: item.status,
        executionStatus: item.executionStatus,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage,
        lastUpdatedAt: item.lastUpdatedAt,
        lastErrorAt: item.lastErrorAt,
        syncCount: item.syncCount,
        consecutiveErrors: item.consecutiveErrors,
        requiresReconnect: item.requiresReconnect,
        deletedAt: item.deletedAt,
        consentExpiresAt: item.consentExpiresAt,
        notificationSentAt: item.notificationSentAt,
        createdAt: item.createdAt,
      };
      try {
        const result = await syncItemData(localItem, { skipIfNotHealthy: true });
        results.push({
          itemId: item.id,
          bank: item.institutionName,
          success: result.success,
          status: result.status,
          transactions: result.transactions?.total ?? 0,
          reason: result.reason || null,
        });
      } catch (err) {
        console.error('[refresh] erro ao sincronizar item Pluggy:', err);
        results.push({
          itemId: item.id,
          bank: item.institutionName,
          success: false,
          reason: err.message,
        });
      }
    }

    await updateClient(id, { lastSync: new Date().toISOString() });

    return NextResponse.json({ refreshed_at: new Date().toISOString(), results });
  } catch (error) {
    console.error('[refresh] erro:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
