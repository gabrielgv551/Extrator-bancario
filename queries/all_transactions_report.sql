SELECT
  a.id AS id,
  a.client_name AS cliente,
  a.date::date AS data_lancamento,
  to_char(a.date, 'HH24:MI:SS') AS hora_lancamento,
  to_char(a.date_transacted, 'DD/MM/YYYY') AS data_transacao,
  a.description AS descricao,
  CASE WHEN a.type = 'CREDIT' THEN 'Entrada' ELSE 'Saida' END AS tipo,
  replace(a.amount::text, '.', ',') AS valor_reais,
  replace(a.balance::text, '.', ',') AS saldo,
  a.category_l1 AS categoria_l1,
  a.category_l2 AS categoria_l2,
  a.category_l3 AS categoria_l3,
  a.account_name AS conta,
  a.account_number AS agencia_numero,
  a.account_type AS tipo_conta,
  a.institution_name AS banco,
  a.razao_social AS razao_social,
  CASE
    WHEN a.counterparty_document IS NULL THEN NULL
    WHEN length(a.counterparty_document) = 14
      THEN substring(a.counterparty_document, 1, 2) || '.' || substring(a.counterparty_document, 3, 3) || '.' || substring(a.counterparty_document, 6, 3) || '/' || substring(a.counterparty_document, 9, 4) || '-' || substring(a.counterparty_document, 13, 2)
    WHEN length(a.counterparty_document) = 11
      THEN substring(a.counterparty_document, 1, 3) || '.' || substring(a.counterparty_document, 4, 3) || '.' || substring(a.counterparty_document, 7, 3) || '-' || substring(a.counterparty_document, 10, 2)
    ELSE a.counterparty_document
  END AS cnpj_cpf,
  CASE WHEN a.source = 'credit' THEN 'Cartao de Credito' ELSE 'Conta Bancaria' END AS origem,
  a.status AS status,
  a.api_order
FROM all_transactions a
WHERE a.status = 'POSTED'
ORDER BY a.date ASC, a.api_order ASC;
