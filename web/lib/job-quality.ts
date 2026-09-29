// Checks that a search result is a genuine, relevant job posting.
//
// Some job feeds re-list postings scraped from other sites. Their links lead to another
// job search site (WhatJobs, Adzuna, Jooble…) instead of the employer's posting, and some
// list the aggregator itself as the "company". Those are dropped, along with results
// whose title isn't the role searched for and entries with broken data (no link, a job
// title in the company field, "talent pool" sign-ups rather than openings).

// Sites that re-list jobs found elsewhere. A result linking here is not the original posting.
const AGGREGATOR_DOMAINS = [
  'whatjobs', 'adzuna', 'jooble', 'jobbydoo', 'talent.com', 'neuvoo', 'careerjet', 'jobrapido',
  'jobsora', 'jobisjob', 'trovit', 'mitula', 'jobtome', 'jobvertise', 'recruit.net', 'lensa',
  'jobgether', 'jobleads', 'jobera', 'learn4good', 'jobilize', 'jobsinnetwork', 'jobtensor',
  'simplyhired', 'ziprecruiter', 'glassdoor', 'indeed', 'getwork', 'jobkicks', 'bebee',
  'jobzmall', 'jobs.ac', 'workable.com/j/search', 'remoterocketship', 'hiringcafe', 'jobhire',
  'himalayas.app', 'remoteok.com', 'jobicy.com', 'remotive.com', 'arbeitnow'
];

// Job search sites that sometimes appear as the "company" of a re-listed posting
const AGGREGATOR_COMPANIES = /^(whatjobs|adzuna|jooble|jobbydoo|talent\.com|neuvoo|careerjet|jobrapido|jobsora|lensa|jobgether|jobleads|jobera|jobs for humanity|bebee|jobilize|jobtensor|getwork|simplyhired|ziprecruiter|glassdoor|indeed|remote rocketship|hiring cafe|jobicy|himalayas|remote ?ok|remotive|arbeitnow|freehire)\b/i;

// Sign-up pools and open applications, not actual openings
const NOT_AN_OPENING = /\b(talent pool|talent community|talent network|general application|open application|spontaneous application|expression of interest|future opportunities)\b/i;

// A company name that is really a job title (a data error in some feeds)
const ROLE_AS_COMPANY = /\b(engineer|developer|scientist|designer|analyst|programmer|intern|working student|werkstudent)\b/i;

// Role nouns that mean the same across languages ("engineer" ≈ "developer")
const ROLE_NOUNS = /\b(engineers?|developers?|dev|programmers?|entwickler(in)?|ingenieur(in)?|d[ée]veloppeur(se)?|ing[ée]nieur|desarrollador(a)?|ingeniero|engenheiro|desenvolvedor|sviluppatore|sre)\b/;
const GENERIC_ROLE_WORDS = new Set(['engineer', 'engineers', 'developer', 'developers', 'dev']);
const LEVEL_WORDS = new Set(['senior', 'junior', 'lead', 'principal', 'staff', 'sr', 'jr', 'mid', 'level', 'remote', 'role', 'job', 'jobs', 'the', 'and', 'of', 'for']);

// Titles that count as the same role
const SYNONYMS: Record<string, string[]> = {
  devops: ['devops', 'devsecops', 'site reliability', 'sre'],
  frontend: ['frontend', 'front end'],
  backend: ['backend', 'back end'],
  fullstack: ['fullstack', 'full stack'],
  ux: ['ux', 'user experience'],
  ui: ['ui', 'user interface'],
  ml: ['ml', 'machine learning'],
  ai: ['ai', 'artificial intelligence', 'llm', 'genai', 'machine learning']
};

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim().split(' ').filter(Boolean);

