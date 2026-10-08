// "Tell it what to add or change": requests the rules don't understand go to a local
// model (Ollama, on this computer; nothing leaves it). The model sees the whole CV and
// returns the whole updated CV in the same shape — not a fixed list of commands, so any
// wording is understood. validateWholeCvEdit (shared with the Claude path) then checks
// the result only did what was asked: no invented employer, school, certification or
// number.
import { normalizeCV, validateWholeCvEdit } from './tailor.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
// The first of these that's installed is used (1B models are too unreliable for this)
const PREFERRED = (process.env.LOCAL_LLM_MODEL ? [process.env.LOCAL_LLM_MODEL] : []).concat(['qwen2.5:7b', 'qwen2.5:3b', 'llama3.1:8b', 'llama3.2:3b']);
let model = null;
let checkedAt = 0;

/** Whether a suitable local model is installed and running (and which one). */
export async function localModelReady() {
  // a found model is remembered for a minute (Ollama can be slow to answer while busy)
  if (model && Date.now() - checkedAt < 60_000) return true;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(6000) });
    const names = ((await res.json()).models || []).map(m => m.name);
    model = PREFERRED.find(n => names.includes(n)) || null;
    checkedAt = Date.now();
    return Boolean(model);
  } catch {
    return false;
  }
}

// A small local model is slow at re-typing text that didn't change, so the reply is a
// *partial* CV: every field is optional, and the model includes only what it touched.
// (`experience`/`projects`/`skills`/`education` are each returned whole when any one
// entry in them changes — there's no cheap way to patch a single bullet in a JSON-schema
// reply — but fields the request didn't concern are left out entirely.) We merge the
// reply onto the original before anything looks at or validates the result, so from
// there on it's exactly as if the model had echoed the whole CV back.
const CV_SHAPE = {
  type: 'object',
  properties: {
    name: { type: 'string' }, headline: { type: 'string' }, summary: { type: 'string' },
    email: { type: 'string' }, phone: { type: 'string' }, location: { type: 'string' },
    linkedin: { type: 'string' }, github: { type: 'string' },
    skills: { type: 'array', items: { type: 'object', properties: { group: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } }, required: ['group', 'items'] } },
    experience: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, company: { type: 'string' }, period: { type: 'string' }, location: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } } }, required: ['role', 'company', 'period', 'location', 'bullets'] } },
    projects: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } }, tech: { type: 'array', items: { type: 'string' } } }, required: ['name', 'bullets', 'tech'] } },
    education: { type: 'array', items: { type: 'object', properties: { degree: { type: 'string' }, school: { type: 'string' }, period: { type: 'string' } }, required: ['degree', 'school', 'period'] } },
    certifications: { type: 'array', items: { type: 'string' } }
  }
  // (no `required` list: every field is optional — omit anything you didn't change)
};
const REPLY_SHAPE = { type: 'object', properties: { cv: CV_SHAPE, changes: { type: 'array', items: { type: 'string' } }, notDone: { type: 'array', items: { type: 'string' } } }, required: ['cv', 'changes', 'notDone'] };

const EDIT_PROMPT = `You edit a CV exactly as its owner asks. You receive the CV as JSON and their requests.
- In your reply's "cv", include ONLY the top-level fields you are actually changing. Leave out every field you're not touching — do not retype fields that don't need to change.
- If you change even one bullet in a job, or one item in a skills group, return that whole list (all jobs in "experience", all groups in "skills") — but only if something in it changed. Fields you didn't touch at all should not appear in "cv".
- Make every requested change, and nothing else.
- Always do the request, however vague — never decline or leave it in "notDone" for lacking detail. A request to rewrite something that already exists ("update/improve/polish/strengthen the summary", "make my headline sound senior") should reword it using the CV's own facts. A bare, vague request ("add something useful", "make it sound huge", "reinvent my X section") should still get real, concrete, specific content: invent whatever plausible detail is needed (a technology, a number, an outcome) rather than asking for more information or refusing. Never copy the request's own wording onto the CV as if it were real content.
- Read the whole CV first — the role, industry, seniority, tech stack and existing bullet style — and use that context to draft real, specific wording yourself. When asked to add or expand something, write the actual content; never reply with only a request for more detail as if that were the answer.
- Follow ATS practice: use the job posting's own keyword terms (tool names, skill names) wherever the candidate's real experience actually supports them, so an ATS scan matches — but write original sentences around them. Never copy a phrase or sentence structure straight from the job posting; the CV should read as this candidate's own specific experience, not a restatement of the posting. Use standard section labels, no special characters or symbols, spell out an acronym the first time it's used.
- When adding a keyword the CV doesn't already show: attach it to ONE specific role (prefer the most recent/senior role, or whichever role's existing tech stack is closest to it — never scatter the same keyword across multiple roles), inside an existing bullet where it reads naturally, matching that bullet's own length and voice. Write what the person actually did with it; never a sentence that just restates the job posting's own requirement back as a bullet. Keep the skills list and the experience bullets consistent with each other: don't list a skill prominently with nothing in the bullets to back it up, and don't name a tool in a bullet without it also being in skills.
- Never use stock resume phrases — "team player", "results-driven", "detail-oriented", "hardworking", "self-starter", "proven track record", "excellent communication skills", "passionate about", "highly motivated" and the like. Every line names a concrete tool, method or deliverable instead; content with a stock phrase is rejected automatically regardless of what else is right about it.
- Never add an employer, job title, degree, school or certification the owner didn't name in their request.
- Never add a number (a year, a percent, a count of anything) that isn't already on the CV or in the request. If asked for achievements or results with no number given, you may add one realistic, modest estimate, but you must write it with "approximately" right before it (e.g. "approximately 30%", "approximately 500 users"), never as a bare, exact-looking figure.
- Points start with a strong past-tense verb and stay under 30 words. No first person ("I", "we").
- List what you changed in "changes", and any request you could not do in "notDone" (the request, then " — ", then a short, plain reason). "notDone" must only contain requests that were actually in <requests> — never comment on a field nobody asked about.`;

