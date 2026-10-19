// "Tell it what to add or change": requests the rules don't understand go to a free-tier
// cloud model when one is configured, as a faster and more reliable alternative to
// Anthropic or the local Ollama model. Same idea as local-llm.js: the model sees the
// whole CV and returns the whole updated CV in the same shape, checked by the shared
// validateWholeCvEdit honesty gate before it's trusted.
//
// Gemini is tried first when configured (a notably more generous free-tier rate limit
// than Groq's — see the comment on GEMINI_MODEL), then Groq/OpenRouter as the next tier,
// mirroring the Claude -> cloud -> local-Ollama fallback one level up in the route.
import { normalizeCV, validateWholeCvEdit, copiesJdText, hasCliche, checkExperienceQuality, unsupportedSkills, skillsNamed } from './tailor.js';

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
// gemini-3.5-flash-lite: verified live (2026-10-07) as the first model in this key's
// catalog that actually serves generateContent quickly — several of Gemini's current
// model names (gemini-3.8-flash, gemini-flash-latest, the plain -flash/-pro aliases)
// either 404 as retired or hang for 15-30s before timing out on this account, despite
// being listed by the API; this one responds in ~1-1.5s. Override via GEMINI_MODEL if a
// different key/account needs a different name.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

// Either key activates the Groq/OpenRouter tier; Groq is tried first if both are set.
// Both APIs are OpenAI-compatible, so the same request shape works for either one.
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const PROVIDER = GROQ_KEY
  ? { key: GROQ_KEY, url: 'https://api.groq.com/openai/v1/chat/completions', model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b' }
  : OPENROUTER_KEY
    ? { key: OPENROUTER_KEY, url: 'https://openrouter.ai/api/v1/chat/completions', model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free' }
    : null;

/** Whether any cloud model (Gemini, Groq or OpenRouter) is configured. */
export const cloudAiConfigured = Boolean(GEMINI_KEY || PROVIDER);

/**
 * Which cloud model the next request will actually use, for the line the server prints on
 * startup. A key pasted into web/.env.local is otherwise silent until the first AI request
 * fails, which is a slow and confusing way to find out it didn't take — a typo'd variable
 * name or a key on the wrong line reads exactly like "the AI is broken".
 */
export const cloudAiDescription = GEMINI_KEY
  ? `Gemini (${GEMINI_MODEL})${PROVIDER ? `, falling back to ${PROVIDER.url.includes('groq') ? 'Groq' : 'OpenRouter'}` : ''}`
  : PROVIDER
    ? `${PROVIDER.url.includes('groq') ? 'Groq' : 'OpenRouter'} (${PROVIDER.model})`
    : '';

/**
 * Appends this request's corrections memory (see corrections.js) to a system prompt. The
 * owner's past corrections go last, after the standing rules, so they read as the most
 * recent and most specific instruction on the point they cover. An empty memory — no
 * stored correction close enough to this request, which is the normal case — returns the
 * prompt completely untouched, so a request without one is byte-for-byte what it always was.
 */
const withMemory = (prompt, memory) => (memory ? `${prompt}\n\n${memory}` : prompt);

const EDIT_PROMPT = `You edit a CV exactly as its owner asks. You receive the CV as JSON and their requests.
Reply with ONLY a JSON object, no other text, shaped exactly like this:
{"cv": { <only the top-level CV fields you changed> }, "changes": [ <short plain-English descriptions of what you changed> ], "notDone": [ <any request you could not do, as "<the request> — <short reason>"> ]}
The CV's fields are: name, headline, summary, email, phone, location, linkedin, github, skills (array of {group, items: [string]}), experience (array of {role, company, period, location, bullets: [string]}), projects (array of {name, bullets: [string], tech: [string]}), education (array of {degree, school, period}), certifications (array of string).
- In "cv", include ONLY the top-level fields you are actually changing. Leave out every field you're not touching.
- If you change even one bullet in a job, or one item in a skills group, return that whole list (all jobs in "experience", all groups in "skills") — but only if something in it changed.
- Make every requested change, and nothing else.
- Always do the request, however vague — never decline or leave it in "notDone" for lacking detail. A request to rewrite something that already exists ("update/improve/polish/strengthen the summary", "make my headline sound senior") should reword it using the CV's own facts. A bare, vague request ("add something useful", "make it sound huge", "reinvent my X section") should still get real, concrete, specific content: invent whatever plausible detail is needed (a technology, a number, an outcome) rather than asking for more information or refusing. Never copy the request's own wording onto the CV as if it were real content.
- Read the whole CV first — the role, industry, seniority, tech stack and existing bullet style — and use that context to draft real, specific wording yourself. When asked to add or expand something, write the actual content; never reply with only a request for more detail as if that were the answer.
- Follow ATS practice: use the job posting's own keyword terms (tool names, skill names) wherever the candidate's real experience actually supports them, so an ATS scan matches — but write original sentences around them. Never copy a phrase or sentence structure straight from the job posting; the CV should read as this candidate's own specific experience, not a restatement of the posting. Use standard section labels, no special characters or symbols, spell out an acronym the first time it's used.
- When adding a keyword the CV doesn't already show: attach it to ONE specific role (prefer the most recent/senior role, or whichever role's existing tech stack is closest to it — never scatter the same keyword across multiple roles), inside an existing bullet where it reads naturally, matching that bullet's own length and voice. Write what the person actually did with it; never a sentence that just restates the job posting's own requirement back as a bullet. Keep the skills list and the experience bullets consistent with each other: don't list a skill prominently with nothing in the bullets to back it up, and don't name a tool in a bullet without it also being in skills.
- Never use stock resume phrases — "team player", "results-driven", "detail-oriented", "hardworking", "self-starter", "proven track record", "excellent communication skills", "passionate about", "highly motivated" and the like. Every line names a concrete tool, method or deliverable instead; content with a stock phrase is rejected automatically regardless of what else is right about it.
- Never add an employer, job title, degree, school or certification the owner didn't name in their request.
- Never add a number (a year, a percent, a count of anything) that isn't already on the CV or in the request. If asked for achievements or results with no number given, you may add one realistic, modest estimate, but you must write it with "approximately" right before it (e.g. "approximately 30%", "approximately 500 users"), never as a bare, exact-looking figure.
- Points start with a strong past-tense verb and stay under 30 words. No first person ("I", "we").
- Within each role, order the bullets so that any point naming a programming language (Python, TypeScript, Go, SQL, Java and the like) comes before the points that name none. Ordering only — never invent a language the CV doesn't support, and never drop a point to make room.
- "notDone" must only contain requests that were actually asked — never comment on a field nobody asked about.`;

async function chatJSONGemini(systemPrompt, userContent, timeoutMs, maxTokens, temperature) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userContent }] }],
      generationConfig: { temperature, responseMimeType: 'application/json', maxOutputTokens: maxTokens }
    })
  });
  if (!res.ok) throw new Error(`Gemini error: ${res.status} ${await res.text().catch(() => '')}`);
  const data = await res.json();
  const candidate = data.candidates && data.candidates[0];
  if (candidate && candidate.finishReason === 'MAX_TOKENS') throw new Error('Gemini reply was cut off (too long for the token budget)');
  const part = candidate && candidate.content && candidate.content.parts && candidate.content.parts.find(p => p.text);
  return JSON.parse((part && part.text) || '{}');
}

