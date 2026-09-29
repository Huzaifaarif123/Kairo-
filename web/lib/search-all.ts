// Search every job board at once and merge the results.
//
// Each board runs in parallel with its own time limit, so one slow or failing board
// never blocks the others; its problem is reported alongside the results instead.
// Identical postings found on several boards are shown once, and the best title
// matches come first.

import { searchFreehire, searchLinkedIn, type SearchParams } from './jobs';
import { REMOTE_SOURCES, searchRemoteBoard, titleScore, norm, type RemoteSource } from './remote-boards';
import { vetJobs } from './job-quality';

// Each board's own site: its postings link there, which is expected
const OWN_DOMAINS: Record<string, string[]> = {
  linkedin: ['linkedin.com'],
  remotive: ['remotive.com'],
  jobicy: ['jobicy.com'],
  himalayas: ['himalayas.app'],
  remoteok: ['remoteok.com'],
  arbeitnow: ['arbeitnow']
};

/**
 * Drops results that aren't genuine postings for the role searched for (see job-quality.ts).
 * LinkedIn's own search already matches titles (including other languages), so only its
 * data is checked, not its titles.
 */
export function vetBoardResults<T extends { title?: string | null; company?: string | null; url?: string | null }>(portal: string, jobs: T[], query: string): T[] {
  const { kept, dropped } = vetJobs(jobs, query, { ownDomains: OWN_DOMAINS[portal] || [], checkTitle: portal !== 'linkedin' });
  if (dropped.length && process.env.NODE_ENV !== 'production') {
    console.log(`[search] ${portal}: dropped ${dropped.length} —`, dropped.map(d => `${d.title} @ ${d.company} (${d.reason})`).join('; '));
  }
  return kept;
}

const PER_BOARD_TIMEOUT_MS = 25000;
// Ask each board for more than we show: the "posted within" filter removes some
const PER_BOARD_FETCH = 25;
const PER_BOARD_LIMIT = 15;
const MAX_RESULTS = 90;
const CACHE_MS = 10 * 60 * 1000;

type Job = Record<string, any> & { title: string; company?: string | null; date?: string | null; source: string; portal: string };

interface Board {
  portal: string;
  label: string;
  run: (p: SearchParams) => Promise<object[]>;
}

const BOARDS: Board[] = [
  // Many Freehire results are re-listings on other job sites and get dropped, so ask for more
  { portal: 'freehire', label: 'Freehire', run: p => searchFreehire({ ...p, limit: 50 }) },
  { portal: 'linkedin', label: 'LinkedIn', run: searchLinkedIn },
  ...(Object.keys(REMOTE_SOURCES) as RemoteSource[]).map(key => ({
    portal: key,
    label: REMOTE_SOURCES[key],
    run: (p: SearchParams) => searchRemoteBoard(key, p)
  }))
];

export const BOARD_COUNT = BOARDS.length;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} took too long to respond`)), ms))
  ]);
}

export interface BoardStatus { source: string; count: number; error?: string }

const cache = new Map<string, { at: number; value: { results: Job[]; boards: BoardStatus[] } }>();

export async function searchAllBoards(params: SearchParams): Promise<{ results: Job[]; boards: BoardStatus[] }> {
  const key = JSON.stringify(params);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const perBoard = { ...params, limit: PER_BOARD_FETCH };
  const settled = await Promise.allSettled(BOARDS.map(b => withTimeout(b.run(perBoard), PER_BOARD_TIMEOUT_MS, b.label)));

  const boards: BoardStatus[] = [];
  const all: Job[] = [];
  settled.forEach((r, i) => {
    const b = BOARDS[i];
    if (r.status === 'fulfilled') {
      const jobs = vetBoardResults(b.portal, r.value as Job[], params.query).slice(0, PER_BOARD_LIMIT).map(j => ({ ...j, source: b.label, portal: b.portal }));
      boards.push({ source: b.label, count: jobs.length });
      all.push(...jobs);
    } else {
      boards.push({ source: b.label, count: 0, error: (r.reason as Error)?.message || 'failed' });
    }
  });

  // The same posting on several boards is shown once (first board wins)
  const seen = new Set<string>();
  const unique = all.filter(j => {
    const k = `${norm(j.title || '').replace(/\s+/g, ' ').trim()}|${norm(j.company || '').replace(/\s+/g, ' ').trim()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Best title matches first, then newest; ties keep boards interleaved for variety
  const position = new Map<Job, number>();
  const perSource = new Map<string, number>();
  for (const j of unique) {
    const n = perSource.get(j.source) || 0;
    position.set(j, n);
    perSource.set(j.source, n + 1);
  }
  const ranked = unique
    .map(j => ({ j, score: titleScore(params.query, j.title || ''), time: Date.parse(j.date || '') || 0 }))
    .sort((a, b) => b.score - a.score || (position.get(a.j)! - position.get(b.j)!) || b.time - a.time)
    .map(x => x.j)
    .slice(0, MAX_RESULTS);

  const value = { results: ranked, boards };
  // Only cache complete answers, so a temporary failure isn't remembered
  if (boards.every(b => !b.error)) cache.set(key, { at: Date.now(), value });
  if (cache.size > 100) cache.delete(cache.keys().next().value as string);
  return value;
}
