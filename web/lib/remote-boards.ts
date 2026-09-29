// Free, key-less job sources: Remotive, Jobicy, Himalayas, RemoteOK, Arbeitnow.
//
// Each source asks to be credited with a link back, and not to be polled too often.
// Results carry `source` (shown as "via …" on each card) and link to the original
// posting, and every upstream request is cached in memory for the interval the
// source asks for, so repeated searches don't hit their APIs.

import { titleMatchesQuery } from './job-quality';
import { isRecent, type SearchParams } from './jobs';

export const REMOTE_SOURCES = {
  remotive: 'Remotive',
  jobicy: 'Jobicy',
  himalayas: 'Himalayas',
  remoteok: 'Remote OK',
  arbeitnow: 'Arbeitnow'
} as const;

export type RemoteSource = keyof typeof REMOTE_SOURCES;

export function isRemoteSource(s: string): s is RemoteSource {
  return Object.prototype.hasOwnProperty.call(REMOTE_SOURCES, s);
}

const HOUR = 60 * 60 * 1000;
// Remotive asks for at most ~4 requests a day; Jobicy for at most one an hour
const CACHE_TTL: Record<RemoteSource, number> = {
  remotive: 6 * HOUR,
  jobicy: HOUR,
  himalayas: HOUR,
  remoteok: HOUR,
  arbeitnow: HOUR
};

const UA = 'Mozilla/5.0 (compatible; kairo-job-search/1.0; personal job search dashboard)';

const cache = new Map<string, { at: number; data: unknown }>();

async function getJson(source: RemoteSource, url: string): Promise<unknown> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL[source]) return hit.data;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(20000)
    });
  } catch (e) {
    // Serve a stale copy rather than failing if the source is briefly down
    if (hit) return hit.data;
    throw new Error(`${REMOTE_SOURCES[source]} is not reachable (${(e as Error).message})`);
  }
  if (!res.ok) {
    if (hit) return hit.data;
    throw new Error(res.status === 429
      ? `${REMOTE_SOURCES[source]} is limiting requests right now. Try again later.`
      : `${REMOTE_SOURCES[source]} request failed: ${res.status}`);
  }
  const data = await res.json();
  cache.set(url, { at: Date.now(), data });
  // Keep the cache small
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return data;
}

// ---------- Helpers ----------

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_, d) => { const n = Number(d); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { const n = parseInt(h, 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; })
    .replace(/&amp;/g, '&');
}

function stripTags(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|ul|ol|div|h\d|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
}

// Some boards send HTML, some send HTML that is itself entity-encoded
// ("&lt;p&gt;…"); decode and strip until no markup is left
function htmlToText(html: unknown): string {
  let text = String(html || '');
  for (let pass = 0; pass < 3; pass++) {
    const encoded = /&lt;\/?[a-z]/i.test(text);
    if (encoded) text = decodeEntities(text);
    const stripped = stripTags(text);
    const changed = stripped !== text;
    text = stripped;
    if (!encoded && !changed) break;
  }
  return decodeEntities(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 8000);
}

// "Albania, Andorra, Argentina, … (50 countries)" -> "Albania, Andorra, Argentina +47 more"
function shortPlaces(list: string[], fallback: string): string {
  if (!list || !list.length) return fallback;
  return list.length <= 3 ? list.join(', ') : `${list.slice(0, 3).join(', ')} +${list.length - 3} more`;
}

export const norm = (s: string) => s.toLowerCase().replace(/[-_/.]+/g, ' ');
// Locations: punctuation becomes spaces so "USA, Canada" matches "usa" and "canada"
const normPlace = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');

// Role words that postings phrase in many ways; they don't have to match exactly
const GENERIC_WORDS = new Set(['developer', 'engineer', 'dev', 'developers', 'engineers', 'senior', 'junior', 'lead', 'principal', 'staff', 'sr', 'jr', 'remote', 'role', 'job', 'jobs', 'mid', 'level']);

