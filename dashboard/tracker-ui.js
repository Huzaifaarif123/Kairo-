// Pipeline: "Ask AI" on each application card. Same idea as the CV editor's per-section
// boxes — say a short sentence, only that card changes, instantly (no AI model needed for
// the common phrasings: this is plain rules, not a network call). Covers moving stages,
// adding a note, setting who to contact, and a follow-up date.

const STATUS_WORDS = [
  [/\b(?:drafted?|draft(?:ing)?)\b/i, 'drafted'],
  [/\b(?:applied|submit(?:ted)?|sent (?:the|my) application)\b/i, 'applied'],
  [/\b(?:screen(?:ing)?|phone screen)\b/i, 'screening'],
  [/\b(?:interview(?:ing)?)\b/i, 'interview'],
  [/\b(?:offer(?:ed)?|got an offer)\b/i, 'offer'],
  [/\b(?:hired|accepted|started)\b/i, 'hired'],
  [/\b(?:rejected|reject(?:ion)?|closed|declined|turned down|didn'?t get it|no longer (?:in )?consideration|ghosted)\b/i, 'rejected']
];
const STATUS_NAMES = { drafted: 'Drafted', applied: 'Applied', screening: 'Screening', interview: 'Interview', offer: 'Offer', hired: 'Hired', rejected: 'Closed' };

// A short sentence with nothing concrete in it ("make some real-time improvements",
// "optimize this") should never be saved as a real note — only a vague instruction about
// the card itself slips through here; a genuine note like "called, left voicemail" always
// has something concrete (a name, an action with an object, a date) once these are stripped.
const VAGUE_WORDS = new Set([
  'add', 'added', 'adding', 'put', 'make', 'made', 'makes', 'making', 'do', 'did', 'does', 'doing',
  'try', 'tried', 'trying', 'some', 'something', 'anything', 'nothing', 'things', 'thing', 'stuff',
  'this', 'that', 'these', 'those', 'it', 'them', 'the', 'and', 'for', 'with', 'from', 'into', 'onto', 'about',
  'improve', 'improved', 'improvement', 'improvements', 'change', 'changed', 'changes',
  'update', 'updated', 'updates', 'edit', 'edited', 'edits', 'enhance', 'enhanced', 'enhancement', 'enhancements',
  'fix', 'fixed', 'fixes', 'tweak', 'tweaked', 'tweaks', 'optimize', 'optimise', 'optimized', 'optimised',
  'optimization', 'optimisation', 'better', 'stronger', 'best', 'good', 'nice', 'useful', 'helpful', 'relevant',
  'real', 'realtime', 'time', 'please', 'also', 'just', 'now', 'here', 'there', 'up', 'out', 'more'
]);
function isVagueRequest(text) {
  if (/\d/.test(text)) return false;
  const words = String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  return words.filter(w => w.length > 2 && !VAGUE_WORDS.has(w)).length === 0;
}

// "Friday", "next Friday", "tomorrow", "in 3 days", "Oct 20", "10/20", "2026-10-20"
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function parseWhen(text, now = new Date()) {
  const t = String(text).trim().toLowerCase();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const add = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return iso(d); };
  if (/^today$/.test(t)) return add(0);
  if (/^tomorrow$/.test(t)) return add(1);
  let m = t.match(/^in\s+(\d+)\s+days?$/);
  if (m) return add(Number(m[1]));
  m = t.match(/^(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (m) {
    const target = WEEKDAYS.indexOf(m[2]);
    let delta = (target - now.getDay() + 7) % 7;
    // "next Friday" always means next week's, even if this week's hasn't happened yet;
    // a bare "Friday" means the next upcoming one (today, if today is Friday)
    if (m[1]) delta += 7;
    return add(delta);
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return t;
  m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) { const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : now.getFullYear(); return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  m = t.match(/^([a-z]{3,9})\s+(\d{1,2})(?:,?\s*(\d{4}))?$/);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3));
    if (mi >= 0) return `${m[3] || now.getFullYear()}-${String(mi + 1).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
  }
  return null;
}

/**
 * Apply plain instructions to one tracker row. Pure, no network call.
 * @param {any} row the application (company, role, status, notes, contact_person, deadline, …)
 * @param {string} text one or more instructions (one per line or separated by ";")
 * @returns {{ row: any, done: string[], unclear: string[] }}
 */
function applyTrackerInstruction(row, text) {
  const out = { ...row };
  const done = [], unclear = [];
  // Two instructions in one sentence: "mark as interviewing, follow up Friday"
  const splitAt = /\s*,?\s+(?:and then|and also|then)\s+|\s*,\s+(?=(?:mark|move|set|status|add|note|contact|recruiter|follow|remind|next step|interview)\b)/i;
  const lines = String(text || '').split(/\n+|;\s*(?=[A-Za-z])/).flatMap(l => l.split(splitAt)).map(l => l.trim().replace(/^[-•*\s]+/, '')).filter(Boolean).slice(0, 10);
  for (const raw of lines) {
    let line = raw.replace(/^(?:please|pls|also|and|then|ok(?:ay)?|so)[,\s]+/i, '').trim();
    let m;
    // Status: "mark as interviewing", "move to offer", "we got an offer", "I got rejected"
    const hit = STATUS_WORDS.find(([re]) => re.test(line));
    if (hit && /\b(mark|move|set|status|stage|we|i|got|they|update)\b/i.test(line)) {
      out.status = hit[1];
      done.push(`Moved to ${STATUS_NAMES[hit[1]]}`);
      continue;
    }
    // Contact: "contact is Sarah", "recruiter is Sarah from HR", "set contact to Sarah"
    if ((m = line.match(/^(?:set\s+)?(?:the\s+|my\s+)?(?:contact|recruiter|hiring manager)\s+(?:is|to|=|:)\s*(.+)$/i))) {
      out.contact_person = m[1].trim().replace(/[.]$/, '');
      done.push(`Set the contact to ${out.contact_person}`);
      continue;
    }
    // Follow-up / deadline: "follow up Friday", "remind me next Friday", "next step: Oct 20"
    if ((m = line.match(/^(?:set\s+)?(?:a\s+|the\s+)?follow[\s-]?up(?:\s+(?:date|for|on))?\s*(?:is|to|:|=)?\s*(.+)$/i))
      || (m = line.match(/^remind me\s*(?:on|for)?\s*(.+)$/i))
      || (m = line.match(/^next step(?:\s+is)?\s*(?:on|:|=)?\s*(.+)$/i))
      || (m = line.match(/^interview(?:\s+is)?\s+(?:scheduled\s+)?(?:on|for)\s+(.+)$/i))) {
      const when = parseWhen(m[1].trim().replace(/[.]$/, ''));
      if (when) { out.deadline = when; done.push(`Follow-up set for ${when}`); }
      else unclear.push(`${raw} — I didn't understand "${m[1].trim()}" as a date. Try "Friday", "next Friday", "in 3 days" or "2026-10-20".`);
      continue;
    }
    // Notes: "add a note: ...", "note that ...", or any other short sentence
    if ((m = line.match(/^(?:add\s+(?:a\s+)?note\s*:?\s*|note(?:\s+that)?\s*:?\s*)(.+)$/i))) {
      const note = `${m[1].trim().replace(/[.]+$/, '')}.`;
      out.notes = out.notes ? `${out.notes}\n${note}` : note;
      done.push(`Added a note: "${note}"`);
      continue;
    }
    // Anything else short enough is treated as a note too, so "called, left voicemail" still
    // works — but only when it says something concrete; a vague instruction about the card
    // itself ("make some real-time improvements") must never be saved as if it were a note.
    if (line.split(/\s+/).length <= 25 && line.length >= 3 && !isVagueRequest(line)) {
      const note = `${line.replace(/[.]+$/, '')}.`;
      out.notes = out.notes ? `${out.notes}\n${note}` : note;
      done.push(`Added a note: "${note}"`);
      continue;
    }
    unclear.push(`${raw} — that doesn't say what to change. Try "mark as interviewing", "add a note: called recruiter today", "contact is Sarah", or "follow up Friday".`);
  }
  return { row: out, done, unclear };
}

