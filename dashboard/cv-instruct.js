// Tailor CV: "Tell it what to add or change". After tailoring, type plain instructions
// ("Under Brightloop add: …", "Add skills: Kubernetes", "Remove PHP", "Change headline
// to …") and they are applied to the CV; the preview, CV match, review and downloads
// follow. Suggestions above the box point at what to improve for this job; clicking one
// starts the instruction for you. Also: reading the job description from a file.

let instructUndo = [];   // earlier versions of the CV, for "Undo last change"

// Called after each tailoring run
let instructBaseSummary = '';   // the summary Kairo wrote for this job

function instructLoaded(result) {
  instructUndo = [];
  instructBaseSummary = (result && result.cv && result.cv.summary) || '';
  const box = document.getElementById('tailor-instruct');
  if (box) box.value = '';
  setInstructResult('');
  updateInstructUndo();
  renderInstructTips();
}

// After any change to the CV (Edit CV, the style bar, an instruction): refresh the suggestions
function instructSync() {
  renderInstructTips();
}

function updateInstructUndo() {
  const btn = document.getElementById('tailor-instruct-undo');
  if (btn) btn.disabled = !instructUndo.length;
}

function setInstructResult(html) {
  const el = document.getElementById('tailor-instruct-result');
  if (el) el.innerHTML = html;
}

