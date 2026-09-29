// Candidate profiles and their application trackers.
//
// The built-in profile is the framework's own candidate profile (the one /apply
// uses). Extra profiles are listed in profiles/profiles.json; locally each lives in
// profiles/<id>/, on Vercel in Redis.

import path from 'node:path';
import { ROOT, usingRedis, kvGet, kvSet, readFile, writeFile } from './store';
import { parseCSV, stringifyCSV, TRACKER_HEADERS, type Row } from './csv';
import { parseProfile, analyseJob, yearsOfExperience } from './tailor.js';

export interface ProfileEntry {
  id: string;
  label: string;
  builtin: boolean;
}

const BUILTIN: ProfileEntry = { id: 'default', label: 'AI Full Stack Engineer', builtin: true };
const BUILTIN_PROFILE_FILE = '.claude/skills/job-application-assistant/01-candidate-profile.md';

function registry(): ProfileEntry[] {
  try {
    const list = JSON.parse(readFile(path.join(ROOT, 'profiles', 'profiles.json')) || '[]');
    return Array.isArray(list)
      ? list.filter((p: ProfileEntry) => /^[a-z0-9-]{1,40}$/.test(p.id) && p.id !== BUILTIN.id).map((p: ProfileEntry) => ({ id: p.id, label: p.label, builtin: false }))
      : [];
  } catch {
    return [];
  }
}

// Unknown or missing ids fall back to the built-in profile
export function resolveProfile(id: string | null): ProfileEntry {
  return registry().find(p => p.id === id) || BUILTIN;
}

function profileFile(p: ProfileEntry): string {
  return p.builtin ? path.join(ROOT, BUILTIN_PROFILE_FILE) : path.join(ROOT, 'profiles', p.id, 'profile.md');
}

function trackerFile(p: ProfileEntry): string {
  return p.builtin ? path.join(ROOT, 'job_search_tracker.csv') : path.join(ROOT, 'profiles', p.id, 'job_search_tracker.csv');
}

// ---------- Profile markdown ----------

export async function getProfileMarkdown(p: ProfileEntry): Promise<string> {
  if (usingRedis) {
    const stored = await kvGet(`profile:${p.id}`);
    if (stored !== null) return stored;
    // First run on Vercel: start from the file shipped with the repo, or a blank template
    return (p.builtin ? readFile(profileFile(p)) : null) ?? template(p);
  }
  const content = readFile(profileFile(p));
  if (content !== null) return content;
  if (p.builtin) return '';
  const blank = template(p);
  writeFile(profileFile(p), blank);
  return blank;
}

export async function saveProfileMarkdown(p: ProfileEntry, markdown: string): Promise<void> {
  if (usingRedis) await kvSet(`profile:${p.id}`, markdown);
  else writeFile(profileFile(p), markdown);
}

// ---------- Trackers ----------

const STARTER_ROWS: Row[] = [
  {
    date: '2026-09-01',
    company: 'Deployly AI',
    sector: 'AI & Developer Tools',
    role: 'Senior Full Stack AI Engineer',
    role_type: 'Full-time',
    channel: 'LinkedIn',
    status: 'drafted',
    contact_person: 'Talent Acquisition',
    fit_rating: '94',
    notes: 'High synergy with Claude Code, Python, and Next.js background',
    cv_file: 'cv/main_DeploylyAI_AIEngineer.tex',
    cover_letter_file: 'cover_letters/cover_DeploylyAI.tex',
    source: 'https://www.linkedin.com/jobs/view/ai-engineer-at-deployly-ai-4447791646',
    deadline: '2026-09-30'
  },
  {
    date: '2026-08-28',
    company: 'Nexus Cloud Systems',
    sector: 'Cloud & Infrastructure',
    role: 'Senior Backend Engineer (Python/PostgreSQL)',
    role_type: 'Full-time',
    channel: 'Freehire',
    status: 'interview',
    contact_person: 'Engineering Manager',
    fit_rating: '91',
    notes: 'Completed technical take-home; System design interview scheduled',
    cv_file: 'cv/main_Nexus_Backend.tex',
    cover_letter_file: 'cover_letters/cover_Nexus.tex',
    source: 'https://freehire.me/jobs/nexus-backend',
    deadline: '2026-09-15'
  }
];

