// Live job search, ported from the repo's portal skills
// (.agents/skills/freehire-search and linkedin-search) so it runs inside Next.js
// without Bun. Same endpoints, parameters and parsing as those CLIs.

// ---------- Regions ----------

// Freehire tags jobs with overlapping region codes, so each region ORs every code that belongs to it
const FREEHIRE_REGIONS: Record<string, string[]> = {
  APAC: ['apac', 'asia'],
  APJ: ['apac', 'asia', 'jp'],
  MENA: ['mena', 'middle_east'],
  EMEA: ['emea', 'eu', 'mena', 'middle_east', 'africa'],
  NAMER: ['north_america', 'us', 'ca'],
  Worldwide: []
};

// LinkedIn resolves these names to its own geo regions
const LINKEDIN_REGIONS: Record<string, string> = {
  APAC: 'APAC',
  APJ: 'APJ',
  MENA: 'MENA',
  EMEA: 'EMEA',
  NAMER: 'North America',
  Worldwide: 'Worldwide'
};

export interface SearchParams {
  query: string;
  location: string;
  remoteOnly: boolean;
  limit: number;
  // Only jobs posted within this many days (whole days, see ageInDays)
  maxAgeDays?: number;
}

// Whole days since a posting date (0 = within the last 24 hours). Dates in the
// future (clock differences between sites) count as today; unknown dates as null.
export function ageInDays(date: unknown, now = Date.now()): number | null {
  if (!date) return null;
  const t = typeof date === 'number' ? (date < 1e12 ? date * 1000 : date) : Date.parse(String(date));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

export function isRecent(date: unknown, maxAgeDays: number | undefined): boolean {
  if (!maxAgeDays) return true;
  const age = ageInDays(date);
  return age !== null && age <= maxAgeDays;
}

// ---------- Shared fetch with retry ----------

async function fetchWithRetry(url: string, headers: Record<string, string>): Promise<Response> {
  let delay = 500;
  for (let attempt = 0; attempt <= 2; attempt++) {
    const res = await fetch(url, { headers, redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (res.status !== 429 && res.status < 500) return res;
    if (attempt === 2) return res;
    await new Promise(r => setTimeout(r, delay + Math.floor(Math.random() * 300)));
    delay *= 2;
  }
  throw new Error('unreachable');
}

// ---------- Freehire (public JSON API) ----------

const FREEHIRE_BASE = (process.env.FREEHIRE_API_URL || 'https://freehire.me').replace(/\/+$/, '');
const FREEHIRE_UA = 'freehire-search-skill/1.0 (+https://freehire.me)';

interface FreehireJob {
  public_slug: string;
  url: string;
  title: string;
  company: string;
  company_slug: string;
  location: string;
  description: string;
  skills: string[];
  work_mode?: string;
  regions: string[];
  countries: string[];
  posted_at: string | null;
}

export async function searchFreehire(params: SearchParams) {
  const { query, location, remoteOnly, limit } = params;
  const p = new URLSearchParams();
  if (query) p.set('q', query);
  p.set('limit', String(limit));
  p.set('offset', '0');
  p.set('semantic_ratio', '0');
  p.set('include_description', 'true');
  p.set('description_format', 'text');
  if (params.maxAgeDays) p.set('posted_within_days', String(params.maxAgeDays));
  if (remoteOnly) p.set('work_mode', 'remote');
  for (const region of FREEHIRE_REGIONS[location] || []) p.append('regions', region);

  let res: Response;
  try {
    res = await fetchWithRetry(`${FREEHIRE_BASE}/api/v1/agent/jobs/search?${p}`, { 'User-Agent': FREEHIRE_UA, Accept: 'application/json' });
  } catch (e) {
    throw new Error(`could not reach the freehire API (${e instanceof Error ? e.message : String(e)})`);
  }
  const body = (await res.json().catch(() => null)) as { data?: FreehireJob[]; error?: string } | null;
  if (!res.ok) throw new Error(body?.error || `freehire API request failed: ${res.status}`);

  return (body?.data || [])
    .filter(j => isRecent(j.posted_at, params.maxAgeDays))
    // Freehire is asked for remote jobs; also drop any it labels otherwise
    .filter(j => !remoteOnly || j.work_mode === 'remote')
    .map(j => ({
    id: j.public_slug,
    title: j.title || '(untitled)',
    company: j.company || null,
    company_slug: j.company_slug || null,
    location: j.location || null,
    date: j.posted_at,
    url: j.url,
    work_mode: j.work_mode || null,
    regions: j.regions,
    countries: j.countries,
    skills: j.skills,
    description: j.description || null
  }));
}

// ---------- LinkedIn (public jobs-guest pages) ----------

const LINKEDIN_SEARCH = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const LINKEDIN_DETAIL = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting';
const LINKEDIN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; linkedin-search-cli/1.0)',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'X-Requested-With': 'XMLHttpRequest'
};

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html));
}

