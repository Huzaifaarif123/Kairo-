// Tailor CV tab - builds a job-specific CV from the profile via /api/tailor.
// Kept separate from app.js; relies only on its shared helpers
// (switchTab, showToast, escapeHtml, PAGES).

PAGES.tailor = ['Tailor CV', 'Reshape your CV around a specific job description.'];

let tailorResult = null;

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
  // Tailoring again rebuilds the CV from the profile
  if (tailorWs.edited && !confirm('Tailoring again replaces the edits you made in Edit CV. Continue?')) return;

  button.disabled = true;
  button.textContent = ai ? 'Tailoring… (this can take up to a minute)' : 'Updating…';
  try {
    const res = await fetch(apiUrl('/api/tailor'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, company, description, confirmedSkills: [...tailorConfirmed], ai, template: tailorLayout, styles: tailorWs.styles })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Tailoring failed');
    tailorResult = data;
    renderTailorResult();
  } catch (err) {
    showToast(err.message || 'Could not reach the server');
  } finally {
    button.disabled = false;
    button.textContent = 'Tailor my CV';
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

function renderTailorResult() {
  const r = tailorResult;
  const { analysis } = r;
  renderTailorScore();

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

// Says whether Claude rewrote this CV, and why not when it didn't
function renderTailorAiNote(ai) {
  const note = document.getElementById('tailor-ai-note');
  let html = '';
  let kind = 'info';
  if (ai.used) {
    html = '<strong>Rewritten by Claude</strong> for this job, using only facts from your profile and skills you confirmed.';
    kind = 'ok';
  } else if (ai.error) {
    html = `<strong>Claude's rewrite isn't available:</strong> ${escapeHtml(ai.error)} Showing the rule-based CV. <button class="btn-link" onclick="runTailor()">Try again</button>`;
    kind = 'warn';
  } else if (ai.configured) {
    html = 'Skills and score updated. <button class="btn-link" onclick="runTailor()">Rewrite with Claude</button> to update the wording too.';
  } else {
    html = 'Rule-based CV: your bullets are selected and reordered, not reworded. Add an Anthropic API key to the server to have Claude rewrite the CV for each job.';
  }
  note.className = `tailor-ai-note ${kind}`;
  note.innerHTML = html;
  note.hidden = false;
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
