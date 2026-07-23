import { NextResponse } from 'next/server';
import { getClientByToken } from '@/lib/storage';
import { getAccessToken, createLink, getInstitutions } from '@/lib/klavi';

export const dynamic = 'force-dynamic';

export async function GET(_, { params }) {
  const { token } = await params;
  const client = await getClientByToken(token);
  if (!client) return NextResponse.json({ error: 'Portal não encontrado' }, { status: 404 });

  try {
    // Criamos um link temporário apenas para listar instituições (sem CNPJ obrigatório neste momento).
    const redirectUrl = `${process.env.KLAVI_WEBHOOK_URL || ''}`; // não usado aqui
    const link = await createLink({ redirectUrl });
    const institutions = await getInstitutions(link.linkToken);

    return NextResponse.json({
      linkId: link.linkId,
      linkToken: link.linkToken,
      institutions: (institutions || []).map(i => ({
        institutionCode: i.institutionCode,
        name: i.name,
        avatar: i.avatar,
        isOutage: i.isOutage,
        businessType: i.businessType,
        availableResources: i.availableResources || [],
      })),
    });
  } catch (error) {
    console.error('[portal institutions] erro:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
