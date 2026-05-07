import { NextResponse } from 'next/server';

const PUBLIC = ['/login', '/portal', '/api/portal', '/api/admin/login', '/api/cron', '/api/clients'];
const SALT = 'pluggy-admin-2024';

async function sessionToken(password) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(SALT), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(password));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith('/_next') || pathname === '/favicon.ico') return NextResponse.next();

  const session = request.cookies.get('admin_session')?.value;
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const expected = await sessionToken(password);

  if (session !== expected) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
