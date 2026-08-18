// Solicita um novo relatório de dados da Klavi para a empresa canal40.
// Isso força a Klavi a reenviar as transações, preenchendo o campo balance.
//
// Uso:
//   node --env-file=.env.local scripts/sync-klavi-canal40.mjs

import { getCompanyPool, closeCompanyPools } from '../lib/company-db.js';
import { getClientByGestorEmpresa, getItemByKlaviLinkId } from '../lib/storage-company.js';
import { requestBusinessInstitutionData } from '../lib/klavi.js';

async function main() {
  const empresa = 'canal40';
  const pool = await getCompanyPool(empresa);

  const client = await getClientByGestorEmpresa(pool, empresa);
  if (!client) throw new Error(`Cliente não encontrado para ${empresa}`);

  const item = await getItemByKlaviLinkId(pool, '688f0b9a-a9b8-47c3-89bf-0fbd1bc447bb');
  if (!item) throw new Error('Item Klavi não encontrado');

  console.log('Cliente:', client.name, client.id);
  console.log('Item:', item.id, item.institutionName, item.institutionCode);
  console.log('BusinessTaxId:', item.businessTaxId || client.businessTaxId);
  console.log('Solicitando relatório...');

  const result = await requestBusinessInstitutionData({
    businessTaxId: item.businessTaxId || client.businessTaxId,
    institutionCode: item.institutionCode,
    linkId: item.klaviLinkId,
    consentIds: item.klaviConsentId ? [item.klaviConsentId] : [],
    products: ['pj_categorized_checking_l3', 'pj_categorized_creditcard_l3'],
    productsCallbackUrl: process.env.KLAVI_WEBHOOK_URL || null,
  });

  console.log('Resposta da Klavi:', JSON.stringify(result, null, 2));
}

main()
  .then(async () => {
    await closeCompanyPools();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Erro:', err);
    await closeCompanyPools();
    process.exit(1);
  });
