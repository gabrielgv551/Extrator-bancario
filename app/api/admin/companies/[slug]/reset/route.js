import { NextResponse } from 'next/server';
import { getCentralConfig } from '@/lib/company-db';
import { resetCompanyDatabase } from '@/lib/setup-company-db';

function validSlug(value) {
  if (!value || typeof value !== 'string') return null;
  const slug = value.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '').slice(0, 50);
  return slug || null;
}

function isGeral(request) {
  return request.cookies.get('extrator_empresa')?.value === '__geral__';
}

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  try {
    if (!isGeral(request)) {
      return NextResponse.json({ error: 'Acesso restrito ao admin geral' }, { status: 403 });
    }

    const { slug } = await params;
    const empresaSlug = validSlug(slug);
    if (!empresaSlug) {
      return NextResponse.json({ error: 'Slug inválido' }, { status: 400 });
    }

    const dbName = `have_${empresaSlug}`;
    await resetCompanyDatabase(getCentralConfig(), dbName);

    return NextResponse.json({ success: true, slug: empresaSlug });
  } catch (err) {
    console.error('[admin/companies/reset] erro:', err);
    return NextResponse.json({ error: err.message || 'Erro interno' }, { status: 500 });
  }
}