// ---------- The box on each card ----------

let trackerAiOpen = null;   // index of the card whose box is open
let trackerAiUndo = {};     // idx -> previous row, for Undo
let trackerAiNotes = {};    // idx -> { done, unclear } from the last apply, survives re-render
let trackerAiDrafts = {};   // idx -> text left in the box (e.g. the unclear part, to fix and retry)

function toggleCardAi(idx) {
  trackerAiOpen = trackerAiOpen === idx ? null : idx;
  renderKanban();
  if (trackerAiOpen === idx) setTimeout(() => { const el = document.getElementById(`tracker-ai-${idx}`); if (el) el.focus(); }, 0);
}

function cardAiKey(e, idx) {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  applyCardAi(idx);
}

async function applyCardAi(idx) {
  const box = document.getElementById(`tracker-ai-${idx}`);
  const text = box ? box.value.trim() : '';
  const app = applications[idx];
  if (!app) return;
  if (!text) { if (box) box.focus(); return; }
  const before = { ...app };
  const { row, done, unclear } = applyTrackerInstruction(app, text);
  if (done.length) {
    trackerAiUndo[idx] = before;
    applications[idx] = row;
    syncTrackerData();
    updateStats();
  }
  // kept in state (not just the DOM): renderKanban() below rebuilds this card's markup,
  // which would otherwise wipe a result written directly into the page
  trackerAiNotes[idx] = { done, unclear };
  trackerAiDrafts[idx] = unclear.length ? unclear.map(u => u.split(' — ')[0]).join('\n') : '';
  renderKanban();
}

