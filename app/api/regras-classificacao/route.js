import { NextResponse } from 'next/server';
import { getCompanyPool, requireEmpresaFromHeader } from '@/lib/company-db';
import {
  garantirSchema,
  listarRegras,
  criarRegra,
  atualizarRegra,
  excluirRegra,
  sugerirCategoria,
} from '@/lib/regras-classificacao';

export const dynamic = 'force-dynamic';

// Regras de pré-classificação da empresa (tabela caixa_regras_classificacao,
// aplicacao='extrato'). Empresa vem do header x-extrator-empresa.
export async function GET(request) {
  try {
    const empresa = requireEmpresaFromHeader(request);
    const pool = await getCompanyPool(empresa);
    await garantirSchema(pool, empresa);
    const regras = await listarRegras(pool, empresa);
    return NextResponse.json({ regras });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST body:
//  - { suggestOnly: true, descricao, tipo, razao_social, documento, banco }
//    → apenas calcula a sugestão, sem gravar regra.
//  - { l1, l2, descricao_padrao, tipo_padrao, razao_social_padrao,
//      documento_padrao, banco_padrao, prioridade, ativo }
//    → cria (ou atualiza, se já existir regra equivalente) a regra.
export async function POST(request) {
  try {
    const empresa = requireEmpresaFromHeader(request);
    const pool = await getCompanyPool(empresa);
    await garantirSchema(pool, empresa);

    const body = await request.json();
    if (body.suggestOnly) {
      const sugestao = await sugerirCategoria(pool, empresa, body);
      return NextResponse.json({ sugestao });
    }

    const regra = await criarRegra(pool, empresa, body);
    return NextResponse.json({ regra });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

// PATCH body: { id, ...campos } (ativo, prioridade, condições, l1/l2)
export async function PATCH(request) {
  try {
    const empresa = requireEmpresaFromHeader(request);
    const pool = await getCompanyPool(empresa);
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });
    const regra = await atualizarRegra(pool, empresa, body.id, body);
    return NextResponse.json({ regra });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

// DELETE body: { id }
export async function DELETE(request) {
  try {
    const empresa = requireEmpresaFromHeader(request);
    const pool = await getCompanyPool(empresa);
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 });
    await excluirRegra(pool, empresa, body.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
