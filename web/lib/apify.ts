// Apify-backed job sources: LinkedIn, Glassdoor, and Indeed plus the ATS boards.
//
// Why this exists: the direct LinkedIn scraper in jobs.ts works from a home IP but is
// throttled to near-nothing from a datacenter one. Measured on the live Vercel deployment,
// the same query returned 35 LinkedIn results locally and 1 in production. Apify runs its
// actors through residential proxies, which is the part we cannot reproduce ourselves, and
// brings Glassdoor and Indeed along with it — neither has a free API.
//
// Entirely opt-in: with no APIFY_TOKEN set, nothing here is registered as a board and the
// free sources behave exactly as before. Runs are billed, so results are cached far longer
// than the free boards' and the per-run row count is capped.
//
// The defaults are AgentX's actors because the three share one input shape (keyword,
// country, location, max_results, …), so a single builder drives all of them. Any actor id
// is overridable; an actor with a different input shape needs its dialect set too, or its
// input supplied verbatim as JSON. If an id is wrong the board reports its own error and
// the other boards are unaffected — a failing board never blocks a search.

import { titleMatchesQuery } from './job-quality';
import { isRecent, type SearchParams } from './jobs';
import { titleScore, type BoardJob } from './remote-boards';

export const APIFY_SOURCES = {
  'apify-linkedin': 'LinkedIn (Apify)',
  'apify-glassdoor': 'Glassdoor',
  'apify-alljobs': 'Indeed & job boards'
} as const;

export type ApifySource = keyof typeof APIFY_SOURCES;

const TOKEN = process.env.APIFY_TOKEN || '';

/** Whether Apify is configured at all. Without a token none of these boards are used. */
export const apifyConfigured = Boolean(TOKEN);

export function isApifySource(s: string): s is ApifySource {
  return Object.prototype.hasOwnProperty.call(APIFY_SOURCES, s);
}

const ENV_KEY: Record<ApifySource, string> = {
  'apify-linkedin': 'LINKEDIN',
  'apify-glassdoor': 'GLASSDOOR',
  'apify-alljobs': 'ALLJOBS'
};

// Verified against a real account. Timings measured on the free plan, searching
// "Senior Data Engineer":
//
//   bebity~linkedin-jobs-scraper   ~23s, succeeds — on by default
//   agentx~linkedin-jobs-scraper   33s / 48s / >55s across three runs — too variable
//   agentx~glassdoor-jobs-scraper  >55s, times out — off by default
//   agentx~all-jobs-scraper        >55s, times out — off by default
//
// bebity is the default because it is both the fastest and the only one that finished
// every time. AgentX's LinkedIn actor succeeded twice and timed out once on identical
// input, and a source that drops out at random is worse than one that is simply absent.
//
// These actors start a container before they scrape, so they take tens of seconds whatever
// max_results is set to — dropping it from 50 to 10 changed nothing. The search route's
// ceiling is 60s (maxDuration) and boards run in parallel, so the search costs the slowest
// board: with all three on it measured 56.0s, close enough to 60 that the whole search
// would fail rather than just one board. Only the one that fits is on by default.
//
// To enable the others, set their id below AND give the route more room than Vercel's 60s
// — or move Apify off the request path entirely (start the run, store its id, collect the
// results afterwards), which is the real fix for actors this slow.
// all-jobs-scraper covers Indeed plus the ATS boards (Greenhouse, Lever, Ashby and the
// rest of its 42 platforms) in one run, which is why there is no separate Indeed actor.
const ACTORS: Record<ApifySource, string> = {
  'apify-linkedin': process.env.APIFY_LINKEDIN_ACTOR ?? 'bebity~linkedin-jobs-scraper',
  'apify-glassdoor': process.env.APIFY_GLASSDOOR_ACTOR ?? '',
  'apify-alljobs': process.env.APIFY_ALLJOBS_ACTOR ?? ''
};

/**
 * Which input shape an actor wants. "agentx" covers the three defaults above; "bebity" is
 * the other widely-used LinkedIn actor, whose schema takes arrays rather than strings.
 * Inferred from the actor id so swapping to a known actor needs no second setting.
 */
