// Tailor CV tab - builds a job-specific CV from the profile via /api/tailor.
// Kept separate from app.js; relies only on its shared helpers
// (switchTab, showToast, escapeHtml, PAGES).

PAGES.tailor = ['Tailor CV', 'Reshape your CV around a specific job description.'];

let tailorResult = null;

// Which CV is tailored: the selected profile, or "another CV" uploaded or pasted here
// (read in the browser, sent with each request, never saved to a profile)
let tailorSource = { kind: 'profile', name: '', markdown: '', label: '' };

function tailorOneOffMarkdown() {
  return tailorSource.kind === 'other' ? tailorSource.markdown : '';
}

function setTailorSource(kind) {
  if (kind === tailorSource.kind) return;
  if (tailorWs.edited && !confirm('Switching CVs clears the tailored CV and your edits. Continue?')) return;
  tailorSource.kind = kind;
  document.querySelectorAll('.cv-source .seg-btn').forEach(b => {
    const on = b.dataset.src === kind;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on);
  });
  document.getElementById('cv-source-other').hidden = kind !== 'other';
  // A different CV: start the tailoring over
  tailorConfirmed.clear();
  tailorJobKey = '';
  resetTailor();
}

async function handleTailorCvFile(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  if (file.size > CV_MAX_BYTES) return showToast('That file is larger than 10 MB');
  showToast(`Reading ${file.name}…`, 60000);
  try {
    useTailorCv(await readCv(file), file.name);
  } catch (err) {
    console.warn('CV read failed', err);
    showToast(friendlyCvError(err), 8000);
  }
}

function useTailorCvText() {
  const text = document.getElementById('tailor-cv-text').value;
  if (text.replace(/\s/g, '').length < 80) return showToast('Paste the whole CV (it looks too short)');
  try {
    useTailorCv(parseCvText(text), 'pasted text');
  } catch (err) {
    showToast('Could not read that text as a CV');
  }
}

function useTailorCv(cv, from) {
  if (!cv.name || !cv.experience.length) {
    showToast('Could not find a name and work experience in that CV. Try the other format (file or pasted text).', 7000);
    return;
  }
  tailorSource = { kind: 'other', name: cv.name, markdown: buildProfileMarkdown(cv, null), label: from };
  const skills = cv.skills.reduce((n, g) => n + g.items.length, 0);
  document.getElementById('tailor-cv-status').innerHTML =
    `Using <strong>${escapeHtml(cv.name)}</strong>'s CV (from ${escapeHtml(from)}): ${cv.experience.length} role${cv.experience.length === 1 ? '' : 's'}, ${skills} skill${skills === 1 ? '' : 's'}${cv.projects.length ? `, ${cv.projects.length} project${cv.projects.length === 1 ? '' : 's'}` : ''}. Not saved to any profile.`;
  tailorConfirmed.clear();
  tailorJobKey = '';
  resetTailor();
  showToast(`${cv.name}'s CV is ready. Add the job and click Tailor my CV.`, 4000);
}

// Skills the candidate confirmed for the current job (gaps their profile doesn't mention)
const tailorConfirmed = new Set();
let tailorJobKey = '';

// The CV layout's own styles come with the result, so the preview matches the LaTeX
// CV layout chosen in the toolbar (remembered on this device)
let tailorLayout = 'ats-classic';
try { tailorLayout = localStorage.getItem('cvLayout') || tailorLayout; } catch (e) {}

// The tailored CV in the chosen layout (every layout comes with each result)
function currentLayout() {
  const r = tailorResult;
  return (r.layouts && (r.layouts[tailorLayout] || r.layouts[r.template])) || { html: r.html, css: r.css, latex: r.latex };
}

function setTailorLayout(id) {
  tailorLayout = id;
  try { localStorage.setItem('cvLayout', id); } catch (e) {}
  // The style toolbar shows this layout's own choices
  tailorWs.layout = id;
  tailorWs.menu = null;
  renderStyleBar(tailorWs);
  renderTailorPreview();
}

