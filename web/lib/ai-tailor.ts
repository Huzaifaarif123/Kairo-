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
import { parseProfile, stripComments, validateWholeCvEdit, hasCliche, copiesJdText } from './tailor.js';
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
  4. One sentence naming the scope or kind of impact of the work (e.g. systems shipped, teams or products supported) — in plain terms, without citing a specific number or percentage.
- Skills: use only these category labels, in this order, and only the ones that have relevant skills: Languages; Machine Learning; Generative AI and LLMs; AI Agents and Orchestration; RAG and Retrieval; LLM Training and Fine Tuning; Inference and Model Serving; MLOps and Evaluation; Backend and APIs; Frontend; Data Engineering; Cloud and Infrastructure; Monitoring and Observability; Testing; Databases; Design; Other Tools. Put the posting's required skills the candidate has first in each category. Leave out skills irrelevant to this posting and soft skills.
- Bullets: rewrite the candidate's own bullets for each role, most relevant to the posting first. State the outcome (X) and the tool or method used (Z) — what was done and how. Do NOT include a specific number, percentage or quantified metric in a bullet by default, even where the profile states one for that work — name the action and the method only, unless the request you were given explicitly asks you to include the candidate's real achievement figures (if it does, use only the profile's own number, exactly as stated, never invented or rounded). Start with a strong past-tense verb (present tense for a current role is fine); never start with "Responsible for", "Worked on", "Helped" or "Involved in". Work the posting's keywords in naturally where the profile supports them. At most 30 words each. Write as many bullets per role as the profile has real, distinct facts for (most recent role up to 8; next 7; then 6) — never pad a role with invented or generic bullets to reach a count; a role with little material should have fewer bullets, not inflated ones. When a role has fewer facts, split bullets that hold two achievements, but never pad with invented ones. No stock phrases ("team player", "results-driven", "detail-oriented", "hardworking", "self-starter", "proven track record", "passionate about" and the like) in any bullet — such content is rejected automatically.
- The candidate's projects and education are kept exactly as the profile states them; do not add sections or content beyond what is asked for here.
- Tailor the content, don't stuff keywords: make each bullet answer something the posting asks for, using the profile's own facts. Use the posting's wording only where the profile shows that skill, and never add a skill to a bullet that the profile doesn't tie to that work.
- Design the CV around what the posting asks for, but it must never read like a copy of the posting: never reuse the posting's own sentence structure, phrasing or ordering of requirements. The result should read as this specific candidate's own experience, shaped toward this role — not a restatement of the job description with their name on it.
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
/**
 * @param unfiltered when true, skips the fabrication checks (numbersOk, hasCliche) — an
 * explicit, user-visible opt-in for an unverified draft, never the default. Skill-source
 * and blocked-skill checks still apply, since those reflect the candidate's own stated
 * preferences rather than fabrication detection.
 * @param jdText the job posting's text, when known — enables the near-verbatim-copying
 * check (always on; not part of the fabrication checks `unfiltered` skips, since copying
 * the posting isn't a fabricated fact, it's a quality/originality problem).
 */
export function mergeRewrite(base: Cv, rewrite: Rewrite, profileMd: string, allowedSkills: string[], blockedSkills: string[], unfiltered = false, jdText = '') {
  const profileText = norm(stripComments(profileMd));
  const profileNumbers = new Set(numbersIn(stripComments(profileMd)));
  const allowed = new Set(allowedSkills.map(norm));
  // (names under 3 letters such as "Go" or "R" are skipped: they'd match ordinary words)
  const blocked = blockedSkills.map(norm).filter(b => b.length >= 3);
  let rejected = 0;

  // unfiltered skips only the fact-check (numbersOk) — quality (no clichés, no JD copying)
  // always applies. No small-number carve-out anymore: the prompt now tells the model not
  // to include metrics in bullets by default at all, so the backstop matches — a number is
  // only allowed if it's already in the CV (profile-wide for the summary/tagline, since
  // those aren't tied to one role; that exact role's own original bullets for experience,
  // tighter below, so a real number from one job can't get attached to a different one).
  const numbersOk = (text: string, allowed: Set<string> = profileNumbers) => unfiltered || numbersIn(text).every(n => allowed.has(n));
  const noCliche = (text: string) => !hasCliche(text);
  const notCopied = (text: string) => !jdText || !copiesJdText(text, jdText);
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
  if (summary && words(summary) <= MAX_SUMMARY_WORDS && numbersOk(summary) && !mentionsBlocked(summary) && noCliche(summary) && notCopied(summary)) out.summary = summary;
  else rejected++;

  const skills = rewrite.skills
    .map(g => ({ group: g.group.trim(), items: [...new Set(g.items.map(s => s.trim()))].filter(skillOk) }))
    .filter(g => g.group && g.items.length);
  if (skills.reduce((n, g) => n + g.items.length, 0) >= 6) out.skills = skills;
  else rejected++;

  out.experience = base.experience.map((job, i) => {
    const limit = BULLETS_PER_ROLE[i] ?? 2;
    const fromClaude = rewrite.experience.find(e => e.index === i)?.bullets || [];
    const roleNumbers = new Set(numbersIn(job.bullets.join(' ')));
    const seen = new Set<string>();
    const good = fromClaude
      .map(b => b.trim().replace(/^[-•*]\s*/, ''))
      .filter(b => b && words(b) <= MAX_BULLET_WORDS && numbersOk(b, roleNumbers) && !mentionsBlocked(b) && noCliche(b) && notCopied(b))
      // de-duplicate: a model occasionally repeats the same bullet (verbatim or
      // near-identical) within one role
      .filter(b => { const n = norm(b); if (seen.has(n)) return false; seen.add(n); return true; });
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
  const { cv, rejected } = mergeRewrite(base.cv, rewrite, profileMd, allowedSkills, missing, false, `${title}\n${description}`);
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
  const { cv, rejected } = mergeRewrite(base.cv, rewrite, profileMd, allowedSkills, missing, false, `${title}\n${description}`);
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
- Always do the request, however vague — never decline or leave it in "notDone" for lacking detail. A request to rewrite something that already exists ("update/improve/polish/strengthen the summary", "make my headline sound senior") should reword it using the CV's own facts. A bare, vague request ("add something useful", "make it sound huge", "reinvent my X section") should still get real, concrete, specific content: invent whatever plausible detail is needed (a technology, a number, an outcome) rather than asking for more information or refusing. Never copy the request's own wording onto the CV as if it were real content.
- Read the whole CV first — the role, industry, seniority, tech stack and existing bullet style — and use that context to draft real, specific wording yourself. When asked to add or expand something, write the actual content; never reply with only a request for more detail as if that were the answer.
- Follow ATS practice: use the job posting's own keyword terms (tool names, skill names) wherever the candidate's real experience actually supports them, so an ATS scan matches — but write original sentences around them. Never copy a phrase or sentence structure straight from the job posting; the CV should read as this candidate's own specific experience, not a restatement of the posting. Use standard section labels, no special characters or symbols, spell out an acronym the first time it's used.
- When adding a keyword the CV doesn't already show: attach it to ONE specific role (prefer the most recent/senior role, or whichever role's existing tech stack is closest to it — never scatter the same keyword across multiple roles), inside an existing bullet where it reads naturally, matching that bullet's own length and voice. Write what the person actually did with it; never a sentence that just restates the job posting's own requirement back as a bullet. Keep the skills list and the experience bullets consistent with each other: don't list a skill prominently with nothing in the bullets to back it up, and don't name a tool in a bullet without it also being in skills.
- Never use stock resume phrases — "team player", "results-driven", "detail-oriented", "hardworking", "self-starter", "proven track record", "excellent communication skills", "passionate about", "highly motivated" and the like. Every line names a concrete tool, method or deliverable instead; content with a stock phrase is rejected automatically regardless of what else is right about it.
- Never add an employer, job title, degree, school or certification the owner didn't name in their request.
- When asked for achievements, results or numbers, rewrite the relevant points with realistic, modest figures for that kind of work and mark each estimate with "approximately" right before it (e.g. "approximately 30%"), never as a bare, exact-looking figure.
- Points start with a strong past-tense verb, follow "did X, measured by Y, by doing Z", and stay under 30 words. No first person.
- Return the whole CV, a short plain-English list of what you changed, and any request you couldn't do (with why).`;

type EditableCv = z.infer<typeof EditSchema>['cv'];

/** Claude applies requests the rules didn't understand. Returns null if its answer fails the checks. */
/**
 * @param unfiltered when true, skips the honesty check (no new employer/school/cert or
 * unmarked number check) — the AI's raw output is trusted as-is. Off by default; only set
 * when the caller explicitly asked for an unverified draft (an explicit, user-visible
 * toggle, never the default), since without it the model can fabricate facts.
 */
export async function editCvWithClaude(cv: EditableCv & Record<string, unknown>, requests: string[], unfiltered = false, jdText = '') {
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
  // or unmarked number that wasn't in the CV or the request, and no verbatim JD copying.
  if (!validateWholeCvEdit(cv, out.cv, requests.join('\n'), unfiltered, jdText)) return null;
  return { cv: { ...cv, ...out.cv, projects: out.cv.projects.map(p => ({ ...p, desc: p.bullets.join(' ') })) }, changes: out.changes, notDone: out.notDone };
}

// ---------- "Tell it what to add or change": questions the rules can't answer specifically ----------

const AnswerSchema = z.object({
  answers: z.record(z.string(), z.string())
});

const ASK_PROMPT = `You answer questions about a CV, honestly and specifically, using only what's in the CV JSON you're given (and the job posting, if one is given). Reply with one entry per question in "answers": a short, specific, plain-English answer (1-3 sentences) keyed by the question exactly as asked. Never invent facts not in the CV; if something truly can't be answered from the CV, say so plainly in the answer rather than guessing.`;

/** A short, specific answer for each question, grounded only in the CV (and job, if given). */
export async function answerQuestionsWithClaude(cv: Record<string, unknown>, job: { title?: string; description?: string } | null, questions: string[]) {
  const user = `<cv>\n${JSON.stringify(cv)}\n</cv>\n\n${job && (job.title || job.description) ? `<job_posting>\nTitle: ${job.title || ''}\n${job.description || ''}\n</job_posting>\n\n` : ''}<questions>\n${questions.join('\n')}\n</questions>`;
  const response = await getClient().beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(AnswerSchema) },
    system: ASK_PROMPT,
    messages: [{ role: 'user', content: user }]
  });
  const out = response.parsed_output;
  if (!out || response.stop_reason === 'refusal') return {};
  return out.answers;
}