type Dialect = 'agentx' | 'bebity';

function dialectFor(source: ApifySource): Dialect {
  const explicit = process.env[`APIFY_${ENV_KEY[source]}_DIALECT`];
  if (explicit === 'agentx' || explicit === 'bebity') return explicit;
  return /^bebity[~/]/.test(ACTORS[source]) ? 'bebity' : 'agentx';
}

// Only sources with a non-empty actor id run. Setting APIFY_LINKEDIN_ACTOR="" turns that
// one off without unsetting the token.
export function enabledApifySources(): ApifySource[] {
  return (Object.keys(APIFY_SOURCES) as ApifySource[]).filter(s => apifyConfigured && ACTORS[s].trim());
}

// An Apify run is a job, not a request: it starts a container, scrapes, then fills a
// dataset. run-sync-get-dataset-items waits for all of that and hands back the rows, so it
// stays inside the existing synchronous board architecture — but it is slow, and the search
// route's own ceiling is 60s (maxDuration). This stays under it with room for the response
// to be assembled, and a run that overruns is abandoned rather than failing the search.
const RUN_TIMEOUT_S = Number(process.env.APIFY_TIMEOUT_S || 40);
// Each row is billed, and the search only ever shows the best ~20 per board
const MAX_ITEMS = Number(process.env.APIFY_MAX_ITEMS || 50);
// Runs cost money, so a repeated search reuses the previous one for far longer than the
// free boards' cache
const CACHE_TTL = Number(process.env.APIFY_CACHE_MINUTES || 60) * 60 * 1000;
// The AgentX actors require a country, and it must be the full English name from their
// own list ("United States", not "us" or "USA" — a code is refused outright). The app's own
// locations are regions ("Worldwide", "EMEA"), so there is nothing to derive it from.
const COUNTRY = process.env.APIFY_COUNTRY || 'United States';

const REGIONS = ['Worldwide', 'EMEA', 'Americas', 'APAC', 'Remote'];

/** YYYY-MM-DD for the oldest posting wanted, which is how AgentX takes the age filter. */
function postedSince(maxAgeDays: number | undefined): string | undefined {
  if (!maxAgeDays) return undefined;
  return new Date(Date.now() - maxAgeDays * 86400_000).toISOString().slice(0, 10);
}

function actorInput(source: ApifySource, params: SearchParams): Record<string, unknown> {
  // A region name is not a place any of these actors can search, so it is dropped and the
  // country setting carries the location instead.
  const place = params.location && !REGIONS.includes(params.location) ? params.location : '';

  const override = process.env[`APIFY_${ENV_KEY[source]}_INPUT`];
  if (override) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(override) as Record<string, unknown>;
    } catch {
      // A malformed override must not quietly search for something other than what was asked
      throw new Error(`APIFY_${ENV_KEY[source]}_INPUT is not valid JSON`);
    }
    // The stored input supplies the actor's own settings; the query still comes from the
    // search, so one override serves every search.
    return { ...parsed, ...shapeFor(dialectFor(source), params, place) };
  }
  return shapeFor(dialectFor(source), params, place);
}

