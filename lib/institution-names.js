// Mapa puro de códigos de instituição financeira → nome de exibição.
// Sem dependências de runtime, pode ser importado tanto no servidor quanto no cliente.

const INSTITUTION_CODE_TO_NAME = {
  // COMPE (código de três dígitos)
  '001': 'Banco do Brasil',
  '033': 'Banco Santander',
  '041': 'Banrisul',
  '070': 'BRB - Banco de Brasília',
  '077': 'Banco Inter',
  '087': 'Banco União',
  '104': 'Caixa Econômica Federal',
  '208': 'Banco BTG Pactual',
  '212': 'Banco Original',
  '218': 'Banco BS2',
  '237': 'Bradesco',
  '260': 'Nu Pagamentos (Nubank)',
  '269': 'Banco União de Crédito Cooperativo',
  '290': 'PagBank',
  '318': 'Banco BMG',
  '323': 'Mercado Pago',
  '335': 'Banco Digio',
  '336': 'Banco C6',
  '341': 'Itaú Unibanco',
  '380': 'PicPay',
  '399': 'HSBC Bank Brasil',
  '422': 'Banco Safra',
  '456': 'Banco MUFG Brasil',
  '464': 'Banco Sumitomo Mitsui Brasileiro',
  '477': 'Citibank N.A.',
  '487': 'Deutsche Bank',
  '488': 'Banco Morgan Stanley',
  '505': 'Banco Credit Suisse',
  '600': 'Banco Luso Brasileiro',
  '604': 'Banco Industrial do Brasil',
  '611': 'Banco Paulista',
  '623': 'Banco Pine',
  '633': 'Banco Rendimento',
  '634': 'Banco Triângulo',
  '655': 'Banco Votorantim',
  '707': 'Banco Daycoval',
  '735': 'Banco Neon',
  '741': 'Banco Ribeirão Preto',
  '745': 'Banco Citibank',
  '748': 'Sicredi',
  '751': 'Banco Scotiabank Brasil',
  '755': 'Banco Merrill Lynch',
  '756': 'SICOOB - Banco Cooperativo do Brasil',
  '1023': 'Banese',
  // ISPBs comuns
  '00000000': 'Banco do Brasil',
  '00360305': 'Caixa Econômica Federal',
  '00416968': 'Banco Inter',
  '00992383': 'Sicredi',
  '01522368': 'Banco Santander',
  '03046391': 'Banco Original',
  '03065958': 'Nu Pagamentos (Nubank)',
  '04014707': 'PagBank',
  '05607647': 'Banco Safra',
  '07626508': 'Banco C6',
  '07693818': 'PicPay',
  '10573521': 'Banco Inter',
  '10741273': 'Banco BTG Pactual',
  '60701190': 'Itaú Unibanco',
  '60746948': 'Bradesco',
  '74828715': 'Sicredi',
  '75644118': 'SICOOB - Banco Cooperativo do Brasil',
  // Nomes normalizados que a Klavi pode usar como institutionCode
  'sicoob': 'SICOOB - Banco Cooperativo do Brasil',
  'sicredi': 'Sicredi',
  'bancoob': 'SICOOB - Banco Cooperativo do Brasil',
  '6341': 'Banco Itaú BBA',
};

const PLACEHOLDER_NAMES = new Set([
  'Banco selecionado no widget Klavi',
  'Banco conectado',
  'Banco em conexão',
  'Banco',
  'Banco desconhecido',
]);

const GENERIC_BANK_NAME_RE = /^banco\s+\d+$/i;

export function isPlaceholderInstitutionName(name) {
  if (!name) return true;
  const trimmed = String(name).trim();
  return PLACEHOLDER_NAMES.has(trimmed) || GENERIC_BANK_NAME_RE.test(trimmed);
}

export function resolveInstitutionNameByCode(institutionCode) {
  if (!institutionCode) return null;
  const code = String(institutionCode).trim();
  return INSTITUTION_CODE_TO_NAME[code] ||
    INSTITUTION_CODE_TO_NAME[code.toLowerCase()] ||
    INSTITUTION_CODE_TO_NAME[code.replace(/\D/g, '')] ||
    null;
}

export function resolveDisplayName(item) {
  if (!item) return 'Banco';
  if (item.institutionName && !isPlaceholderInstitutionName(item.institutionName)) {
    return item.institutionName;
  }
  return resolveInstitutionNameByCode(item.institutionCode) || item.institutionName || 'Banco';
}