function renderLayoutPicker() {
  const select = document.getElementById('tailor-layout');
  const layouts = tailorResult.layouts || {};
  if (!layouts[tailorLayout]) tailorLayout = tailorResult.template || Object.keys(layouts)[0] || tailorLayout;
  select.innerHTML = Object.entries(layouts).map(([id, l]) => `<option value="${escapeHtml(id)}"${id === tailorLayout ? ' selected' : ''}>${escapeHtml(l.label)}</option>`).join('');
  select.hidden = Object.keys(layouts).length < 2;
}

// A CV as a standalone page for the preview frame and printing (css: the layout's styles)
function cvDocument(html, title, highlight, css) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${css != null ? css : currentLayout().css}</style></head><body class="${highlight ? 'highlight' : ''}"><div class="page">${html}</div></body></html>`;
}

function importFromEvaluator() {
  const title = document.getElementById('eval-job-title').value;
  const company = document.getElementById('eval-company-name').value;
  const desc = document.getElementById('eval-job-desc').value;
  if (!desc.trim()) {
    showToast('The Evaluate tab has no job description yet');
    return;
  }
  document.getElementById('tailor-title').value = title;
  document.getElementById('tailor-company').value = company;
  document.getElementById('tailor-desc').value = desc;
  showToast('Job imported from Evaluate');
}

// "Tailor CV for this job" on the Evaluate tab: fill in the job and build the CV
function tailorJob(title, company, description) {
  if (!String(description || '').trim()) {
    showToast('Add the job description first');
    return;
  }
  document.getElementById('tailor-title').value = title || '';
  document.getElementById('tailor-company').value = company || '';
  document.getElementById('tailor-desc').value = description;
  switchTab('tailor');
  runTailor();
}

function tailorFromEvaluator() {
  tailorJob(
    document.getElementById('eval-job-title').value,
    document.getElementById('eval-company-name').value,
    document.getElementById('eval-job-desc').value
  );
}

// Confirm or remove a skill the profile doesn't mention. The score and skills update
// straight away; Claude's wording is refreshed with "Rewrite with Claude" when ready.
function toggleConfirmedSkill(name) {
  if (tailorConfirmed.has(name)) tailorConfirmed.delete(name);
  else tailorConfirmed.add(name);
  runTailor({ ai: false });
}

// ai: false skips Claude's rewrite (quick update after confirming a skill)
async function runTailor({ ai = true } = {}) {
  const title = document.getElementById('tailor-title').value.trim();
  const company = document.getElementById('tailor-company').value.trim();
  const description = document.getElementById('tailor-desc').value.trim();
  const button = document.getElementById('tailor-run');

  // Confirmed skills belong to one job; start fresh when the job changes
  const key = `${title}\n${company}\n${description}`;
  if (key !== tailorJobKey) {
    tailorConfirmed.clear();
    tailorJobKey = key;
  }

  if (!description) {
    showToast('Paste the job description first');
    document.getElementById('tailor-desc').focus();
    return;
  }
  if (tailorSource.kind === 'other' && !tailorSource.markdown) {
    showToast('Upload or paste the CV to tailor first');
    return;
  }
  // Tailoring again rebuilds the CV from the profile
  if (tailorWs.edited && !confirm('Tailoring again replaces the edits you made in Edit CV. Continue?')) return;

  button.disabled = true;
  button.textContent = ai ? 'Tailoring… (this can take up to a minute)' : 'Updating…';
  showGlobalLoader(ai ? 'Tailoring your CV…' : 'Updating your CV…');
  try {
    const res = await fetch(apiUrl('/api/tailor'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(65_000),
      body: JSON.stringify({ title, company, description, confirmedSkills: [...tailorConfirmed], ai, template: tailorLayout, styles: tailorWs.styles, profileMarkdown: tailorOneOffMarkdown() || undefined })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Tailoring failed');
    tailorResult = data;
    renderTailorResult();
  } catch (err) {
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    showToast(timedOut ? 'Tailoring took too long and was cancelled — try again.' : (err.message || 'Could not reach the server'));
  } finally {
    button.disabled = false;
    button.textContent = 'Tailor my CV';
    hideGlobalLoader();
  }
}

// The ring is the CV match: how much of what you meet the tailored CV shows (100% once
// tailored). Job fit (required skills you have at all) is shown underneath. Also called
// after each edit in Edit CV, since editing can remove a skill from the CV.
function renderTailorScore() {
  const r = tailorResult;
  const { analysis } = r;
  const req = analysis.matched.filter(m => m.required).length;
  const reqTotal = req + analysis.missing.filter(m => m.required).length;
  const cov = r.coverage || { cvScore: analysis.matchScore, cvShown: req, cvNeeded: req, notShown: [] };
  const ring = document.getElementById('tailor-score');
  ring.style.setProperty('--score', cov.cvScore);
  ring.classList.remove('good', 'fair', 'low');
  ring.classList.add(cov.cvScore >= 75 ? 'good' : cov.cvScore >= 50 ? 'fair' : 'low');
  document.getElementById('tailor-score-num').textContent = `${cov.cvScore}%`;
  const gaps = reqTotal - req;
  document.getElementById('tailor-score-text').innerHTML = !reqTotal
    ? 'No specific required skills were detected in this posting.'
    : (cov.cvScore === 100
      ? `This CV shows <strong>all ${cov.cvShown}</strong> of the posting's required skills that you meet.`
      : `This CV shows <strong>${cov.cvShown} of ${cov.cvNeeded}</strong> required skills you meet (missing: ${escapeHtml(cov.notShown.join(', '))}).`)
      + `<span class="tailor-fit">Job fit: you meet <strong>${req} of ${reqTotal}</strong> required skills (${analysis.matchScore}%)${gaps
        ? `. ${gaps === 1 ? 'One is' : `${gaps} are`} not in your profile: click <strong>+ I have this</strong> below if you have ${gaps === 1 ? 'it' : 'them'}.`
        : '.'}</span>`;
}