// The specific words of the query (e.g. "react", "data") must all appear in the job
function matchesQuery(query: string, ...fields: unknown[]): boolean {
  const words = norm(query).split(/\s+/).filter(w => w.length > 1);
  if (!words.length) return true;
  const hay = ` ${norm(fields.map(f => (Array.isArray(f) ? f.join(' ') : String(f || ''))).join(' '))} `;
  const squashed = hay.replace(/\s+/g, '');
  const has = (w: string) => hay.includes(w) || squashed.includes(w);
  const specific = words.filter(w => !GENERIC_WORDS.has(w));
  return specific.length ? specific.every(has) : words.some(has);
}

export function titleScore(query: string, title: string): number {
  const t = norm(title);
  return norm(query).split(/\s+/).filter(w => w.length > 1 && t.includes(w)).length;
}

// Where a remote job accepts candidates from. Text naming no known place
// ("Worldwide", "Anywhere", blank) means open to everyone.
const PLACES = {
  europe: ['europe', 'european', 'eu', 'eea', 'albania', 'andorra', 'austria', 'belarus', 'belgium', 'bosnia', 'bulgaria', 'croatia', 'cyprus', 'czech', 'czechia', 'denmark', 'estonia', 'finland', 'france', 'germany', 'greece', 'hungary', 'iceland', 'ireland', 'italy', 'kosovo', 'latvia', 'liechtenstein', 'lithuania', 'luxembourg', 'malta', 'moldova', 'monaco', 'montenegro', 'netherlands', 'north macedonia', 'macedonia', 'norway', 'poland', 'portugal', 'romania', 'serbia', 'slovakia', 'slovenia', 'spain', 'sweden', 'switzerland', 'ukraine', 'uk', 'united kingdom', 'great britain', 'britain', 'england', 'scotland', 'wales', 'london', 'berlin', 'paris', 'amsterdam', 'madrid', 'lisbon', 'dublin', 'warsaw', 'cet', 'cest', 'gmt', 'bst'],
  middleEast: ['middle east', 'gulf', 'gcc', 'uae', 'united arab emirates', 'emirates', 'dubai', 'abu dhabi', 'saudi', 'saudi arabia', 'ksa', 'riyadh', 'qatar', 'doha', 'kuwait', 'bahrain', 'oman', 'jordan', 'lebanon', 'israel', 'palestine', 'iraq', 'turkey', 'türkiye', 'istanbul', 'دبي', 'الإمارات'],
  northAfrica: ['north africa', 'egypt', 'cairo', 'morocco', 'tunisia', 'algeria', 'libya', 'sudan'],
  africa: ['africa', 'nigeria', 'lagos', 'kenya', 'nairobi', 'south africa', 'ghana', 'ethiopia', 'uganda', 'tanzania', 'rwanda', 'senegal', 'cameroon', 'ivory coast', 'zambia', 'zimbabwe', 'namibia', 'botswana', 'mozambique', 'mauritius'],
  asiaPacific: ['apac', 'apj', 'asia', 'asia pacific', 'pacific', 'oceania', 'china', 'japan', 'tokyo', 'korea', 'taiwan', 'hong kong', 'mongolia', 'india', 'bangalore', 'bengaluru', 'pakistan', 'lahore', 'karachi', 'islamabad', 'bangladesh', 'sri lanka', 'nepal', 'singapore', 'malaysia', 'indonesia', 'philippines', 'thailand', 'vietnam', 'cambodia', 'myanmar', 'australia', 'sydney', 'melbourne', 'new zealand', 'kazakhstan', 'uzbekistan'],
  northAmerica: ['north america', 'americas', 'usa', 'us', 'u s', 'united states', 'canada', 'mexico', 'est', 'pst', 'cst', 'mst', 'toronto', 'vancouver', 'new york', 'san francisco', 'seattle', 'boston', 'chicago', 'austin', 'los angeles', 'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia usa', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming', 'ontario', 'quebec', 'british columbia', 'alberta'],
  latam: ['latam', 'latin america', 'south america', 'central america', 'argentina', 'brazil', 'chile', 'colombia', 'peru', 'uruguay', 'paraguay', 'bolivia', 'ecuador', 'venezuela', 'costa rica', 'panama', 'guatemala', 'honduras', 'el salvador', 'nicaragua', 'dominican republic', 'puerto rico', 'jamaica']
};

const REGION_WORDS: Record<string, string[]> = {
  APAC: PLACES.asiaPacific,
  APJ: PLACES.asiaPacific,
  MENA: ['mena', ...PLACES.middleEast, ...PLACES.northAfrica],
  EMEA: ['emea', ...PLACES.europe, ...PLACES.middleEast, ...PLACES.northAfrica, ...PLACES.africa],
  NAMER: PLACES.northAmerica
};

const ALL_REGION_WORDS = [...new Set(['emea', 'mena', ...Object.values(PLACES).flat()])];

function openToRegion(region: string, location: unknown): boolean {
  const words = REGION_WORDS[region];
  if (!words) return true; // Worldwide
  const text = ` ${normPlace(Array.isArray(location) ? location.join(' ') : String(location || ''))} `;
  // No place named at all ("Worldwide", "Anywhere", blank): open to every region
  if (!ALL_REGION_WORDS.some(w => text.includes(` ${w} `))) return true;
  return words.some(w => text.includes(` ${w} `));
}

export interface BoardJob {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  date: string | null;
  url: string;
  work_mode: string | null;
  skills: string[];
  description: string | null;
  source: string;
}

// Keep only recent jobs (before trimming, so recent ones are never cut), best matches first
function finish(jobs: (BoardJob & { _score?: number })[], params: SearchParams): BoardJob[] {
  const { query, limit, maxAgeDays } = params;
  return jobs
    .filter(j => isRecent(j.date, maxAgeDays))
    // The title must be the role searched for (a word in the description isn't enough)
    .filter(j => !query.trim() || titleMatchesQuery(query, j.title))
    .map(j => ({ ...j, _score: titleScore(query, j.title) }))
    .sort((a, b) => b._score - a._score || String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, limit)
    .map(({ _score, ...j }) => j);
}

// ---------- Sources ----------

async function remotive(params: SearchParams): Promise<BoardJob[]> {
  const { query, location } = params;
  // One fetch of the whole public feed every 6 hours (Remotive asks for at most ~4 requests
  // a day); every search filters that copy locally
  const data = await getJson('remotive', 'https://remotive.com/api/remote-jobs') as { jobs?: Record<string, any>[] };
  const jobs = (data.jobs || [])
    .filter(j => matchesQuery(query, j.title, j.tags, j.company_name, j.category))
    .filter(j => openToRegion(location, j.candidate_required_location))
    .map(j => ({
      id: `remotive-${j.id}`,
      title: j.title,
      company: j.company_name || null,
      location: j.candidate_required_location || 'Remote',
      date: j.publication_date || null,
      url: j.url,
      work_mode: 'remote',
      skills: (j.tags || []).slice(0, 8),
      description: htmlToText(j.description),
      source: REMOTE_SOURCES.remotive
    }));
  return finish(jobs, params);
}

async function jobicy(params: SearchParams): Promise<BoardJob[]> {
  const { query, location } = params;
  // One fetch of the latest 100 jobs per hour (Jobicy's polling limit); searches filter locally
  const data = await getJson('jobicy', 'https://jobicy.com/api/v2/remote-jobs?count=100') as { jobs?: Record<string, any>[] };
  const jobs = (data.jobs || [])
    .filter(j => matchesQuery(query, htmlToText(j.jobTitle), j.jobIndustry, j.companyName, j.jobExcerpt))
    .filter(j => openToRegion(location, j.jobGeo))
    .map(j => ({
      id: `jobicy-${j.id}`,
      title: htmlToText(j.jobTitle),
      company: j.companyName ? htmlToText(j.companyName) : null,
      location: j.jobGeo || 'Remote',
      date: j.pubDate || null,
      url: j.url,
      work_mode: 'remote',
      skills: [...(j.jobIndustry || []), ...(j.jobLevel ? [j.jobLevel] : [])].map(htmlToText).slice(0, 6),
      description: htmlToText(j.jobDescription || j.jobExcerpt),
      source: REMOTE_SOURCES.jobicy
    }));
  return finish(jobs, params);
}

async function himalayas(params: SearchParams): Promise<BoardJob[]> {
  const { query, location } = params;
  const p = new URLSearchParams({ q: query || 'engineer', page: '1' });
  const data = await getJson('himalayas', `https://himalayas.app/jobs/api/search?${p}`) as { jobs?: Record<string, any>[] };
  const jobs = (data.jobs || [])
    .filter(j => openToRegion(location, j.locationRestrictions))
    .map(j => ({
      id: `himalayas-${j.guid || j.applicationLink}`,
      title: j.title,
      company: j.companyName || null,
      location: shortPlaces(j.locationRestrictions || [], 'Worldwide'),
      locations: j.locationRestrictions || [],
      date: j.pubDate ? new Date(Number(j.pubDate) * 1000).toISOString() : null,
      url: j.applicationLink || j.guid,
      work_mode: 'remote',
      skills: (j.categories || []).map((c: string) => c.replace(/-/g, ' ')).slice(0, 6),
      description: htmlToText(j.description || j.excerpt),
      source: REMOTE_SOURCES.himalayas
    }));
  return finish(jobs, params);
}

// Remote OK sends some text double-encoded (UTF-8 read as Latin-1); undo that when detected
function fixMojibake(v: unknown): string {
  const str = String(v || '');
  if (!/[ÃØÙÂâ][\u0080-\u00ff]/.test(str)) return str;
  try {
    const fixed = Buffer.from(str, 'latin1').toString('utf8');
    return fixed.includes('\ufffd') ? str : fixed;
  } catch {
    return str;
  }
}

async function remoteok(params: SearchParams): Promise<BoardJob[]> {
  const { query, location } = params;
  // The public feed is the latest ~100 jobs; it's filtered here by keyword and region
  const data = await getJson('remoteok', 'https://remoteok.com/api') as Record<string, any>[];
  const jobs = (Array.isArray(data) ? data.slice(1) : [])
    .map((j): Record<string, any> => ({ ...j, position: fixMojibake(j.position), company: fixMojibake(j.company), location: fixMojibake(j.location), description: fixMojibake(j.description) }))
    .filter(j => j && j.position && matchesQuery(query, j.position, j.tags, j.company, htmlToText(j.description)))
    .filter(j => openToRegion(location, j.location))
    .map(j => ({
      id: `remoteok-${j.id}`,
      title: j.position,
      company: j.company || null,
      location: j.location || 'Worldwide',
      date: j.date || null,
      url: j.url,
      work_mode: 'remote',
      skills: (j.tags || []).slice(0, 8),
      description: htmlToText(j.description),
      source: REMOTE_SOURCES.remoteok
    }));
  return finish(jobs, params);
}

async function arbeitnow(params: SearchParams): Promise<BoardJob[]> {
  const { query, location, remoteOnly } = params;
  // Arbeitnow lists jobs in Europe (mostly Germany)
  if (!['Worldwide', 'EMEA'].includes(location)) return [];
  const data = await getJson('arbeitnow', 'https://www.arbeitnow.com/api/job-board-api') as { data?: Record<string, any>[] };
  const jobs = (data.data || [])
    .filter(j => matchesQuery(query, j.title, j.tags, j.company_name, htmlToText(j.description)))
    .filter(j => !remoteOnly || j.remote)
    .map(j => ({
      id: `arbeitnow-${j.slug}`,
      title: j.title,
      company: j.company_name || null,
      location: j.location || 'Germany',
      date: j.created_at ? new Date(Number(j.created_at) * 1000).toISOString() : null,
      url: j.url,
      work_mode: j.remote ? 'remote' : null,
      skills: (j.tags || []).slice(0, 8),
      description: htmlToText(j.description),
      source: REMOTE_SOURCES.arbeitnow
    }));
  return finish(jobs, params);
}

const HANDLERS: Record<RemoteSource, (p: SearchParams) => Promise<BoardJob[]>> = { remotive, jobicy, himalayas, remoteok, arbeitnow };

export function searchRemoteBoard(source: RemoteSource, params: SearchParams): Promise<BoardJob[]> {
  return HANDLERS[source](params);
}

// A short explanation shown with the results when a source can't match the request
export function boardNote(source: RemoteSource, location: string): string | null {
  if (source === 'arbeitnow' && !['Worldwide', 'EMEA'].includes(location)) {
    return 'Arbeitnow only lists jobs in Europe (mostly Germany). Choose EMEA or Worldwide.';
  }
  if (source === 'remotive') return 'Remotive shares a small public feed, delayed by 24 hours.';
  if (source === 'remoteok') return 'Remote OK searches its latest ~100 jobs.';
  return null;
}
