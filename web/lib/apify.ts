// Apify-backed job sources: LinkedIn, Indeed and Glassdoor.
//
// Why this exists: the direct LinkedIn scraper in jobs.ts works from a home IP but is
// throttled to near-nothing from a datacenter one. Measured on the live Vercel deployment,
// the same query returned 35 LinkedIn results locally and 1 in production. Apify runs its
// actors through residential proxies, which is the part we cannot reproduce ourselves, and
// brings Indeed and Glassdoor along with it.
//
// Entirely opt-in: with no APIFY_TOKEN set, nothing here is registered as a board and the
// free sources behave exactly as before. Runs cost money, so results are cached longer
// than the free boards' and the per-run item count is capped.
//
// Actors are addressed by id (`username~actor-name`) and every one is overridable by env,
// because the Apify store's actors come and go and their input shapes differ. If an actor
// id is wrong the board reports its error and the other boards are unaffected — a failing
// board never blocks a search (see searchAllBoards).

import { titleMatchesQuery } from './job-quality';
import { isRecent, type SearchParams } from './jobs';
import { titleScore, type BoardJob } from './remote-boards';

export const APIFY_SOURCES = {
  'apify-linkedin': 'LinkedIn (Apify)',
  'apify-indeed': 'Indeed',
  'apify-glassdoor': 'Glassdoor'
} as const;

export type ApifySource = keyof typeof APIFY_SOURCES;

const TOKEN = process.env.APIFY_TOKEN || '';

/** Whether Apify is configured at all. Without a token none of these boards are used. */
export const apifyConfigured = Boolean(TOKEN);

export function isApifySource(s: string): s is ApifySource {
  return Object.prototype.hasOwnProperty.call(APIFY_SOURCES, s);
}

// Defaults point at widely-used store actors, but they are not guaranteed to exist or to
// keep their input shape — confirm the id on the Apify store and override if it differs.
const ACTORS: Record<ApifySource, string> = {
  'apify-linkedin': process.env.APIFY_LINKEDIN_ACTOR || 'bebity~linkedin-jobs-scraper',
  'apify-indeed': process.env.APIFY_INDEED_ACTOR || 'misceres~indeed-scraper',
  'apify-glassdoor': process.env.APIFY_GLASSDOOR_ACTOR || 'bebity~glassdoor-jobs-scraper'
};

// Only the sources whose actor id is non-empty run. Setting APIFY_LINKEDIN_ACTOR="" turns
// that one off without unsetting the token.
export function enabledApifySources(): ApifySource[] {
  return (Object.keys(APIFY_SOURCES) as ApifySource[]).filter(s => apifyConfigured && ACTORS[s].trim());
}

// An Apify run is a job, not a request: it starts a container, scrapes, then fills a
// dataset. run-sync-get-dataset-items waits for all of that and hands back the rows, so it
// stays inside the existing synchronous board architecture — but it is slow, and the search
// route's own ceiling is 60s (maxDuration). This stays under it with room for the response
// to be assembled, and a run that overruns is abandoned rather than failing the search.
const RUN_TIMEOUT_S = Number(process.env.APIFY_TIMEOUT_S || 40);
// Each row costs compute, and the search only ever shows the best ~20 per board
const MAX_ITEMS = Number(process.env.APIFY_MAX_ITEMS || 50);
// Runs are billed, so a repeated search reuses the previous one for far longer than the
// free boards' cache
const CACHE_TTL = Number(process.env.APIFY_CACHE_MINUTES || 60) * 60 * 1000;

const cache = new Map<string, { at: number; jobs: BoardJob[] }>();

/**
 * The actor's input. Job actors disagree on field names, so the common spellings are all
 * sent — an actor ignores the ones it doesn't declare. APIFY_<SOURCE>_INPUT replaces this
 * wholesale with raw JSON for an actor that wants something different entirely.
 */
function actorInput(source: ApifySource, params: SearchParams): Record<string, unknown> {
  const override = process.env[`APIFY_${source.replace('apify-', '').toUpperCase()}_INPUT`];
  if (override) {
    try {
      const parsed = JSON.parse(override) as Record<string, unknown>;
      // The query and row count still come from the search, so one stored input serves every search
      return { ...parsed, ...queryFields(params), maxItems: MAX_ITEMS };
    } catch {
      // A malformed override must not silently search for the wrong thing
      throw new Error(`APIFY_${source.replace('apify-', '').toUpperCase()}_INPUT is not valid JSON`);
    }
  }
  return {
    ...queryFields(params),
    maxItems: MAX_ITEMS,
    rows: MAX_ITEMS,
    // Residential proxies are the whole reason for routing through Apify: the datacenter
    // group is the one LinkedIn already blocks.
    proxy: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    publishedAt: params.maxAgeDays && params.maxAgeDays <= 7 ? 'r604800' : 'r2592000'
  };
}