function undoCardAi(idx) {
  if (!trackerAiUndo[idx]) return;
  applications[idx] = trackerAiUndo[idx];
  delete trackerAiUndo[idx];
  trackerAiNotes[idx] = { done: ['Undone.'], unclear: [] };
  syncTrackerData();
  updateStats();
  renderKanban();
}

/** Small toggle in the card's action row; always rendered. */
function cardAiToggle(idx) {
  return `<button class="btn-link" onclick="toggleCardAi(${idx})">${trackerAiOpen === idx ? 'Close AI' : 'Ask AI'}</button>`;
}

/** The expanded box, rendered as its own block below the card's actions when open. */
function cardAiPanel(idx) {
  if (trackerAiOpen !== idx) return '';
  const r = trackerAiNotes[idx];
  const noteHtml = r
    ? (r.done.length ? `<ul class="instruct-done">${r.done.map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul>${trackerAiUndo[idx] !== undefined ? `<button type="button" class="btn-link" onclick="undoCardAi(${idx})">Undo</button>` : ''}` : '')
      + (r.unclear.length ? `<div class="instruct-unclear"><ul>${r.unclear.map(u => `<li>${escapeHtml(u)}</li>`).join('')}</ul></div>` : '')
    : '';
  return `<div class="tracker-ai" onclick="event.stopPropagation()">
    <textarea class="input tracker-ai-box" id="tracker-ai-${idx}" rows="1" placeholder="e.g. mark as interviewing, follow up Friday, contact is Sarah" onkeydown="cardAiKey(event, ${idx})" onclick="event.stopPropagation()">${escapeHtml(trackerAiDrafts[idx] || '')}</textarea>
    <div class="tracker-ai-row"><button type="button" class="btn btn-primary btn-sm" onclick="applyCardAi(${idx})">Apply</button></div>
    <div class="instruct-note" id="tracker-ai-note-${idx}"${noteHtml ? '' : ' hidden'}>${noteHtml}</div>
  </div>`;
}
