// Lista pré-definida de classificação manual de receitas e despesas.
// Usada pela página de classificação e validada na API de atualização.

export const CLASSIFICACOES = {
  'Receita': [
    'Vendas',
    'Serviços Prestados',
    'Recebimento de Empréstimos',
    'Reembolso',
    'Transferência Entre Contas',
    'Outras Receitas',
  ],
  'Despesa': [
    'Impostos e Taxas',
    'Folha de Pagamento',
    'Fornecedores',
    'Aluguel e Condomínio',
    'Energia/Água/Telefone/Internet',
    'Tarifas Bancárias',
    'Combustível e Veículos',
    'Marketing e Publicidade',
    'Transferência Entre Contas',
    'Outras Despesas',
  ],
};

export function isValidClassificacao(l1, l2) {
  if (l1 === null && l2 === null) return true; // limpar classificação
  if (!l1 || !CLASSIFICACOES[l1]) return false;
  if (!l2) return false;
  return CLASSIFICACOES[l1].includes(l2);
}

// Valida contra o plano de contas do cliente (lista de linhas do extrator_plano_contas).
// Aceita somente grupos ativos (parentId null) e contas ativas filhas do grupo.
export function isValidClassificacaoPlano(plano, l1, l2) {
  if (l1 === null && l2 === null) return true; // limpar classificação
  if (!l1 || !l2) return false;
  const grupo = plano.find((p) => !p.parentId && p.ativo && p.nome === l1);
  if (!grupo) return false;
  return plano.some((p) => p.parentId === grupo.id && p.ativo && p.nome === l2);
}
