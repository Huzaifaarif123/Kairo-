import { linkedinDetail } from '@/lib/jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Full posting for a LinkedIn search result (its search results carry no description)
export async function POST(req: Request) {
  try {
    const { portal = 'linkedin', id = '' } = await req.json().catch(() => ({}));
    if (portal !== 'linkedin' || !/^\d{6,}$/.test(String(id))) {
      return Response.json({ error: 'Invalid job reference' }, { status: 400 });
    }
    return Response.json(await linkedinDetail(String(id)));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
