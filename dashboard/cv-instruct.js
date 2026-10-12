// Tailor CV: "Tell it what to add or change". After tailoring, type plain instructions
// ("Under Brightloop add: …", "Add skills: Kubernetes", "Remove PHP", "Change headline
// to …") and they are applied to the CV; the preview, CV match, review and downloads
// follow. Suggestions above the box point at what to improve for this job; clicking one
// starts the instruction for you. Also: reading the job description from a file.

let instructUndo = [];   // earlier versions of the CV, for "Undo last change"

// "Skip fact-check" checkbox: the honesty check is archived (off) for now, by default —
// the code stays in place (see validateWholeCvEdit/mergeRewrite in tailor.js/ai-tailor.ts)
// so it can be switched back on in one click; it's not deleted, just not applied unless
// this box is unchecked. Always starts checked on every page load — no stored memory of a
// previous session's choice, so an old "off" state never silently sticks around. The
// warning banner still shows on every request it's used for, so it's never silent anyway.
function instructUnfiltered() {
  const box = document.getElementById('tailor-instruct-unfiltered');
  return Boolean(box && box.checked);
}
function initInstructUnfiltered() {
  const box = document.getElementById('tailor-instruct-unfiltered');
  if (box) box.checked = true;
}

// Called after each tailoring run
let instructBaseSummary = '';   // the summary Kairo wrote for this job

function instructLoaded(result) {
  instructUndo = [];
  instructBaseSummary = (result && result.cv && result.cv.summary) || '';
  initInstructUnfiltered();
  const box = document.getElementById('tailor-instruct');
  if (box) box.value = '';
  setInstructResult('');
  updateInstructUndo();
}

