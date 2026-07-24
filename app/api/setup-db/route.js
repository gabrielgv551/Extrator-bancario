import { NextResponse } from 'next/server';
import { setupDatabase } from '@/lib/setup-db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(request) {
  const authHeader = request.headers.get('authorization') || '';
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (process.env.CRON_SECRET && authHeader === expected) return true;

  const adminCookie = request.headers.get('cookie') || '';
  if (adminCookie.includes('admin_session=')) return true;

  return false;
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const databaseName = await setupDatabase();
    return NextResponse.json({
      success: true,
      database: databaseName,
      message: 'Schema atualizado com sucesso',
    });
  } catch (err) {
    console.error('[setup-db] erro:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ ok: true, usage: 'POST /api/setup-db' });
}