export async function getTracker(p: ProfileEntry): Promise<Row[]> {
  if (usingRedis) {
    const stored = await kvGet(`tracker:${p.id}`);
    if (stored !== null) return JSON.parse(stored);
    if (!p.builtin) return [];
    await kvSet(`tracker:${p.id}`, JSON.stringify(STARTER_ROWS));
    return STARTER_ROWS;
  }
  const content = readFile(trackerFile(p));
  if (content !== null) return parseCSV(content);
  if (!p.builtin) return [];
  // Same first-run behaviour as the original dashboard
  writeFile(trackerFile(p), stringifyCSV(TRACKER_HEADERS, STARTER_ROWS));
  return STARTER_ROWS;
}

export async function saveTracker(p: ProfileEntry, rows: Row[]): Promise<void> {
  if (usingRedis) await kvSet(`tracker:${p.id}`, JSON.stringify(rows));
  else writeFile(trackerFile(p), stringifyCSV(TRACKER_HEADERS, rows));
}

// ---------- Summaries ----------

function field(md: string, label: string): string {
  return (md.replace(/<!--[\s\S]*?-->/g, '').match(new RegExp(`\\*\\*${label}:\\*\\*[ \\t]*(.*)`)) || [])[1]?.trim() || '';
}

function initials(name: string): string {
  return String(name).split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
}

function isComplete(parsed: ReturnType<typeof parseProfile>): boolean {
  return Boolean(parsed.name && (parsed.experience.length || parsed.skills.length));
}

export async function listProfiles() {
  return Promise.all([BUILTIN, ...registry()].map(async p => {
    const md = await getProfileMarkdown(p);
    const parsed = parseProfile(md);
    const name = parsed.name || '';
    return {
      id: p.id,
      label: p.label,
      builtin: p.builtin,
      name,
      title: p.builtin ? 'Senior Full Stack & AI Engineer' : (field(md, 'Title') || p.label),
      initials: initials(name || p.label),
      complete: isComplete(parsed)
    };
  }));
}

// Profile JSON for the dashboard's profile panel
export async function profileDetails(p: ProfileEntry) {
  const md = await getProfileMarkdown(p);
  if (p.builtin) {
    // The built-in profile keeps the original dashboard's hand-written summary
    return {
      name: 'Hassaan Nasir',
      title: 'Senior Full Stack & AI Engineer',
      experience: '8+ Years',
      email: 'hasaan.engineer1@gmail.com',
      location: 'Pakistan / UAE / Worldwide Remote',
      linkedin: 'https://linkedin.com/in/hassaan713-nasir',
      skills: {
        primary: ['Python 3', 'Django', 'Django REST Framework', 'React.js', 'Next.js', 'TypeScript', 'PostgreSQL', 'Celery', 'Redis', 'REST APIs', 'Microservices'],
        ai: ['Claude Code', 'Anthropic Claude API', 'OpenAI API', 'LangChain', 'LangGraph', 'Model Context Protocol (MCP)', 'Cursor AI'],
        cloud: ['Docker', 'Kubernetes', 'AWS (EC2, ECS, S3, RDS)', 'GitLab CI/CD', 'GitHub Actions', 'Terraform', 'Linux'],
        observability: ['Sentry', 'Datadog', 'Grafana', 'Prometheus', 'OpenTelemetry'],
        secondary: ['FastAPI', 'Node.js', 'Express.js', 'ClickHouse', 'Elasticsearch', 'GraphQL', 'Tailwind CSS']
      },
      rawMarkdown: md
    };
  }
  const parsed = parseProfile(md);
  const years = yearsOfExperience(parsed.experience);
  return {
    id: p.id,
    label: p.label,
    name: parsed.name || p.label,
    title: field(md, 'Title') || p.label,
    experience: years ? `${years}+ Years` : '',
    email: parsed.email,
    location: parsed.location,
    linkedin: parsed.linkedin,
    skillGroups: parsed.skills.filter((g: { items: string[] }) => g.items.length),
    complete: isComplete(parsed),
    rawMarkdown: md
  };
}

// ---------- Fit evaluation for added profiles ----------