// After any change to the CV (Edit CV, the style bar, an instruction): was used to refresh
// the Suggestions box, removed along with the recruiter-review feature it was built from.
function instructSync() {}

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
    setInstructResult(summaryNote + questions.map(q => `<div class="instruct-answer" data-q="${escapeHtml(q)}"><strong>${escapeHtml(q)}</strong><p>${answerInstructQuestion(q)}</p></div>`).join(''));
    // A question outside the instant categories (score/gaps) gets a real, CV-grounded
    // answer from AI in the background, replacing the "Thinking about this…" holding text
    const openEnded = questions.filter(q => !questionHasSpecificCategory(q));
    if (openEnded.length && tailorWs.cv) fetchQuestionAnswers(openEnded);
    return;
  }
  button.disabled = true;
  button.textContent = 'Working on it…';
  setInstructResult('<p class="instruct-wait">Working on it… requests in your own words can take up to a minute with the local AI.</p>');
  showGlobalLoader('Applying your changes…');
  try {
    const res = await fetch(apiUrl('/api/cv/instruct'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Generous, but bounded: the server's own worst case (a cloud AI call that
      // fails, falling through to the local model) is capped well under this, so
      // a stuck request fails with a clear message instead of spinning forever.
      signal: AbortSignal.timeout(160_000),
      // the job too, so changes can be tailored to it
      body: JSON.stringify({ cv: tailorWs.cv, text: changes.join('\n'), job: { title: document.getElementById('tailor-title').value.trim(), description: document.getElementById('tailor-desc').value.trim() }, unfiltered: instructUnfiltered() })
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
    // Keep only the original request (not the explanation, already shown below) in the box
    box.value = (data.pending && data.pending.length ? data.pending : data.unclear).map(u => u.split(' — ')[0]).join('\n');
    setInstructResult(
      (data.unfiltered ? '<div class="instruct-unfiltered-warning"><strong>Fact-check was off for this request.</strong> The AI\'s output was applied without checking for invented technologies, numbers or claims — review it before using this CV.</div>' : '')
      + summaryNote + questions.map(q => `<div class="instruct-answer"><strong>${escapeHtml(q)}</strong><p>${answerInstructQuestion(q)}</p></div>`).join('')
      + (data.done.length ? `<ul class="instruct-done">${data.done.map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` : '')
      + (data.unclear.length ? `<div class="instruct-unclear"><strong>Not changed</strong> (left in the box):<ul>${data.unclear.map(u => `<li>${escapeHtml(u)}</li>`).join('')}</ul>${data.ai ? 'Try describing it a different way — say exactly what you did, or name the job or section.' : 'Try one of the examples below. For anything else, I need an AI key added (Anthropic, Groq or OpenRouter), or the local AI (Ollama) running.'}</div>` : ''));
    if (typeof saveTailorDraft === 'function') saveTailorDraft();
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    showToast(timedOut ? 'That took too long and was cancelled — try again, or describe it more simply.' : (err.message || 'Could not reach the server'));
    setInstructResult('');
  } finally {
    button.disabled = false;
    button.textContent = 'Apply to CV';
    updateInstructUndo();
    hideGlobalLoader();
  }
}

function undoInstruct() {
  if (!instructUndo.length) return;
  tailorWs.cv = instructUndo.pop();
  if (!document.getElementById('tailor-edit-card').hidden) renderEditor(tailorWs);
  cveRender(tailorWs, 0);
  setInstructResult('<ul class="instruct-done"><li>Undid the last change.</li></ul>');
  updateInstructUndo();
  if (typeof saveTailorDraft === 'function') saveTailorDraft();
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
  // "Do not show X", "Don't add Y", "Should not include Z": a negated opener is an
  // instruction ("stop doing/never do this"), not a question — "do/does/did/should" only
  // reads as a question when NOT immediately followed by a negation.
  if (/^(?:is|am|are|do|does|did|should|can|could)\b/i.test(line) && !/^(?:is|am|are|do|does|did|should|can|could)\s*n'?t\b|^(?:is|am|are|do|does|did|should|can|could)\s+not\b/i.test(line)) return true;
  // "Rate/score/grade/evaluate my CV's ATS score": asking for an assessment, not an edit —
  // phrased as an imperative (no "?", not a what/how/can opener), but still a question
  if (/^(?:rate|score|grade|evaluate|assess|review|analy[sz]e|check)\b/i.test(line) && /\b(?:cv|resume|profile|summary|ats|score|rating|match)\b/i.test(line)) return true;
  return /\?\s*$/.test(line) && !INSTRUCT_ACTION.test(line.split(/\s+/).slice(0, 3).join(' '));
}

// Whether answerInstructQuestion has an instant, locally-computed answer for this
// question — only score/match and skill gaps do, straight from tailorCV()'s own match
// analysis (r.analysis/r.coverage), no AI call needed. Everything else (red flags,
// length, general advice) has no local data source, so it always goes to AI (if
// configured) for a real, CV-grounded answer instead of a canned non-answer.
function questionHasSpecificCategory(q) {
  return /\b(score|match|rating|percent|%|how good|how strong|good enough|ready|chance|fit)\b/i.test(q)
    || /\b(missing|gap|lack|need|require|skills?|keywords?)\b/i.test(q);
}

// An instant answer from this CV's own match analysis (score, gaps); anything else shows
// a holding message until the AI-grounded answer (see applyInstruct's openEnded fetch, or
// cveAiApply's equivalent) replaces it in place.
function answerInstructQuestion(q) {
  const r = tailorResult;
  if (!r) return 'Tailor a CV first, then ask again.';
  const a = r.analysis;
  const list = (xs) => xs.map(x => escapeHtml(x)).join(', ');
  const missingReq = a.missing.filter(m => m.required && !m.soft).map(m => m.name);
  const missingNice = a.missing.filter(m => !m.required && !m.soft && !m.note).map(m => m.name);
  const score = `CV match <strong>${r.coverage ? r.coverage.cvScore : a.matchScore}%</strong> for this job.`;
  const gaps = missingReq.length ? `The job asks for ${list(missingReq)}, which your CV doesn't show.${missingNice.length ? ` Nice to have: ${list(missingNice)}.` : ''} If you have any of them, write e.g. "Add skills: ${escapeHtml(missingReq[0])}".` : `Nothing the job requires is missing.${missingNice.length ? ` Nice to have: ${list(missingNice)}.` : ''}`;
  if (/\b(score|match|rating|percent|%|how good|how strong|good enough|ready|chance|fit)\b/i.test(q)) return `${score} ${missingReq.length ? gaps : ''}`;
  if (/\b(missing|gap|lack|need|require|skills?|keywords?)\b/i.test(q)) return gaps;
  return 'Thinking about this…';
}

// Shared by the main instruct box and the per-section "Ask AI to change X" boxes in Edit
// CV: fills in a real, CV-grounded answer for each question in `questions` next to its
// "Thinking about this…" placeholder, found by its `data-q` attribute. If no AI answered
// (none configured, or the call failed) the placeholder is replaced with a clear reason
// instead of being left stuck forever.
function fetchQuestionAnswers(questions, cv = tailorWs.cv, job = { title: document.getElementById('tailor-title').value.trim(), description: document.getElementById('tailor-desc').value.trim() }) {
  fetch(apiUrl('/api/cv/ask'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(35_000),
    body: JSON.stringify({ cv, questions, job })
  }).then(res => res.json()).then(data => {
    for (const q of questions) {
      const p = document.querySelector(`.instruct-answer[data-q="${CSS.escape(q)}"] p`);
      if (!p) continue;
      const answer = data.answers && data.answers[q];
      p.textContent = answer || "I can't answer that one yet — add an AI key (Gemini, Groq, OpenRouter or Anthropic), or ask about your match score or missing skills instead.";
    }
  }).catch(() => {
    for (const q of questions) {
      const p = document.querySelector(`.instruct-answer[data-q="${CSS.escape(q)}"] p`);
      if (p) p.textContent = "Couldn't reach the server to answer that — try again.";
    }
  });
}

// "Generate (a generic / new / profile) summary (for this JD)", "write my summary for this job"
function isSummaryRequest(line) {
  return /^(?:please\s+|can you\s+|could you\s+)?(?:generate|regenerate|write|rewrite|create|make|give(?:\s+me)?|redo|refresh|build|draft|improve|strengthen|enhance|polish|refine|tighten|fix)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+|my\s+)?(?:new\s+|generic\s+|fresh\s+|tailored\s+|proper\s+|better\s+|good\s+|strong\s+)*(?:profile\s+|professional\s+|cv\s+)?summary(?:\s+(?:for|to match|matching|based on|according to)\s+(?:this|the|my)\s+(?:jd|job|job description|role|position|posting))?[.!?]*$/i.test(line);
}
