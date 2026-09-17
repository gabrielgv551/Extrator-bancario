// Wrapper do motor de pré-classificação (lib/motor-classificacao.js, copiado do
// Have_SOP) para o Extrator Bancário. Cuida de:
//  - garantir o schema caixa_* no banco da empresa + seed do catálogo de categorias
//  - traduzir o vocabulário de categorias do motor para CLASSIFICACOES (lib/classification.js)
//  - CRUD de regras de classificação por empresa

import { createRequire } from 'module';
import { CLASSIFICACOES, isValidClassificacao } from './classification.js';

const require = createRequire(import.meta.url);
const motor = require('./motor-classificacao');

const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

// Mapa nome-de-conta (normalizado) -> { l1, l2 } conforme CLASSIFICACOES.
const L2_MAP = {};
for (const [l1, l2s] of Object.entries(CLASSIFICACOES)) {
  for (const l2 of l2s) L2_MAP[norm(l2)] = { l1, l2 };
}

// Aliases do vocabulário nativo do motor (Have_SOP) para o plano do Extrator.
const ALIASES = {
  'taxas e juros': { l1: 'Despesa', l2: 'Tarifas Bancárias' },
  'folha de pagamento': { l1: 'Despesa', l2: 'Folha de Pagamento' },
  recebimentos: { l1: 'Receita', l2: 'Vendas' },
  boleto: { l1: 'Despesa', l2: 'Fornecedores' },
  cartao: { l1: 'Despesa', l2: 'Outras Despesas' },
  impostos: { l1: 'Despesa', l2: 'Impostos e Taxas' },
  'aluguel e condominio': { l1: 'Despesa', l2: 'Aluguel e Condomínio' },
  'outras entradas': { l1: 'Receita', l2: 'Outras Receitas' },
  'outras saidas': { l1: 'Despesa', l2: 'Outras Despesas' },
};

// Converte uma categoria vinda do motor para { l1, l2 } do plano do Extrator.
// Aceita "L1 > L2" (formato que gravamos nas regras), nomes de conta diretos
// e aliases do vocabulário nativo. Retorna null quando não há correspondência.
export function mapearCategoria(categoria) {
  if (!categoria) return null;
  const c = String(categoria).trim();
  if (!c || norm(c) === norm('NÃO CLASSIFICADO')) return null;
  const sep = c.includes('>') ? '>' : c.includes('|') ? '|' : null;
  if (sep) {
    const [l1, l2] = c.split(sep).map((s) => s.trim());
    if (isValidClassificacao(l1, l2)) return { l1, l2 };
  }
  const key = norm(c);
  if (L2_MAP[key]) return L2_MAP[key];
  if (ALIASES[key]) return ALIASES[key];
  return null;
}