// The recruiter review: a recruiter's first read (score, missing keywords, red flags),
// the XYZ check of every bullet and the ATS / hiring-manager skim. Also called after
// each edit in Edit CV.
function renderTailorReview() {
  const card = document.getElementById('tailor-review');
  const rv = tailorResult && tailorResult.review;
  card.hidden = !rv;
  if (!rv) return;
  const band = (n, good, fair) => (n >= good ? 'good' : n >= fair ? 'fair' : 'low');
  const setBadge = (id, text, kind) => {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = `review-badge ${kind}`;
  };

  const { recruiter, xyz, skim } = rv;
  setBadge('review-score', `${recruiter.score}/100`, band(recruiter.score, 80, 60));
  document.getElementById('review-recruiter').innerHTML = `
    <ul class="review-parts">${recruiter.parts.map(p => `<li><span>${escapeHtml(p.label)} <small>(${escapeHtml(p.note)})</small></span><strong>${p.of ? `${p.points}/${p.of}` : p.points}</strong></li>`).join('')}</ul>
    <h3 class="review-sub">Most important missing keywords</h3>
    ${recruiter.missingKeywords.length
      ? `<div class="req-chips">${recruiter.missingKeywords.map(k => `<span class="req-chip gap">${escapeHtml(k.name)}${k.required ? '' : '<small>nice to have</small>'}</span>`).join('')}</div>`
      : '<p class="review-ok">None: the CV covers every keyword this posting names.</p>'}
    <h3 class="review-sub">Biggest red flags in the first 10 seconds</h3>
    ${recruiter.redFlags.length
      ? `<ul class="review-flags">${recruiter.redFlags.map(f => `<li><strong>${escapeHtml(f.title)}.</strong> ${escapeHtml(f.detail)}<span class="review-fix">${escapeHtml(f.fix)}</span></li>`).join('')}</ul>${recruiter.moreFlags ? `<p class="review-ok">${recruiter.moreFlags} smaller issue${recruiter.moreFlags > 1 ? 's' : ''} not shown.</p>` : ''}`
      : '<p class="review-ok">No red flags a recruiter would spot in 10 seconds.</p>'}`;

  setBadge('review-xyz-badge', `${xyz.full}/${xyz.total} full XYZ`, band(xyz.total ? xyz.full / xyz.total : 0, 0.7, 0.4));
  const tags = (list) => `<span class="review-tags">${list.map(x => `<span>no ${escapeHtml(x)}</span>`).join('')}</span>`;
  document.getElementById('review-xyz').innerHTML = `
    <p class="review-ok">Accomplished <strong>X</strong>, as measured by <strong>Y</strong>, by doing <strong>Z</strong>. ${xyz.quantified} of ${xyz.total} bullets have a measured result.</p>
    ${xyz.rewrites.length ? `<h3 class="review-sub">Rewritten for you</h3><ul class="review-list">${xyz.rewrites.map(w => `<li><span class="review-before">${escapeHtml(w.before)}</span><span class="review-after">${escapeHtml(w.after)}</span></li>`).join('')}</ul>` : ''}
    ${xyz.needNumbers.length
      ? `<h3 class="review-sub">Add a number to these</h3><ul class="review-list">${xyz.needNumbers.map(b => `<li><strong>${escapeHtml(b.where)}</strong>${tags(b.missing)}<br>${escapeHtml(b.text)}</li>`).join('')}</ul>
         <p class="review-ok">Only add numbers you can back up: % faster or cheaper, time saved, users or requests served, revenue, team size. Edit them in <strong>Edit CV</strong>.</p>`
      : '<p class="review-ok">Every bullet has a measured result.</p>'}`;

  const counts = skim.sections.reduce((c, s) => ({ ...c, [s.verdict]: (c[s.verdict] || 0) + 1 }), {});
  const worst = counts.reject ? 'low' : counts.skip ? 'fair' : 'good';
  setBadge('review-skim-badge', counts.reject ? `${counts.reject} reject` : `${counts.read || 0} read · ${counts.skim || 0} skim${counts.skip ? ` · ${counts.skip} skip` : ''}`, worst);
  document.getElementById('review-skim').innerHTML = `
    <p class="review-ok">About ${skim.pages} page${skim.pages > 1 ? 's' : ''}. What a reviewer with 200 CVs reads, skims, skips or rejects:</p>
    <ul class="review-list review-skim">${skim.sections.map(s => `<li><span class="verdict ${s.verdict}">${escapeHtml(s.verdict)}</span><span><strong>${escapeHtml(s.section)}</strong>: ${escapeHtml(s.reason)}${s.fix ? `<span class="review-fix">${escapeHtml(s.fix)}</span>` : ''}</span></li>`).join('')}</ul>`;
}

