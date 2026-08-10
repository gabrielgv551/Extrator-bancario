import { NextResponse } from 'next/server';

function validEmpresa(value) {
  if (!value || typeof value !== 'string') return null;
  const slug = value.toLowerCase().trim();
  if (slug === '__geral__') return '__geral__';
  return slug.replace(/[^a-z0-9_-]/g, '') || null;
}

export async function POST(request) {
  try {
    const { empresa } = await request.json();
    const slug = validEmpresa(empresa);
    if (!slug) {
      return NextResponse.json({ error: 'Empresa inválida' }, { status: 400 });
    }

    const res = NextResponse.json({ success: true, empresa: slug });
    res.cookies.set('extrator_empresa', slug, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
      sameSite: 'lax',
    });
    return res;
  } catch (err) {
    console.error('[admin/select-company] erro:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
