import { listProfiles } from '@/lib/profiles';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(await listProfiles());
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