// The "Covered in your CV" and "Not in your profile" chips
function renderTailorChips() {
  const { analysis } = tailorResult;
  // Why a skill counts (or doesn't count) toward the score
  const tag = (m) => m.implied ? `via ${m.implied}`
    : m.soft ? 'soft skill'
    : m.note === 'alternative' ? 'alternative'
    : m.note === 'example' ? 'example'
    : m.required ? '' : 'nice to have';
  const label = (m) => `${escapeHtml(m.name)}${tag(m) ? `<small>${escapeHtml(tag(m))}</small>` : ''}`;
  const arg = (m) => escapeHtml(JSON.stringify(m.name));
  document.getElementById('tailor-matched').innerHTML = analysis.matched.length
    ? analysis.matched.map(m => m.confirmed
      ? `<button class="req-chip hit confirmed" onclick="toggleConfirmedSkill(${arg(m)})" title="You confirmed this skill. Click to remove it from the CV.">${label(m)}<span class="chip-x" aria-hidden="true">×</span></button>`
      : `<span class="req-chip hit"${m.implied ? ` title="Your profile shows this through ${escapeHtml(m.implied)}"` : ''}>${label(m)}</span>`).join('')
    : '<span class="muted">None detected</span>';
  document.getElementById('tailor-missing').innerHTML = analysis.missing.length
    ? analysis.missing.map(m => `<button class="req-chip gap" onclick="toggleConfirmedSkill(${arg(m)})" title="Add this skill to your CV if you really have it">${label(m)}<span class="chip-add">+ I have this</span></button>`).join('')
    : '<span class="muted">No gaps - you cover everything we detected.</span>';
  document.getElementById('tailor-gap-block').hidden = false;
}