// "Full Stack" / "full-stack" / "fullstack" all become "fullstack"
function canonical(text: string): string {
  return ` ${words(text).join(' ')} `
    .replace(/ full stack /g, ' fullstack ')
    .replace(/ front end /g, ' frontend ')
    .replace(/ back end /g, ' backend ')
    .replace(/ dev ops /g, ' devops ')
    .replace(/ ui ux | ux ui | uiux | uxui /g, ' ui ux ');
}

/**
 * True when the job title is the role searched for: every specific word of the query
 * (e.g. "data", "devops", "ui", "ux", "designer") appears in the title as a whole word,
 * and an "engineer"/"developer" search only returns engineering or developer roles
 * (not "Data Scientist" or "Deal Desk Manager").
 */
export function titleMatchesQuery(query: string, title: string, { requireRoleNoun = true } = {}): boolean {
  const q = canonical(query);
  const t = canonical(title);
  const qWords = q.trim().split(' ').filter(Boolean);
  const specific = qWords.filter(w => !GENERIC_ROLE_WORDS.has(w) && !LEVEL_WORDS.has(w));

  const inTitle = (w: string) => (SYNONYMS[w] || [w]).some(v => t.includes(` ${v} `));
  if (!specific.every(inTitle)) return false;

  const askedForEngineer = qWords.some(w => GENERIC_ROLE_WORDS.has(w));
  if (requireRoleNoun && askedForEngineer && !ROLE_NOUNS.test(t) && !specific.some(w => w === 'devops')) return false;
  return true;
}

function host(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isPostingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    // A bare domain is a company homepage, not a posting
    return /^https?:$/.test(u.protocol) && (u.pathname.replace(/\/+$/, '') !== '' || u.search !== '');
  } catch {
    return false;
  }
}

export function isAggregatorUrl(url: string): boolean {
  const full = String(url).toLowerCase();
  const h = host(url);
  return AGGREGATOR_DOMAINS.some(d => (d.includes('/') ? full.includes(d) : h === d || h.endsWith(`.${d}`) || h.includes(`${d}.`) || h === `${d}.com`));
}

type Job = { title?: string | null; company?: string | null; url?: string | null };

/**
 * Why a result isn't a genuine posting, or null if it is.
 * `ownDomain` is the board's own site (its postings legitimately link there).
 */
export function rejectReason(job: Job, ownDomains: string[] = []): string | null {
  const title = String(job.title || '').trim();
  const company = String(job.company || '').trim();
  const url = String(job.url || '').trim();

  if (!title || title === '(untitled)') return 'no title';
  if (!company) return 'no company';
  if (!url || !isPostingUrl(url)) return 'no link to the posting';
  const h = host(url);
  const onOwnSite = ownDomains.some(d => h === d || h.endsWith(`.${d}`) || h.startsWith(`${d}.`) || h.includes(`.${d}.`));
  if (!onOwnSite && isAggregatorUrl(url)) return 'links to another job search site';
  if (AGGREGATOR_COMPANIES.test(company)) return 'posted by a job search site';
  if (ROLE_AS_COMPANY.test(company) && !/\b(engineering|developers? (group|studio|inc|ltd|llc))\b/i.test(company)) return 'company name is a job title';
  if (NOT_AN_OPENING.test(title)) return 'not an actual opening';
  return null;
}

/** Keeps genuine postings for the role searched for; returns what was dropped, for logging. */
export function vetJobs<T extends Job>(jobs: T[], query: string, opts: { ownDomains?: string[]; requireRoleNoun?: boolean; checkTitle?: boolean } = {}) {
  const kept: T[] = [];
  const dropped: { title: string; company: string; reason: string }[] = [];
  for (const j of jobs) {
    const reason = rejectReason(j, opts.ownDomains)
      || (opts.checkTitle !== false && query.trim() && !titleMatchesQuery(query, String(j.title || ''), { requireRoleNoun: opts.requireRoleNoun }) ? 'not the role searched for' : null);
    if (reason) dropped.push({ title: String(j.title || ''), company: String(j.company || ''), reason });
    else kept.push(j);
  }
  return { kept, dropped };
}