/** Only the fields the actor declares — actors with a strict schema reject unknown ones. */
function shapeFor(dialect: Dialect, params: SearchParams, place: string): Record<string, unknown> {
  if (dialect === 'bebity') {
    return {
      titles: [params.query],
      locations: place ? [place] : [],
      rows: MAX_ITEMS,
      // bebity takes LinkedIn's own relative windows, in seconds
      publishedAt: params.maxAgeDays && params.maxAgeDays <= 7 ? 'r604800' : 'r2592000'
    };
  }
  const since = postedSince(params.maxAgeDays);
  return {
    keyword: params.query,
    country: COUNTRY,
    max_results: MAX_ITEMS,
    ...(place ? { location: place } : {}),
    ...(params.remoteOnly ? { remote_only: true } : {}),
    ...(since ? { posted_since: since } : {})
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
  const title = pick(row, 'title', 'jobTitle', 'job_title', 'positionName', 'position', 'name');
  // platform_url first: it is the posting on the board that was searched. official_url is
  // the employer's own listing, which is a fine fallback but is sometimes missing or a
  // careers-page root rather than this job. (AgentX's actors return both and neither of
  // the names every other scraper uses, which is why they lead the list.)
  const url = pick(row, 'platform_url', 'url', 'jobUrl', 'job_url', 'link', 'applyUrl', 'apply_url', 'jobLink', 'detailsUrl', 'official_url');
  // A row with no title, or nowhere to apply, is not a usable posting
  if (!title || !url) return null;

  const description = pick(row, 'description', 'descriptionText', 'description_text', 'jobDescription', 'snippet', 'summary');
  const skillsRaw = row.skills ?? row.tags ?? row.jobSkills;

  return {
    id: `${source}-${pick(row, 'id', 'jobId', 'job_id', 'key') || `${i}-${url.slice(-24)}`}`,
    title,
    company: pick(row, 'companyName', 'company_name', 'company', 'employer', 'organization'),
    location: pick(row, 'location', 'jobLocation', 'job_location', 'formattedLocation', 'place') || 'Remote',
    date: pick(row, 'posted_date', 'postedAt', 'posted_at', 'publishedAt', 'published_at', 'postingDateParsed', 'datePosted', 'date_posted', 'date'),
    url,
    work_mode: pick(row, 'workplaceType', 'workMode', 'work_mode', 'remote'),
    skills: Array.isArray(skillsRaw) ? skillsRaw.map(s => String(s)).filter(Boolean).slice(0, 8) : [],
    description: description ? description.replace(/\s+/g, ' ').slice(0, 4000) : null,
    source: APIFY_SOURCES[source]
  };
}

async function runActor(source: ApifySource, params: SearchParams): Promise<Record<string, unknown>[]> {
  const actor = ACTORS[source].replace('/', '~');
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
    // The token travels in the query string, so none of it can appear in Apify's reply
    const detail = body.slice(0, 200).replace(/\s+/g, ' ');
    if (res.status === 401 || res.status === 403) throw new Error(`Apify rejected the token (${res.status})`);
    if (res.status === 404) throw new Error(`Apify actor "${actor}" not found — check APIFY_${ENV_KEY[source]}_ACTOR`);
    // A 400 covers two very different problems and they need different fixes, so the
    // message must tell them apart: an input the actor's schema refuses, versus a run that
    // started fine and ran out of time. Reporting a timeout as bad input sends you editing
    // settings that were never wrong.
    if (res.status === 400 && /invalid-input/.test(body)) {
      throw new Error(`Apify actor "${actor}" refused the input — set APIFY_${ENV_KEY[source]}_DIALECT or _INPUT${detail ? `: ${detail}` : ''}`);
    }
    if (res.status === 400 && /TIMED-OUT|timed out/i.test(body)) {
      throw new Error(`Apify actor "${actor}" ran out of time (${RUN_TIMEOUT_S}s). It needs longer than a single request can wait — see APIFY_TIMEOUT_S.`);
    }
    if (res.status === 400) throw new Error(`Apify actor "${actor}" did not finish${detail ? `: ${detail}` : ''}`);
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
    // The same two gates every other board applies, so paying for a source can't lower the bar
    .filter(j => isRecent(j.date, params.maxAgeDays))
    .filter(j => !params.query.trim() || titleMatchesQuery(params.query, j.title))
    .map(j => ({ ...j, _score: titleScore(params.query, j.title) }))
    .sort((a, b) => b._score - a._score || String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, params.limit)
    .map(({ _score, ...j }) => j);

  cache.set(key, { at: Date.now(), jobs });
  return jobs;
}

const cache = new Map<string, { at: number; jobs: BoardJob[] }>();

/** Shown with the results, so a slow or empty Apify board explains itself. */
export function apifyNote(source: ApifySource): string | null {
  if (source === 'apify-linkedin') return 'LinkedIn through Apify residential proxies — slower than the free boards, and each run is billed to your Apify account.';
  if (source === 'apify-alljobs') return 'Indeed and the ATS boards (Greenhouse, Lever, Ashby and others) in one run, billed to your Apify account.';
  return `${APIFY_SOURCES[source]} through Apify — each run is billed to your Apify account.`;
}
