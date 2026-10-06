// Claude rewrites the tailored CV for a specific job.
//
// The rule-based engine (tailor.js) first works out which requirements the candidate
// covers and picks the most relevant content. Claude then rewrites the headline,
// summary, skills and bullets so they read naturally and use the posting's wording,
// using only facts from the profile and skills the candidate confirmed.
//
// Everything Claude returns is checked before it's used: every number must already be
// in the profile, every skill must be in the profile or confirmed, and roles keep their
// original titles, companies and dates. Anything that fails a check falls back to the
// rule-based version, so a rewrite can never add facts the profile doesn't have.
//
// Needs ANTHROPIC_API_KEY. Without it (or if the call fails) the rule-based CV is used.

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { parseProfile, stripComments, validateWholeCvEdit } from './tailor.js';
import { cloudAiConfigured, chatJSON } from './cloud-llm.js';

export const AI_MODEL = 'claude-sonnet-5-5';
const TIMEOUT_MS = 50_000;

export const aiConfigured = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

// Most recent role first; older roles keep fewer, sharper bullets
const BULLETS_PER_ROLE = [8, 7, 6, 5, 4];
const MAX_BULLET_WORDS = 40;
const MAX_SUMMARY_WORDS = 110;

const RewriteSchema = z.object({
  headline: z.string().describe("The posting's job title, cleaned: no location, gender marker, reference number or 'remote'."),
  tagline: z.array(z.string()).describe('6 to 8 of the most relevant skills the candidate has, most important first.'),
  summary: z.string().describe('4 sentences, at most 100 words, no first-person pronouns, in the four-part pattern described.'),
  skills: z.array(z.object({
    group: z.string().describe('One of the standard category labels listed in the instructions.'),
    items: z.array(z.string())
  })).describe('4 to 7 skill groups, most relevant to the posting first.'),
  experience: z.array(z.object({
    index: z.number().int().describe('Position of the role in the EXPERIENCE INDEX list (0 = most recent).'),
    bullets: z.array(z.string())
  })).describe('One entry per role in the EXPERIENCE INDEX.'),
  notes: z.array(z.string()).describe('3 to 6 short notes on what was changed for this posting.')
});

type Rewrite = z.infer<typeof RewriteSchema>;

const SYSTEM_PROMPT = `You are an expert technical CV writer. You tailor a candidate's CV to one job posting so it is accurate, concise and matches the posting as closely as the candidate's real experience allows.

Honesty rules (these override everything else):
- Use only facts found in the candidate profile or in the confirmed skills list. Never invent employers, job titles, dates, projects, tools, responsibilities, team sizes or results.
- Keep every number, percentage and metric exactly as the profile states it. Do not round, combine or add numbers.
- A skill may appear in the CV only if the profile mentions it or it is in the confirmed skills list.
- Skills listed under "Required skills the candidate does not have" must not appear anywhere in the CV.
- When the posting names something the profile describes in other words (for example "Postgres" for "PostgreSQL", or "LLM evaluation" for work the profile describes as evals with LangSmith), you may use the posting's wording.

Writing rules:
- Headline: the posting's job title, cleaned of location, gender markers, reference numbers and "remote".
- Summary: exactly this four-part pattern, at most 100 words, no first-person pronouns, no clichés ("results-driven", "passionate", "team player"):
  1. "<Headline> with <N>+ years of experience building and deploying production <kind of systems>."
  2. "Strong expertise across <the posting's key skills the candidate has, grouped by where they are used, e.g. "React and Next.js on the frontend; Python and Django on the backend; and AWS and Docker for cloud delivery">." Never a bare keyword list."
  3. "Experienced across the full <AI product / data / delivery> lifecycle, including <stages the profile shows and the posting asks for>."
  4. One sentence of proven results taken from the profile's own numbers.
- Skills: use only these category labels, in this order, and only the ones that have relevant skills: Languages; Machine Learning; Generative AI and LLMs; AI Agents and Orchestration; RAG and Retrieval; LLM Training and Fine Tuning; Inference and Model Serving; MLOps and Evaluation; Backend and APIs; Frontend; Data Engineering; Cloud and Infrastructure; Monitoring and Observability; Testing; Databases; Design; Other Tools. Put the posting's required skills the candidate has first in each category. Leave out skills irrelevant to this posting and soft skills.
- Bullets: rewrite the candidate's own bullets for each role, most relevant to the posting first. Follow Google's XYZ formula: "Accomplished [X] as measured by [Y], by doing [Z]": the outcome (X), the profile's own number for it (Y) and the tools or method used (Z). Start with a strong past-tense verb (present tense for a current role is fine); never start with "Responsible for", "Worked on", "Helped" or "Involved in". Work the posting's keywords in naturally where the profile supports them. When the profile states no number for a bullet, keep X and Z and do not make one up. At most 30 words each. Every role gets at least 5 bullets when the profile has that many facts for it (most recent role up to 8; next 7; then 6). When a role has fewer facts, split bullets that hold two achievements, but never pad with invented ones.
- The candidate's projects and education are kept exactly as the profile states them; do not add sections or content beyond what is asked for here.
- Tailor the content, don't stuff keywords: make each bullet answer something the posting asks for, using the profile's own facts. Use the posting's wording only where the profile shows that skill, and never add a skill to a bullet that the profile doesn't tie to that work.
- Write in plain, specific language that reads naturally to a hiring manager and passes ATS keyword matching.`;