async function applyInstruct(button) {
  const box = document.getElementById('tailor-instruct');
  const text = box.value.trim();
  if (!tailorWs.cv) return;
  if (!text) {
    showToast('Write what you want to add or change first');
    box.focus();
    return;
  }
  // "Generate a summary for this JD": the summary Kairo wrote for this job, straight away
  const allLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const wantSummary = allLines.filter(isSummaryRequest);
  if (wantSummary.length && instructBaseSummary) {
    if (tailorWs.cv.summary !== instructBaseSummary) {
      instructUndo.push(JSON.parse(JSON.stringify(tailorWs.cv)));
      tailorWs.cv.summary = instructBaseSummary;
      tailorWs.edited = true;
      if (!document.getElementById('tailor-edit-card').hidden) renderEditor(tailorWs);
      cveRender(tailorWs, 0);
      updateInstructUndo();
    }
  }
  const summaryNote = wantSummary.length ? `<ul class="instruct-done"><li>${instructBaseSummary ? 'Your summary is the one written for this job' : 'Tailor the CV first to get a summary for this job'}: "${escapeHtml(instructBaseSummary.slice(0, 160))}${instructBaseSummary.length > 160 ? '…' : ''}"</li></ul>` : '';
  // Questions ("what am I missing?") are answered here from the CV review
  const lines = allLines.filter(l => !isSummaryRequest(l));
  if (!lines.length) {
    box.value = '';
    setInstructResult(summaryNote);
    return;
  }
  const questions = lines.filter(isInstructQuestion);
  const changes = lines.filter(l => !isInstructQuestion(l));
  if (questions.length && !changes.length) {
    box.value = '';
    setInstructResult(summaryNote + questions.map(q => `<div class="instruct-answer"><strong>${escapeHtml(q)}</strong><p>${answerInstructQuestion(q)}</p></div>`).join(''));
    return;
  }
  button.disabled = true;
  button.textContent = 'Working on it…';
  setInstructResult('<p class="instruct-wait">Working on it… requests in your own words can take up to a minute with the local AI.</p>');
  try {
    const res = await fetch(apiUrl('/api/cv/instruct'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // the job too, so changes can be tailored to it
      body: JSON.stringify({ cv: tailorWs.cv, text: changes.join('\n'), job: { title: document.getElementById('tailor-title').value.trim(), description: document.getElementById('tailor-desc').value.trim() } })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not apply that');
    if (data.done.length) {
      instructUndo.push(JSON.parse(JSON.stringify(tailorWs.cv)));
      tailorWs.cv = data.cv;
      tailorWs.edited = true;
      // Skills you added count as yours for this job
      for (const skill of data.skills || []) instructConfirmSkill(skill);
      if (!document.getElementById('tailor-edit-card').hidden) renderEditor(tailorWs);
      cveRender(tailorWs, 0);
    }
    // Keep only the original request (not the explanation) in the box, to fix and try again
    box.value = (data.pending && data.pending.length ? data.pending : data.unclear).join('\n');
    setInstructResult(
      summaryNote + questions.map(q => `<div class="instruct-answer"><strong>${escapeHtml(q)}</strong><p>${answerInstructQuestion(q)}</p></div>`).join('')
      + (data.done.length ? `<ul class="instruct-done">${data.done.map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` : '')
      + (data.unclear.length ? `<div class="instruct-unclear"><strong>Not changed</strong> (left in the box):<ul>${data.unclear.map(u => `<li>${escapeHtml(u)}</li>`).join('')}</ul>${data.ai ? 'Try describing it a different way — say exactly what you did, or name the job or section.' : 'Try one of the examples below. For anything else, I need the local AI (Ollama) running, or an Anthropic API key added.'}</div>` : ''));
  } catch (err) {
    showToast(err.message || 'Could not reach the server');
  } finally {
    button.disabled = false;
    button.textContent = 'Apply to CV';
    updateInstructUndo();
  }
}

function undoInstruct() {
  if (!instructUndo.length) return;
  tailorWs.cv = instructUndo.pop();
  if (!document.getElementById('tailor-edit-card').hidden) renderEditor(tailorWs);
  cveRender(tailorWs, 0);
  setInstructResult('<ul class="instruct-done"><li>Undid the last change.</li></ul>');
  updateInstructUndo();
}

// A skill added by instruction moves from "Not in your profile" to "Covered"
function instructConfirmSkill(skill) {
  const a = tailorResult && tailorResult.analysis;
  if (!a) return;
  const i = a.missing.findIndex(m => m.name.toLowerCase() === skill.toLowerCase());
  if (i < 0) return;
  const m = a.missing.splice(i, 1)[0];
  tailorConfirmed.add(m.name);
  a.matched.push({ name: m.name, required: m.required, soft: m.soft, confirmed: true, implied: null });
  const req = a.matched.filter(x => x.required).length;
  const total = req + a.missing.filter(x => x.required).length;
  if (total) a.matchScore = Math.round((req / total) * 100);
  renderTailorChips();
  renderTailorScore();
}

// ---------- Suggestions above the box ----------
// Plain pointers from the CV review. Clicking one writes the start of the instruction.

const MAX_INSTRUCT_TIPS = 6;

function instructTips() {
  const rv = tailorResult && tailorResult.review;
  if (!rv) return [];
  const tips = [];
  const seen = new Set();
  const add = (tip) => {
    const key = tip.key || tip.line || tip.text;
    if (seen.has(key)) return;
    seen.add(key);
    tips.push(tip);
  };
  const x = tailorWs.cv && tailorWs.cv.experience[0];
  const job = x ? (x.company || x.role) : '';
  const replace = (line) => `Replace "${line}" with "${line}"`;
  // Every job should have at least five points
  for (const j of ((tailorWs.cv && tailorWs.cv.experience) || []).filter(e => e.bullets.length < 5).slice(0, 3)) {
    const name = j.company || j.role;
    add({ key: `short:${name}`, text: `${[j.role, j.company].filter(Boolean).join(' at ')} has ${j.bullets.length} point${j.bullets.length === 1 ? '' : 's'}; every job should have at least 5. Add real ones from that job.`, prefill: `Under ${name}, add: ` });
  }
  for (const k of rv.recruiter.missingKeywords.filter(k => k.required && k.name !== 'AI').slice(0, 2)) {
    add({ key: `kw:${k.name}`, text: `The job asks for ${k.name}. If you've used it, add a point about it, or add it to your skills.`, prefill: job ? `Under ${job}, add: ` : 'Add a point: ' });
  }
  const contact = rv.recruiter.redFlags.find(f => /contact details/i.test(f.title));
  if (contact) add({ key: 'contact', text: contact.detail, prefill: /phone/i.test(contact.detail) ? 'Set phone to ' : 'Set email to ' });
  for (const b of (rv.xyz.weak || []).slice(0, 2)) add({ text: 'Start this point with what you did (Built, Led, Cut, Launched…), not a duty.', line: b.text, prefill: replace(b.text), select: true });
  for (const b of rv.xyz.needNumbers.slice(0, 3)) add({ text: 'Add a number to this point: how much, how many or how fast (only if you know it).', line: b.text, prefill: replace(b.text), select: true });
  for (const b of (rv.xyz.long || []).slice(0, 1)) add({ text: `Shorten this point to one or two lines (it has ${b.words} words).`, line: b.text, prefill: replace(b.text), select: true });
  for (const sec of rv.skim.sections) {
    if (sec.verdict === 'read' || !sec.fix || /^Experience|^Header/.test(sec.section)) continue;
    const prefill = sec.section === 'Skills' ? 'Add skills: ' : sec.section === 'Summary' ? 'Add to summary: ' : '';
    add({ key: sec.section, text: `${sec.section}: ${sec.reason} ${sec.fix}`, prefill });
  }
  for (const f of rv.recruiter.redFlags) {
    if (/required skill|contact details|measurable results|Duty-style|Dense bullets/i.test(f.title)) continue;
    add({ text: `${f.title}: ${f.fix}` });
  }
  return tips;
}

function renderInstructTips() {
  const box = document.getElementById('tailor-instruct-tips');
  if (!box) return;
  const tips = instructTips();
  window.__instructTips = tips;
  if (!tips.length) {
    box.innerHTML = '<p class="cv-tips-ok">Looks good: nothing major to fix for this job.</p>';
    return;
  }
  const shown = tips.slice(0, MAX_INSTRUCT_TIPS);
  const quote = (t) => (t.line ? `<span class="cv-tip-line">${escapeHtml(t.line.length > 90 ? `${t.line.slice(0, 90)}…` : t.line)}</span>` : '');
  box.innerHTML = `<p class="cv-tips-title">Suggestions <span>${tips.length}</span></p><ol class="cv-tips">${shown.map((t, i) => `
    <li><button type="button" class="cv-tip" onclick="useInstructTip(${i})"${t.prefill ? ' title="Start this change in the box below"' : ' disabled'}>
      <span class="cv-tip-text">${escapeHtml(t.text)}</span>${quote(t)}</button></li>`).join('')}</ol>${tips.length > MAX_INSTRUCT_TIPS ? `<p class="cv-tips-more">${tips.length - MAX_INSTRUCT_TIPS} more after you fix these.</p>` : ''}`;
}

// Start the instruction for a suggestion in the box (on a new line if there's text)
function useInstructTip(i) {
  const tip = (window.__instructTips || [])[i];
  const box = document.getElementById('tailor-instruct');
  if (!tip || !tip.prefill || !box) return;
  const before = box.value.replace(/\s+$/, '');
  box.value = before ? `${before}\n${tip.prefill}` : tip.prefill;
  box.focus();
  if (tip.select) {
    // select the second copy of the point, the part to rewrite
    const end = box.value.length - 1;
    const start = end - tip.line.length;
    box.setSelectionRange(start, end);
  } else box.setSelectionRange(box.value.length, box.value.length);
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------- Upload the job description ----------

async function handleTailorJdFile(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  if (file.size > CV_MAX_BYTES) {
    showToast('That file is too large (10 MB at most).');
    return;
  }
  const desc = document.getElementById('tailor-desc');
  if (desc.value.trim() && !confirm('Replace the job description you already have?')) return;
  try {
    const text = String(await extractCvText(file)).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 40) throw new Error('Could not read much text from that file. Paste the job description instead.');
    desc.value = text;
    // The first line of a job description is usually the job title
    const title = document.getElementById('tailor-title');
    const first = text.split('\n').map(l => l.trim()).find(Boolean) || '';
    if (!title.value.trim() && first.length <= 80 && !/[.:]$/.test(first)) title.value = first;
    showToast(`Read the job description from ${file.name}`);
  } catch (err) {
    showToast(typeof friendlyCvError === 'function' ? friendlyCvError(err) : err.message, 7000);
  }
}

// "What can I write?": the + next to an example puts it in the box (with your latest
// job's name in place of the example's), ready to finish and apply
function addInstructExample(btn) {
  const box = document.getElementById('tailor-instruct');
  if (!box) return;
  const x = tailorWs.cv && tailorWs.cv.experience[0];
  const job = x ? (x.company || x.role) : '';
  let text = btn.dataset.text || '';
  if (text.includes('{job}')) text = job ? text.replace('{job}', job) : (text.startsWith('Under') ? 'Add a point: ' : 'I ');
  const before = box.value.replace(/\s+$/, '');
  box.value = before ? `${before}\n${text}` : text;
  box.focus();
  const select = btn.dataset.select;
  if (select) {
    const start = box.value.lastIndexOf(select);
    box.setSelectionRange(start, start + select.length);
  } else box.setSelectionRange(box.value.length, box.value.length);
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Enter applies what's in the box straight away; Shift+Enter starts a new line
function instructKey(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  const btn = document.getElementById('tailor-instruct-apply');
  if (btn && !btn.disabled) applyInstruct(btn);
}

// ---------- Questions typed in the box ----------

// "What am I missing?" is a question; "Can you add Kafka to my skills?" is a change
const INSTRUCT_ACTION = /\b(?:add|remove|delete|change|make|put|set|update|replace|rewrite|mention|highlight|include|insert|drop|get rid|move|shorten|organi[sz]e|write|rename|list|use)\b/i;
function isInstructQuestion(line) {
  if (/^(?:what|which|how|why|where|who|tell me|show me|explain)\b/i.test(line)) return true;
  if (/^(?:can|could|would|will)\s+(?:you|u)\b|^(?:please|pls|kindly)\b/i.test(line)) return !INSTRUCT_ACTION.test(line) && /\?\s*$/.test(line);
  if (/^(?:is|am|are|do|does|did|should|can|could)\b/i.test(line)) return true;
  return /\?\s*$/.test(line) && !INSTRUCT_ACTION.test(line.split(/\s+/).slice(0, 3).join(' '));
}

// An answer from this CV's review: score, gaps, red flags, what to improve, length
function answerInstructQuestion(q) {
  const r = tailorResult;
  if (!r || !r.review) return 'Tailor a CV first, then ask again.';
  const rv = r.review;
  const a = r.analysis;
  const list = (xs) => xs.map(x => escapeHtml(x)).join(', ');
  const missingReq = a.missing.filter(m => m.required && !m.soft).map(m => m.name);
  const missingNice = a.missing.filter(m => !m.required && !m.soft && !m.note).map(m => m.name);
  const tips = (typeof instructTips === 'function' ? instructTips() : []).slice(0, 3).map(t => escapeHtml(t.text));
  const score = `CV match <strong>${r.coverage ? r.coverage.cvScore : a.matchScore}%</strong>, recruiter score <strong>${escapeHtml(rv.recruiter.score)}/100</strong> (${rv.recruiter.parts.map(p => `${escapeHtml(p.label)} ${escapeHtml(p.points)}${p.of ? `/${p.of}` : ''}`).join(', ')}).`;
  const gaps = missingReq.length ? `The job asks for ${list(missingReq)}, which your CV doesn't show.${missingNice.length ? ` Nice to have: ${list(missingNice)}.` : ''} If you have any of them, write e.g. "Add skills: ${escapeHtml(missingReq[0])}".` : `Nothing the job requires is missing.${missingNice.length ? ` Nice to have: ${list(missingNice)}.` : ''}`;
  const flags = rv.recruiter.redFlags.length ? rv.recruiter.redFlags.map(f => `${escapeHtml(f.title)}: ${escapeHtml(f.detail)}`).join(' ') : 'No red flags a recruiter would spot in 10 seconds.';
  if (/\b(score|match|rating|percent|%|how good|how strong|good enough|ready|chance|fit)\b/i.test(q)) return `${score} ${missingReq.length ? gaps : ''}`;
  if (/\b(missing|gap|lack|need|require|skills?|keywords?)\b/i.test(q)) return gaps;
  if (/\b(red flags?|problems?|issues?|wrong|weak|bad)\b/i.test(q)) return flags;
  if (/\b(long|length|pages?|short)\b/i.test(q)) return `About ${escapeHtml(rv.skim.pages)} page${rv.skim.pages > 1 ? 's' : ''}. Write "Make it one page" to shorten it.`;
  if (/\b(improve|better|stronger|tips?|suggest|advice|change|fix)\b/i.test(q)) return tips.length ? `Top things to do: ${tips.map((t, i) => `${i + 1}. ${t}`).join(' ')}` : 'It already looks strong for this job.';
  return `${score} ${gaps} ${tips.length ? `Next: ${tips[0]}` : ''}`;
}

// "Generate (a generic / new / profile) summary (for this JD)", "write my summary for this job"
function isSummaryRequest(line) {
  return /^(?:please\s+|can you\s+|could you\s+)?(?:generate|regenerate|write|rewrite|create|make|give(?:\s+me)?|redo|refresh|build|draft|improve|strengthen|enhance|polish|refine|tighten|fix)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+|my\s+)?(?:new\s+|generic\s+|fresh\s+|tailored\s+|proper\s+|better\s+|good\s+|strong\s+)*(?:profile\s+|professional\s+|cv\s+)?summary(?:\s+(?:for|to match|matching|based on|according to)\s+(?:this|the|my)\s+(?:jd|job|job description|role|position|posting))?[.!?]*$/i.test(line);
}
