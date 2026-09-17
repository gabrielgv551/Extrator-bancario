/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MOTOR DE CLASSIFICAÇÃO DE CAIXA — pacote autocontido
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Propósito
 * ---------
 * Motor único de classificação de lançamentos de extrato (EM QUAL categoria o
 * lançamento aparece) e de regras de consumo do modelo (SE o lançamento
 * participa do modelo). Consolidado a partir de:
 *
 *   - have-gestor-api/lib/caixa-classificacao.js   (Seção CLASSIFICAÇÃO)
 *   - have-gestor-api/lib/classificacao-oficial.js (Seção OFICIAL)
 *   - have-gestor-api/lib/caixa-regras-consumo.js  (Seção CONSUMO)
 *   - have-gestor-api/lib/routes/caixa-extrato.js  (Seção HTTP — regras de
 *     classificação e confirmação de classificação)
 *   - have-gestor-api/lib/routes/caixa-regras-consumo.js (Seção HTTP — regras
 *     de consumo)
 *
 * Única dependência: `crypto` (Node.js built-in). Não há outros require().
 *
 * Schema necessário (PostgreSQL — ver schema.sql deste pacote)
 * ------------------------------------------------------------
 * Obrigatórias para o motor completo:
 *   - caixa_regras_classificacao      (migrações 109, 110, 111)
 *   - caixa_extrato_classificacoes    (migração 112)
 *   - caixa_regras_consumo            (migração 117)
 *   - caixa_regras_consumo_config     (migração 117)
 *   - caixa_regras_consumo_auditoria  (migração 117)
 *   - caixa_categorias                (tabela de categorias do tenant)
 *   - caixa_contrapartes              (tabela de contrapartes do tenant)
 *
 * Somente para carregarLancamentosExtrato() / preview de consumo:
 *   - caixa_extrato                   (lançamentos manuais/pluggy)
 *   - extrator_all_transactions       (lançamentos openfinance)
 *   - extrator_items / extrator_clients (joins do extrator openfinance)
 *   - caixa_extrato_tratamentos       (inclusões/exclusões manuais no preview)
 *   - caixa_bancos                    (resolução do nome do banco no filtro)
 *
 * Contrato dos handlers HTTP
 * --------------------------
 *   async function handler(req, res, ctx)
 *
 *   ctx.pool    — Pool pg já autenticado/verificado do tenant (pg.Pool ou
 *                 objeto compatível com .query(sql, params) e .connect()).
 *   ctx.company — slug do tenant (string, já normalizada em lower case).
 *   ctx.user    — (opcional) payload do token do usuário; usa .email/.sub
 *                 para preencher campos de auditoria (criado_por etc.).
 *
 * O sistema hospedeiro é responsável por CORS, autenticação e resolução do
 * pool antes de chamar o handler. req/res seguem o estilo Express/Vercel
 * (req.method, req.query, req.body; res.status(n).json(obj) / res.json(obj)).
 *
 * Exemplo de montagem em Express:
 *
 *   const express = require('express');
 *   const motor = require('./motor-classificacao');
 *
 *   const app = express();
 *   app.use(express.json());
 *
 *   // middleware de autenticação hipotético: resolve pool/company/user
 *   function autenticar(req, res, next) {
 *     req.ctx = { pool: resolverPoolDoTenant(req), company: req.tenant, user: req.user };
 *     next();
 *   }
 *
 *   app.all('/api/caixa-regras-classificacao', autenticar,
 *     (req, res) => motor.http.handleRegrasClassificacao(req, res, req.ctx));
 *   app.all('/api/caixa-extrato-confirmar-classificacao', autenticar,
 *     (req, res) => motor.http.handleConfirmarClassificacao(req, res, req.ctx));
 *   app.all('/api/caixa-regras-consumo', autenticar,
 *     (req, res) => motor.http.handleRegrasConsumo(req, res, req.ctx));
 *
 *   app.listen(3000);
 *
 * Uso das funções de biblioteca (fora de HTTP):
 *
 *   const motor = require('./motor-classificacao');
 *   const sugestao = await motor.suggestCategoriaForContraparte(pool, company, {
 *     nome: 'ACME LTDA', documento: '12345678000199', descricao: 'Pix recebido',
 *     tipo: 'Entrada', categoria_l1: '', categoria_l2: '', categoria_l3: '',
 *     banco: 'Banco X', valor: 150000
 *   });
 *   const ctx = await motor.carregarContextoConsumo(pool, company, 'EXTRATO_REALIZADO');
 *   const decisao = ctx.habilitado
 *     ? ctx.decidir({ status: 'completed', descricao: 'Tarifa', valor: -12.9 })
 *     : { compoe: true, origem_decisao: 'PADRAO' };
 */
// ═══════════════════════════════════════════════════════════════════════════
// SEÇÃO CLASSIFICAÇÃO — cópia verbatim de have-gestor-api/lib/caixa-classificacao.js
// ═══════════════════════════════════════════════════════════════════════════

// Sugestão automática de classificação para contrapartes
// Ordem de avaliação (da mais específica para a mais genérica):
// 1. Regras de classificação da tabela caixa_regras_classificacao
// 2. Categoria hierárquica do extrato (category_l1/l2/l3)
// 3. Padrão por banco + tipo/descrição
// 4. Fallback: NÃO CLASSIFICADO