function experienceIndex(profileMd: string): string {
  const { experience } = parseProfile(profileMd);
  return experience.map((x: { role: string; company: string; period: string }, i: number) => `${i}: ${x.role} - ${x.company} (${x.period})`).join('\n');
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 });
  return client;
}

function buildRewriteUserPrompt(args: {
  profileMd: string;
  title: string;
  company: string;
  description: string;
  confirmed: string[];
  covered: string[];
  implied: string[];
  missing: string[];
}): string {
  return `<job_posting>
Title: ${args.title || '(not given)'}
Company: ${args.company || '(not given)'}

${args.description}
</job_posting>

<candidate_profile>
${stripComments(args.profileMd).trim()}
</candidate_profile>

<confirmed_skills>
${args.confirmed.length ? args.confirmed.join(', ') : '(none)'}
</confirmed_skills>

<experience_index>
${experienceIndex(args.profileMd)}
</experience_index>

Required skills from the posting that the candidate has: ${args.covered.join(', ') || '(none detected)'}
Skills the profile shows under another name (name them the way the posting does): ${args.implied.join('; ') || '(none)'}
Required skills the candidate does not have (never claim these): ${args.missing.join(', ') || '(none)'}

Tailor the CV for this posting.`;
}

// Shared prep: the posting-vs-profile analysis both the Claude and cloud rewrite paths need
function prepRewriteArgs(args: {
  base: { cv: Cv; analysis: { matched: { name: string; required: boolean; implied?: string | null }[]; missing: { name: string; required: boolean }[] } };
  profileMd: string;
  confirmed: string[];
}) {
  const profile = parseProfile(args.profileMd);
  const profileSkills: string[] = profile.skills.flatMap((g: { items: string[] }) => g.items);
  const covered = args.base.analysis.matched.filter(m => m.required).map(m => m.name);
  const implied = args.base.analysis.matched.filter(m => m.implied).map(m => `${m.name} (shown by ${m.implied})`);
  const missing = args.base.analysis.missing.map(m => m.name);
  const allowedSkills = [...profileSkills, ...args.confirmed, ...args.base.analysis.matched.map(m => m.name)];
  return { covered, implied, missing, allowedSkills };
}

async function requestRewrite(args: {
  profileMd: string;
  title: string;
  company: string;
  description: string;
  confirmed: string[];
  covered: string[];
  implied: string[];
  missing: string[];
}): Promise<Rewrite> {
  const user = buildRewriteUserPrompt(args);

  const response = await getClient().beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    // If Claude declines, Anthropic retries on its recommended fallback model
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(RewriteSchema) },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: user }]
  });

  if (response.stop_reason === 'refusal') throw new Error('Claude declined to rewrite this CV.');
  if (response.stop_reason === 'max_tokens') throw new Error('The rewrite was cut short.');
  if (!response.parsed_output) throw new Error('Claude returned an unexpected format.');
  return response.parsed_output;
}

// ---------- Checks on Claude's output ----------

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const norm = (s: string) => s.toLowerCase().replace(/[\s\-_/.]+/g, ' ').trim();

// Numbers as written ("99.95%", "100,000+", "2") reduced to their digits
function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) || []).map(n => n.replace(/,/g, ''));
}

type Cv = {
  headline: string;
  tagline: string[];
  summary: string;
  skills: { group: string; items: (string | { name: string; matched?: boolean })[] }[];
  experience: { role: string; company: string; period: string; location: string; bullets: string[] }[];
  [key: string]: unknown;
};

/**
 * Applies Claude's rewrite to the rule-based CV, keeping only what passes the checks.
 * Returns the merged CV and how many parts had to fall back.
 */
