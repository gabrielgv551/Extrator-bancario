import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { listActiveCompanies } from '@/lib/company-db';

const SALT = 'pluggy-admin-2024';

function sessionToken(password) {
  return crypto.createHmac('sha256', SALT).update(password).digest('hex');
}

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      return NextResponse.json({ error: 'Admin não configurado' }, { status: 500 });
    }

    const session = request.cookies.get('admin_session')?.value;
    const empresa = request.cookies.get('extrator_empresa')?.value;
    const expected = sessionToken(adminPassword);

    if (session !== expected) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const companies = await listActiveCompanies();
    const companyList = companies.map((c) => (typeof c === 'string' ? { slug: c, name: c.toUpperCase() } : c));

    if (!empresa || empresa === '__geral__') {
      return NextResponse.json({ mode: 'geral', empresa: null, companies: companyList });
    }

    const company = companyList.find((c) => c.slug === empresa);
    return NextResponse.json({ mode: 'empresa', empresa, company: company || null });
  } catch (err) {
    console.error('[admin/me] erro:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