function extractDivContent(html: string, className: string): string | null {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const open = new RegExp(`<div[^>]*class="[^"]*${escaped}[^"]*"[^>]*>`, 'i').exec(html);
  if (!open) return null;
  let i = open.index + open[0].length;
  let depth = 1;
  while (depth > 0 && i < html.length) {
    const nextOpen = html.indexOf('<div', i);
    const nextClose = html.indexOf('</div>', i);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 4;
    } else {
      depth--;
      i = nextClose + 6;
    }
  }
  return html.slice(open.index + open[0].length, i - 6);
}

async function linkedinHtml(url: string): Promise<string> {
  const res = await fetchWithRetry(url, LINKEDIN_HEADERS);
  if (res.status === 404) return '';
  if (!res.ok) throw new Error(`LinkedIn request failed: ${res.status} ${res.statusText}`);
  return res.text();
}

// LinkedIn's public listing ignores its own "remote" filter, so each posting is opened
// and read to confirm it's remote. The posting also gives the description (shown on the
// card) and LinkedIn's industry label (used to leave out staffing agencies).
// LinkedIn rate-limits its public pages (HTTP 429) when requests arrive in bursts, but
// accepts a steady stream (tested: 30+ postings in a row with a short gap). So pages and
// postings are fetched one at a time with a short pause, and the first 429 stops further
// requests for that search; whatever has been confirmed by then is returned.
const LINKEDIN_PAGE_SIZE = 10;
const LINKEDIN_MAX_PAGES = 6;
const LINKEDIN_PAGE_PAUSE_MS = 400;
const LINKEDIN_POSTING_PAUSE_MS = 120;
// Stop opening postings after this long and return what's been confirmed
const LINKEDIN_TIME_BUDGET_MS = 30000;
const POSTING_CACHE_MS = 6 * 60 * 60 * 1000;

interface LinkedInPosting { description: string; industry: string }
const postingCache = new Map<string, { at: number; value: LinkedInPosting }>();

function postingFromHtml(html: string): LinkedInPosting {
  let description = '';
  const descHtml = extractDivContent(html, 'show-more-less-html__markup') ?? extractDivContent(html, 'description__text');
  if (descHtml) {
    const withBreaks = descHtml.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|li|ul|ol|div|h\d)>/gi, '\n');
    description = decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, '\n\n').trim();
  }
  const industry = html.match(/description__job-criteria-subheader[^>]*>\s*Industries\s*<\/h3>[\s\S]*?description__job-criteria-text[^>]*>([\s\S]*?)<\/span>/i)?.[1];
  return { description, industry: industry ? clean(industry) : '' };
}

class RateLimited extends Error {}