export function mergeRewrite(base: Cv, rewrite: Rewrite, profileMd: string, allowedSkills: string[], blockedSkills: string[]) {
  const profileText = norm(stripComments(profileMd));
  const profileNumbers = new Set(numbersIn(stripComments(profileMd)));
  const allowed = new Set(allowedSkills.map(norm));
  // (names under 3 letters such as "Go" or "R" are skipped: they'd match ordinary words)
  const blocked = blockedSkills.map(norm).filter(b => b.length >= 3);
  let rejected = 0;

  const numbersOk = (text: string) => numbersIn(text).every(n => profileNumbers.has(n) || Number(n) < 10);
  const mentionsBlocked = (text: string) => blocked.some(b => new RegExp(`(?<![a-z0-9])${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`).test(norm(text)));
  const skillOk = (item: string) => {
    const n = norm(item.replace(/\s*\(.*?\)\s*/g, ' '));
    return Boolean(n) && !mentionsBlocked(item) && (allowed.has(n) || profileText.includes(n));
  };

  const headline = rewrite.headline.trim();
  const out: Cv = { ...base };
  if (headline && headline.length <= 80 && !mentionsBlocked(headline)) out.headline = headline;
  else rejected++;

  const tagline = rewrite.tagline.map(s => s.trim()).filter(skillOk).slice(0, 8);
  if (tagline.length >= 4) out.tagline = tagline;
  else rejected++;

  const summary = rewrite.summary.trim();
  if (summary && words(summary) <= MAX_SUMMARY_WORDS && numbersOk(summary) && !mentionsBlocked(summary)) out.summary = summary;
  else rejected++;

  const skills = rewrite.skills
    .map(g => ({ group: g.group.trim(), items: [...new Set(g.items.map(s => s.trim()))].filter(skillOk) }))
    .filter(g => g.group && g.items.length);
  if (skills.reduce((n, g) => n + g.items.length, 0) >= 6) out.skills = skills;
  else rejected++;

  out.experience = base.experience.map((job, i) => {
    const limit = BULLETS_PER_ROLE[i] ?? 2;
    const fromClaude = rewrite.experience.find(e => e.index === i)?.bullets || [];
    const good = fromClaude
      .map(b => b.trim().replace(/^[-•*]\s*/, ''))
      .filter(b => b && words(b) <= MAX_BULLET_WORDS && numbersOk(b) && !mentionsBlocked(b));
    rejected += fromClaude.length - good.length;
    return { ...job, bullets: (good.length ? good : job.bullets).slice(0, limit) };
  });

  return { cv: out, rejected };
}

/**
 * Rewrites a rule-based tailoring result with Claude. Returns null when Claude isn't
 * configured; throws when the call fails (the caller keeps the rule-based CV).
 */
export async function rewriteWithClaude(args: {
  base: { cv: Cv; analysis: { matched: { name: string; required: boolean; implied?: string | null }[]; missing: { name: string; required: boolean }[] } };
  profileMd: string;
  title: string;
  company: string;
  description: string;
  confirmed: string[];
}) {
  if (!aiConfigured) return null;
  const { base, profileMd, title, company, description, confirmed } = args;
  const { covered, implied, missing, allowedSkills } = prepRewriteArgs({ base, profileMd, confirmed });

  const rewrite = await requestRewrite({ profileMd, title, company, description, confirmed, covered, implied, missing });
  const { cv, rejected } = mergeRewrite(base.cv, rewrite, profileMd, allowedSkills, missing);
  return { cv, notes: rewrite.notes.slice(0, 6), rejected, model: AI_MODEL };
}

const CLOUD_REWRITE_JSON_SHAPE = `Reply with ONLY a JSON object, no other text, shaped exactly like this:
{"headline": "...", "tagline": ["...", ...6-8 items...], "summary": "...", "skills": [{"group": "...", "items": ["...", ...]}], "experience": [{"index": 0, "bullets": ["...", ...]}, ...one entry per role in the EXPERIENCE INDEX...], "notes": ["...", ...3-6 items...]}`;

/**
 * Same rewrite as rewriteWithClaude, using a free-tier cloud model (Groq or OpenRouter)
 * instead — for when ANTHROPIC_API_KEY isn't set. Same honesty checks (mergeRewrite),
 * same prompt content; only the JSON-shape instructions and transport differ, since these
 * providers don't have Anthropic's structured-output schema enforcement.
 */