async function chatJSONOpenAICompatible(systemPrompt, userContent, timeoutMs, maxTokens, temperature) {
  const res = await fetch(PROVIDER.url, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROVIDER.key}` },
    body: JSON.stringify({
      model: PROVIDER.model,
      temperature,
      // reasoning models (e.g. Groq's gpt-oss) spend a chunk of this budget thinking
      // before the JSON itself, so a full CV rewrite needs real headroom or the reply
      // gets cut off mid-JSON and fails to parse
      max_completion_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ]
    })
  });
  if (!res.ok) throw new Error(`${PROVIDER.url.includes('groq') ? 'Groq' : 'OpenRouter'} error: ${res.status} ${await res.text().catch(() => '')}`);
  const data = await res.json();
  const choice = data.choices && data.choices[0];
  if (choice && choice.finish_reason === 'length') throw new Error(`${PROVIDER.url.includes('groq') ? 'Groq' : 'OpenRouter'} reply was cut off (too long for the token budget)`);
  const content = choice && choice.message && choice.message.content;
  return JSON.parse(content || '{}');
}

/**
 * A single JSON-mode chat call to whichever cloud provider is configured. Gemini is
 * tried first when it has a key; if that call fails and a Groq/OpenRouter key is also
 * set, that's tried next before giving up — the same "don't let one backend's outage
 * take down the whole fallback tier" principle as the cloud -> local-Ollama handoff one
 * level up.
 *
 * `temperature` defaults to 1, which suits the open-ended calls. A task that should give
 * the same answer twice passes it lower — see TAILOR_TEMPERATURE.
 */
export async function chatJSON(systemPrompt, userContent, timeoutMs = 60_000, maxTokens = 8000, temperature = 1) {
  if (GEMINI_KEY) {
    try {
      return await chatJSONGemini(systemPrompt, userContent, timeoutMs, maxTokens, temperature);
    } catch (err) {
      console.error('Gemini failed:', err.message);
      if (!PROVIDER) throw err;
    }
  }
  return chatJSONOpenAICompatible(systemPrompt, userContent, timeoutMs, maxTokens, temperature);
}

async function askCloud(cv, requests, memory) {
  return chatJSON(withMemory(EDIT_PROMPT, memory), `<cv>\n${JSON.stringify(cv)}\n</cv>\n\n<requests>\n${requests.join('\n')}\n</requests>`);
}

const TAILOR_REWRITE_PROMPT = `You rewrite a candidate's CV to align it closely with one specific job description. You receive the CV as JSON and the job posting. Reply with ONLY a JSON object:
{"cv": {"summary": "...", "skills": [{"group": "...", "items": ["..."]}], "experience": [{"role": "...", "company": "...", "period": "...", "location": "...", "bullets": ["..."]}], "projects": [...]}, "changes": [<short plain-English descriptions of what you changed, 3-8 items>]}
Only include the top-level fields you're actually rewriting; include every job in "experience" (all of them, not just the ones you changed) if you touch any of them, same for "skills".

Where the facts come from, and this ranking settles every conflict:
1. The CV you are given is the only record of what this candidate has done. Every claim you write must be supported by something in it.
2. The job posting tells you what the employer wants and what words they use for it. It is NEVER evidence about the candidate. A tool named in the posting does not mean the candidate has used it; a responsibility listed there does not mean they have held it.
3. Where the CV gives you no support for something the posting asks for, leave it out. A shorter, true CV beats a fuller, invented one — and an interview exposes the difference.

Work this out before you write, and keep it to yourself (return only the JSON):
- what the role is really for, and the handful of requirements that matter most;
- for each of those, what in this CV genuinely speaks to it;
- which are fully supported, which only partly, and which not at all.
Then rewrite so the supported ones lead and are stated in the clearest, most relevant terms the CV's own facts allow.

Rewrite properly — reordering the candidate's own words is not tailoring. Say what they actually did, in sharper and more relevant language, using the posting's vocabulary ONLY where it genuinely names the same thing (the posting's "Postgres" for the CV's "PostgreSQL" is the same thing; the posting's "Kubernetes" for a CV that only mentions Docker is not).

Firm limits, never crossed:
- Never name a technology, tool, framework, language or platform in a bullet unless that CV already names it. Adjacent is not the same: REST APIs are not GraphQL, Docker is not Kubernetes, a database is not a specific one. If the CV doesn't name it, you don't either.
- Never turn one of the posting's requirements into something the candidate did. Reading "optimise SQL queries and build ETL workflows" in the posting, next to "created sales dashboards using SQL Server and SSIS" in the CV, the honest rewrite is "Built sales dashboards in SQL Server and SSIS to support sales reporting and analysis" — NOT "Developed ETL workflows, transformed business data and optimised SQL queries", which quietly awards the candidate the employer's whole wish list.
- Never invent a new employer, job title, degree, school or certification the candidate didn't have — their actual career history (who they worked for, what they studied, what they're certified in) stays exactly as given.
- Never add a specific number, percentage, year or count (a metric, a dollar figure, a headcount) unless the candidate's CV already states that exact number for that point. A posting asking for "measurable impact" is not permission to supply one: describe scope in plain terms instead ("a high-traffic production system", not "50,000 users"), or write a plain responsibility bullet.
- Never build a bullet by stringing the posting's keywords together. Every bullet is one real piece of work, and a reader who knows the job should recognise it as a thing someone actually did.
- Never change what a piece of the candidate's experience actually means in order to make it fit better.
- Never copy a sentence or distinctive phrase straight from the job posting — write this candidate's own voice, specific to their own work.
Keep every technology the bullet already names. Removing one is the opposite of tailoring: "Implemented Kafka streaming pipelines" must not become "Implemented streaming pipelines", and "Architected LangGraph agent systems" must not become "Architected agent systems". Those names are the candidate's evidence and the words the posting is screened for. Rewrite around them — lead with the one this posting asks for — but never drop one.
Return every bullet you were given for every role — all of them, rewritten. Dropping bullets is not tailoring, it is losing the candidate's experience: a role that arrives with five bullets leaves with five. Only ever merge two if they genuinely describe one piece of work.
Bullets start with a strong past-tense verb, stay under 30 words, no first person ("I", "we"). No stock phrases ("team player", "results-driven", "detail-oriented", "proven track record", "passionate about" and the like).
Within each role, order the bullets so that any point naming a programming language (Python, TypeScript, Go, SQL, Java and the like) comes before the points that name none. Ordering only — never invent a language the candidate's work doesn't support, and never drop a point to make room.`;

/**
 * Rewrites the CV's summary/skills/experience to align with a specific job, in the
 * cloud model's own words — not limited to only what the rule-based tailorCV() already
 * picked out verbatim from the profile; it restates the candidate's real work in sharper,
 * more relevant language, using the posting's vocabulary only where that names the same
 * thing (see TAILOR_REWRITE_PROMPT for the firm limits: no technology the CV doesn't
 * name, no requirement turned into an achievement, no invented employer or number). Called
 * on the main "Tailor my CV" button, after the deterministic pass. Never blocks the
 * tailor: returns null on any failure or when no cloud model is configured, and the
 * caller falls back to the rule-based result.
 * @param {{name: string, required?: boolean}[]} [matched] posting requirements the
 * candidate covers (tailorCV's analysis.matched) — feeds the experience-only quality gate
 * below; omit it and that gate just skips its ATS-relevance check.
 */
export async function rewriteTailoredCv(cv, job, matched = []) {
  if (!cloudAiConfigured) return null;
  const jdText = `${job.title || ''}\n${job.description || ''}`;
  // Everything the candidate's own CV says, as the evidence a generated line is held to.
  // A technology that appears nowhere in here was not theirs to claim: the prompt forbids
  // it too, but a prompt is advisory and this (plus the JD-copy/cliché checks) is what
  // actually holds. A field that fails falls back to the rule-based CV's own original.
  const evidence = JSON.stringify(cv);
  const clean = (text) => typeof text === 'string' && text.trim()
    && !copiesJdText(text, jdText) && !hasCliche(text)
    && unsupportedSkills(text, evidence).length === 0;

  // Near-identical, not identical. Exact matching missed the common case entirely: the
  // model hands a bullet back having changed one word, or dropped the figure it was told
  // not to repeat, and a string compare calls that a rewrite while the user reads it as
  // the line they already had. Word overlap catches what they actually see.
  const echoRate = (rewritten) => {
    const before = (cv.experience || []).flatMap(x => x.bullets || []);
    const after = (rewritten.experience || []).flatMap(x => x.bullets || []);
    if (!after.length || !before.length) return 0;
    return after.filter(b => before.some(o => overlap(b, o) >= NEAR_IDENTICAL)).length / after.length;
  };

  // The whole rewrite is on a clock: the Next.js tailor route is capped at 60s
  // (maxDuration), so a later attempt only runs if there is time for it to return.
  const deadline = Date.now() + TAILOR_BUDGET_MS;
  const remaining = () => deadline - Date.now();

  const attempt = async (extra) => {
    const user = `<cv>\n${JSON.stringify(cv)}\n</cv>\n\n<job_posting>\nTitle: ${job.title || ''}\nCompany: ${job.company || ''}\n${job.description || ''}\n</job_posting>${extra ? `\n\n${extra}` : ''}`;
    const out = await chatJSON(TAILOR_REWRITE_PROMPT, user,
      Math.max(5_000, Math.min(ATTEMPT_TIMEOUT_MS, remaining())), 8000, TAILOR_TEMPERATURE)
      .catch((err) => { console.error('Tailor attempt failed:', err.message); return null; });
    if (!out || !out.cv || typeof out.cv !== 'object' || !Object.keys(out.cv).length) return null;
    const fixed = { ...out.cv };
    if ('summary' in fixed && !clean(fixed.summary)) delete fixed.summary;
    if (Array.isArray(fixed.skills)) {
      fixed.skills = fixed.skills
        .map(g => ({ group: g.group, items: Array.isArray(g.items) ? g.items.filter(i => clean(typeof i === 'string' ? i : i && i.name)) : [] }))
        .filter(g => g.group && g.items.length);
    }
    if (Array.isArray(fixed.experience)) {
      fixed.experience = fixed.experience.map((job2, i) => {
        const bullets = Array.isArray(job2.bullets) ? job2.bullets.filter(clean) : [];
        const original = cv.experience[i];
        if (!original) return { ...job2, bullets: bullets.length ? bullets : job2.bullets };
        return { ...job2, bullets: repairRole(original.bullets, bullets) };
      });
    }
    if (Array.isArray(fixed.projects)) {
      fixed.projects = fixed.projects.map((p, i) => {
        const bullets = Array.isArray(p.bullets) ? p.bullets.filter(clean) : [];
        const original = cv.projects && cv.projects[i];
        return { ...p, bullets: bullets.length ? bullets : (original ? original.bullets : p.bullets) };
      });
    }
    return { cv: normalizeCV({ ...cv, ...fixed }), changes: Array.isArray(out.changes) ? out.changes.map(String) : [] };
  };
  try {
    // Two independent ways a draft fails, each with its own history here. It can come back
    // not actually rewritten — measured at anything up to 89% of bullets handed straight
    // back — and it can come back rewritten but weak: no action verb, stock phrasing,
    // overlong, or a most-recent role whose top bullets answer none of the posting's
    // requirements (checkExperienceQuality, which deliberately never counts a missing
    // number as a fault, so the gate can't pressure the model into inventing one).
    //
    // Both are counted against the same draw and both feed the same corrective retry, so a
    // draft is only accepted when it is genuinely rewritten AND reads well. Whichever draw
    // scores best is kept, so a retry can never make the result worse.
    let best = null, bestScore = Infinity, bestNudge = '';
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      if (i && remaining() < MIN_RETRY_MS) break;
      const draw = await attempt(i ? bestNudge : null);
      if (!draw) continue;

      const quality = checkExperienceQuality(draw.cv.experience, matched);
      const echoed = echoRate(draw.cv) > MAX_ECHO;
      const score = quality.issues.length + (echoed ? 1 : 0);
      if (score < bestScore) {
        best = draw;
        bestScore = score;
        bestNudge = [
          echoed ? ECHO_RETRY_NUDGE : '',
          quality.issues.length ? `Your last draft of the experience bullets had specific problems — fix these in this rewrite:\n${quality.issues.join('\n')}` : ''
        ].filter(Boolean).join('\n\n');
      }
      if (quality.ok && !echoed) break;
    }
    return best;
  } catch (err) {
    console.error('Tailor rewrite failed:', err.message);
    return null;
  }
}

// Tailoring should give the same CV for the same inputs, so it runs well below the
// default of 1. Measured across repeated runs, the default was the main source of the
// swing between a properly rewritten experience section and one handed straight back.
const TAILOR_TEMPERATURE = Number(process.env.TAILOR_TEMPERATURE || 0.3);

// Above this share of bullets returned unchanged, the rewrite is treated as a non-answer
// and re-rolled. Not zero: a bullet that is already the sharpest true statement of that
// work for this posting should come back as it was, and some roles have only one or two.
const MAX_ECHO = Number(process.env.MAX_ECHO || 0.6);

// The whole rewrite, both attempts included, has to fit inside the Next.js tailor route's
// 60s maxDuration with room for the response to be rendered after it.
const TAILOR_BUDGET_MS = Number(process.env.TAILOR_BUDGET_MS || 50_000);
// No single attempt may eat the whole budget and leave nothing for a second.
const ATTEMPT_TIMEOUT_MS = 28_000;
// Below this there isn't time for a second attempt to return, so the first result stands.
const MIN_RETRY_MS = 12_000;
// Draws per tailor. Measured: one draw in six was still unusable after two.
// Two bullets sharing this much of their wording are the same line to a reader, whatever
// a string compare says.
const NEAR_IDENTICAL = 0.85;

const MAX_ATTEMPTS = Number(process.env.TAILOR_MAX_ATTEMPTS || 3);

// Appended only on the retry, naming what went wrong with the first attempt.
const ECHO_RETRY_NUDGE = `Your previous attempt handed most of the bullets back unchanged. That is not a tailored CV. Rewrite every bullet: lead with the part of it this posting cares about, name the tool or method the CV already names, say what the work produced, and drop the part irrelevant to this role. Keep every bullet — rewritten, not removed — and stay inside the firm limits.`;

/** A bullet reduced to its words, for comparing two versions of the same CV. */
const bulletKey = (b) => String(b || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const wordSet = (s) => new Set(bulletKey(s).split(' ').filter(Boolean));

/** How much two bullets overlap in words, 0..1 — used to tell which one is a rewrite of which. */
function overlap(a, b) {
  const A = wordSet(a), B = wordSet(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

/**
 * One role's bullets, repaired rather than accepted or rejected wholesale.
 *
 * The first version of this check threw away a role's entire rewrite the moment one bullet
 * lost a technology, which on a measured run reverted three of four roles and left the
 * experience section reading exactly as before — the complaint it was meant to fix. The
 * loss is per bullet, so the repair is too: each rewritten bullet is paired with the
 * original it came from, and only a bullet that actually dropped one of its own tools is
 * swapped back. A good rewrite beside a bad one now survives.
 *
 * Every original is accounted for, so a role never ends up shorter than it started, and no
 * technology the candidate had can go missing.
 */
function repairRole(originals, rewritten) {
  if (!originals || !originals.length) return rewritten;
  if (!rewritten || !rewritten.length) return originals;

  const takenOriginal = new Set();
  const out = [];
  for (const line of rewritten) {
    // The original this line is a rewrite of: the closest one not already claimed.
    let best = -1, bestScore = 0;
    originals.forEach((o, i) => {
      if (takenOriginal.has(i)) return;
      const s = overlap(line, o);
      if (s > bestScore) { bestScore = s; best = i; }
    });
    // Below this the line isn't a rewrite of anything — it's new material. It has already
    // passed the grounding and JD-copy checks, so it stands on its own.
    if (best < 0 || bestScore < 0.25) { out.push(line); continue; }
    takenOriginal.add(best);
    const origin = originals[best];
    const lost = skillsNamed(origin).filter(s => !skillsNamed(line).includes(s));
    out.push(lost.length ? origin : line);
  }
  // Anything the model quietly dropped comes back, in its original order.
  originals.forEach((o, i) => { if (!takenOriginal.has(i) && !out.includes(o)) out.push(o); });
  return out;
}

const ASK_PROMPT = `You answer questions about a CV, honestly and specifically, using only what's in the CV JSON you're given (and the job posting, if one is given). Reply with ONLY a JSON object: {"answers": {"<question, exactly as asked>": "<a short, specific, plain-English answer, 1-3 sentences>"}}. One entry per question. Never invent facts not in the CV; if something truly can't be answered from the CV, say so plainly in the answer rather than guessing.`;

/** A short, specific answer for each question, grounded only in the CV (and job, if given). */
export async function answerQuestions(cv, job, questions, memory = '') {
  const user = `<cv>\n${JSON.stringify(cv)}\n</cv>\n\n${job && (job.title || job.description) ? `<job_posting>\nTitle: ${job.title || ''}\n${job.description || ''}\n</job_posting>\n\n` : ''}<questions>\n${questions.join('\n')}\n</questions>`;
  const out = await chatJSON(withMemory(ASK_PROMPT, memory), user, 30_000, 2000);
  return out && typeof out.answers === 'object' && out.answers ? out.answers : {};
}

const STRIP_NUMBERS_PROMPT = `You rewrite resume bullets to remove specific numbers. You get a JSON array of strings. For each one, rewrite it to remove any specific number, percentage, count or quantity (e.g. "15,000+ documents a month" -> "a high volume of documents", "40% off response latency" -> "lower response latency") while keeping the actual action and method/tool named — never change what was done or how, only drop the figure. If a bullet has no number, return it completely unchanged. Reply with ONLY a JSON object: {"bullets": [<rewritten strings, same order, same count as given>]}.`;

/**
 * Rewrites bullets whose number a cheap regex pass couldn't safely strip out (the number
 * sits mid-sentence as a direct object — "processed 15,000+ records" — not in a clean
 * trailing clause a regex can lift off). One batched call for everything still left, so
 * this stays a single extra request per tailor, not one per bullet. Falls back to the
 * input unchanged (number and all) on any failure — never throws, never blocks the tailor.
 */
export async function stripBulletNumbers(bullets) {
  if (!cloudAiConfigured || !bullets.length) return bullets;
  try {
    const out = await chatJSON(STRIP_NUMBERS_PROMPT, JSON.stringify(bullets), 20_000, 2000);
    const stripped = Array.isArray(out && out.bullets) ? out.bullets.map(String) : null;
    if (!stripped || stripped.length !== bullets.length) return bullets;
    return stripped;
  } catch (err) {
    console.error('Number-stripping pass failed:', err.message);
    return bullets;
  }
}

// Appended to the request on the one automatic retry below, when the model's first
// attempt couldn't be trusted (validateWholeCvEdit rejected it) — spells out the likely
// cause so the retry has a real chance to fix it, instead of the user having to retype
// the exact same request and watch it fail the exact same way a second time.
const SELF_CORRECTION_NOTE = '(Your last attempt at this could not be used — it likely added something not already in the CV or clearly asked for here: an employer, school or certification that wasn\'t named, a number that wasn\'t already present or requested, or a phrase lifted straight from the job posting. Try again: only use facts already in the CV or stated in the request above, write it in your own original wording, and don\'t add a number unless one was already there or explicitly asked for.)';

/**
 * The cloud model's pass over requests the rules didn't understand. Changes `result`
 * in place like applyWithLocalModel, but — unlike it — returns whether the call
 * actually reached the provider and got a usable reply (true), or failed outright
 * (false, e.g. a rate limit), so the caller can decide whether another backend
 * (the local model) is worth trying instead of treating "we tried" as "it worked".
 * @param {boolean} [unfiltered] skips the honesty check when true — an explicit,
 * user-visible opt-in for an unverified draft, never the default (the model can
 * otherwise fabricate facts: invented technologies, numbers, even employers).
 * @param {string} [jdText] the job posting's text, so the honesty check can also catch
 * the model copying it verbatim.
 * @param {string} [memory] this request's corrections memory (corrections.js), appended
 * to the system prompt so an edit the owner has already corrected once comes back right.
 */
export async function applyWithCloudModel(result, unfiltered = false, jdText = '', memory = '') {
  if (!result.pending.length) return true;
  const requestText = result.pending.join('\n');
  const originalMessage = result.unclear.find(u => u.startsWith(requestText));
  const fallback = (reason) => originalMessage || `${requestText} — ${reason}`;
  let out;
  try {
    out = await askCloud(result.cv, result.pending, memory);
  } catch (err) {
    console.error('Cloud model failed:', err.message);
    // A free-tier rate limit is common under quick back-to-back requests — say so
    // plainly instead of leaving whatever message was already there (which may not even
    // mention AI, e.g. a request the rules already had a specific, now-stale reply for)
    if (/\b429\b|rate.?limit/i.test(err.message)) {
      result.pending = [`${requestText} — the AI is at its free-tier rate limit right now; wait a few seconds and try again.`];
      result.unclear = result.pending;
    }
    return false;
  }
  let touchedCv = out && out.cv && typeof out.cv === 'object';
  let merged = touchedCv ? { ...result.cv, ...out.cv } : null;
  let ok = touchedCv && validateWholeCvEdit(result.cv, merged, requestText, unfiltered, jdText);
  let retried = false;
  // One automatic self-correcting retry when the first attempt couldn't be trusted: tell
  // the model specifically what's likely wrong and let it try again within this same
  // request, rather than immediately handing the user a dead end they'd have to retype.
  if (touchedCv && !ok) {
    retried = true;
    try {
      const retry = await askCloud(result.cv, [...result.pending, SELF_CORRECTION_NOTE], memory);
      const retryTouched = retry && retry.cv && typeof retry.cv === 'object';
      if (retryTouched) {
        const retryMerged = { ...result.cv, ...retry.cv };
        if (validateWholeCvEdit(result.cv, retryMerged, requestText, unfiltered, jdText)) {
          out = retry;
          merged = retryMerged;
          ok = true;
        }
      }
    } catch (err) {
      console.error('Self-correcting retry failed:', err.message);
    }
  }
  const notDone = (Array.isArray(out && out.notDone) ? out.notDone.map(String) : [])
    .filter(n => result.pending.some(p => n.startsWith(p) || p.toLowerCase().includes(n.split(' — ')[0].toLowerCase().slice(0, 20))));
  if (!touchedCv) {
    result.pending = notDone.length ? notDone : [fallback('nothing to change.')];
  } else if (ok) {
    const normalized = normalizeCV(merged);
    if (JSON.stringify(normalized) === JSON.stringify(normalizeCV(result.cv))) {
      result.pending = [fallback("I couldn't make that change.")];
    } else {
      const skillName = (i) => (typeof i === 'string' ? i : i.name);
      const before = new Set(result.cv.skills.flatMap(g => g.items.map(i => skillName(i).toLowerCase())));
      const added = normalized.skills.flatMap(g => g.items.map(i => i.name)).filter(n => !before.has(n.toLowerCase()));
      result.cv = normalized;
      result.done.push(...(Array.isArray(out.changes) ? out.changes.map(String) : []));
      result.skills.push(...added);
      result.pending = notDone;
    }
  } else {
    result.pending = [fallback(`that change couldn't be made safely${retried ? ', even after trying again,' : ''} (it would have added something not in your request) — try rephrasing it with more specific detail.`)];
  }
  result.unclear = result.pending;
  // The call itself succeeded (a reply came back and was handled) even when the
  // model declined the request or the honesty check rejected its answer — that's
  // a legitimate outcome, not a backend failure, so it does not fall through to
  // the local model too.
  return true;
}
