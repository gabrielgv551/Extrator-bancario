import { NextResponse } from 'next/server';
import crypto from 'crypto';

const SALT = 'pluggy-admin-2024';

function sessionToken(password) {
  return crypto.createHmac('sha256', SALT).update(password).digest('hex');
}

function validEmpresa(value) {
  if (!value || typeof value !== 'string') return null;
  const slug = value.toLowerCase().trim();
  if (slug === '__geral__') return '__geral__';
  return slug.replace(/[^a-z0-9_-]/g, '') || null;
}

export async function POST(request) {
  try {
    const { empresa, password } = await request.json();
    const adminPassword = process.env.ADMIN_PASSWORD;
    console.log('[admin/login] requisição recebida. ADMIN_PASSWORD configurada:', !!adminPassword);
    if (!adminPassword) {
      return NextResponse.json({ error: 'Admin não configurado' }, { status: 500 });
    }

    const empresaSlug = validEmpresa(empresa);
    if (!empresaSlug) {
      return NextResponse.json({ error: 'Informe uma empresa válida' }, { status: 400 });
    }

    if (password !== adminPassword) {
      console.log('[admin/login] senha incorreta');
      return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 });
    }

    console.log('[admin/login] senha correta, empresa=', empresaSlug);
    const token = sessionToken(adminPassword);
    const res = NextResponse.json({ success: true, empresa: empresaSlug });
    res.cookies.set('admin_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
      sameSite: 'lax',
    });
    res.cookies.set('extrator_empresa', empresaSlug, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
      sameSite: 'lax',
    });
    return res;
  } catch (err) {
    console.error('[admin/login] erro interno:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
