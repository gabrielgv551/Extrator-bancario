import { NextResponse } from 'next/server';
import { forEachCompany, getCompanyPool } from '@/lib/company-db';
import { runMultiTenantSync, syncCompany } from '@/lib/cron-sync';

export const dynamic = 'force-dynamic';
// A cron processa dezenas de empresas; 60s costuma estourar antes de chegar
// nos últimos tenants. O limite real depende do plano Vercel (Hobby: 60s, Pro: 300s).
export const maxDuration = 300;

export async function GET(request) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const hasSecret = secret && authHeader === `Bearer ${secret}`;
  if (!isVercelCron && !hasSecret) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const filterClientId = searchParams.get('clientId') || null;
  const filterEmpresa = searchParams.get('empresa') || null;

  let companyResults;
  if (filterEmpresa) {
    const pool = await getCompanyPool(filterEmpresa);
    companyResults = [await syncCompany({ empresa: filterEmpresa, pool, filterClientId })];
  } else {
    companyResults = await runMultiTenantSync({ filterClientId, forEachCompany });
  }

  return NextResponse.json({ synced_at: new Date().toISOString(), companies: companyResults });
}