function queryFields(params: SearchParams): Record<string, unknown> {
  const location = params.location && params.location !== 'Worldwide' ? params.location : '';
  return {
    title: params.query,
    keyword: params.query,
    position: params.query,
    searchQuery: params.query,
    queries: params.query,
    location,
    country: location
  };
}

const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  return s || null;
};

// Actors name the same field half a dozen ways; take the first that has a value.
const pick = (row: Record<string, unknown>, ...keys: string[]): string | null => {
  for (const k of keys) {
    const v = str(row[k]);
    if (v) return v;
  }
  return null;
};

/** One dataset row turned into the shape every other board returns. */
function toJob(source: ApifySource, row: Record<string, unknown>, i: number): BoardJob | null {
  const title = pick(row, 'title', 'jobTitle', 'positionName', 'position', 'name');
  const url = pick(row, 'url', 'jobUrl', 'link', 'applyUrl', 'jobLink', 'detailsUrl');
  // A row with no title or nowhere to apply is not a usable posting
  if (!title || !url) return null;

  const company = pick(row, 'companyName', 'company', 'employer', 'organization', 'company_name');
  const descriptionRaw = pick(row, 'description', 'descriptionText', 'jobDescription', 'snippet', 'summary');
  const skillsRaw = row.skills ?? row.tags ?? row.jobSkills;

  return {
    id: `${source}-${pick(row, 'id', 'jobId', 'key') || `${i}-${url.slice(-24)}`}`,
    title,
    company,
    location: pick(row, 'location', 'jobLocation', 'formattedLocation', 'place') || 'Remote',
    date: pick(row, 'postedAt', 'publishedAt', 'postingDateParsed', 'datePosted', 'date', 'postedTime'),
    url,
    work_mode: pick(row, 'workplaceType', 'workMode', 'remote') || null,
    skills: Array.isArray(skillsRaw) ? skillsRaw.map(s => String(s)).filter(Boolean).slice(0, 8) : [],
    description: descriptionRaw ? descriptionRaw.replace(/\s+/g, ' ').slice(0, 4000) : null,
    source: APIFY_SOURCES[source]
  };
}

async function runActor(source: ApifySource, params: SearchParams): Promise<Record<string, unknown>[]> {
  const actor = ACTORS[source];
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items`
    + `?token=${encodeURIComponent(TOKEN)}&timeout=${RUN_TIMEOUT_S}&maxItems=${MAX_ITEMS}&format=json`;

  // The run is abandoned a little after Apify's own deadline, so a hung connection can
  // never hold the whole search past the route's 60s ceiling.
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(actorInput(source, params)),
    signal: AbortSignal.timeout((RUN_TIMEOUT_S + 5) * 1000)
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // The token is in the URL, so nothing of it can reach the message Apify sends back
    const detail = body.slice(0, 200).replace(/\s+/g, ' ');
    if (res.status === 401 || res.status === 403) throw new Error(`Apify rejected the token (${res.status})`);
    if (res.status === 404) throw new Error(`Apify actor "${actor}" not found — check APIFY_${source.replace('apify-', '').toUpperCase()}_ACTOR`);
    throw new Error(`Apify ${actor} failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? data as Record<string, unknown>[] : [];
}

export async function searchApifyBoard(source: ApifySource, params: SearchParams): Promise<BoardJob[]> {
  if (!apifyConfigured) throw new Error('APIFY_TOKEN is not set');

  const key = `${source}|${JSON.stringify(params)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.jobs;

  const rows = await runActor(source, params);
  const jobs = rows
    .map((r, i) => toJob(source, r, i))
    .filter((j): j is BoardJob => j !== null)
    // Same two gates every other board applies, so Apify's extra reach can't lower the bar
    .filter(j => isRecent(j.date, params.maxAgeDays))
    .filter(j => !params.query.trim() || titleMatchesQuery(params.query, j.title))
    .map(j => ({ ...j, _score: titleScore(params.query, j.title) }))
    .sort((a, b) => b._score - a._score || String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, params.limit)
    .map(({ _score, ...j }) => j);

  cache.set(key, { at: Date.now(), jobs });
  return jobs;
}

/** Shown with the results, so a slow or empty Apify board explains itself. */
export function apifyNote(source: ApifySource): string | null {
  if (source === 'apify-linkedin') return 'LinkedIn via Apify residential proxies — slower than the free boards, and each run is billed to your Apify account.';
  return `${APIFY_SOURCES[source]} via Apify — each run is billed to your Apify account.`;
}