export async function evaluateAgainstProfile(p: ProfileEntry, { title = '', description = '' }: { title?: string; description?: string }) {
  const md = await getProfileMarkdown(p);
  const parsed = parseProfile(md);

  if (!isComplete(parsed)) {
    return {
      overallScore: 0,
      verdict: 'Profile incomplete',
      breakdown: { technical: 0, experience: 0, behavioral: 0, location: 0, career: 0 },
      matchedKeywords: [],
      strengths: [`Fill in the ${p.label} profile (name, experience and skills) to score jobs against it.`]
    };
  }

  const { matched, missing } = analyseJob(description, title, md);
  const text = `${title}\n${description}`.toLowerCase();

  const reqMatched = matched.filter((t: { required: boolean }) => t.required).length;
  const reqTotal = reqMatched + missing.filter((t: { required: boolean }) => t.required).length;
  const technical = reqTotal ? Math.round((reqMatched / reqTotal) * 100) : 60;

  const years = yearsOfExperience(parsed.experience);
  const asked = Math.max(0, ...[...text.matchAll(/(\d{1,2})\+?\s*(?:\+\s*)?years?/g)].map(m => Number(m[1])).filter(n => n < 30));
  const experience = !asked ? 80 : years >= asked ? 95 : Math.max(35, 95 - (asked - years) * 15);

  const behavioral = 75;

  const place = parsed.location.toLowerCase();
  const placeWords = place.split(/[^a-z]+/).filter((w: string) => w.length > 3 && !['remote', 'open', 'worldwide', 'hybrid'].includes(w));
  const location = /remote|anywhere|worldwide|work from home/.test(text) || placeWords.some((w: string) => text.includes(w)) ? 95 : 70;

  const targetTitle = (field(md, 'Title') || p.label).toLowerCase();
  const titleWords = targetTitle.split(/[^a-z]+/).filter(w => w.length > 2 && !['senior', 'junior', 'lead'].includes(w));
  const career = titleWords.length && titleWords.every(w => title.toLowerCase().includes(w)) ? 92
    : titleWords.some(w => text.includes(w)) ? 80 : 60;

  const overallScore = Math.round(technical * 0.35 + experience * 0.25 + behavioral * 0.15 + location * 0.10 + career * 0.15);
  const verdict = overallScore >= 90 ? 'Exceptional Match' : overallScore >= 80 ? 'Strong Fit' : overallScore >= 70 ? 'Good Fit' : overallScore >= 55 ? 'Moderate Fit' : 'Weak Fit';

  // Strengths come straight from the profile: the bullets that evidence most requirements
  type Term = { name: string; re: RegExp; required: boolean };
  const bullets = parsed.experience
    .flatMap((x: { bullets: string[] }) => x.bullets.map(b => ({ b, hits: matched.filter((t: Term) => { t.re.lastIndex = 0; return t.re.test(b); }).length })))
    .filter((x: { hits: number }) => x.hits > 0)
    .sort((a: { hits: number }, b: { hits: number }) => b.hits - a.hits)
    .slice(0, 2)
    .map((x: { b: string }) => x.b);
  const strengths: string[] = [];
  if (matched.length) strengths.push(`Covers ${matched.slice(0, 6).map((t: Term) => t.name).join(', ')} from the posting.`);
  strengths.push(...bullets);
  if (missing.some((t: Term) => t.required)) strengths.push(`Gaps to address: ${missing.filter((t: Term) => t.required).slice(0, 5).map((t: Term) => t.name).join(', ')}.`);

  return {
    overallScore,
    verdict,
    breakdown: { technical, experience, behavioral, location, career },
    matchedKeywords: matched.map((t: Term) => t.name),
    strengths
  };
}

// Blank, commented template for a new profile. HTML comments are ignored by the
// parser, so the examples never leak into CVs or scores.
function template(p: ProfileEntry): string {
  return `---
profile_label: ${p.label}
---

# Candidate Profile

<!-- Fill in each section below. Text inside comment blocks like this one is only an example and is ignored. -->

## Identity
- **Name:**
- **Title:** ${p.label}
- **Location:**
- **Email:**
- **LinkedIn:**
- **Status:**

### Languages
| Language | Level | Notes |
|----------|-------|-------|

## Education

| Degree | Period | Institution | Key Topics |
|--------|--------|-------------|------------|

## Professional Experience
<!-- One block per role, most recent first:
### Job Title - Company (2022 – 2025)
City, Country / Remote
- What you achieved, with a measurable result where possible
-->

## Independent Projects
<!-- - **Project name**: one-line description -->

## Technical Skills
<!-- Group skills under ### headings, for example:
### Core
- **Main skill** (Expert): related tool, related tool
-->

## Certifications
<!-- - **Certification name** - Issuer -->
`;
}