// Garante as tabelas caixa_* no banco da empresa e semeia o catálogo de
// categorias (todas as contas de CLASSIFICACOES). Idempotente.
export async function garantirSchema(pool, empresa) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS caixa_regras_classificacao (
      id SERIAL PRIMARY KEY,
      empresa VARCHAR(50) NOT NULL,
      descricao_padrao TEXT,
      tipo_padrao VARCHAR(50),
      categoria_l1 VARCHAR(100),
      categoria_l2 VARCHAR(100),
      categoria_l3 VARCHAR(100),
      razao_social_padrao TEXT,
      documento_padrao VARCHAR(50),
      banco_padrao VARCHAR(100),
      categoria_sugerida VARCHAR(100) NOT NULL,
      prioridade INTEGER NOT NULL DEFAULT 0,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      origem VARCHAR(30) DEFAULT 'seed',
      aplicacao VARCHAR(50) NOT NULL DEFAULT 'extrato',
      criado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_caixa_regras_classificacao_empresa ON caixa_regras_classificacao(empresa, ativo, prioridade DESC)`).catch(() => {});
  await pool.query(`
    CREATE TABLE IF NOT EXISTS caixa_extrato_classificacoes (
      id SERIAL PRIMARY KEY,
      empresa TEXT NOT NULL,
      origem TEXT NOT NULL,
      transacao_id TEXT NOT NULL,
      categoria TEXT,
      sugerido_por TEXT,
      confirmado BOOLEAN DEFAULT FALSE,
      atualizado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE (empresa, origem, transacao_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_caixa_extrato_classificacoes_empresa ON caixa_extrato_classificacoes(empresa)`).catch(() => {});
  await pool.query(`
    CREATE TABLE IF NOT EXISTS caixa_categorias (
      empresa VARCHAR(50) NOT NULL,
      nome VARCHAR(100) NOT NULL,
      tipo VARCHAR(20) NOT NULL DEFAULT 'item',
      ordem INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (empresa, nome)
    )
  `);

  const nomes = [];
  let ordem = 0;
  for (const l2s of Object.values(CLASSIFICACOES)) {
    for (const l2 of l2s) nomes.push([empresa, l2, 'item', ordem++]);
  }
  if (nomes.length) {
    const values = nomes.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(', ');
    const flat = nomes.flat();
    await pool.query(
      `INSERT INTO caixa_categorias (empresa, nome, tipo, ordem) VALUES ${values} ON CONFLICT (empresa, nome) DO NOTHING`,
      flat
    );
  }
}

// Calcula sugestões para um lote de transações do extrator.
// transactions: array com { id, source ('bank'|'credit'), description, type,
// amount, categoryL1/L2/L3, counterpartyName, counterpartyDocument, institutionName }.
// Retorna Map<txId, { l1, l2, confianca, origem } | null>.
export async function sugerirLote(pool, empresa, transactions) {
  if (!transactions.length) return new Map();
  const cache = await motor.carregarCacheClassificacao(pool, empresa, 'extrato');
  const resultado = new Map();
  for (const tx of transactions) {
    const sugestao = motor.calcularSugestaoComCache(cache, {
      descricao: tx.description,
      tipo: tx.type === 'CREDIT' ? 'Entrada' : 'Saída',
      razao_social: tx.counterpartyName || null,
      documento: tx.counterpartyDocument || null,
      banco: tx.institutionName || null,
      categoria_l1: tx.categoryL1 || null,
      categoria_l2: tx.categoryL2 || null,
      categoria_l3: tx.categoryL3 || null,
      valor: tx.amount,
    });
    const mapeada = mapearCategoria(sugestao.categoria);
    resultado.set(tx.id, mapeada ? { ...mapeada, confianca: sugestao.confianca, origem: sugestao.origem } : null);
  }
  return resultado;
}

// Sugestão pontual para o formulário de regras ("✨ Sugerir").
// data: { descricao, tipo ('Entrada'|'Saída'), razao_social, documento, banco }.
export async function sugerirCategoria(pool, empresa, data) {
  const sugestao = await motor.suggestCategoriaForContraparte(pool, empresa, {
    aplicacao: 'extrato',
    descricao: data.descricao || null,
    tipo: data.tipo || null,
    razao_social: data.razao_social || null,
    documento: data.documento || null,
    banco: data.banco || null,
  });
  const mapeada = mapearCategoria(sugestao.categoria);
  return { ...sugestao, classificacao: mapeada };
}

export async function listarRegras(pool, empresa) {
  const r = await pool.query(
    `SELECT * FROM caixa_regras_classificacao
     WHERE empresa = $1 AND aplicacao = 'extrato'
     ORDER BY ativo DESC, prioridade DESC, id ASC`,
    [empresa]
  );
  return r.rows;
}

// Converte { l1, l2 } (ou classificacaoSugerida já em texto) para o texto
// gravado em categoria_sugerida: "L1 > L2".
function formatarCategoriaSugerida(regra) {
  if (regra.categoria_sugerida) return String(regra.categoria_sugerida).trim();
  if (regra.l1 && regra.l2) return `${regra.l1} > ${regra.l2}`;
  throw new Error('Categoria sugerida é obrigatória.');
}

export async function criarRegra(pool, empresa, regra) {
  garantirValida(regra);
  return motor.upsertRegraClassificacao(pool, empresa, {
    aplicacao: 'extrato',
    descricao_padrao: regra.descricao_padrao || null,
    tipo_padrao: regra.tipo_padrao || null,
    categoria_l1: regra.categoria_l1 || null,
    categoria_l2: regra.categoria_l2 || null,
    categoria_l3: regra.categoria_l3 || null,
    razao_social_padrao: regra.razao_social_padrao || null,
    documento_padrao: regra.documento_padrao || null,
    banco_padrao: regra.banco_padrao || null,
    categoria_sugerida: formatarCategoriaSugerida(regra),
    prioridade: regra.prioridade != null ? regra.prioridade : undefined,
    ativo: regra.ativo !== false,
    origem: 'manual',
  });
}

function garantirValida(regra) {
  if (!regra.categoria_sugerida) {
    if (!isValidClassificacao(regra.l1, regra.l2)) {
      throw new Error('Classificação inválida. Escolha um grupo (Receita/Despesa) e uma conta.');
    }
  }
  const temCondicao =
    regra.descricao_padrao || regra.tipo_padrao || regra.razao_social_padrao ||
    regra.documento_padrao || regra.banco_padrao;
  if (!temCondicao) {
    throw new Error('Informe ao menos uma condição (descrição, tipo, razão social, documento ou banco).');
  }
}

export async function atualizarRegra(pool, empresa, id, patch) {
  const atual = await pool.query(
    `SELECT * FROM caixa_regras_classificacao WHERE id = $1 AND empresa = $2 AND aplicacao = 'extrato'`,
    [id, empresa]
  );
  if (!atual.rows.length) throw new Error('Regra não encontrada.');
  const regra = { ...atual.rows[0], ...patch };
  garantirValida({ ...regra, categoria_sugerida: regra.categoria_sugerida });
  const categoriaSugerida = patch.categoria_sugerida || patch.l1
    ? formatarCategoriaSugerida({ categoria_sugerida: patch.categoria_sugerida, l1: patch.l1, l2: patch.l2 })
    : regra.categoria_sugerida;
  const prioridade = patch.prioridade != null
    ? patch.prioridade
    : motor.calcularPrioridade({ ...regra, categoria_sugerida: categoriaSugerida });
  const r = await pool.query(
    `UPDATE caixa_regras_classificacao
     SET descricao_padrao = $3, tipo_padrao = $4, categoria_l1 = $5, categoria_l2 = $6,
         categoria_l3 = $7, razao_social_padrao = $8, documento_padrao = $9, banco_padrao = $10,
         categoria_sugerida = $11, prioridade = $12, ativo = $13, origem = 'manual',
         atualizado_em = CURRENT_TIMESTAMP
     WHERE id = $1 AND empresa = $2
     RETURNING *`,
    [
      id, empresa,
      regra.descricao_padrao || null,
      regra.tipo_padrao || null,
      regra.categoria_l1 || null,
      regra.categoria_l2 || null,
      regra.categoria_l3 || null,
      regra.razao_social_padrao || null,
      regra.documento_padrao || null,
      regra.banco_padrao || null,
      categoriaSugerida,
      prioridade,
      regra.ativo !== false,
    ]
  );
  return r.rows[0];
}

export async function excluirRegra(pool, empresa, id) {
  const r = await pool.query(
    `DELETE FROM caixa_regras_classificacao WHERE id = $1 AND empresa = $2 AND aplicacao = 'extrato' RETURNING id`,
    [id, empresa]
  );
  if (!r.rows.length) throw new Error('Regra não encontrada.');
  return { ok: true };
}
