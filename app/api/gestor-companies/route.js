import { NextResponse } from 'next/server';
import { GESTOR_COMPANIES } from '@/gestor.config';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(GESTOR_COMPANIES);
}
