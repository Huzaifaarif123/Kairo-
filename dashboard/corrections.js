// Corrections memory: the feedback loop behind "Fix this answer" on an AI reply. When an
// answer is wrong, the owner's own correction is stored here, and the closest few
// corrections are fed back into the system prompt of later requests — so the same
// question, or a reworded one, gets the right answer the next time it's asked.
//
// This is not training. Nothing about the model changes: the model simply sees "you were
// asked this before, here is the right answer" as part of its instructions, and answers
// accordingly. Worth being explicit about, because the public Gemini API that cloud-llm.js
// talks to has no fine-tuning at all (only Vertex AI does), so retrieval like this is the
// only way to make a correction stick.
//
// File-backed and dependency-free like the rest of the dashboard: one JSON file beside the
// profile's own tracker, so corrections follow the profile they were made against and
// never leak between two people sharing an install.
import fs from 'node:fs';
import path from 'node:path';

const FILE_NAME = 'ai_corrections.json';

// Keep the file small enough to read on every AI request without thinking about it.
const MAX_STORED = 200;
// Only the closest few go into a prompt. More is actively worse: a long block of
// half-relevant corrections crowds out the real request and slows the reply down.
const MAX_INJECTED = 3;
// Below this, two requests share only incidental words and the correction would be noise.
const MIN_SIMILARITY = 0.15;
// Corrections are injected as text, so they're bounded here rather than at write time —
// a long stored answer stays intact for display and is clipped only on the way into a prompt.
const MAX_INJECTED_PROMPT_CHARS = 240;
const MAX_INJECTED_ANSWER_CHARS = 600;

// The two request kinds worth keeping apart: a question about the CV ("ask") and an
// instruction that edits it ("edit"). Mixing them would feed Q&A wording into a prompt
// whose only job is to return edited CV JSON.
export const SCOPES = ['ask', 'edit'];

/** Where this profile's corrections live — beside its tracker, so the two move together. */
export function correctionsPath(profile) {
  return path.join(path.dirname(profile.trackerPath), FILE_NAME);
}

// Words too common to say anything about what a request is about; dropped before scoring
// so "what should I add to my summary" matches on "summary", not on "what"/"should"/"my".
const STOPWORDS = new Set([
  'the', 'and', 'but', 'for', 'with', 'about', 'from', 'into', 'that', 'this', 'these', 'those',
  'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'having', 'does', 'did', 'doing',
  'you', 'your', 'yours', 'our', 'its', 'can', 'could', 'would', 'should', 'shall', 'will',
  'what', 'which', 'who', 'whom', 'how', 'why', 'where', 'when', 'please', 'tell', 'show',
  'any', 'all', 'some', 'more', 'most', 'very', 'just', 'also', 'than', 'then', 'there'
]);

// Keeps +, # and . inside a token so "c++", "c#" and "node.js" survive as single words.
function tokenize(text) {
  const out = new Set();
  for (const raw of String(text || '').toLowerCase().split(/[^a-z0-9+#.]+/)) {
    const token = raw.replace(/^\.+|\.+$/g, '');
    if (token.length > 2 && !STOPWORDS.has(token)) out.add(token);
  }
  return out;
}

// Set cosine: shared words over the geometric mean of both sizes. Plain overlap would
// rank any long stored request highly just for being long; this doesn't.
function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / Math.sqrt(a.size * b.size);
}

function isCorrection(entry) {
  return Boolean(entry && typeof entry.prompt === 'string' && entry.prompt.trim()
    && typeof entry.corrected === 'string' && entry.corrected.trim());
}

/**
 * Every stored correction, newest first. A missing file is the normal state on a fresh
 * install, and a corrupt one is treated the same way as missing — this sits in the path of
 * every AI request, so it must never be the reason one fails.
 */
export function listCorrections(file, scope = null) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const kept = parsed.filter(isCorrection).filter(c => !scope || c.scope === scope);
  return kept.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
}

function writeAll(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);
}

/**
 * Saves one correction and returns it. A new correction for a request that's effectively
 * the same as a stored one replaces that entry rather than stacking beside it, so the
 * owner's latest word wins and the prompt doesn't end up carrying two answers to the same
 * question. Beyond MAX_STORED the oldest are dropped.
 */
export function recordCorrection(file, { scope, prompt, badAnswer = '', corrected }) {
  const entry = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    scope: SCOPES.includes(scope) ? scope : 'ask',
    prompt: String(prompt || '').trim().slice(0, 2000),
    badAnswer: String(badAnswer || '').trim().slice(0, 4000),
    corrected: String(corrected || '').trim().slice(0, 4000),
    created: new Date().toISOString()
  };
  if (!isCorrection(entry)) throw Object.assign(new Error('A correction needs the request and what it should have said.'), { status: 400 });
  const tokens = tokenize(entry.prompt);
  const kept = listCorrections(file)
    .filter(c => !(c.scope === entry.scope && similarity(tokens, tokenize(c.prompt)) > 0.9));
  writeAll(file, [entry, ...kept].slice(0, MAX_STORED));
  return entry;
}

/** Removes one correction by id. Returns whether it was there to remove. */
export function deleteCorrection(file, id) {
  const all = listCorrections(file);
  const kept = all.filter(c => c.id !== id);
  if (kept.length === all.length) return false;
  writeAll(file, kept);
  return true;
}

/** The corrections closest to `promptText`, most similar first. Exported for tests. */
export function findCorrections(file, promptText, scope, limit = MAX_INJECTED) {
  const tokens = tokenize(promptText);
  if (!tokens.size) return [];
  return listCorrections(file, scope)
    .map(c => ({ correction: c, score: similarity(tokens, tokenize(c.prompt)) }))
    .filter(m => m.score >= MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score || String(b.correction.created).localeCompare(String(a.correction.created)))
    .slice(0, limit)
    .map(m => m.correction);
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/**
 * The block appended to a system prompt for this request, or '' when nothing stored is
 * close enough. Empty is the common case and matters: the caller appends nothing at all
 * then, so a request with no relevant correction sends exactly the prompt it always did.
 */
export function correctionsBlock(file, promptText, scope) {
  const matches = findCorrections(file, promptText, scope);
  if (!matches.length) return '';
  const items = matches.map((c, i) => {
    const lines = [`${i + 1}. Request: "${clip(c.prompt, MAX_INJECTED_PROMPT_CHARS)}"`];
    if (c.badAnswer) lines.push(`   Your earlier answer, which was wrong: "${clip(c.badAnswer, MAX_INJECTED_ANSWER_CHARS)}"`);
    lines.push(`   What it should have said: "${clip(c.corrected, MAX_INJECTED_ANSWER_CHARS)}"`);
    return lines.join('\n');
  });
  return `PAST CORRECTIONS FROM THE CV'S OWNER
They marked an earlier answer of yours wrong and wrote what it should have said. Each "should have said" below is the owner's own word and outranks your own judgement on that point. Where one of these applies to the request you've just been given, follow it — in substance and in length — instead of answering afresh. Where none applies, ignore this section entirely.
${items.join('\n')}`;
}