async function linkedinPosting(id: string): Promise<LinkedInPosting | null> {
  const hit = postingCache.get(id);
  if (hit && Date.now() - hit.at < POSTING_CACHE_MS) return hit.value;
  // No retries here: retrying a rate-limited request only makes the limit last longer
  const res = await fetch(`${LINKEDIN_DETAIL}/${id}`, { headers: LINKEDIN_HEADERS, cache: 'no-store', signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (res?.status === 429) throw new RateLimited('LinkedIn rate limit');
  const html = res?.ok ? await res.text().catch(() => '') : '';
  if (!html) return null;
  const value = postingFromHtml(html);
  postingCache.set(id, { at: Date.now(), value });
  if (postingCache.size > 3000) postingCache.delete(postingCache.keys().next().value as string);
  return value;
}

const REMOTE_YES = /\b(fully[- ]remote|100\s?% remote|remote[- ](first|only|friendly|position|role|job|opportunity|work(ing)?|team|contract|based|eligible)|work(ing)? (from home|from anywhere|remotely)|wfh|telecommut\w*|home[- ]based|anywhere in (the )?(world|us|usa|europe|emea|latam|apac)|this (is a|role is|position is|job is) (a )?(fully )?remote|remote\)|\(remote)/i;
const REMOTE_NO = /\b(hybrid|on-?site|in[- ]office|office[- ]based|in the office|days? (a|per|each) week (in|at) (the|our)|relocat(e|ion) (to|is required)|not (a )?remote|no remote|non-remote)\b/i;

/** Whether a posting is a remote job: clearly remote, and not hybrid or on-site. */
export function isRemotePosting(title: string, location: string, description: string): boolean {
  const head = `${title} ${location}`;
  if (/\bhybrid|on-?site\b/i.test(head)) return false;
  if (/\bremote\b/i.test(head)) return true;
  const text = description.slice(0, 8000);
  if (!REMOTE_YES.test(text)) return false;
  // "fully remote" wins over a passing mention of an office
  return !REMOTE_NO.test(text) || /\b(fully[- ]remote|100\s?% remote|remote[- ]first)\b/i.test(text);
}

interface LinkedInCard { id: string; title: string; company: string | null; companyUrl: string | null; location: string | null; date: string | null; url: string }

function parseLinkedInCards(html: string, maxAgeDays?: number): LinkedInCard[] {
  const cards: LinkedInCard[] = [];
  for (const chunk of html.split(/data-entity-urn="urn:li:jobPosting:/).slice(1)) {
    const idMatch = chunk.match(/^(\d+)/);
    if (!idMatch) continue;
    const id = idMatch[1];

    const linkMatch = chunk.match(/class="base-card__full-link[^"]*"[^>]*href="([^"]+)"/i);
    const url = linkMatch ? decodeHtmlEntities(linkMatch[1]).split('?')[0] : '';

    let title: string | null = null;
    const h3 = chunk.match(/class="base-search-card__title"[^>]*>([\s\S]*?)<\/h3>/i);
    if (h3) title = clean(h3[1]);
    if (!title) {
      const sr = chunk.match(/class="sr-only"[^>]*>([\s\S]*?)<\/span>/i);
      if (sr) title = clean(sr[1]);
    }
    if (!title) continue;

    let company: string | null = null;
    let companyUrl: string | null = null;
    const sub = chunk.match(/class="base-search-card__subtitle"[^>]*>([\s\S]*?)<\/h4>/i);
    if (sub) {
      const a = sub[1].match(/href="([^"]+)"/i);
      if (a) companyUrl = decodeHtmlEntities(a[1]).split('?')[0];
      company = clean(sub[1]) || null;
    }

    const loc = chunk.match(/class="job-search-card__location"[^>]*>([\s\S]*?)<\/span>/i);
    const dt = chunk.match(/class="job-search-card__listdate[^"]*"[^>]*datetime="([^"]+)"/i);
    const date = dt ? dt[1] : null;
    if (!isRecent(date, maxAgeDays)) continue;
    cards.push({ id, title, company, companyUrl, location: loc ? clean(loc[1]) || null : null, date, url: url || `https://www.linkedin.com/jobs/view/${id}` });
  }
  return cards;
}

export async function searchLinkedIn(sp: SearchParams) {
  const { query, location, remoteOnly, limit } = sp;
  const started = Date.now();
  const params = new URLSearchParams();
  // Asking for "remote" in the keywords brings remote postings to the top
  params.set('keywords', remoteOnly ? `${query} remote` : query);
  params.set('location', LINKEDIN_REGIONS[location] || 'Worldwide');
  if (remoteOnly) params.set('f_WT', '2');
  if (sp.maxAgeDays) params.set('f_TPR', `r${sp.maxAgeDays * 86400}`);

  type Result = LinkedInCard & { description?: string; industry?: string; work_mode?: string };
  const results: Result[] = [];
  const seen = new Set<string>();
  let rateLimited = false;
  const inTime = () => Date.now() - started < LINKEDIN_TIME_BUDGET_MS;

  // Confirms which of a page's listings are remote, one posting at a time
  async function keepRemote(cards: LinkedInCard[]) {
    const toOpen: LinkedInCard[] = [];
    for (const c of cards) {
      const head = `${c.title} ${c.location || ''}`;
      if (/\bhybrid\b|\bon-?site\b/i.test(head)) continue;
      // Listed as remote: no need to open the posting
      if (/\bremote\b/i.test(head)) results.push({ ...c, work_mode: 'remote' });
      else toOpen.push(c);
    }
    for (const card of toOpen) {
      if (rateLimited || !inTime() || results.length >= limit) break;
      const cached = postingCache.has(card.id);
      try {
        const posting = await linkedinPosting(card.id);
        if (posting && isRemotePosting(card.title, card.location || '', posting.description)) {
          results.push({ ...card, description: posting.description, industry: posting.industry, work_mode: 'remote' });
        }
      } catch (err) {
        if (err instanceof RateLimited) rateLimited = true;
      }
      if (!cached) await new Promise(r => setTimeout(r, LINKEDIN_POSTING_PAUSE_MS));
    }
  }

  for (let page = 0; page < LINKEDIN_MAX_PAGES && results.length < limit && !rateLimited && inTime(); page++) {
    if (page > 0) await new Promise(r => setTimeout(r, LINKEDIN_PAGE_PAUSE_MS));
    params.set('start', String(page * LINKEDIN_PAGE_SIZE));
    let html: string;
    try {
      html = await linkedinHtml(`${LINKEDIN_SEARCH}?${params}`);
    } catch (err) {
      if (page === 0) throw err;
      break; // keep what the earlier pages gave
    }
    if (!html.includes('jobPosting:')) break;
    const cards = parseLinkedInCards(html, sp.maxAgeDays).filter(c => !seen.has(c.id) && seen.add(c.id));
    if (remoteOnly) await keepRemote(cards);
    else results.push(...cards);
  }
  return results.slice(0, limit);
}

export async function linkedinDetail(id: string) {
  const html = await linkedinHtml(`${LINKEDIN_DETAIL}/${id}`);
  if (!html) throw new Error('Job not found');
  const title = html.match(/class="(?:top-card-layout__title|topcard__title)[^"]*"[^>]*>([\s\S]*?)<\/h[12]>/i)?.[1];
  const orgMatch = html.match(/class="topcard__org-name-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
  const locMatch = html.match(/class="topcard__flavor topcard__flavor--bullet"[^>]*>([\s\S]*?)<\/span>/i);

  let description: string | null = null;
  const descHtml = extractDivContent(html, 'show-more-less-html__markup') ?? extractDivContent(html, 'description__text');
  if (descHtml) {
    const withBreaks = descHtml.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|li|ul|ol|div|h\d)>/gi, '\n');
    description = decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, '\n\n').trim() || null;
  }

  return {
    id,
    title: title ? clean(title) : '(untitled)',
    company: orgMatch ? clean(orgMatch[2]) || null : null,
    location: locMatch ? clean(locMatch[1]) || null : null,
    url: `https://www.linkedin.com/jobs/view/${id}`,
    description
  };
}
