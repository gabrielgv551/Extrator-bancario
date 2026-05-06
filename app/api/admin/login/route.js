import { NextResponse } from 'next/server';
import crypto from 'crypto';

const SALT = 'pluggy-admin-2024';

function sessionToken(password) {
  return crypto.createHmac('sha256', SALT).update(password).digest('hex');
}

export async function POST(request) {
  try {
    const { password } = await request.json();
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    if (password !== adminPassword) {
      return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 });
    }

    const token = sessionToken(adminPassword);
    const res = NextResponse.json({ success: true });
    res.cookies.set('admin_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
      sameSite: 'lax',
    });
    return res;
  } catch {
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
