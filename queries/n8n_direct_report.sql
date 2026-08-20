SELECT
  id,
  cliente,
  data_lancamento,
  hora_lancamento,
  data_transacao,
  descricao,
  tipo,
  valor_reais,
  saldo,
  categoria_l1,
  categoria_l2,
  categoria_l3,
  conta,
  agencia_numero,
  tipo_conta,
  banco,
  razao_social,
  cnpj_cpf,
  origem,
  status,
  api_order,
  data_lancamento_raw
FROM (
  SELECT
    t.id,
    c.name AS cliente,
    to_char(t.date::date, 'DD/MM/YYYY') AS data_lancamento,
    to_char(t.date, 'HH24:MI:SS') AS hora_lancamento,
    to_char(t.date_transacted::date, 'DD/MM/YYYY') AS data_transacao,
    t.description AS descricao,
    CASE WHEN t.type = 'CREDIT' THEN 'Entrada' ELSE 'Saida' END AS tipo,
    replace(t.amount::text, '.', ',') AS valor_reais,
    replace(t.balance::text, '.', ',') AS saldo,
    t.category_l1 AS categoria_l1,
    t.category_l2 AS categoria_l2,
    t.category_l3 AS categoria_l3,
    t.account_name AS conta,
    t.account_number AS agencia_numero,
    t.account_type AS tipo_conta,
    t.institution_name AS banco,
    t.counterparty_name AS razao_social,
    CASE
      WHEN t.counterparty_document IS NULL THEN NULL
      WHEN length(t.counterparty_document) = 14
        THEN substring(t.counterparty_document, 1, 2) || '.' || substring(t.counterparty_document, 3, 3) || '.' || substring(t.counterparty_document, 6, 3) || '/' || substring(t.counterparty_document, 9, 4) || '-' || substring(t.counterparty_document, 13, 2)
      WHEN length(t.counterparty_document) = 11
        THEN substring(t.counterparty_document, 1, 3) || '.' || substring(t.counterparty_document, 4, 3) || '.' || substring(t.counterparty_document, 7, 3) || '-' || substring(t.counterparty_document, 10, 2)
      ELSE t.counterparty_document
    END AS cnpj_cpf,
    'Conta Bancaria' AS origem,
    t.status,
    t.api_order,
    t.date::date AS data_lancamento_raw
  FROM transactions t
  LEFT JOIN clients c ON c.id = t.client_id

  UNION ALL

  SELECT
    ct.id,
    c.name AS cliente,
    to_char(ct.date::date, 'DD/MM/YYYY') AS data_lancamento,
    to_char(ct.date, 'HH24:MI:SS') AS hora_lancamento,
    to_char(ct.date_transacted::date, 'DD/MM/YYYY') AS data_transacao,
    ct.description AS descricao,
    CASE WHEN ct.type = 'CREDIT' THEN 'Entrada' ELSE 'Saida' END AS tipo,
    replace(ct.amount::text, '.', ',') AS valor_reais,
    replace(ct.balance::text, '.', ',') AS saldo,
    ct.category_l1 AS categoria_l1,
    ct.category_l2 AS categoria_l2,
    ct.category_l3 AS categoria_l3,
    ct.account_name AS conta,
    ct.account_number AS agencia_numero,
    ct.account_type AS tipo_conta,
    ct.institution_name AS banco,
    ct.counterparty_name AS razao_social,
    CASE
      WHEN ct.counterparty_document IS NULL THEN NULL
      WHEN length(ct.counterparty_document) = 14
        THEN substring(ct.counterparty_document, 1, 2) || '.' || substring(ct.counterparty_document, 3, 3) || '.' || substring(ct.counterparty_document, 6, 3) || '/' || substring(ct.counterparty_document, 9, 4) || '-' || substring(ct.counterparty_document, 13, 2)
      WHEN length(ct.counterparty_document) = 11
        THEN substring(ct.counterparty_document, 1, 3) || '.' || substring(ct.counterparty_document, 4, 3) || '.' || substring(ct.counterparty_document, 7, 3) || '-' || substring(ct.counterparty_document, 10, 2)
      ELSE ct.counterparty_document
    END AS cnpj_cpf,
    'Cartao de Credito' AS origem,
    ct.status,
    ct.api_order,
    ct.date::date AS data_lancamento_raw
  FROM credit_transactions ct
  LEFT JOIN clients c ON c.id = ct.client_id
) all_tx
ORDER BY data_lancamento_raw ASC, api_order ASC;
