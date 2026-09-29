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

  return (body?.data || []).filter(j => isRecent(j.posted_at, params.maxAgeDays)).map(j => ({
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

export async function searchLinkedIn(sp: SearchParams) {
  const { query, location, remoteOnly, limit } = sp;
  const params = new URLSearchParams();
  // LinkedIn's public listings ignore the workplace-type filter, so for
  // remote-only searches also require the word "remote" in the posting
  params.set('keywords', remoteOnly ? `${query} remote` : query);
  params.set('location', LINKEDIN_REGIONS[location] || 'Worldwide');
  if (remoteOnly) params.set('f_WT', '2');
  if (sp.maxAgeDays) params.set('f_TPR', `r${sp.maxAgeDays * 86400}`);
  params.set('start', '0');

  const html = await linkedinHtml(`${LINKEDIN_SEARCH}?${params}`);
  const results = [];
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
    if (!isRecent(date, sp.maxAgeDays)) continue;
    results.push({
      id,
      title,
      company,
      companyUrl,
      location: loc ? clean(loc[1]) || null : null,
      date,
      url: url || `https://www.linkedin.com/jobs/view/${id}`
    });
    if (results.length >= limit) break;
  }
  return results;
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