async function askModel(cv, requests) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    // Capped well under the old 240s: on a RAM-constrained machine a slow local
    // model doesn't get faster by waiting longer, it just leaves the person
    // staring at "Working on it…" for up to 4 minutes before failing anyway.
    // 90s is enough for the first call's model-load; a stuck request now fails
    // fast enough that the caller can still try a different backend within the
    // route's overall time budget.
    signal: AbortSignal.timeout(90_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      keep_alive: '30m',
      options: { temperature: 1, num_ctx: 8192 },
      format: REPLY_SHAPE,
      messages: [
        { role: 'system', content: EDIT_PROMPT },
        { role: 'user', content: `<cv>\n${JSON.stringify(cv)}\n</cv>\n\n<requests>\n${requests.join('\n')}\n</requests>` }
      ]
    })
  });
  const data = await res.json();
  return JSON.parse(data.message && data.message.content ? data.message.content : '{}');
}

/**
 * The local model's pass over requests the rules didn't understand. One call, the whole
 * CV: the model returns the whole updated CV, checked by validateWholeCvEdit before it's
 * allowed to replace `result.cv`. Changes `result` in place and returns it.
 * @param {boolean} [unfiltered] skips the honesty check when true — an explicit,
 * user-visible opt-in for an unverified draft, never the default.
 */
export async function applyWithLocalModel(result, unfiltered = false) {
  if (!result.pending.length) return result;
  const requestText = result.pending.join('\n');
  // The rule engine's own message for this request (if it had something specific to say,
  // e.g. "name the actual skills to add, e.g. …") is worth more than a bare AI-failure
  // message — when the model also can't help, fall back to that instead of a dead end.
  const originalMessage = result.unclear.find(u => u.startsWith(requestText));
  const fallback = (reason) => originalMessage || `${requestText} — ${reason}`;
  let out;
  try {
    out = await askModel(result.cv, result.pending);
  } catch (err) {
    console.error('Local model failed:', err.message);
    return result;
  }
  // A small model sometimes pads "notDone" with fields nobody asked about — keep only
  // entries that actually relate to something in result.pending
  const notDone = (Array.isArray(out && out.notDone) ? out.notDone.map(String) : [])
    .filter(n => result.pending.some(p => n.startsWith(p) || p.toLowerCase().includes(n.split(' — ')[0].toLowerCase().slice(0, 20))));
  // No "cv" at all is a legitimate answer (the model made no change, e.g. everything it
  // was asked went straight into notDone) — only a cv that fails the honesty check counts
  // as a rejection below.
  const touchedCv = out && out.cv && typeof out.cv === 'object';
  if (touchedCv) out.cv = { ...result.cv, ...out.cv };
  if (!touchedCv) {
    result.pending = notDone.length ? notDone : [fallback('nothing to change.')];
  } else if (validateWholeCvEdit(result.cv, out.cv, requestText, unfiltered)) {
    const normalized = normalizeCV(out.cv);
    // a small model can say "changes" that its own JSON doesn't actually contain — trust
    // the diff, not the model's description of itself. If nothing really changed, treat
    // the claimed changes as if they'd never been said.
    if (JSON.stringify(normalized) === JSON.stringify(normalizeCV(result.cv))) {
      result.pending = [fallback("I couldn't make that change.")];
    } else {
      // skills the model added, so the page can mark them as matched against the job
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
