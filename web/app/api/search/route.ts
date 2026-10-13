import { searchFreehire, searchLinkedIn } from '@/lib/jobs';
import { isRemoteSource, searchRemoteBoard, boardNote, REMOTE_SOURCES } from '@/lib/remote-boards';
import { isApifySource, searchApifyBoard, apifyNote, apifyConfigured, APIFY_SOURCES } from '@/lib/apify';
import { searchAllBoards, vetBoardResults } from '@/lib/search-all';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TIMEOUT_MS = 45000;

export async function POST(req: Request) {
  try {
    const { query = 'Senior Full Stack Engineer', location = 'Worldwide', portal = 'all', limit = 10, maxAgeDays = 7 } = await req.json().catch(() => ({}));
    const params = {
      query: String(query).slice(0, 200),
      location: String(location),
      // Kairo only lists remote jobs
      remoteOnly: true,
      // Posted within the last N days (default one week)
      maxAgeDays: Math.min(30, Math.max(1, parseInt(maxAgeDays) || 7)),
      limit: Math.min(40, Math.max(1, parseInt(limit) || 10))
    };

    // Default: every job board at once
    if (!portal || portal === 'all') {
      const { results, boards } = await searchAllBoards(params);
      return Response.json({ portal: 'all', results, boards });
    }
    // An Apify source asked for by name without a token configured is a setup mistake, not
    // an empty result: say so rather than silently answering with Freehire's jobs instead.
    if (isApifySource(portal) && !apifyConfigured) {
      return Response.json({ error: `${APIFY_SOURCES[portal]} needs APIFY_TOKEN to be set.` }, { status: 400 });
    }
    const tool = portal === 'linkedin' || isRemoteSource(portal) || isApifySource(portal) ? portal : 'freehire';

    let search: Promise<object[]>;
    let label: string;
    if (tool === 'linkedin') { search = searchLinkedIn(params); label = 'LinkedIn'; }
    else if (isApifySource(tool)) { search = searchApifyBoard(tool, params); label = APIFY_SOURCES[tool]; }
    else if (isRemoteSource(tool)) { search = searchRemoteBoard(tool, params); label = REMOTE_SOURCES[tool]; }
    else { search = searchFreehire(params); label = 'Freehire'; }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('The job board took too long to respond. Try again.')), TIMEOUT_MS));
    const found = (await Promise.race([search, timeout])) as { title?: string | null; company?: string | null; url?: string | null }[];
    const results = vetBoardResults(tool, found, params.query).map(r => ({ source: label, portal: tool, ...r }));

    return Response.json({
      portal: tool,
      source: label,
      results,
      note: isApifySource(tool) ? apifyNote(tool) : isRemoteSource(tool) ? boardNote(tool, params.location) : null
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
