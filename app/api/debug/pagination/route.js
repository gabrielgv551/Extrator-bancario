import { NextResponse } from 'next/server';
import { getApiKey, getAccounts } from '@/lib/pluggy';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PLUGGY_API_BASE = 'https://api.pluggy.ai';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get('itemId') || 'bf8c5ceb-54cb-4e30-9069-1578aca8ac1c';
  const from   = searchParams.get('from')   || '2026-05-01';
  const to     = searchParams.get('to')     || '2026-05-11';

  const apiKey   = await getApiKey();
  const accounts = await getAccounts(itemId);
  const report   = [];

  for (const account of accounts) {
    const accountReport = {
      accountId: account.id,
      accountName: account.name,
      accountType: account.type,
      pages: [],
    };

    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const url = `${PLUGGY_API_BASE}/transactions?accountId=${account.id}&page=${page}&pageSize=500&from=${from}&to=${to}`;
      try {
        const res  = await fetch(url, { headers: { 'X-API-KEY': apiKey } });
        const text = await res.text();

        if (!res.ok) {
          accountReport.pages.push({ page, error: `HTTP ${res.status}`, body: text.slice(0, 300) });
          break;
        }

        const data = JSON.parse(text);
        totalPages = data.totalPages;

        const dates = data.results.map(tx => tx.date?.slice(0, 10)).filter(Boolean);
        accountReport.pages.push({
          page,
          totalPages,
          total: data.total,
          returned: data.results.length,
          dateMin: dates.length ? dates[dates.length - 1] : null,
          dateMax: dates.length ? dates[0] : null,
        });

        page++;
      } catch (err) {
        accountReport.pages.push({ page, error: err.message });
        break;
      }
    }

    report.push(accountReport);
  }

  return NextResponse.json({ itemId, from, to, report });
}
