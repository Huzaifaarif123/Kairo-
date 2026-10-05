// "Tell it what to add or change": requests the rules don't understand are turned into
// the box's own commands by a local model (Ollama, on this computer; nothing leaves it).
// Every command is checked against what was actually asked before it touches the CV:
// numbers, contact details, certifications and employers must come from the request,
// and nothing is removed that the request didn't name.
import { applyInstructions } from './tailor.js';

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

const SYSTEM = `You turn a CV owner's request into edit commands for their CV. Reply with JSON {"commands": [...]}.
Use ONLY these command forms, exactly as written:
- Under <company> add: <achievement sentence>
- Add skills: <skill>, <skill>
- Remove <skill name>
- Remove the point about <words from that point>
- Change headline to <new headline>
- Change summary to: <new summary>
- Add to summary: <one sentence>
- Replace "<exact words from the CV>" with "<new words>"
- Change my title at <company> to <new title>
- Set phone to <number> / Set email to <email> / Set location to <place>
- Add certification: <name>
- Make my summary shorter / Make it one page / Organize my CV
Rules:
- Only do what the request asks. Never invent numbers, employers, certifications or contact details.
- Use company names and exact words exactly as they appear in the CV below.
- If the request can't be done with these commands, reply {"commands": []}.
Examples:
Request: "my summary should focus on AI work" -> {"commands": ["Change summary to: <the current summary rewritten to lead with the AI work it already mentions>"]}
Request: "I don't use PHP anymore" -> {"commands": ["Remove PHP"]}
Request: "say I mentored two juniors at Brightloop" -> {"commands": ["Under Brightloop add: Mentored two junior developers"]}`;

// What the model needs to know about the CV (kept short for a small model)
function cvContext(cv) {
  const lines = [
    `Headline: ${cv.headline}`,
    `Summary: ${cv.summary}`,
    `Jobs: ${cv.experience.map(x => `${x.role} at ${x.company}`).join('; ')}`,
    `Skills: ${cv.skills.flatMap(g => g.items.map(i => (typeof i === 'string' ? i : i.name))).join(', ')}`,
    'Points:',
    ...cv.experience.flatMap(x => x.bullets.map(b => `- (${x.company}) ${b}`)).slice(0, 25)
  ];
  return lines.join('\n').slice(0, 6000);
}

async function askModel(cv, request) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    // the first request loads the model into memory, which can take a while
    signal: AbortSignal.timeout(240_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      keep_alive: '30m',
      options: { temperature: 0, num_ctx: 4096 },
      format: { type: 'object', properties: { commands: { type: 'array', items: { type: 'string' } } }, required: ['commands'] },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `CV:\n${cvContext(cv)}\n\nRequest: "${request}"` }
      ]
    })
  });
  const data = await res.json();
  const parsed = JSON.parse(data.message && data.message.content ? data.message.content : '{}');
  return Array.isArray(parsed.commands) ? parsed.commands.map(String).map(c => c.trim()).filter(Boolean).slice(0, 6) : [];
}

const digits = (s) => (String(s).match(/\d[\d,.]*/g) || []).map(n => n.replace(/[,.]$/, '').replace(/,/g, ''));
const contentWords = (s) => (String(s).toLowerCase().match(/[a-z][a-z+#.-]{3,}/g) || []);

/** Whether a command does only what the request asked (see the top of this file). */
export function commandFitsRequest(cmd, request, cv) {
  const req = String(request).toLowerCase();
  const inReq = (x) => req.includes(String(x).toLowerCase().trim().replace(/[.]$/, ''));
  const cvText = JSON.stringify(cv).toLowerCase();
  const numbersOk = (text, also = '') => digits(text).every(n => digits(req).includes(n) || digits(also).includes(n));
  let m;
  if ((m = cmd.match(/^Set (?:phone|email|location|linkedin|github) to (.+)$/i))) return inReq(m[1]);
  if ((m = cmd.match(/^Add certification:\s*(.+)$/i))) return inReq(m[1]);
  if ((m = cmd.match(/^Add skills:\s*(.+)$/i))) return m[1].split(/\s*,\s*/).every(inReq);
  // only when the request asks to take something out
  if ((m = cmd.match(/^Remove (?:the point about\s+)?(.+)$/i))) return /\b(remove|delete|drop|get rid|take out|take off|don'?t|do not|no longer|anymore|without|stop|not use)\b/.test(req) && (inReq(m[1]) || contentWords(m[1]).some(w => req.includes(w)));
  if ((m = cmd.match(/^Under (.+?) add:\s*(.+)$/i))) {
    const words = contentWords(m[2]);
    const shared = words.filter(w => req.includes(w)).length;
    return numbersOk(m[2]) && cvText.includes(m[1].toLowerCase()) && words.length > 0 && shared / words.length >= 0.4;
  }
  if ((m = cmd.match(/^Replace "(.+)" with "(.+)"$/i))) return numbersOk(m[2], m[1]);
  if ((m = cmd.match(/^Change headline to (.+)$/i))) return /\b(headline|title|senior|lead|principal|staff|role|position)\b/.test(req) || inReq(m[1]);
  // a rewritten summary uses what's already on the CV (or in the request): no new claims
  if ((m = cmd.match(/^(?:Change summary to|Add to summary):?\s*(.+)$/i))) {
    const words = contentWords(m[1]).filter(w => w.length >= 5);
    const known = words.filter(w => cvText.includes(w) || req.includes(w)).length;
    return /\b(summary|profile|about me|intro)\b/.test(req) && numbersOk(m[1], cv.summary) && m[1].length >= 40 && (!words.length || known / words.length >= 0.85);
  }
  if ((m = cmd.match(/^Change my title at (.+?) to (.+)$/i))) return inReq(m[2]);
  return numbersOk(cmd) && /^(Make my summary shorter|Make it one page|Organize my CV)$/i.test(cmd);
}

/**
 * The local model's pass over requests the rules didn't understand. Changes `result`
 * (the applyInstructions result) in place: the CV, what was done and what's still unclear.
 */
export async function applyWithLocalModel(result) {
  const leftover = [];
  for (const request of result.pending) {
    let commands = [];
    try {
      commands = await askModel(result.cv, request);
    } catch (err) {
      console.error('Local model failed:', err.message);
      leftover.push(request);
      continue;
    }
    let changed = false;
    for (const c of commands.filter(x => commandFitsRequest(x, request, result.cv))) {
      const applied = applyInstructions(result.cv, c, { whole: true });
      if (!applied.done.length) continue;
      result.cv = applied.cv;
      result.done.push(...applied.done);
      result.skills.push(...applied.skills);
      changed = true;
    }
    if (!changed) leftover.push(request);
  }
  result.unclear = result.unclear.filter(u => leftover.some(l => u === l || u.startsWith(`${l} (`)));
  result.pending = leftover;
  return result;
}
