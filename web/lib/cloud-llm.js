// "Tell it what to add or change": requests the rules don't understand go to a free-tier
// cloud model when one is configured, as a faster and more reliable alternative to
// Anthropic or the local Ollama model. Same idea as local-llm.js: the model sees the
// whole CV and returns the whole updated CV in the same shape, checked by the shared
// validateWholeCvEdit honesty gate before it's trusted.
//
// Gemini is tried first when configured (a notably more generous free-tier rate limit
// than Groq's — see the comment on GEMINI_MODEL), then Groq/OpenRouter as the next tier,
// mirroring the Claude -> cloud -> local-Ollama fallback one level up in the route.
import { normalizeCV, validateWholeCvEdit, copiesJdText, hasCliche } from './tailor.js';

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
- "notDone" must only contain requests that were actually asked — never comment on a field nobody asked about.`;

async function chatJSONGemini(systemPrompt, userContent, timeoutMs, maxTokens) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userContent }] }],
      generationConfig: { temperature: 1, responseMimeType: 'application/json', maxOutputTokens: maxTokens }
    })
  });
  if (!res.ok) throw new Error(`Gemini error: ${res.status} ${await res.text().catch(() => '')}`);
  const data = await res.json();
  const candidate = data.candidates && data.candidates[0];
  if (candidate && candidate.finishReason === 'MAX_TOKENS') throw new Error('Gemini reply was cut off (too long for the token budget)');
  const part = candidate && candidate.content && candidate.content.parts && candidate.content.parts.find(p => p.text);
  return JSON.parse((part && part.text) || '{}');
}

async function chatJSONOpenAICompatible(systemPrompt, userContent, timeoutMs, maxTokens) {
  const res = await fetch(PROVIDER.url, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROVIDER.key}` },
    body: JSON.stringify({
      model: PROVIDER.model,
      temperature: 1,
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
 */
export async function chatJSON(systemPrompt, userContent, timeoutMs = 60_000, maxTokens = 8000) {
  if (GEMINI_KEY) {
    try {
      return await chatJSONGemini(systemPrompt, userContent, timeoutMs, maxTokens);
    } catch (err) {
      console.error('Gemini failed:', err.message);
      if (!PROVIDER) throw err;
    }
  }
  return chatJSONOpenAICompatible(systemPrompt, userContent, timeoutMs, maxTokens);
}

async function askCloud(cv, requests) {
  return chatJSON(EDIT_PROMPT, `<cv>\n${JSON.stringify(cv)}\n</cv>\n\n<requests>\n${requests.join('\n')}\n</requests>`);
}

const TAILOR_REWRITE_PROMPT = `You rewrite a candidate's CV to align it closely with one specific job description. You receive the CV as JSON and the job posting. Reply with ONLY a JSON object:
{"cv": {"summary": "...", "skills": [{"group": "...", "items": ["..."]}], "experience": [{"role": "...", "company": "...", "period": "...", "location": "...", "bullets": ["..."]}], "projects": [...]}, "changes": [<short plain-English descriptions of what you changed, 3-8 items>]}
Only include the top-level fields you're actually rewriting; include every job in "experience" (all of them, not just the ones you changed) if you touch any of them, same for "skills".

Rewrite the summary, skills and experience bullets so they speak directly to what this job description is asking for — don't just lightly reorder the candidate's own words. You may describe the candidate's real work using the job posting's own vocabulary and plausibly extend it where that's a reasonable reading of what they actually did (e.g. if they list "built REST APIs in Node.js" and the posting wants GraphQL experience, you may write that they built GraphQL APIs if that reads as a natural extension of their real stack, not a fabrication from nothing). Weave in the posting's required skills and tools wherever there's a plausible basis for them in the candidate's actual roles.
Firm limits, never crossed:
- Never invent a new employer, job title, degree, school or certification the candidate didn't have — their actual career history (who they worked for, what they studied, what they're certified in) stays exactly as given.
- Never add a specific number, percentage, year or count (a metric, a dollar figure, a headcount) unless the candidate's CV already states that exact number for that point. Describe scope and impact in plain terms instead ("a high-traffic production system", not "50,000 users").
- Never copy a sentence or distinctive phrase straight from the job posting — write this candidate's own voice, specific to their own work.
Bullets start with a strong past-tense verb, stay under 30 words, no first person ("I", "we"). No stock phrases ("team player", "results-driven", "detail-oriented", "proven track record", "passionate about" and the like).`;

/**
 * Rewrites the CV's summary/skills/experience to align with a specific job, in the
 * cloud model's own words — not limited to only what the rule-based tailorCV() already
 * picked out verbatim from the profile; it can describe the candidate's real work using
 * the job posting's vocabulary and plausibly extend it (see TAILOR_REWRITE_PROMPT for the
 * firm limits: no invented employer/title/degree/school/cert, no invented number). Called
 * on the main "Tailor my CV" button, after the deterministic pass. Never blocks the
 * tailor: returns null on any failure or when no cloud model is configured, and the
 * caller falls back to the rule-based result.
 */
export async function rewriteTailoredCv(cv, job) {
  if (!cloudAiConfigured) return null;
  try {
    const user = `<cv>\n${JSON.stringify(cv)}\n</cv>\n\n<job_posting>\nTitle: ${job.title || ''}\nCompany: ${job.company || ''}\n${job.description || ''}\n</job_posting>`;
    const out = await chatJSON(TAILOR_REWRITE_PROMPT, user, 45_000, 6000);
    if (!out || !out.cv || typeof out.cv !== 'object' || !Object.keys(out.cv).length) return null;
    // The prompt tells the model never to copy the posting's own phrasing or use a stock
    // resume cliché, but a model doesn't always follow that — enforced here per field
    // (not just asked for), same quality gate web/lib/ai-tailor.ts's mergeRewrite applies.
    // A field that fails falls back to the rule-based CV's own original for that field.
    const jdText = `${job.title || ''}\n${job.description || ''}`;
    const clean = (text) => typeof text === 'string' && text.trim() && !copiesJdText(text, jdText) && !hasCliche(text);
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
        return { ...job2, bullets: bullets.length ? bullets : (original ? original.bullets : job2.bullets) };
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
  } catch (err) {
    console.error('Tailor rewrite failed:', err.message);
    return null;
  }
}

const ASK_PROMPT = `You answer questions about a CV, honestly and specifically, using only what's in the CV JSON you're given (and the job posting, if one is given). Reply with ONLY a JSON object: {"answers": {"<question, exactly as asked>": "<a short, specific, plain-English answer, 1-3 sentences>"}}. One entry per question. Never invent facts not in the CV; if something truly can't be answered from the CV, say so plainly in the answer rather than guessing.`;

/** A short, specific answer for each question, grounded only in the CV (and job, if given). */
export async function answerQuestions(cv, job, questions) {
  const user = `<cv>\n${JSON.stringify(cv)}\n</cv>\n\n${job && (job.title || job.description) ? `<job_posting>\nTitle: ${job.title || ''}\n${job.description || ''}\n</job_posting>\n\n` : ''}<questions>\n${questions.join('\n')}\n</questions>`;
  const out = await chatJSON(ASK_PROMPT, user, 30_000, 2000);
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
 */
export async function applyWithCloudModel(result, unfiltered = false, jdText = '') {
  if (!result.pending.length) return true;
  const requestText = result.pending.join('\n');
  const originalMessage = result.unclear.find(u => u.startsWith(requestText));
  const fallback = (reason) => originalMessage || `${requestText} — ${reason}`;
  let out;
  try {
    out = await askCloud(result.cv, result.pending);
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
  const notDone = (Array.isArray(out && out.notDone) ? out.notDone.map(String) : [])
    .filter(n => result.pending.some(p => n.startsWith(p) || p.toLowerCase().includes(n.split(' — ')[0].toLowerCase().slice(0, 20))));
  const touchedCv = out && out.cv && typeof out.cv === 'object';
  if (touchedCv) out.cv = { ...result.cv, ...out.cv };
  if (!touchedCv) {
    result.pending = notDone.length ? notDone : [fallback('nothing to change.')];
  } else if (validateWholeCvEdit(result.cv, out.cv, requestText, unfiltered, jdText)) {
    const normalized = normalizeCV(out.cv);
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
    result.pending = [fallback('that change couldn\'t be made safely (it would have added something not in your request), try rephrasing it.')];
  }
  result.unclear = result.pending;
  // The call itself succeeded (a reply came back and was handled) even when the
  // model declined the request or the honesty check rejected its answer — that's
  // a legitimate outcome, not a backend failure, so it does not fall through to
  // the local model too.
  return true;
}
