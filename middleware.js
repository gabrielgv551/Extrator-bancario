import { NextResponse } from 'next/server';

const PUBLIC = ['/login', '/portal', '/api/portal', '/api/admin/login', '/api/gestor/client', '/api/cron/sync', '/api/webhooks/pluggy', '/api/webhooks/klavi', '/api/debug'];
const SALT = 'pluggy-admin-2024';

async function sessionToken(password) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(SALT), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(password));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (PUBLIC.some((p) => pathname.startsWith(p))) {
    // Rotas publicas do portal resolvem a empresa pelo portal_token (lib central-token-map),
    // nao pelo pathname. Admin continua usando cookie extrator_empresa abaixo.
    return NextResponse.next();
  }
  if (pathname.startsWith('/_next') || pathname === '/favicon.ico') return NextResponse.next();

  const session = request.cookies.get('admin_session')?.value;
  const empresa = request.cookies.get('extrator_empresa')?.value;
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error('[middleware] ADMIN_PASSWORD não configurada');
    return NextResponse.redirect(new URL('/login', request.url));
  }
  const expected = await sessionToken(password);

  if (session !== expected || !empresa) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  request.headers.set('x-extrator-empresa', empresa);
  return NextResponse.next({
    request: {
      headers: request.headers,
    },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