function normalizeDoc(doc) {
  return String(doc || '').replace(/\D/g, '');
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function containsAny(haystack, needles) {
  const h = normalizeText(haystack);
  return needles.some((n) => h.includes(normalizeText(n)));
}

function matchRuleField(value, pattern) {
  if (!pattern) return true; // campo vazio na regra = não restringe
  const vNorm = normalizeText(value);
  const pNorm = normalizeText(pattern);
  if (!vNorm) return false; // regra exige campo, mas valor está vazio
  return vNorm.includes(pNorm) || pNorm.includes(vNorm);
}

function matchTipo(value, pattern) {
  if (!pattern) return true;
  const vNorm = normalizeText(value);
  const pNorm = normalizeText(pattern);
  const entradas = ['entrada', 'credit', 'credito', 'receita'];
  const saidas = ['saida', 'saída', 'debit', 'debito', 'despesa'];
  const vEhEntrada = entradas.some((e) => vNorm.includes(e));
  const vEhSaida = saidas.some((s) => vNorm.includes(s));
  const pEhEntrada = entradas.some((e) => pNorm.includes(e));
  const pEhSaida = saidas.some((s) => pNorm.includes(s));
  if (pEhEntrada && vEhEntrada) return true;
  if (pEhSaida && vEhSaida) return true;
  return vNorm.includes(pNorm) || pNorm.includes(vNorm);
}

/**
 * Carrega em lote tudo o que o cálculo de sugestão precisa, UMA única vez
 * por tenant/aplicação — elimina o padrão N+1 (regras + histórico + categorias
 * eram consultados a cada lançamento).
 *
 * @returns {Promise<{aplicacao:string, regras:Array, regrasHistorico:Array, categorias:Set<string>}>}
 */
async function carregarCacheClassificacao(pool, company, aplicacao = 'extrato') {
  const [rulesR, allRulesR, catR] = await Promise.all([
    pool.query(
      `SELECT descricao_padrao, tipo_padrao, categoria_l1, categoria_l2, categoria_l3,
              razao_social_padrao, documento_padrao, banco_padrao, categoria_sugerida,
              prioridade, id
       FROM caixa_regras_classificacao
       WHERE empresa=$1 AND ativo=TRUE AND aplicacao=$2
       ORDER BY prioridade DESC, id ASC`,
      [company, aplicacao]
    ).catch((e) => { console.error('[REGRAS] erro ao buscar:', e.message); return { rows: [] }; }),
    // Histórico de regras para fallback por contraparte: replica o filtro do SQL
    // antigo (apenas empresa, sem filtro de ativo/aplicacao), com valores em
    // lower+trim SEM remover acentos — exatamente como o LIKE do PostgreSQL.
    pool.query(
      `SELECT razao_social_padrao, descricao_padrao, categoria_sugerida
       FROM caixa_regras_classificacao
       WHERE empresa=$1`,
      [company]
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT nome FROM caixa_categorias WHERE empresa=$1 AND tipo='item'`,
      [company]
    ).catch(() => ({ rows: [] })),
  ]);

  return {
    aplicacao,
    regras: rulesR.rows,
    regrasHistorico: allRulesR.rows,
    categorias: new Set(catR.rows.map((row) => normalizeText(row.nome))),
  };
}

function resolveCategoriaExtrato(data) {
  // extrato_openfinance tem apenas 'categoria'; extrator_all_transactions tem l1/l2/l3.
  // Se nao houver l1/l2/l3, considera 'categoria' como l1 para fins de matching.
  return {
    categoria_l1: data.categoria_l1 || data.categoria || '',
    categoria_l2: data.categoria_l2 || '',
    categoria_l3: data.categoria_l3 || ''
  };
}

/**
 * Persiste sugestões automáticas de classificação em lote, de forma idempotente.
 *
 * Estratégia: UNNEST com arrays explicitamente tipados ($n::text[]). Evita o
 * problema de inferência de tipos de VALUES multi-linha com parâmetros sem
 * cast (erro "could not determine data type of parameter $N").
 *
 * Proteção de hierarquia (nunca sobrescreve confirmação manual):
 *   - ON CONFLICT só atualiza linhas com confirmado = FALSE;
 *   - confirmado é sempre FALSE neste insert (sugestão automática);
 *   - classificações confirmadas manualmente são preservadas integralmente.
 *
 * @param {Pool} pool
 * @param {string} company
 * @param {Array<{origem:string, transacao_id:string, categoria:string|null, sugerido_por:string|null}>} items
 * @param {number} [chunkSize] tamanho máximo de cada INSERT (padrão 500)
 * @returns {Promise<{inserted:number, updated:number, total:number}>}
 * @throws Erro do PostgreSQL NÃO é engolido; o chamador decide como responder.
 */
async function persistirSugestoesClassificacao(pool, company, items, chunkSize = 500) {
  const lista = (items || []).filter((it) => it && it.origem && it.transacao_id);
  if (!lista.length) return { inserted: 0, updated: 0, total: 0 };

  const CHUNK = Math.max(1, Math.min(2000, Number(chunkSize) || 500));
  let inserted = 0;
  let updated = 0;

  for (let i = 0; i < lista.length; i += CHUNK) {
    const chunk = lista.slice(i, i + CHUNK);
    const r = await pool.query(
      `INSERT INTO caixa_extrato_classificacoes
         (empresa, origem, transacao_id, categoria, sugerido_por, confirmado, atualizado_em)
       SELECT u.empresa, u.origem, u.transacao_id, u.categoria, u.sugerido_por, FALSE, NOW()
       FROM UNNEST(
         $1::text[],
         $2::text[],
         $3::text[],
         $4::text[],
         $5::text[]
       ) AS u(empresa, origem, transacao_id, categoria, sugerido_por)
       ON CONFLICT (empresa, origem, transacao_id) DO UPDATE SET
         categoria = EXCLUDED.categoria,
         sugerido_por = EXCLUDED.sugerido_por,
         atualizado_em = NOW()
       WHERE caixa_extrato_classificacoes.confirmado = FALSE
       RETURNING (xmax = 0) AS foi_inserido`,
      [
        chunk.map(() => company),
        chunk.map((it) => String(it.origem)),
        chunk.map((it) => String(it.transacao_id)),
        chunk.map((it) => (it.categoria == null ? null : String(it.categoria))),
        chunk.map((it) => (it.sugerido_por == null ? null : String(it.sugerido_por))),
      ]
    );
    for (const row of r.rows) {
      if (row.foi_inserido) inserted++;
      else updated++;
    }
  }

  return { inserted, updated, total: inserted + updated };
}

async function upsertClassificacao(pool, company, { origem, transacao_id, categoria, sugerido_por, confirmado }) {
  const r = await pool.query(
    `INSERT INTO caixa_extrato_classificacoes
       (empresa, origem, transacao_id, categoria, sugerido_por, confirmado, atualizado_em)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (empresa, origem, transacao_id)
     DO UPDATE SET
       categoria = COALESCE(EXCLUDED.categoria, caixa_extrato_classificacoes.categoria),
       sugerido_por = COALESCE(EXCLUDED.sugerido_por, caixa_extrato_classificacoes.sugerido_por),
       confirmado = EXCLUDED.confirmado,
       atualizado_em = NOW()
     RETURNING origem, transacao_id, categoria, sugerido_por, confirmado`,
    [company, origem, String(transacao_id), categoria || null, sugerido_por || null, confirmado === true]
  );
  return r.rows[0];
}

/**
 * Versão síncrona do matching de regras, operando sobre o cache carregado por
 * carregarCacheClassificacao. Mesma semântica da antiga consulta por lançamento:
 * regra por documento é decisiva; demais regras exigem que todos os campos
 * preenchidos casuem; primeira regra em prioridade DESC / id ASC ganha.
 */
function matchRegrasComCache(cache, data) {
  const doc = normalizeDoc(data.documento);
  const catExtrato = resolveCategoriaExtrato(data);

  for (const rule of cache.regras) {
    const ruleDoc = normalizeDoc(rule.documento_padrao);

    // Regra por documento é decisiva
    if (ruleDoc) {
      if (!doc || doc !== ruleDoc) continue;
      return { categoria: rule.categoria_sugerida, origem: 'regra_doc', confianca: 0.98 };
    }

    // Demais regras: todos os campos preenchidos na regra devem casar
    const matches = [
      matchRuleField(data.descricao, rule.descricao_padrao),
      matchTipo(data.tipo, rule.tipo_padrao),
      matchRuleField(catExtrato.categoria_l1, rule.categoria_l1),
      matchRuleField(catExtrato.categoria_l2, rule.categoria_l2),
      matchRuleField(catExtrato.categoria_l3, rule.categoria_l3),
      matchRuleField(data.nome, rule.razao_social_padrao),
      matchRuleField(data.banco, rule.banco_padrao)
    ];

    if (matches.every(Boolean)) {
      // Confiança varia com a especificidade (campos preenchidos)
      const camposPreenchidos = [
        rule.descricao_padrao, rule.tipo_padrao, rule.categoria_l1, rule.categoria_l2,
        rule.categoria_l3, rule.razao_social_padrao, rule.banco_padrao
      ].filter(Boolean).length;
      const confianca = Math.min(0.95, 0.5 + camposPreenchidos * 0.08);
      return { categoria: rule.categoria_sugerida, origem: 'regra', confianca };
    }
  }

  return null;
}

/**
 * Versão em memória do fallback por categoria do extrato + histórico de regras.
 * Replica a semântica do SQL antigo: valores das regras em lower+trim SEM
 * remoção de acentos (como o LIKE do PostgreSQL); agulha é normalizeText(nome).
 */
function findCategoriaExtratoComCache(cache, { nome, categoria_l1, categoria_l2, categoria_l3, categoria }) {
  const nomeNorm = normalizeText(nome);
  const catExtrato = { categoria_l1: categoria_l1 || categoria || '', categoria_l2, categoria_l3 };

  // 1. Pré-classificação do extrato: busca categoria_l1/l2/l3 direto
  for (const cat of [catExtrato.categoria_l1, catExtrato.categoria_l2, catExtrato.categoria_l3]) {
    if (!cat) continue;
    const catNorm = normalizeText(cat);
    for (const existing of cache.categorias) {
      if (existing === catNorm || catNorm.includes(existing) || existing.includes(catNorm)) {
        return { categoria: existing.toUpperCase(), origem: 'extrato', confianca: 0.85 };
      }
    }
  }

  // 2. Categoria com base no histórico de regras para a mesma contraparte
  const contagem = new Map();
  for (const rule of cache.regrasHistorico) {
    const rs = String(rule.razao_social_padrao || '').toLowerCase().trim();
    const dp = String(rule.descricao_padrao || '').toLowerCase().trim();
    if (rs.includes(nomeNorm) || dp.includes(nomeNorm)) {
      const cat = rule.categoria_sugerida;
      if (cat && String(cat).trim() !== '') contagem.set(cat, (contagem.get(cat) || 0) + 1);
    }
  }

  if (contagem.size) {
    const melhor = [...contagem.entries()].sort((a, b) => (b[1] - a[1]) || String(a[0]).localeCompare(String(b[0])))[0][0];
    const catNorm = normalizeText(melhor);
    for (const existing of cache.categorias) {
      if (existing === catNorm || catNorm.includes(existing) || existing.includes(catNorm)) {
        return { categoria: existing.toUpperCase(), origem: 'extrato', confianca: 0.75 };
      }
    }
  }

  return null;
}

/**
 * Cálculo de sugestão síncrono, usando cache pré-carregado.
 * Hierarquia: regra → extrato → padrão banco → NÃO CLASSIFICADO.
 */
function calcularSugestaoComCache(cache, data) {
  let result = matchRegrasComCache(cache, { ...data, aplicacao: data.aplicacao || cache.aplicacao });
  if (result) return result;

  result = findCategoriaExtratoComCache(cache, data);
  if (result) return result;

  result = findCategoriaPadrao(data);
  if (result) return result;

  return fallbackCategoria(data);
}

function findCategoriaPadrao({ descricao, tipo, banco, valor }) {
  const descNorm = normalizeText(descricao);
  const tipoNorm = normalizeText(tipo);
  const valorNum = Number(valor) || 0;

  const isEntrada = valorNum >= 0;

  // Taxas / tarifas / juros
  if (containsAny(descricao, ['tarifa', 'iof', 'juros', 'encargo', 'taxa', 'pacote tarifa'])) {
    return { categoria: 'TAXAS E JUROS', origem: 'padrao_banco', confianca: 0.6 };
  }

  // Folha de pagamento
  if (containsAny(descricao, ['folha', 'pagamento salario', 'salario', 'rescisao', 'adiantamento salarial'])) {
    return { categoria: 'FOLHA DE PAGAMENTO', origem: 'padrao_banco', confianca: 0.6 };
  }

  // Boletos / transferências / PIX / TED
  if (containsAny(descricao, ['boleto', 'pix', 'ted', 'transferencia', 'doc'])) {
    if (isEntrada) {
      return { categoria: 'RECEBIMENTOS', origem: 'padrao_banco', confianca: 0.55 };
    }
    return { categoria: 'BOLETO', origem: 'padrao_banco', confianca: 0.55 };
  }

  // Cartão
  if (containsAny(descricao, ['cartao', 'debito', 'credito']) || tipoNorm.includes('cartao')) {
    return { categoria: 'CARTAO', origem: 'padrao_banco', confianca: 0.55 };
  }

  // Impostos / Tributos
  if (containsAny(descricao, ['imposto', 'tributo', 'simples nacional', 'irrf', 'pis', 'cofins', 'icms', 'iss'])) {
    return { categoria: 'IMPOSTOS', origem: 'padrao_banco', confianca: 0.6 };
  }

  // Aluguel / serviços
  if (containsAny(descricao, ['aluguel', 'locacao', 'condominio'])) {
    return { categoria: 'ALUGUEL E CONDOMINIO', origem: 'padrao_banco', confianca: 0.55 };
  }

  return null;
}

function fallbackCategoria() {
  // O usuário quer um grupo específico para manutenção quando não houver regra.
  return { categoria: 'NÃO CLASSIFICADO', origem: 'fallback', confianca: 0.2 };
}

function calcularPrioridade(regra) {
  // Documento é o mais específico. Quanto mais campos preenchidos, maior a prioridade.
  if (regra.documento_padrao) return 100;
  const campos = [
    regra.descricao_padrao, regra.tipo_padrao, regra.categoria_l1,
    regra.categoria_l2, regra.categoria_l3, regra.razao_social_padrao, regra.banco_padrao
  ].filter(Boolean).length;
  return Math.min(95, 30 + campos * 10);
}

function matchConditionSql() {
  const cols = [
    'descricao_padrao', 'tipo_padrao', 'categoria_l1', 'categoria_l2', 'categoria_l3',
    'razao_social_padrao', 'documento_padrao', 'banco_padrao'
  ];
  return cols
    .map((c, i) => `COALESCE(r.${c}, '') = COALESCE($${i + 3}, '')`)
    .join(' AND ');
}

async function upsertRegraClassificacao(pool, company, regra) {
  const fields = {
    empresa: company,
    aplicacao: regra.aplicacao || 'extrato',
    descricao_padrao: regra.descricao_padrao || null,
    tipo_padrao: regra.tipo_padrao || null,
    categoria_l1: regra.categoria_l1 || null,
    categoria_l2: regra.categoria_l2 || null,
    categoria_l3: regra.categoria_l3 || null,
    razao_social_padrao: regra.razao_social_padrao || null,
    documento_padrao: normalizeDoc(regra.documento_padrao) || null,
    banco_padrao: regra.banco_padrao || null,
    categoria_sugerida: regra.categoria_sugerida,
    prioridade: regra.prioridade != null ? regra.prioridade : calcularPrioridade(regra),
    ativo: regra.ativo !== false,
    origem: regra.origem || 'manual',
    atualizado_em: new Date().toISOString()
  };

  const cols = Object.keys(fields);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const values = cols.map(c => fields[c]);

  // Verifica se já existe uma regra equivalente (NULL = vazio) na mesma aplicação
  const matchCols = ['aplicacao', 'descricao_padrao', 'tipo_padrao', 'categoria_l1', 'categoria_l2', 'categoria_l3', 'razao_social_padrao', 'documento_padrao', 'banco_padrao'];
  const matchParams = matchCols.map(c => fields[c]);
  const existingR = await pool.query(
    `SELECT id FROM caixa_regras_classificacao AS r
     WHERE r.empresa = $1 AND r.aplicacao = $2 AND ${matchConditionSql()}`,
    [company, fields.aplicacao, ...matchParams.slice(1)]
  );

  if (existingR.rows.length) {
    const id = existingR.rows[0].id;
    const updateCols = cols.filter(c => c !== 'empresa' && c !== 'id');
    const updatePlaceholders = updateCols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const updateR = await pool.query(
      `UPDATE caixa_regras_classificacao
       SET ${updatePlaceholders}
       WHERE id = $1 AND empresa = $${updateCols.length + 2}
       RETURNING *`,
      [id, ...updateCols.map(c => fields[c]), company]
    );
    return updateR.rows[0];
  }

  const insertR = await pool.query(
    `INSERT INTO caixa_regras_classificacao (${cols.join(', ')})
     VALUES (${placeholders})
     RETURNING *`,
    values
  );
  return insertR.rows[0];
}

async function suggestCategoriaForContraparte(pool, company, data) {
  // Aplicação padrão é 'extrato'; outras: contas_pagar, pedidos_compra, vendas
  const cache = await carregarCacheClassificacao(pool, company, data.aplicacao || 'extrato');
  return calcularSugestaoComCache(cache, data);
}

/**
 * Extrai a razão social efetiva de um lançamento: usa o campo razao_social
 * quando presente; caso contrário tenta o trecho após o separador '·' da
 * descrição (padrão usado em descrições bancárias).
 */
function extrairRazaoSocialEfetiva(row) {
  if (row.razao_social) return row.razao_social;
  const parts = String(row.descricao || '').split('·');
  return parts.length > 1 ? parts.slice(1).join('·').trim() : '';
}

/**
 * Carrega lançamentos do extrato (manual/pluggy + openfinance) para um
 * período, usando a mesma query em todos os consumidores (tela e rotinas).
 * Não aplica sugestões nem tratamentos — retorna os dados brutos.
 */
async function carregarLancamentosExtrato(pool, company, { ano, mes, bancoId = null } = {}) {
  // Lançamentos openfinance não possuem banco_id (coluna NULL); o vínculo é
  // pelo nome da instituição. Resolve o nome do banco selecionado para filtrar
  // o branch do extrator com comparação normalizada.
  let ofBancoNome = null;
  if (bancoId) {
    const bR = await pool.query('SELECT nome FROM caixa_bancos WHERE id=$1 AND empresa=$2', [bancoId, company]);
    ofBancoNome = bR.rows[0]?.nome || null;
  }
  const params = bancoId ? [company, ano, mes, bancoId, ofBancoNome] : [company, ano, mes];
  const filtroBancoManual = bancoId ? 'AND e.banco_id = $4' : '';
  // banco inexistente no cadastro => nenhum lançamento openfinance pertence a ele;
  // caso contrário filtra pela instituição (lower/trim dos dois lados).
  const filtroBancoOf = bancoId
    ? (ofBancoNome
        ? "AND LOWER(TRIM(COALESCE(ext.institution_name,''))) = LOWER(TRIM($5))"
        : 'AND FALSE')
    : '';
  const { rows } = await pool.query(
    `SELECT e.id::text AS id, CASE WHEN e.belvo_tx_id IS NULL THEN 'manual' ELSE 'pluggy' END AS origem,
            FALSE AS exclusao_automatica, NULL::text AS motivo_automatico,
            e.dia, e.descricao, e.razao_social, e.account_number,
            e.counterparty_document, e.valor,
            e.belvo_tx_id, e.banco_id, b.nome AS banco_nome,
            e.atualizado_em,
            NULL::text AS categoria_extrato,
            NULL::text AS categoria_l1,
            NULL::text AS categoria_l2,
            NULL::text AS categoria_l3,
            NULL::text AS of_status, NULL::text AS of_origem, NULL::text AS of_tipo_conta,
            FALSE AS of_transferencia
     FROM caixa_extrato e
     LEFT JOIN caixa_bancos b ON b.id = e.banco_id
     WHERE e.empresa=$1 AND e.ano=$2 AND e.mes=$3
       ${filtroBancoManual}

     UNION ALL

     SELECT ext.id::text AS id, 'openfinance' AS origem,
            FALSE AS exclusao_automatica, NULL::text AS motivo_automatico,
            EXTRACT(DAY FROM ext.date)::int AS dia,
            ext.description AS descricao,
            ext.razao_social,
            ext.account_number,
            ext.counterparty_document,
            ROUND(ext.amount * 100)::int AS valor,
            ext.id::text AS belvo_tx_id,
            NULL::int AS banco_id,
            ext.institution_name AS banco_nome,
            ext.synced_at AS atualizado_em,
            ext.category AS categoria_extrato,
            ext.category_l1,
            ext.category_l2,
            ext.category_l3,
            ext.status AS of_status,
            ext.source AS of_origem,
            ext.account_type AS of_tipo_conta,
            (ext.category = 'TRANSFERENCIA_MESMA_INSTITUICAO' OR EXISTS (
               SELECT 1 FROM extrator_items i WHERE i.client_id = ext.client_id
                 AND REGEXP_REPLACE(COALESCE(i.business_tax_id,''), '\\D','','g') <> ''
                 AND REGEXP_REPLACE(COALESCE(i.business_tax_id,''), '\\D','','g')
                   = REGEXP_REPLACE(COALESCE(ext.counterparty_document,''), '\\D','','g')
             )) AS of_transferencia
     FROM extrator_all_transactions ext
     LEFT JOIN extrator_clients c ON c.id = ext.client_id
     WHERE LOWER(TRIM(COALESCE(c.gestor_empresa, c.name))) LIKE LOWER(TRIM($1)) || '%'
       AND EXTRACT(YEAR FROM ext.date)=$2 AND EXTRACT(MONTH FROM ext.date)=$3
       ${filtroBancoOf}

     ORDER BY dia, id`,
    params
  );
  return rows;
}

/**
 * Calcula a sugestão de categoria para um lançamento bruto (linha de
 * carregarLancamentosExtrato), aplicando a hierarquia:
 *   regra do tenant → categoria do extrato → padrão banco → NÃO CLASSIFICADO.
 */
async function calcularSugestaoParaLancamento(pool, company, row) {
  const cache = await carregarCacheClassificacao(pool, company);
  return calcularSugestaoComCache(cache, {
    nome: extrairRazaoSocialEfetiva(row),
    documento: row.counterparty_document,
    descricao: row.descricao,
    tipo: row.valor >= 0 ? 'Entrada' : 'Saida',
    categoria_l1: row.categoria_l1,
    categoria_l2: row.categoria_l2,
    categoria_l3: row.categoria_l3,
    categoria: row.categoria_extrato,
    banco: row.banco_nome,
    valor: row.valor
  });
}

/**
 * Busca classificações já persistidas para uma lista de lançamentos.
 * Lança exceção em caso de erro de banco (não engole).
 */
async function buscarClassificacoes(pool, company, items) {
  if (!items || !items.length) return new Map();
  const byOrigem = items.reduce((acc, { origem, transacao_id }) => {
    (acc[origem] ||= []).push(String(transacao_id));
    return acc;
  }, {});
  const rows = [];
  for (const [origem, ids] of Object.entries(byOrigem)) {
    const r = await pool.query(
      `SELECT origem, transacao_id, categoria, sugerido_por, confirmado
       FROM caixa_extrato_classificacoes
       WHERE empresa=$1 AND origem=$2 AND transacao_id=ANY($3::varchar[])
       ORDER BY atualizado_em DESC`,
      [company, origem, ids]
    );
    rows.push(...r.rows);
  }
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.origem}:${row.transacao_id}`, row);
  }
  return map;
}

/**
 * Confirma classificações de extrato dentro de uma transação única.
 * Se uma regra for fornecida, ela é salva/reativada primeiro; em seguida
 * as classificações são persistidas. Qualquer falha gera rollback de ambas.
 */
async function confirmarClassificacaoTransacao(client, company, { regra, items }) {
  let regraSalva = null;
  if (regra && regra.categoria_sugerida) {
    regraSalva = await upsertRegraClassificacao(client, company, regra);
  }

  const confirmed = [];
  for (const item of (items || [])) {
    const { origem, transacao_id, categoria } = item || {};
    if (!origem || !transacao_id) continue;
    const row = await upsertClassificacao(client, company, {
      origem,
      transacao_id,
      categoria: categoria || null,
      sugerido_por: 'manual',
      confirmado: true,
    });
    confirmed.push(row);
  }
  return { regra: regraSalva, confirmed };
}

// ═══════════════════════════════════════════════════════════════════════════
// SEÇÃO OFICIAL — cópia verbatim de have-gestor-api/lib/classificacao-oficial.js
// ═══════════════════════════════════════════════════════════════════════════

// ── Resolvedor único de classificação oficial ────────────────────────────────
// Fonte de verdade compartilhada entre Extratos Realizados (api/caixa-extrato.js)
// e Fluxo de Caixa (lib/consolidar-caixa.js). Ambos os consumidores passam a
// usar EXATAMENTE a mesma precedência, eliminando a divergência em que a tela
// exibia uma categoria e o Fluxo agregava em Outras Entradas/Saídas.
//
// NÃO confundir com as regras de CONSUMO (compõe/não compõe do modelo):
//   - classificação define EM QUAL CATEGORIA o lançamento aparece;
//   - consumo define SE o lançamento participa do modelo.
// Um lançamento pode estar classificado e, ao mesmo tempo, NÃO COMPÕE.
//
// Precedência da classificação oficial:
//   1. CONFIRMADA — caixa_extrato_classificacoes com confirmado = TRUE
//   2. REGRA       — match contra caixa_regras_classificacao (aplicacao='extrato',
//                    ativo=TRUE), ordem: documento > razão social + palavra-chave
//                    > razão social > palavra-chave
//   3. FALLBACK    — 'OUTRAS ENTRADAS' ou 'OUTRAS SAÍDAS' conforme o sinal do valor
//
// Sugestões pendentes (categoria nativa L1/L2/L3 do extrato, padrão por banco,
// histórico) NUNCA entram na classificação oficial — são apenas exibição na
// tela de Extratos, até que o usuário confirme manualmente.

function onlyDigits(s) {
  return String(s || '').replace(/\D/g, '');
}

/**
 * Match oficial de um lançamento contra as regras de classificação.
 * Replica a semântica histórica do consolidar (e agora é a ÚNICA semântica):
 *   - regra com documento: exige igualdade exata de dígitos;
 *   - regra com razão social + palavra-chave: ambas devem casar;
 *   - regra só com razão social: includes;
 *   - regra só com palavra-chave: includes na descrição.
 * `regras` deve vir ordenada: documento primeiro, depois razão social, depois id
 * (mesmo ORDER BY usado no consolidar). Retorna { categoria, regra } ou null.
 *
 * Aceita os dois aliases de colunas usados nos SQLs existentes:
 *   palavra_chave/categoria_nome (consolidar) e
 *   descricao_padrao/categoria_sugerida/razao_social_padrao/documento_padrao.
 */
function matchRegraClassificacao(lancamento, regras) {
  const documento = onlyDigits(lancamento.documento || lancamento.counterparty_document);
  const rsRaw = lancamento.razao_social_efetiva != null
    ? lancamento.razao_social_efetiva
    : (lancamento.razao_social || '');
  const rsLower = String(rsRaw || '').toLowerCase();
  const descLower = String(lancamento.descricao || '').toLowerCase();

  for (const dp of regras || []) {
    const dpCNPJ = onlyDigits(dp.cnpj != null ? dp.cnpj : dp.documento_padrao);
    const dpRS = String(dp.razao_social != null ? dp.razao_social : dp.razao_social_padrao || '').toLowerCase();
    const dpPK = String(dp.palavra_chave != null ? dp.palavra_chave : dp.descricao_padrao || '').toLowerCase();
    let matched;
    if (dpCNPJ) {
      matched = !!documento && documento === dpCNPJ;
    } else if (dpRS && dpPK) {
      matched = !!rsLower && rsLower.includes(dpRS) && descLower.includes(dpPK);
    } else if (dpRS) {
      matched = !!rsLower && rsLower.includes(dpRS);
    } else {
      matched = !!dpPK && descLower.includes(dpPK);
    }
    if (matched) {
      const categoria = dp.categoria_nome != null ? dp.categoria_nome : dp.categoria_sugerida;
      return { categoria, regra: dp };
    }
  }
  return null;
}

/**
 * Resolve a classificação oficial de um lançamento.
 *
 * @param {object} args
 * @param {string|null} args.confirmada categoria de caixa_extrato_classificacoes com confirmado=TRUE
 * @param {Array}  args.regras regras ativas ordenadas (ver matchRegraClassificacao)
 * @param {object} args.lancamento { descricao, razao_social, razao_social_efetiva, documento, valor }
 * @returns {{ categoria: string, estado: 'CONFIRMADA'|'REGRA'|'FALLBACK', origem_decisao: string }}
 */
function resolverClassificacaoOficial({ confirmada, regras, lancamento }) {
  if (confirmada && String(confirmada).trim()) {
    return { categoria: String(confirmada), estado: 'CONFIRMADA', origem_decisao: 'MANUAL' };
  }
  const regra = matchRegraClassificacao(lancamento, regras);
  if (regra) {
    return { categoria: regra.categoria, estado: 'REGRA', origem_decisao: 'REGRA', regra: regra.regra };
  }
  const valor = Number(lancamento && lancamento.valor || 0);
  return {
    categoria: valor >= 0 ? 'OUTRAS ENTRADAS' : 'OUTRAS SAÍDAS',
    estado: 'FALLBACK',
    origem_decisao: 'PADRAO',
  };
}

/**
 * SQL (LEFT JOIN LATERAL) que anexa a classificação oficial CONFIRMADA do
 * lançamento como a coluna `cat_confirmada`. Usa $1 como empresa — todos os
 * SQLs de extrato do consolidar já têm a empresa em $1. Quando não houver
 * confirmação manual, `cat_confirmada` vem NULL e o consumidor cai na regra/
 * fallback.
 *
 * @param {object} args
 * @param {string} args.origem   'manual' | 'pluggy' | 'openfinance'
 * @param {string[]} args.transacaoIdExprs expressões SQL que identificam a transação
 */
function sqlJoinClassificacaoConfirmada({ origem, transacaoIdExprs }) {
  const conds = (transacaoIdExprs || []).map((expr) => `cl.transacao_id = ${expr}`).join('\n             OR ');
  return `LEFT JOIN LATERAL (
      SELECT cl.categoria FROM caixa_extrato_classificacoes cl
      WHERE cl.empresa = $1 AND cl.origem = '${origem}' AND cl.confirmado = TRUE
        AND (${conds})
      ORDER BY cl.atualizado_em DESC LIMIT 1
    ) clf ON TRUE`;
}

/**
 * Verifica (sem erro SQL) se o tenant possui a tabela
 * caixa_extrato_classificacoes. Tenants sem a migration 112 seguem funcionando
 * com regras + fallback — a confirmação manual simplesmente não existe para eles.
 *
 * @param {Pool} pool
 * @returns {Promise<boolean>}
 */
async function tabelaClassificacoesDisponivel(pool) {
  const r = await pool.query(
    "SELECT to_regclass('public.caixa_extrato_classificacoes') IS NOT NULL AS tem"
  ).catch(() => ({ rows: [{ tem: false }] }));
  return !!(r.rows[0] && r.rows[0].tem);
}

// ═══════════════════════════════════════════════════════════════════════════
// SEÇÃO CONSUMO — cópia verbatim de have-gestor-api/lib/caixa-regras-consumo.js
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Regras de consumo do modelo de caixa — validação, compilação e avaliação.
 *
 * Separação de conceitos:
 *  - Classificação (caixa_regras_classificacao) = ONDE o lançamento aparece.
 *  - Consumo (caixa_regras_consumo) = SE o lançamento participa do modelo.
 *
 * Segurança do compilador:
 *  - Whitelist estrita de campos e operadores; campo/operador desconhecido
 *    é rejeitado (nunca vira fragmento SQL).
 *  - Valores sempre parametrizados ($N); nunca interpolados no SQL.
 *  - JSONB de condições validado (schema_version, combinador, limite de 20).
 *  - Campo "status" só é válido nos escopos EXTRATO_REALIZADO e
 *    FLUXO_REALIZADO (rejeitado em PROJECOES/TODOS) — lançamentos de
 *    contas a pagar/receber e projeções têm outra natureza.
 *
 * Hierarquia de decisão (avaliarConsumo):
 *  1. Inclusão manual da transação   → origem_decisao = MANUAL_INCLUSAO
 *  2. Exclusão manual da transação   → origem_decisao = MANUAL_EXCLUSAO
 *  3. Regra específica (maior prioridade numérica)
 *  4. Regra geral
 *  5. Padrão                           → origem_decisao = PADRAO (COMPOR)
 */

const SCHEMA_VERSION = 1;
const MAX_CONDICOES = 20;

const ESCOPOS = ['EXTRATO_REALIZADO', 'FLUXO_REALIZADO', 'PROJECOES', 'TODOS'];
// Campos cujo significado só existe no extrato realizado.
const ESCOPOS_COM_STATUS = ['EXTRATO_REALIZADO', 'FLUXO_REALIZADO'];

/**
 * Whitelist de campos.
 * tipo: 'texto' | 'numero' | 'data' | 'booleano'
 * Operadores válidos por tipo estão em OPERADORES_POR_TIPO.
 */
const CAMPOS = {
  status:            { tipo: 'texto',   escopos_status: true },
  origem:            { tipo: 'texto' },
  fonte:             { tipo: 'texto' },
  banco:             { tipo: 'texto' },
  conta:             { tipo: 'texto' },
  tipo:              { tipo: 'texto' },
  descricao:         { tipo: 'texto' },
  razao_social:      { tipo: 'texto' },
  documento:         { tipo: 'texto' },
  categoria_l1:      { tipo: 'texto' },
  categoria_l2:      { tipo: 'texto' },
  categoria_l3:      { tipo: 'texto' },
  classificacao:     { tipo: 'texto' },
  transferencia_entre_contas: { tipo: 'booleano' },
  valor:             { tipo: 'numero' },
  data:              { tipo: 'data' },
};

const OPERADORES_POR_TIPO = {
  texto: ['igual', 'diferente', 'contem', 'nao_contem', 'comeca_com', 'termina_com', 'esta_em', 'nao_esta_em', 'vazio', 'nao_vazio'],
  numero: ['igual', 'diferente', 'maior', 'menor', 'entre'],
  data: ['igual', 'diferente', 'maior', 'menor', 'entre'],
  booleano: ['igual'],
};

const COMBINADORES = ['AND', 'OR'];

function rejeitar(msg) {
  const e = new Error(msg);
  e.code = 'REGRA_CONSUMO_INVALIDA';
  throw e;
}

/**
 * Valida a estrutura do JSONB de condições e os escopos da regra.
 * @param {object} condicoes - { schema_version, combinador, condicoes: [...] }
 * @param {string[]} escopos - escopos da regra
 */
function validarCondicoes(condicoes, escopos = []) {
  if (!condicoes || typeof condicoes !== 'object' || Array.isArray(condicoes)) {
    rejeitar('Condições devem ser um objeto JSON');
  }
  if (condicoes.schema_version !== SCHEMA_VERSION) {
    rejeitar(`schema_version deve ser ${SCHEMA_VERSION}`);
  }
  const combinador = condicoes.combinador;
  if (!COMBINADORES.includes(combinador)) {
    rejeitar(`Combinador inválido: ${combinador} (use AND ou OR)`);
  }
  const lista = condicoes.condicoes;
  if (!Array.isArray(lista) || lista.length === 0) {
    rejeitar('Lista de condições vazia');
  }
  if (lista.length > MAX_CONDICOES) {
    rejeitar(`Máximo de ${MAX_CONDICOES} condições por regra`);
  }

  // Campo status só pode atuar nos escopos EXTRATO_REALIZADO/FLUXO_REALIZADO:
  // rejeita PROJECOES ou TODOS (contas a pagar/receber e projeções têm outra
  // natureza e não possuem status de extrato).
  const escopoInvalidoStatus = escopos.some((s) => s === 'PROJECOES' || s === 'TODOS');

  lista.forEach((c, i) => {
    if (!c || typeof c !== 'object') rejeitar(`Condição ${i + 1} inválida`);
    const campo = CAMPOS[c.campo];
    if (!campo) rejeitar(`Campo desconhecido: ${c.campo}`);
    const ops = OPERADORES_POR_TIPO[campo.tipo];
    if (!ops.includes(c.operador)) {
      rejeitar(`Operador "${c.operador}" incompatível com o tipo ${campo.tipo} do campo ${c.campo}`);
    }
    if (campo.escopos_status && escopoInvalidoStatus) {
      rejeitar('Campo "status" não pode atuar no escopo PROJECOES (lançamentos planejados/projetados não possuem status de extrato)');
    }
    const unario = ['vazio', 'nao_vazio'].includes(c.operador);
    const entre = c.operador === 'entre';
    if (unario) {
      if (c.valor !== undefined && c.valor !== null) rejeitar(`Operador ${c.operador} não aceita valor`);
    } else if (entre) {
      if (!Array.isArray(c.valor) || c.valor.length !== 2) rejeitar('Operador "entre" exige array de 2 valores');
    } else if (['esta_em', 'nao_esta_em'].includes(c.operador)) {
      if (!Array.isArray(c.valor) || c.valor.length === 0) rejeitar(`Operador ${c.operador} exige array de valores não vazio`);
    } else if (c.valor === undefined || c.valor === null) {
      rejeitar(`Condição ${i + 1} (${c.campo}) exige valor`);
    }
  });
  return true;
}

/** Normaliza texto para comparações (mesma base usada na classificação). */
function normTexto(v) {
  return String(v == null ? '' : v)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
}

/**
 * Avalia uma condição contra o valor do lançamento (memória, sem SQL).
 */
function avaliarCondicao(cond, valorCampo) {
  const op = cond.operador;
  if (op === 'vazio') return valorCampo == null || String(valorCampo).trim() === '';
  if (op === 'nao_vazio') return !(valorCampo == null || String(valorCampo).trim() === '');

  if (op === 'entre') {
    const [a, b] = cond.valor;
    return valorCampo >= a && valorCampo <= b;
  }
  if (op === 'esta_em') return cond.valor.includes(valorCampo);
  if (op === 'nao_esta_em') return !cond.valor.includes(valorCampo);

  if (['igual', 'diferente', 'contem', 'nao_contem', 'comeca_com', 'termina_com'].includes(op)) {
    // Comparação textual normalizada (case/diacríticos insensitivo).
    const esq = normTexto(valorCampo);
    const dir = normTexto(cond.valor);
    switch (op) {
      case 'igual': return esq === dir;
      case 'diferente': return esq !== dir;
      case 'contem': return esq.includes(dir);
      case 'nao_contem': return !esq.includes(dir);
      case 'comeca_com': return esq.startsWith(dir);
      case 'termina_com': return esq.endsWith(dir);
      default: return false;
    }
  }

  // numero/data: igual, diferente, maior, menor
  switch (op) {
    case 'igual': return valorCampo === cond.valor;
    case 'diferente': return valorCampo !== cond.valor;
    case 'maior': return valorCampo > cond.valor;
    case 'menor': return valorCampo < cond.valor;
    default: return false;
  }
}

/**
 * Compila as condições em SQL parametrizado.
 * Retorna { where, params } — campo já resolvido pela whitelist (nunca
 * proveniente do cliente), valores sempre como parâmetros $N.
 *
 * @param {object} condicoes - validado por validarCondicoes
 * @param {object} mapaCampos - { campoWhitelist: 'expressao_sql' }
 * @returns {{ where: string, params: any[] }}
 */
function compilarParaSql(condicoes, mapaCampos) {
  const params = [];
  const partes = condicoes.condicoes.map((c) => {
    const expr = mapaCampos[c.campo];
    if (!expr) rejeitar(`Campo ${c.campo} sem mapeamento SQL para este consumidor`);
    const op = c.operador;
    const push = (v) => { params.push(v); return `$${params.length}`; };
    switch (op) {
      case 'vazio': return `(${expr} IS NULL OR ${expr}::text = '')`;
      case 'nao_vazio': return `(${expr} IS NOT NULL AND ${expr}::text <> '')`;
      case 'igual': return `${expr} = ${push(c.valor)}`;
      case 'diferente': return `${expr} <> ${push(c.valor)}`;
      case 'contem': return `${expr}::text ILIKE ${push(`%${c.valor}%`)}`;
      case 'nao_contem': return `(${expr} IS NULL OR ${expr}::text NOT ILIKE ${push(`%${c.valor}%`)})`;
      case 'comeca_com': return `${expr}::text ILIKE ${push(`${c.valor}%`)}`;
      case 'termina_com': return `${expr}::text ILIKE ${push(`%${c.valor}`)}`;
      case 'esta_em': {
        const ph = c.valor.map((v) => push(v)).join(', ');
        return `${expr} IN (${ph})`;
      }
      case 'nao_esta_em': {
        const ph = c.valor.map((v) => push(v)).join(', ');
        return `(${expr} IS NULL OR ${expr} NOT IN (${ph}))`;
      }
      case 'maior': return `${expr} > ${push(c.valor)}`;
      case 'menor': return `${expr} < ${push(c.valor)}`;
      case 'entre': return `${expr} BETWEEN ${push(c.valor[0])} AND ${push(c.valor[1])}`;
      default: rejeitar(`Operador não compilável: ${op}`);
    }
  });
  const where = partes.join(condicoes.combinador === 'OR' ? ' OR ' : ' AND ');
  return { where, params };
}

/**
 * Extrai o valor de um campo whitelist do lançamento normalizado.
 * O caller monta o objeto lançamento já com as chaves da whitelist.
 */
function valorDoCampo(lancamento, campo) {
  return lancamento ? lancamento[campo] : undefined;
}

/**
 * Avalia as regras ativas contra um lançamento em memória (fonte única
 * também usada pelo preview — nunca diverge do cálculo real).
 *
 * @param {object} lancamento - chaves da whitelist (ex.: { status, descricao, valor, ... })
 * @param {Array} regrasAtivas - linhas de caixa_regras_consumo (ativo=TRUE),
 *   ordenadas por prioridade DESC; vigência já filtrada pelo caller.
 * @param {object} [manual] - { inclusao: bool, exclusao: bool } decisões manuais
 * @returns {{ compoe: boolean, origem_decisao: string, regra_id: number|null }}
 */
function avaliarConsumo(lancamento, regrasAtivas = [], manual = null) {
  if (manual && manual.inclusao) {
    return { compoe: true, origem_decisao: 'MANUAL_INCLUSAO', regra_id: null };
  }
  if (manual && manual.exclusao) {
    return { compoe: false, origem_decisao: 'MANUAL_EXCLUSAO', regra_id: null };
  }
  for (const regra of regrasAtivas) {
    const lista = regra.condicoes && regra.condicoes.condicoes;
    if (!lista || !lista.length) continue;
    const resultados = lista.map((c) => avaliarCondicao(c, valorDoCampo(lancamento, c.campo)));
    const combina = regra.condicoes.combinador === 'OR'
      ? resultados.some(Boolean)
      : resultados.every(Boolean);
    if (combina) {
      return {
        compoe: regra.acao === 'COMPOR',
        origem_decisao: 'REGRA',
        regra_id: regra.id != null ? regra.id : null,
      };
    }
  }
  return { compoe: true, origem_decisao: 'PADRAO', regra_id: null };
}

/**
 * Decisão completa de consumo para UM lançamento, com a hierarquia total:
 *
 *  1. Inclusão manual da transação   → MANUAL_INCLUSAO
 *  2. Exclusão manual da transação   → MANUAL_EXCLUSAO
 *  3. Transferência entre contas (regra de sistema; hardcode atual ainda
 *     vigente — será substituída por regra de sistema visível após teste
 *     de paridade)                   → REGRA_SISTEMA
 *  4. Regras do usuário (prioridade) → REGRA
 *  5. Comportamento padrão do escopo → PADRAO
 *
 * @param {object} lancamento - chaves da whitelist
 * @param {object} ctx - { regras, padrao: 'COMPOR'|'NAO_COMPOR',
 *                         manual: {inclusao, exclusao}, transferencia: bool }
 */
function decidirConsumo(lancamento, ctx = {}) {
  const manual = ctx.manual || null;
  if (manual && manual.inclusao) {
    return { compoe: true, origem_decisao: 'MANUAL_INCLUSAO', regra_id: null };
  }
  if (manual && manual.exclusao) {
    return { compoe: false, origem_decisao: 'MANUAL_EXCLUSAO', regra_id: null };
  }
  if (ctx.transferencia) {
    return { compoe: false, origem_decisao: 'REGRA_SISTEMA', regra_id: null };
  }
  const r = avaliarConsumo(lancamento, ctx.regras || [], null);
  if (r.origem_decisao === 'PADRAO') {
    return { compoe: (ctx.padrao || 'COMPOR') === 'COMPOR', origem_decisao: 'PADRAO', regra_id: null };
  }
  return r;
}

/**
 * Carrega o contexto de consumo para o cálculo real (leitura).
 *
 * Segurança multitenant:
 *  - Tenants SEM a migration 117 (tabelas ausentes) retornam { habilitado:false }
 *    via to_regclass — nunca erro SQL, comportamento idêntico ao anterior.
 *  - Flag desligada (sem linha de config ou habilitado=FALSE) → { habilitado:false }.
 *  - Qualquer falha inesperada de banco faz fail-safe para desabilitado
 *    (preserva o comportamento atual do tenant).
 *
 * Quando habilitado, expõe decidir(lancamento, manual) — a MESMA
 * decidirConsumo usada pelo preview (nunca diverge do preview).
 *
 * @param {Pool} pool - pool do tenant (já validado por getPoolVerified)
 * @param {string} company - slug do tenant
 * @param {string} escopo - 'EXTRATO_REALIZADO' | 'FLUXO_REALIZADO' | 'PROJECOES'
 * @returns {Promise<{habilitado:boolean, escopo?:string, padrao?:string,
 *                    decidir?:Function}>}
 */
async function carregarContextoConsumo(pool, company, escopo = 'EXTRATO_REALIZADO') {
  try {
    const tem = await pool.query(
      `SELECT to_regclass('public.caixa_regras_consumo') IS NOT NULL AS tem_regras,
              to_regclass('public.caixa_regras_consumo_config') IS NOT NULL AS tem_config`);
    if (!tem.rows[0].tem_regras || !tem.rows[0].tem_config) return { habilitado: false };

    const cfgR = await pool.query(
      'SELECT habilitado, padroes FROM caixa_regras_consumo_config WHERE empresa=$1', [company]);
    const cfg = cfgR.rows[0];
    if (!cfg || !cfg.habilitado) return { habilitado: false };

    const regrasR = await pool.query(
      `SELECT id, nome, escopos, condicoes, acao, prioridade
       FROM caixa_regras_consumo
       WHERE empresa=$1 AND ativo=TRUE
         AND (vigente_desde IS NULL OR vigente_desde <= CURRENT_DATE)
         AND (vigente_ate IS NULL OR vigente_ate >= CURRENT_DATE)
       ORDER BY prioridade DESC, id ASC`, [company]);
    const regras = regrasR.rows.filter((r) => Array.isArray(r.escopos)
      && (r.escopos.includes(escopo) || r.escopos.includes('TODOS')));

    const padroes = cfg.padroes || {};
    const padrao = ['COMPOR', 'NAO_COMPOR'].includes(padroes[escopo]) ? padroes[escopo] : 'COMPOR';

    return {
      habilitado: true,
      escopo,
      padrao,
      regras_carregadas: regras.length,
      decidir(lancamento, manual = null) {
        return decidirConsumo(lancamento, {
          regras, padrao, manual,
          transferencia: !!lancamento.transferencia_entre_contas,
        });
      },
    };
  } catch (e) {
    console.error('[REGRAS-CONSUMO] falha ao carregar contexto; mantendo comportamento padrao:', e.message);
    return { habilitado: false };
  }
}

/**
 * Monta as métricas do preview a partir das linhas do extrato avaliadas
 * (memória — mesma decidirConsumo do cálculo real).
 *
 * @param {Array} avaliados - [{ lancamento, antes: {compoe,...}, depois: {compoe,...} }]
 */
function montarMetricas(avaliados) {
  const zero = () => ({ quantidade: 0, entradas: 0, saidas: 0 });
  const add = (mapa, chave, valor, compoe) => {
    if (!mapa.has(chave)) mapa.set(chave, zero());
    const b = mapa.get(chave);
    b.quantidade += 1;
    if (valor > 0) b.entradas += valor; else b.saidas += -valor;
    if (compoe !== undefined) b[compoe ? 'compoe' : 'nao_compoe'] = (b[compoe ? 'compoe' : 'nao_compoe'] || 0) + 1;
  };

  const resumo = {
    analisados: 0, compoem_atualmente: 0, nao_compoem_atualmente: 0,
    passarao_a_compor: 0, deixarao_de_compor: 0, sem_alteracao: 0,
    entradas_afetadas: 0, saidas_afetadas: 0,
    transferencias_identificadas: 0, overrides_manuais: 0,
  };
  const porMes = new Map(), porBanco = new Map(), porOrigem = new Map(), porStatus = new Map();
  const totais = { extrato_total: 0, nao_compoe_depois: 0, consumido_modelo: 0 };

  for (const item of avaliados) {
    const l = item.lancamento;
    const v = Number(l.valor) || 0;
    const mes = String(l.data || '').slice(0, 7) || 'sem-data';
    resumo.analisados += 1;
    if (item.antes.compoe) resumo.compoem_atualmente += 1; else resumo.nao_compoem_atualmente += 1;
    if (item.antes.compoe !== item.depois.compoe) {
      if (item.depois.compoe) { resumo.passarao_a_compor += 1; resumo.entradas_afetadas += v > 0 ? v : 0; resumo.saidas_afetadas += v < 0 ? -v : 0; }
      else { resumo.deixarao_de_compor += 1; resumo.saidas_afetadas += v < 0 ? -v : 0; resumo.entradas_afetadas += v > 0 ? v : 0; }
    } else {
      resumo.sem_alteracao += 1;
    }
    if (item.transferencia) resumo.transferencias_identificadas += 1;
    if (item.depois.origem_decisao === 'MANUAL_INCLUSAO' || item.depois.origem_decisao === 'MANUAL_EXCLUSAO') resumo.overrides_manuais += 1;

    totais.extrato_total += v;
    if (!item.depois.compoe) totais.nao_compoe_depois += v;

    add(porMes, mes, v, item.depois.compoe);
    add(porBanco, l.banco || 'sem-banco', v, item.depois.compoe);
    add(porOrigem, l.origem || 'sem-origem', v, item.depois.compoe);
    add(porStatus, l.status || 'sem-status', v, item.depois.compoe);
  }
  totais.consumido_modelo = totais.extrato_total - totais.nao_compoe_depois;

  const toObj = (mapa) => Object.fromEntries([...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  return { resumo, totais, por_mes: toObj(porMes), por_banco: toObj(porBanco), por_origem: toObj(porOrigem), por_status: toObj(porStatus) };
}
// ═══════════════════════════════════════════════════════════════════════════
// SEÇÃO HTTP — REGRAS DE CLASSIFICAÇÃO + CONFIRMAÇÃO DE CLASSIFICAÇÃO
// Adaptado de have-gestor-api/lib/routes/caixa-extrato.js
// (sem cors/auth/getPoolVerified; pool/company/user chegam via contexto).
// ═══════════════════════════════════════════════════════════════════════════

async function listRegras(pool, company, filters = {}) {
  const where = ['empresa = $1'];
  const params = [company];
  let p = 1;

  if (filters.categoria_sugerida) {
    p++; where.push(`categoria_sugerida = $${p}`); params.push(filters.categoria_sugerida);
  }
  if (filters.documento_padrao) {
    p++; where.push(`documento_padrao = $${p}`); params.push(normalizeDoc(filters.documento_padrao));
  }
  if (filters.descricao_padrao) {
    p++; where.push(`LOWER(COALESCE(descricao_padrao,'')) LIKE LOWER($${p})`); params.push(`%${filters.descricao_padrao}%`);
  }
  if (filters.razao_social_padrao) {
    p++; where.push(`LOWER(COALESCE(razao_social_padrao,'')) LIKE LOWER($${p})`); params.push(`%${filters.razao_social_padrao}%`);
  }
  if (filters.aplicacao) {
    p++; where.push(`aplicacao = $${p}`); params.push(filters.aplicacao);
  }
  if (filters.ativo !== undefined && filters.ativo !== '') {
    p++; where.push(`ativo = $${p}`); params.push(filters.ativo === 'true' || filters.ativo === true);
  }

  const sql = `SELECT * FROM caixa_regras_classificacao
               WHERE ${where.join(' AND ')}
               ORDER BY prioridade DESC, id ASC`;
  const r = await pool.query(sql, params);
  return r.rows;
}

async function reprocessContrapartesPorRegra(pool, company, regra) {
  /**
   * Reavalia a classificacao das contrapartes que casam com a regra recem-salva.
   * Atualiza caixa_contrapartes.categoria quando a sugestao mudar.
   */
  try {
    const conditions = ['empresa = $1'];
    const params = [company];

    if (regra.documento_padrao) {
      params.push(normalizeDoc(regra.documento_padrao));
      conditions.push(`NULLIF(documento, '') IS NOT NULL AND regexp_replace(documento, '[^0-9]', '', 'g') = $${params.length}`);
    } else if (regra.razao_social_padrao || regra.descricao_padrao) {
      const term = regra.razao_social_padrao || regra.descricao_padrao;
      params.push(`%${term}%`);
      conditions.push(`nome ILIKE $${params.length}`);
    } else {
      return { atualizados: 0 };
    }

    const { rows } = await pool.query(
      `SELECT id, nome, categoria, documento FROM caixa_contrapartes
       WHERE ${conditions.join(' AND ')}
       ORDER BY nome`,
      params
    );

    let atualizados = 0;
    for (const cp of rows) {
      const suggestion = await suggestCategoriaForContraparte(pool, company, {
        nome: cp.nome,
        documento: cp.documento || '',
        descricao: cp.nome,
        banco: '',
        tipo: '',
        valor: 0
      });
      if (suggestion.categoria && suggestion.categoria !== cp.categoria) {
        await pool.query(
          `UPDATE caixa_contrapartes SET categoria = $1, atualizado_em = NOW()
           WHERE id = $2 AND empresa = $3`,
          [suggestion.categoria, cp.id, company]
        );
        atualizados++;
      }
    }
    return { atualizados };
  } catch (e) {
    console.error('[REGRAS] erro ao reprocessar contrapartes:', e.message);
    return { atualizados: 0, erro: e.message };
  }
}

/**
 * Handler HTTP das regras de classificação.
 * GET lista (com filtros em req.query); POST cria/upserta (ou sugere quando
 * body.suggest_only); PATCH/PUT atualiza; DELETE remove.
 */
async function handleRegrasClassificacao(req, res, { pool, company }) {
  if (req.method === 'GET') {
    const filters = req.query || {};
    const rows = await listRegras(pool, company, filters);
    return res.json({ regras: rows });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const { suggest_only, ...regra } = body;

    if (suggest_only) {
      const suggestion = await suggestCategoriaForContraparte(pool, company, {
        nome: regra.razao_social_padrao || regra.descricao_padrao || '',
        documento: regra.documento_padrao || '',
        descricao: regra.descricao_padrao || '',
        tipo: regra.tipo_padrao || '',
        categoria_l1: regra.categoria_l1 || '',
        categoria_l2: regra.categoria_l2 || '',
        categoria_l3: regra.categoria_l3 || '',
        banco: regra.banco_padrao || '',
        aplicacao: regra.aplicacao || 'extrato'
      });
      return res.json({ ok: true, suggestion });
    }

    if (!regra.categoria_sugerida) {
      return res.status(400).json({ error: 'categoria_sugerida é obrigatoria' });
    }

    const row = await upsertRegraClassificacao(pool, company, regra);
    const reprocess = await reprocessContrapartesPorRegra(pool, company, row);
    return res.json({ ok: true, regra: row, reprocess });
  }

  if (req.method === 'PATCH' || req.method === 'PUT') {
    const { id, ...regra } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id é obrigatorio' });

    const fields = [];
    const values = [];
    const allowed = [
      'aplicacao', 'descricao_padrao', 'tipo_padrao', 'categoria_l1', 'categoria_l2', 'categoria_l3',
      'razao_social_padrao', 'documento_padrao', 'banco_padrao', 'categoria_sugerida',
      'prioridade', 'ativo'
    ];
    for (const key of allowed) {
      if (regra[key] !== undefined) {
        if (key === 'documento_padrao') {
          fields.push(`${key} = $${fields.length + 1}`);
          values.push(normalizeDoc(regra[key]) || null);
        } else {
          fields.push(`${key} = $${fields.length + 1}`);
          values.push(regra[key]);
        }
      }
    }
    if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    fields.push(`atualizado_em = NOW()`);
    values.push(parseInt(id), company);

    const r = await pool.query(
      `UPDATE caixa_regras_classificacao SET ${fields.join(', ')}
       WHERE id = $${values.length - 1} AND empresa = $${values.length}
       RETURNING *`,
      values
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Regra nao encontrada' });
    const updatedRow = r.rows[0];
    const reprocess = await reprocessContrapartesPorRegra(pool, company, updatedRow);
    return res.json({ ok: true, regra: updatedRow, reprocess });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id é obrigatorio' });
    await pool.query('DELETE FROM caixa_regras_classificacao WHERE id=$1 AND empresa=$2', [parseInt(id), company]);
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

function sanitizeError(err) {
  // Remove dados sensiveis (senhas, hosts, SQL) das mensagens de log.
  if (!err || !err.message) return String(err);
  let msg = String(err.message);
  msg = msg.replace(/password=[^\s'"]+/gi, 'password=***');
  msg = msg.replace(/(host|server|addr)=\S+/gi, '$1=<redacted>');
  msg = msg.replace(/\b(?:\d{1,3}\.){3}\d{1,3}(:\d+)?\b/g, '<host>');
  return msg;
}

/**
 * Handler HTTP de confirmação manual de classificação de lançamentos.
 * POST { items: [{origem, transacao_id, categoria?}], regra? } — transação única.
 */
async function handleConfirmarClassificacao(req, res, { pool, company }) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { items, regra } = req.body || {};
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Informe items [{origem, transacao_id, categoria?}]' });
  }
  // Limite de segurança para confirmação em lote.
  if (items.length > 2000) {
    return res.status(400).json({ error: 'Lote muito grande (maximo 2000 itens). Divida a selecao.' });
  }

  // Regras validadas antes da transacao
  if (regra && !regra.categoria_sugerida) {
    return res.status(400).json({ error: 'Regra informada sem categoria_sugerida' });
  }

  // Estrutura ausente (tenant sem migration 112): recusa controlada, sem SQL exposto.
  if (!(await tabelaClassificacoesDisponivel(pool))) {
    return res.status(409).json({ error: 'Funcionalidade de classificacao ainda nao habilitada para esta empresa.', reason: 'FEATURE_NOT_PROVISIONED' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await confirmarClassificacaoTransacao(client, company, { regra, items });
    await client.query('COMMIT');
    return res.json({ ok: true, ...result });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (rollbackErr) {
      console.error('[CONFIRMAR CLASSIFICACAO] rollback error:', sanitizeError(rollbackErr));
    }
    console.error('[CONFIRMAR CLASSIFICACAO] falha transacional:', sanitizeError(e));
    return res.status(500).json({ error: 'Nao foi possivel salvar a classificacao. Tente novamente.' });
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SEÇÃO HTTP — REGRAS DE CONSUMO
// Adaptado de have-gestor-api/lib/routes/caixa-regras-consumo.js
// (sem cors/auth/getPoolVerified; pool/company/user chegam via contexto).
// ═══════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
// Tratamentos openfinance foram gravados historicamente em três formatos de
// chave: md5 hex puro, uuid canônico (com hífens) e id bruto do extrator.
// O consolidar aceita as três; o preview precisa aceitar as mesmas para nunca
// divergir do cálculo real.
const openfinanceKeys = (id) => {
  const hex = md5(String(id));
  const dashed = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return [hex, dashed, String(id)];
};

const PADROES_INICIAIS = { EXTRATO_REALIZADO: 'COMPOR', FLUXO_REALIZADO: 'COMPOR', PROJECOES: 'COMPOR' };

function regraPublica(r) {
  return {
    id: r.id, regra_uuid: r.regra_uuid, versao: r.versao, nome: r.nome,
    descricao: r.descricao, escopos: r.escopos, condicoes: r.condicoes,
    acao: r.acao, prioridade: r.prioridade,
    vigente_desde: r.vigente_desde, vigente_ate: r.vigente_ate,
    ativo: r.ativo, is_sistema: r.is_sistema, substitui: r.substitui || null,
    criado_por: r.criado_por, criado_em: r.criado_em,
    desativado_por: r.desativado_por, desativado_em: r.desativado_em,
  };
}

/** Status exibido na tabela principal. */
function statusRegra(r, jaAtivou) {
  if (r.is_sistema) return 'SISTEMA';
  if (!jaAtivou) return 'RASCUNHO';
  if (!r.ativo) return 'INATIVA';
  const hoje = new Date().toISOString().slice(0, 10);
  if (r.vigente_desde && r.vigente_desde > hoje) return 'FUTURA';
  if (r.vigente_ate && r.vigente_ate < hoje) return 'EXPIRADA';
  return 'ATIVA';
}

/**
 * Handler HTTP das regras de consumo do modelo de caixa.
 *
 * Rotas (padrão action-based):
 *   GET  ?capability=1            -> { available, enabled, reason? }
 *   GET  ?status-disponiveis=1    -> status reais do tenant (com contagens)
 *   GET  ?historico=<uuid|id>     -> auditoria da regra
 *   GET  ?id=N                    -> detalhe (com versoes)
 *   GET                           -> lista + config + capability
 *   POST { action: 'create' | 'nova_versao' | 'preview' | 'ativar'
 *          | 'desativar' | 'reverter' | 'config' }
 *
 * Compatibilidade: schemas SEM as tabelas recebem
 * { available:false, enabled:false, reason:'FEATURE_NOT_PROVISIONED' }
 * (nunca erro SQL).
 */
async function handleRegrasConsumo(req, res, { pool, company, user }) {
  const payload = user || {};
  const q = (sql, p) => pool.query(sql, p);

  async function disponibilidade() {
    const r = await q("SELECT to_regclass('public.caixa_regras_consumo') IS NOT NULL AS ok");
    if (!r.rows[0].ok) return { available: false, enabled: false, reason: 'FEATURE_NOT_PROVISIONED' };
    const cfg = await q('SELECT habilitado FROM caixa_regras_consumo_config WHERE empresa=$1', [company]);
    return { available: true, enabled: !!(cfg.rows[0] && cfg.rows[0].habilitado) };
  }

  async function exigirDisponivel() {
    const cap = await disponibilidade();
    if (!cap.available) {
      res.status(409).json(cap);
      return false;
    }
    return true;
  }

  try {
    // ── Capability (seguro em qualquer tenant) ─────────────────────────
    if (req.method === 'GET' && req.query.capability === '1') {
      return res.json(await disponibilidade());
    }

    // ── Status reais do tenant (dados, nunca lista fixa) ───────────────
    if (req.method === 'GET' && req.query['status-disponiveis'] === '1') {
      const cap = await disponibilidade();
      if (!cap.available) return res.json({ available: false, statuses: [] });
      const r = await q(`
        SELECT a.source AS origem, a.status,
               COUNT(*)::int AS quantidade,
               COALESCE(ROUND(SUM(a.amount) FILTER (WHERE a.amount > 0), 2), 0) AS entradas,
               COALESCE(ROUND(-SUM(a.amount) FILTER (WHERE a.amount < 0), 2), 0) AS saidas
        FROM extrator_all_transactions a
        JOIN extrator_clients c ON c.id = a.client_id
        WHERE LOWER(TRIM(COALESCE(c.gestor_empresa, c.name))) = LOWER(TRIM($1))
          AND a.status IS NOT NULL AND a.status <> ''
        GROUP BY a.source, a.status ORDER BY a.source, quantidade DESC`, [company]);
      return res.json({ available: true, statuses: r.rows });
    }

    if (!(await exigirDisponivel())) return;

    // ── Lista / detalhe / histórico ────────────────────────────────────
    if (req.method === 'GET') {
      if (req.query.id) {
        const r = await q('SELECT * FROM caixa_regras_consumo WHERE id=$1 AND empresa=$2', [parseInt(req.query.id), company]);
        if (!r.rowCount) return res.status(404).json({ error: 'Regra não encontrada' });
        const versoes = await q(
          'SELECT * FROM caixa_regras_consumo WHERE empresa=$1 AND regra_uuid=$2 ORDER BY versao DESC',
          [company, r.rows[0].regra_uuid]);
        return res.json({ regra: regraPublica(r.rows[0]), versoes: versoes.rows.map(regraPublica) });
      }
      if (req.query.historico) {
        const alvo = req.query.historico;
        const r = await q(`
          SELECT * FROM caixa_regras_consumo_auditoria
          WHERE empresa=$1 AND (regra_uuid::text = $2
             OR regra_uuid = (SELECT regra_uuid FROM caixa_regras_consumo WHERE id=$2::bigint AND empresa=$1))
          ORDER BY criado_em DESC, id DESC LIMIT 200`, [company, alvo]);
        return res.json({ auditoria: r.rows });
      }
      const regras = await q(
        'SELECT * FROM caixa_regras_consumo WHERE empresa=$1 ORDER BY prioridade DESC, id DESC', [company]);
      const ativaram = await q(
        "SELECT DISTINCT regra_uuid FROM caixa_regras_consumo_auditoria WHERE empresa=$1 AND acao='ATIVACAO'",
        [company]);
      const ativSet = new Set(ativaram.rows.map((r) => r.regra_uuid));
      const cfg = await q('SELECT habilitado, padroes FROM caixa_regras_consumo_config WHERE empresa=$1', [company]);
      return res.json({
        capability: await disponibilidade(),
        config: { habilitado: !!(cfg.rows[0] && cfg.rows[0].habilitado), padroes: (cfg.rows[0] && cfg.rows[0].padroes) || PADROES_INICIAIS },
        regras: regras.rows.map((r) => ({ ...regraPublica(r), status: statusRegra(r, ativSet.has(r.regra_uuid)) })),
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { action } = req.body;
    const audit = async (executor, dados) => {
      const run = executor && executor.query ? (sql, p) => executor.query(sql, p) : executor;
      return run(
      `INSERT INTO caixa_regras_consumo_auditoria
         (empresa, regra_uuid, versao, acao, usuario, preview, quantidade_afetada,
          entradas, saidas, periodos, origens, estado_anterior, estado_posterior, confirmacao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [company, dados.regra_uuid || null, dados.versao || null, dados.acao,
       payload.email || payload.sub || null,
       dados.preview ? JSON.stringify(dados.preview) : null,
       dados.quantidade_afetada || null, dados.entradas || null, dados.saidas || null,
       dados.periodos ? JSON.stringify(dados.periodos) : null,
       dados.origens ? JSON.stringify(dados.origens) : null,
       dados.estado_anterior ? JSON.stringify(dados.estado_anterior) : null,
       dados.estado_posterior ? JSON.stringify(dados.estado_posterior) : null,
       !!dados.confirmacao]);
    };
    const validarPayloadRegra = (b) => {
      const nome = String(b.nome || '').trim();
      if (!nome) throw Object.assign(new Error('Nome obrigatório'), { status: 400 });
      const escopos = Array.isArray(b.escopos) ? b.escopos : [];
      if (!escopos.length || !escopos.every((s) => ESCOPOS.includes(s))) {
        throw Object.assign(new Error('Escopos inválidos'), { status: 400 });
      }
      if (!['COMPOR', 'NAO_COMPOR'].includes(b.acao)) {
        throw Object.assign(new Error('Ação inválida'), { status: 400 });
      }
      validarCondicoes(b.condicoes, escopos);
      const prioridade = Number.isFinite(Number(b.prioridade)) ? Math.max(0, parseInt(b.prioridade)) : 100;
      return { nome: nome.slice(0, 150), descricao: b.descricao || null, escopos, acao: b.acao, prioridade };
    };

    // ── CREATE (rascunho, nunca ativo) ─────────────────────────────────
    if (action === 'create') {
      const v = validarPayloadRegra(req.body);
      const uuid = crypto.randomUUID();
      const r = await q(
        `INSERT INTO caixa_regras_consumo
           (empresa, regra_uuid, versao, nome, descricao, escopos, condicoes, acao,
            prioridade, vigente_desde, vigente_ate, ativo, is_sistema, criado_por)
         VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,FALSE,FALSE,$11) RETURNING *`,
        [company, uuid, v.nome, v.descricao, v.escopos, JSON.stringify(req.body.condicoes),
         v.acao, v.prioridade, req.body.vigente_desde || null, req.body.vigente_ate || null,
         payload.email || payload.sub || null]);
      await audit(q, {
        regra_uuid: uuid, versao: 1, acao: 'CRIACAO',
        estado_posterior: { nome: v.nome, acao: v.acao, escopos: v.escopos },
      });
      return res.json({ ok: true, regra: regraPublica(r.rows[0]) });
    }

    if (action === 'nova_versao') {
      const atual = await q('SELECT * FROM caixa_regras_consumo WHERE id=$1 AND empresa=$2', [parseInt(req.body.id), company]);
      if (!atual.rowCount) return res.status(404).json({ error: 'Regra não encontrada' });
      const v = validarPayloadRegra(req.body);
      const r = await q(
        `INSERT INTO caixa_regras_consumo
           (empresa, regra_uuid, versao, nome, descricao, escopos, condicoes, acao,
            prioridade, vigente_desde, vigente_ate, ativo, substitui, is_sistema, criado_por)
         VALUES ($1,$2,
                 (SELECT COALESCE(MAX(versao),0)+1 FROM caixa_regras_consumo WHERE empresa=$1 AND regra_uuid=$2),
                 $3,$4,$5,$6,$7,$8,$9,$10,FALSE,$11,$12,$13) RETURNING *`,
        [company, atual.rows[0].regra_uuid, v.nome, v.descricao, v.escopos,
         JSON.stringify(req.body.condicoes), v.acao, v.prioridade,
         req.body.vigente_desde || atual.rows[0].vigente_desde,
         req.body.vigente_ate || atual.rows[0].vigente_ate,
         atual.rows[0].id, atual.rows[0].is_sistema, payload.email || payload.sub || null]);
      return res.json({ ok: true, regra: regraPublica(r.rows[0]) });
    }

    // ── Preview (somente leitura) ──────────────────────────────────────
    if (action === 'preview') {
      const resultado = await executarPreview(q, company, req.body);
      return res.json(resultado);
    }

    // ── Ativar (exige preview valido e flag habilitada) ────────────────
    if (action === 'ativar') {
      const { id, preview_hash, preview_snapshot } = req.body;
      if (!preview_hash || !preview_snapshot) {
        return res.status(409).json({ error: 'Ativação exige preview executado e confirmado', code: 'PREVIEW_REQUIRED' });
      }
      const cfg = await q('SELECT habilitado FROM caixa_regras_consumo_config WHERE empresa=$1', [company]);
      if (!(cfg.rows[0] && cfg.rows[0].habilitado)) {
        return res.status(409).json({ error: 'Funcionalidade desabilitada para este tenant', code: 'FEATURE_DISABLED' });
      }
      const r = await q('SELECT * FROM caixa_regras_consumo WHERE id=$1 AND empresa=$2 FOR UPDATE', [parseInt(id), company]);
      if (!r.rowCount) return res.status(404).json({ error: 'Regra não encontrada' });
      const regra = r.rows[0];
      const snap = preview_snapshot;
      const mesmaRegra = snap.regra_id === regra.id
        && snap.versao === regra.versao
        && JSON.stringify(snap.condicoes) === JSON.stringify(regra.condicoes)
        && snap.acao === regra.acao
        && JSON.stringify(snap.escopos) === JSON.stringify(regra.escopos);
      if (!mesmaRegra) {
        return res.status(409).json({ error: 'Preview não corresponde à regra atual; execute novo preview', code: 'PREVIEW_STALE' });
      }
      const agora = await assinaturaDados(q, company);
      if (JSON.stringify(agora) !== JSON.stringify(snap.data_signature)) {
        return res.status(409).json({ error: 'Dados mudaram desde o preview; execute novo preview', code: 'DATA_CHANGED' });
      }
      const esperado = hashPreview(company, snap);
      if (esperado !== preview_hash) {
        return res.status(409).json({ error: 'Hash de preview inválido', code: 'PREVIEW_STALE' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // desativa versão ativa anterior da mesma regra (mesma transação)
        await client.query(
          `UPDATE caixa_regras_consumo SET ativo=FALSE, desativado_por=$3, desativado_em=NOW()
           WHERE empresa=$1 AND regra_uuid=$2 AND ativo=TRUE AND id <> $4`,
          [company, regra.regra_uuid, payload.email || payload.sub || null, regra.id]);
        const up = await client.query(
          `UPDATE caixa_regras_consumo SET ativo=TRUE, desativado_por=NULL, desativado_em=NULL
           WHERE empresa=$1 AND id=$2 RETURNING *`, [company, regra.id]);
        await audit(client, {
          regra_uuid: regra.regra_uuid, versao: regra.versao, acao: 'ATIVACAO',
          preview: snap.metricas, confirmacao: true,
          quantidade_afetada: snap.metricas && snap.metricas.resumo ? snap.metricas.resumo.deixarao_de_compor + snap.metricas.resumo.passarao_a_compor : null,
          estado_posterior: { ativo: true },
        });
        await client.query('COMMIT');
        return res.json({ ok: true, regra: regraPublica(up.rows[0]) });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally { client.release(); }
    }

    // ── Desativar ──────────────────────────────────────────────────────
    if (action === 'desativar') {
      const r = await q('SELECT * FROM caixa_regras_consumo WHERE id=$1 AND empresa=$2', [parseInt(req.body.id), company]);
      if (!r.rowCount) return res.status(404).json({ error: 'Regra não encontrada' });
      const regra = r.rows[0];
      // preview do impacto da retirada (simulação sem a regra)
      const metricas = (await executarPreview(q, company, { regra_id: regra.id, sem_esta_regra: true })).metricas;
      if (!req.body.confirm) {
        return res.status(409).json({ error: 'Confirmação obrigatória para desativação', code: 'CONFIRM_REQUIRED', metricas });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const up = await client.query(
          `UPDATE caixa_regras_consumo SET ativo=FALSE, desativado_por=$3, desativado_em=NOW()
           WHERE empresa=$1 AND id=$2 RETURNING *`, [company, regra.id, payload.email || payload.sub || null]);
        await audit(client, {
          regra_uuid: regra.regra_uuid, versao: regra.versao, acao: 'DESATIVACAO',
          preview: metricas, confirmacao: true, estado_anterior: { ativo: true }, estado_posterior: { ativo: false },
        });
        await client.query('COMMIT');
        return res.json({ ok: true, regra: regraPublica(up.rows[0]), metricas });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally { client.release(); }
    }

    // ── Reverter (nova versão a partir de versão anterior) ─────────────
    if (action === 'reverter') {
      const atual = await q('SELECT * FROM caixa_regras_consumo WHERE id=$1 AND empresa=$2', [parseInt(req.body.id), company]);
      if (!atual.rowCount) return res.status(404).json({ error: 'Regra não encontrada' });
      const alvo = await q(
        'SELECT * FROM caixa_regras_consumo WHERE empresa=$1 AND regra_uuid=$2 AND id=$3',
        [company, atual.rows[0].regra_uuid, parseInt(req.body.versao_id)]);
      if (!alvo.rowCount) return res.status(404).json({ error: 'Versão de origem não encontrada' });
      const base = alvo.rows[0];
      const r = await q(
        `INSERT INTO caixa_regras_consumo
           (empresa, regra_uuid, versao, nome, descricao, escopos, condicoes, acao,
            prioridade, vigente_desde, vigente_ate, ativo, substitui, is_sistema, criado_por)
         VALUES ($1,$2,
                 (SELECT COALESCE(MAX(versao),0)+1 FROM caixa_regras_consumo WHERE empresa=$1 AND regra_uuid=$2),
                 $3,$4,$5,$6,$7,$8,$9,$10,FALSE,$11,$12,$13) RETURNING *`,
        [company, base.regra_uuid, base.nome, base.descricao, base.escopos,
         JSON.stringify(base.condicoes), base.acao, base.prioridade,
         base.vigente_desde, base.vigente_ate, atual.rows[0].id, base.is_sistema,
         payload.email || payload.sub || null]);
      await audit(q, {
        regra_uuid: base.regra_uuid, versao: r.rows[0].versao, acao: 'REVERSAO',
        estado_anterior: { versao_base: base.versao },
        estado_posterior: { nova_versao: r.rows[0].versao },
      });
      return res.json({ ok: true, regra: regraPublica(r.rows[0]), mensagem: 'Nova versão em rascunho; execute preview e ative para aplicar' });
    }

    // ── Config: comportamento padrão por escopo ────────────────────────
    if (action === 'config') {
      const padroes = req.body.padroes || {};
      for (const escopo of Object.keys(PADROES_INICIAIS)) {
        if (padroes[escopo] && !['COMPOR', 'NAO_COMPOR'].includes(padroes[escopo])) {
          return res.status(400).json({ error: `Padrão inválido para ${escopo}` });
        }
      }
      const merged = { ...PADROES_INICIAIS, ...padroes };
      const metricas = (await executarPreview(q, company, { padroes: merged })).metricas;
      if (!req.body.confirm) {
        return res.status(409).json({ error: 'Confirmação obrigatória após revisar o preview', code: 'CONFIRM_REQUIRED', metricas, padroes: merged });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO caixa_regras_consumo_config (empresa, habilitado, padroes, atualizado_por)
           VALUES ($1, COALESCE((SELECT habilitado FROM caixa_regras_consumo_config WHERE empresa=$1), FALSE), $2, $3)
           ON CONFLICT (empresa) DO UPDATE SET padroes=$2, atualizado_em=NOW(), atualizado_por=$3`,
          [company, JSON.stringify(merged), payload.email || payload.sub || null]);
        await audit(client, {
          acao: 'EDICAO', confirmacao: true, preview: metricas,
          estado_posterior: { padroes: merged },
        });
        await client.query('COMMIT');
        return res.json({ ok: true, padroes: merged, metricas });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally { client.release(); }
    }

    return res.status(400).json({ error: 'action invalida' });
  } catch (e) {
    console.error('[REGRAS-CONSUMO]', e.message);
    res.status(e.status || (e.code === 'REGRA_CONSUMO_INVALIDA' ? 400 : 500)).json({ error: e.status || e.code === 'REGRA_CONSUMO_INVALIDA' ? e.message : 'Erro interno; tente novamente ou contate o suporte.' });
  }

  // ── helpers de preview (declarados após o handler, hoisted) ─────────
  async function assinaturaDados(query, empresa) {
    const r = await query(
      `SELECT COUNT(*)::int AS n,
              COALESCE(ROUND(SUM(a.amount), 2), 0) AS soma,
              MAX(a.synced_at::text) AS max_synced
       FROM extrator_all_transactions a
       JOIN extrator_clients c ON c.id = a.client_id
       WHERE LOWER(TRIM(COALESCE(c.gestor_empresa, c.name))) = LOWER(TRIM($1))`, [empresa]);
    const t = await query('SELECT COALESCE(MAX(id),0)::int AS m FROM caixa_extrato_tratamentos WHERE empresa=$1', [empresa]);
    return { ...r.rows[0], tratamentos_max_id: t.rows[0].m };
  }

  function hashPreview(empresa, snap) {
    const segredo = process.env.CENTRAL_DB_PASSWORD || 'regras-consumo';
    return crypto.createHash('sha256')
      .update(segredo + '|' + empresa + '|' + JSON.stringify(snap))
      .digest('hex');
  }

  /**
   * Executa o preview no extrato realizado. body:
   *  - rule (inline) e/ou rule_id (rascunho existente simulado como ativo)
   *  - padroes (override do comportamento padrão por escopo)
   *  - sem_esta_regra (desativação: simula sem a regra informada)
   */
  async function executarPreview(query, empresa, body) {
    const cfgR = await query('SELECT padroes FROM caixa_regras_consumo_config WHERE empresa=$1', [empresa]);
    const padroesAtuais = (cfgR.rows[0] && cfgR.rows[0].padroes) || PADROES_INICIAIS;
    const padroesSimulados = { ...padroesAtuais, ...(body.padroes || {}) };

    const ativas = await query(
      `SELECT * FROM caixa_regras_consumo
       WHERE empresa=$1 AND ativo=TRUE
         AND (vigente_desde IS NULL OR vigente_desde <= CURRENT_DATE)
         AND (vigente_ate IS NULL OR vigente_ate >= CURRENT_DATE)
       ORDER BY prioridade DESC, id ASC`, [empresa]);

    let regraSimulada = null;
    if (body.rule && body.rule.condicoes) {
      regraSimulada = {
        id: body.rule.id || -1,
        acao: body.rule.acao,
        prioridade: body.rule.prioridade != null ? body.rule.prioridade : 100,
        condicoes: body.rule.condicoes,
      };
      validarCondicoes(body.rule.condicoes, body.rule.escopos || ['EXTRATO_REALIZADO']);
    } else if (body.rule_id) {
      const r = await query('SELECT * FROM caixa_regras_consumo WHERE id=$1 AND empresa=$2', [parseInt(body.rule_id), empresa]);
      if (!r.rowCount) throw Object.assign(new Error('Regra não encontrada'), { status: 404 });
      regraSimulada = r.rows[0];
    }

    const encaixaEscopo = (r) => Array.isArray(r.escopos)
      ? r.escopos.includes('EXTRATO_REALIZADO') || r.escopos.includes('TODOS')
      : true;

    let regrasDepois = ativas.rows.filter((r) => encaixaEscopo(r));
    if (body.sem_esta_regra && regraSimulada) {
      regrasDepois = regrasDepois.filter((r) => r.id !== regraSimulada.id);
      regraSimulada = null;
    }
    if (regraSimulada && !body.sem_esta_regra) {
      regrasDepois = regrasDepois.filter((r) => r.id !== regraSimulada.id);
      regrasDepois.push(regraSimulada);
      regrasDepois.sort((a, b) => (b.prioridade || 100) - (a.prioridade || 100));
    }
    const regrasAntes = ativas.rows.filter((r) => encaixaEscopo(r));

    const dados = await query(
      `SELECT a.id, a.date::text AS data, a.description AS descricao, a.amount AS valor,
              a.institution_name AS banco, a.account_number AS conta, a.account_type AS tipo,
              a.source AS origem, a.status, a.razao_social,
              a.counterparty_document AS documento,
              ((a.category = 'TRANSFERENCIA_MESMA_INSTITUICAO') OR EXISTS (
                 SELECT 1 FROM extrator_items i WHERE i.client_id = a.client_id
                   AND REGEXP_REPLACE(COALESCE(i.business_tax_id,''), '\\D','','g') <> ''
                   AND REGEXP_REPLACE(COALESCE(i.business_tax_id,''), '\\D','','g')
                     = REGEXP_REPLACE(COALESCE(a.counterparty_document,''), '\\D','','g')
               )) AS transferencia
       FROM extrator_all_transactions a
       JOIN extrator_clients c ON c.id = a.client_id
       WHERE LOWER(TRIM(COALESCE(c.gestor_empresa, c.name))) = LOWER(TRIM($1))`, [empresa]);

    const trat = await query(
      `SELECT transacao_id, acao FROM caixa_extrato_tratamentos
       WHERE empresa=$1 AND origem='openfinance'`, [empresa]);
    const manualPorId = new Map();
    for (const t of trat.rows) {
      if (!manualPorId.has(t.transacao_id)) manualPorId.set(t.transacao_id, t.acao);
    }

    const avaliados = dados.rows.map((row) => {
      const lancamento = {
        status: row.status, origem: row.origem, banco: row.banco, conta: row.conta,
        tipo: row.tipo, descricao: row.descricao, razao_social: row.razao_social,
        documento: row.documento, valor: Number(row.valor), data: row.data,
        transferencia_entre_contas: row.transferencia,
      };
      const manualAcao = openfinanceKeys(row.id).map((k) => manualPorId.get(k)).find(Boolean);
      const manual = manualAcao === 'incluir' ? { inclusao: true }
        : manualAcao === 'excluir' ? { exclusao: true } : null;
      return {
        lancamento,
        transferencia: !!row.transferencia,
        antes: decidirConsumo(lancamento, { regras: regrasAntes, padrao: padroesAtuais.EXTRATO_REALIZADO || 'COMPOR', manual, transferencia: !!row.transferencia }),
        depois: decidirConsumo(lancamento, { regras: regrasDepois, padrao: padroesSimulados.EXTRATO_REALIZADO || 'COMPOR', manual, transferencia: !!row.transferencia }),
      };
    });

    const metricas = montarMetricas(avaliados);
    const dataSignature = await assinaturaDados(query, empresa);
    const snap = {
      regra_id: regraSimulada ? regraSimulada.id : null,
      versao: regraSimulada ? regraSimulada.versao || null : null,
      condicoes: regraSimulada ? regraSimulada.condicoes : null,
      acao: regraSimulada ? regraSimulada.acao : null,
      escopos: regraSimulada ? (regraSimulada.escopos || ['EXTRATO_REALIZADO']) : null,
      padroes: padroesSimulados,
      data_signature: dataSignature,
      metricas,
    };
    return {
      metricas,
      regras_ativas_no_preview: regrasDepois.filter((r) => !regraSimulada || r.id !== regraSimulada.id).length + (regraSimulada ? 1 : 0),
      snapshot: snap,
      preview_hash: hashPreview(empresa, snap),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  // Seção CLASSIFICAÇÃO
  suggestCategoriaForContraparte,
  upsertRegraClassificacao,
  upsertClassificacao,
  persistirSugestoesClassificacao,
  calcularPrioridade,
  confirmarClassificacaoTransacao,
  extrairRazaoSocialEfetiva,
  carregarLancamentosExtrato,
  calcularSugestaoParaLancamento,
  buscarClassificacoes,
  carregarCacheClassificacao,
  calcularSugestaoComCache,
  matchRegrasComCache,
  findCategoriaExtratoComCache,
  // Seção OFICIAL
  matchRegraClassificacao,
  resolverClassificacaoOficial,
  sqlJoinClassificacaoConfirmada,
  tabelaClassificacoesDisponivel,
  // Seção CONSUMO
  SCHEMA_VERSION,
  MAX_CONDICOES,
  ESCOPOS,
  ESCOPOS_COM_STATUS,
  CAMPOS,
  OPERADORES_POR_TIPO,
  validarCondicoes,
  compilarParaSql,
  avaliarConsumo,
  decidirConsumo,
  carregarContextoConsumo,
  montarMetricas,
  avaliarCondicao,
  normTexto,
  // Seção HTTP
  http: {
    handleRegrasClassificacao,
    handleConfirmarClassificacao,
    handleRegrasConsumo,
  },
};