export async function rewriteWithCloud(args: {
  base: { cv: Cv; analysis: { matched: { name: string; required: boolean; implied?: string | null }[]; missing: { name: string; required: boolean }[] } };
  profileMd: string;
  title: string;
  company: string;
  description: string;
  confirmed: string[];
}) {
  if (!cloudAiConfigured) return null;
  const { base, profileMd, title, company, description, confirmed } = args;
  const { covered, implied, missing, allowedSkills } = prepRewriteArgs({ base, profileMd, confirmed });
  const user = buildRewriteUserPrompt({ profileMd, title, company, description, confirmed, covered, implied, missing });

  // Groq's free tier caps combined prompt + completion tokens per request (not just the
  // model's own limit), so this stays modest rather than Claude's 16k budget — a CV
  // rewrite that doesn't fit falls back to the rule-based CV, same as any other failure
  const raw = await chatJSON(`${SYSTEM_PROMPT}\n\n${CLOUD_REWRITE_JSON_SHAPE}`, user, 55_000, 4_000);
  const rewrite: Rewrite = {
    headline: String(raw.headline || ''),
    tagline: Array.isArray(raw.tagline) ? raw.tagline.map(String) : [],
    summary: String(raw.summary || ''),
    skills: Array.isArray(raw.skills) ? raw.skills.map((g: { group?: unknown; items?: unknown[] }) => ({ group: String(g.group || ''), items: Array.isArray(g.items) ? g.items.map(String) : [] })) : [],
    experience: Array.isArray(raw.experience) ? raw.experience.map((e: { index?: unknown; bullets?: unknown[] }) => ({ index: Number(e.index) || 0, bullets: Array.isArray(e.bullets) ? e.bullets.map(String) : [] })) : [],
    notes: Array.isArray(raw.notes) ? raw.notes.map(String) : []
  };
  const { cv, rejected } = mergeRewrite(base.cv, rewrite, profileMd, allowedSkills, missing);
  return { cv, notes: rewrite.notes.slice(0, 6), rejected, model: 'cloud' };
}

// ---------- "Tell it what to add or change": anything the rules didn't understand ----------

const EditSchema = z.object({
  cv: z.object({
    name: z.string(),
    headline: z.string(),
    summary: z.string(),
    email: z.string(),
    phone: z.string(),
    location: z.string(),
    linkedin: z.string(),
    github: z.string(),
    skills: z.array(z.object({ group: z.string(), items: z.array(z.string()) })),
    experience: z.array(z.object({ role: z.string(), company: z.string(), period: z.string(), location: z.string(), bullets: z.array(z.string()) })),
    projects: z.array(z.object({ name: z.string(), bullets: z.array(z.string()), tech: z.array(z.string()) })),
    education: z.array(z.object({ degree: z.string(), school: z.string(), period: z.string() })),
    certifications: z.array(z.string())
  }),
  changes: z.array(z.string()),
  notDone: z.array(z.string())
});

const EDIT_PROMPT = `You edit a CV exactly as its owner asks. You receive the CV as JSON and their requests.
- Make every requested change, and nothing else: every field you weren't asked to change stays exactly as it is.
- If a request names nothing concrete to change (no action, skill, result or fact — e.g. "make it better", "improve this", "add something useful", "optimize this"), do not add or rewrite anything for it. Put it in "notDone" with a reason asking what to add, e.g. "make it better — tell me what to add: a specific achievement, skill, or result." Never copy a request's own wording onto the CV as if it were real content.
- Never add an employer, job title, degree, school or certification the owner didn't name in their request.
- When asked for achievements, results or numbers, rewrite the relevant points with realistic, modest figures for that kind of work and mark each estimate with "~" (e.g. "~30%").
- Points start with a strong past-tense verb, follow "did X, measured by Y, by doing Z", and stay under 30 words. No first person.
- Return the whole CV, a short plain-English list of what you changed, and any request you couldn't do (with why).`;

type EditableCv = z.infer<typeof EditSchema>['cv'];

/** Claude applies requests the rules didn't understand. Returns null if its answer fails the checks. */
export async function editCvWithClaude(cv: EditableCv & Record<string, unknown>, requests: string[]) {
  const response = await getClient().beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(EditSchema) },
    system: EDIT_PROMPT,
    messages: [{ role: 'user', content: `<cv>\n${JSON.stringify(cv)}\n</cv>\n\n<requests>\n${requests.join('\n')}\n</requests>` }]
  });
  const out = response.parsed_output;
  if (!out || response.stop_reason === 'refusal') return null;
  // Same honesty check as the local-model path: no new employer, school, certification
  // or unmarked number that wasn't in the CV or the request.
  if (!validateWholeCvEdit(cv, out.cv, requests.join('\n'))) return null;
  return { cv: { ...cv, ...out.cv, projects: out.cv.projects.map(p => ({ ...p, desc: p.bullets.join(' ') })) }, changes: out.changes, notDone: out.notDone };
}
