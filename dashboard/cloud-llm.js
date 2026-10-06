// "Tell it what to add or change": requests the rules don't understand go to a free-tier
// cloud model (Groq or OpenRouter — whichever has a key set) when one is configured, as a
// faster and more reliable alternative to Anthropic or the local Ollama model. Same idea
// as local-llm.js: the model sees the whole CV and returns the whole updated CV in the
// same shape, checked by the shared validateWholeCvEdit honesty gate before it's trusted.
import { normalizeCV, validateWholeCvEdit } from './tailor.js';

// Either key activates this path; Groq is tried first if both are set. Both APIs are
// OpenAI-compatible, so the same request shape works for either one.
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const PROVIDER = GROQ_KEY
  ? { key: GROQ_KEY, url: 'https://api.groq.com/openai/v1/chat/completions', model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b' }
  : OPENROUTER_KEY
    ? { key: OPENROUTER_KEY, url: 'https://openrouter.ai/api/v1/chat/completions', model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free' }
    : null;

/** Whether a cloud model (Groq or OpenRouter) is configured. */
export const cloudAiConfigured = Boolean(PROVIDER);

const EDIT_PROMPT = `You edit a CV exactly as its owner asks. You receive the CV as JSON and their requests.
Reply with ONLY a JSON object, no other text, shaped exactly like this:
{"cv": { <only the top-level CV fields you changed> }, "changes": [ <short plain-English descriptions of what you changed> ], "notDone": [ <any request you could not do, as "<the request> — <short reason>"> ]}
The CV's fields are: name, headline, summary, email, phone, location, linkedin, github, skills (array of {group, items: [string]}), experience (array of {role, company, period, location, bullets: [string]}), projects (array of {name, bullets: [string], tech: [string]}), education (array of {degree, school, period}), certifications (array of string).
- In "cv", include ONLY the top-level fields you are actually changing. Leave out every field you're not touching.
- If you change even one bullet in a job, or one item in a skills group, return that whole list (all jobs in "experience", all groups in "skills") — but only if something in it changed.
- Make every requested change, and nothing else.
- If a request names nothing concrete to change (no action, skill, result or fact — e.g. "make it better", "improve this", "add something useful", "optimize this"), do not add or rewrite anything for it. Put it in "notDone" with a reason asking what to add. Never copy a request's own wording onto the CV as if it were real content.
- Never add an employer, job title, degree, school or certification the owner didn't name in their request.
- Never add a number (a year, a percent, a count of anything) that isn't already on the CV or in the request. If asked for achievements or results with no number given, you may add one realistic, modest estimate, but you must write it with "~" right before it (e.g. "~30%", "~500 users").
- Points start with a strong past-tense verb and stay under 30 words. No first person ("I", "we").
- "notDone" must only contain requests that were actually asked — never comment on a field nobody asked about.`;

/** A single JSON-mode chat call to whichever cloud provider is configured. */
export async function chatJSON(systemPrompt, userContent, timeoutMs = 60_000, maxTokens = 8000) {
  const res = await fetch(PROVIDER.url, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${PROVIDER.key}` },
    body: JSON.stringify({
      model: PROVIDER.model,
      temperature: 0,
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

async function askCloud(cv, requests) {
  return chatJSON(EDIT_PROMPT, `<cv>\n${JSON.stringify(cv)}\n</cv>\n\n<requests>\n${requests.join('\n')}\n</requests>`);
}

/**
 * The cloud model's pass over requests the rules didn't understand. Same contract as
 * applyWithLocalModel: changes `result` in place and returns it, never throws.
 */
export async function applyWithCloudModel(result) {
  if (!result.pending.length) return result;
  const requestText = result.pending.join('\n');
  const originalMessage = result.unclear.find(u => u.startsWith(requestText));
  const fallback = (reason) => originalMessage || `${requestText} — ${reason}`;
  let out;
  try {
    out = await askCloud(result.cv, result.pending);
  } catch (err) {
    console.error('Cloud model failed:', err.message);
    return result;
  }
  const notDone = (Array.isArray(out && out.notDone) ? out.notDone.map(String) : [])
    .filter(n => result.pending.some(p => n.startsWith(p) || p.toLowerCase().includes(n.split(' — ')[0].toLowerCase().slice(0, 20))));
  const touchedCv = out && out.cv && typeof out.cv === 'object';
  if (touchedCv) out.cv = { ...result.cv, ...out.cv };
  if (!touchedCv) {
    result.pending = notDone.length ? notDone : [fallback('nothing to change.')];
  } else if (validateWholeCvEdit(result.cv, out.cv, requestText)) {
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
  return result;
}