function renderTailorResult() {
  const r = tailorResult;
  renderTailorScore();
  renderTailorReview();
  renderTailorChips();

  document.getElementById('tailor-changes').innerHTML = r.changes.map(c => `<li>${escapeHtml(c)}</li>`).join('');
  renderTailorAiNote(r.ai || {});

  document.getElementById('tailor-analysis').hidden = false;
  document.getElementById('tailor-empty').hidden = true;
  document.getElementById('tailor-preview').hidden = false;
  document.getElementById('tailor-file').textContent = r.filename;
  renderLayoutPicker();
  // The tailored CV is now what Edit CV and the style toolbar work on
  cveLoadTailored(r);
  renderTailorPreview();
}

// Says whether AI rewrote this CV; stays quiet (no banner) when it didn't, rather than
// surfacing an internal error (token budget, rate limit, provider name) to the user
function renderTailorAiNote(ai) {
  const note = document.getElementById('tailor-ai-note');
  if (ai.used) {
    note.className = 'tailor-ai-note ok';
    note.innerHTML = '<strong>Rewritten by AI</strong> for this job, using only facts from your profile and skills you confirmed.';
    note.hidden = false;
    return;
  }
  note.hidden = true;
}

function renderTailorPreview() {
  if (!tailorResult) return;
  const frame = document.getElementById('tailor-frame');
  const highlight = document.getElementById('tailor-highlight').checked;
  frame.srcdoc = cvDocument(currentLayout().html, cvTitle(), highlight);
  frame.onload = () => {
    frame.style.height = `${frame.contentDocument.documentElement.scrollHeight}px`;
  };
}

function cvTitle() {
  const { title, company } = tailorResult.job;
  return `${tailorResult.cv.name} - CV${company ? ` - ${company}` : ''}${title ? ` - ${title}` : ''}`;
}

// Real PDF compiled from the chosen LaTeX layout (with your edits and styling)
function downloadTailoredPdf(button) {
  if (!tailorResult) return;
  cveDownloadPdf(tailorWs, button, printTailoredPdf);
}

// Fallback: print the preview ("Save as PDF" in the print dialog)
function printTailoredPdf() {
  if (!tailorResult) return;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  frame.srcdoc = cvDocument(currentLayout().html, cvTitle(), false);
  frame.onload = () => {
    // Let the web font settle before printing
    setTimeout(() => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 1000);
    }, 400);
  };
  showToast('Choose "Save as PDF" in the print dialog');
}

function downloadTailoredTex() {
  if (!tailorResult) return;
  const blob = new Blob([currentLayout().latex], { type: 'application/x-tex' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = tailorResult.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function saveTailoredToProject() {
  if (!tailorResult) return;
  const { title, company } = tailorResult.job;
  try {
    const res = await fetch(apiUrl('/api/tailor'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      // The exact CV on screen (latex + filename); title/description for the local dashboard server
      body: JSON.stringify({ title, company, description: document.getElementById('tailor-desc').value, confirmedSkills: [...tailorConfirmed], save: true, latex: currentLayout().latex, filename: tailorResult.filename })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(`Saved to ${data.savedTo}`);
  } catch (err) {
    showToast(err.message || 'Save failed');
  }
}

function copyTailoredText() {
  if (!tailorResult) return;
  navigator.clipboard.writeText(tailorResult.text)
    .then(() => showToast('CV copied as plain text'))
    .catch(() => showToast('Copy failed'));
}
