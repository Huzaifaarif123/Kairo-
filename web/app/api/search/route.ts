import { searchFreehire, searchLinkedIn } from '@/lib/jobs';
import { isRemoteSource, searchRemoteBoard, boardNote, REMOTE_SOURCES } from '@/lib/remote-boards';
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
    const tool = portal === 'linkedin' || isRemoteSource(portal) ? portal : 'freehire';

    let search: Promise<object[]>;
    let label: string;
    if (tool === 'linkedin') { search = searchLinkedIn(params); label = 'LinkedIn'; }
    else if (isRemoteSource(tool)) { search = searchRemoteBoard(tool, params); label = REMOTE_SOURCES[tool]; }
    else { search = searchFreehire(params); label = 'Freehire'; }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('The job board took too long to respond. Try again.')), TIMEOUT_MS));
    const found = (await Promise.race([search, timeout])) as { title?: string | null; company?: string | null; url?: string | null }[];
    // Staffing-agency postings last
    const results = vetBoardResults(tool, found, params.query)
      .sort((a, b) => Number(Boolean((a as { staffing?: boolean }).staffing)) - Number(Boolean((b as { staffing?: boolean }).staffing)))
      .map(r => ({ source: label, portal: tool, ...r }));

    return Response.json({
      portal: tool,
      source: label,
      results,
      note: isRemoteSource(tool) ? boardNote(tool, params.location) : null
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
