import { NextResponse } from 'next/server';
import { GESTOR_COMPANIES } from '@/gestor.config';

export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json(GESTOR_COMPANIES);
}
