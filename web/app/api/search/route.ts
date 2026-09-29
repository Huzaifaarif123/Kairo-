import { searchFreehire, searchLinkedIn } from '@/lib/jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TIMEOUT_MS = 45000;

export async function POST(req: Request) {
  try {
    const { query = 'Senior Full Stack Engineer', location = 'Worldwide', remoteOnly = false, portal = 'freehire', limit = 10 } = await req.json().catch(() => ({}));
    const tool = portal === 'linkedin' ? 'linkedin' : 'freehire';
    const params = {
      query: String(query),
      location: String(location),
      remoteOnly: Boolean(remoteOnly),
      limit: Math.min(25, Math.max(1, parseInt(limit) || 10))
    };
    const search = tool === 'linkedin' ? searchLinkedIn(params) : searchFreehire(params);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('The job board took too long to respond. Try again.')), TIMEOUT_MS));
    const results = await Promise.race([search, timeout]);
    return Response.json({ portal: tool, results, remoteApprox: tool === 'linkedin' && params.remoteOnly });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
