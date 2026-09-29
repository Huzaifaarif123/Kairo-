import { resolveProfile, evaluateAgainstProfile, usesOriginalOwner } from '@/lib/profiles';
import { evaluateDefault } from '@/lib/evaluate-default';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const profile = resolveProfile(new URL(req.url).searchParams.get('profile'));
    const { title = '', description = '' } = await req.json().catch(() => ({}));
    return Response.json((await usesOriginalOwner(profile)) ? evaluateDefault({ title, description }) : await evaluateAgainstProfile(profile, { title, description }));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
