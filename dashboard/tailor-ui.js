// Tailor CV tab - builds a job-specific CV from the profile via /api/tailor.
// Kept separate from app.js; relies only on its shared helpers
// (switchTab, showToast, escapeHtml, PAGES).

PAGES.tailor = ['Tailor CV', 'Reshape your CV around a specific job description.'];

let tailorResult = null;

const CV_DOC_CSS = `
  @page { size: A4; margin: 16mm 16mm 18mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1d2433; font-size: 10pt; line-height: 1.45; background: #fff; }
  .page { padding: 40px 44px 48px; }
  .cv-header { border-bottom: 2px solid #2f4ea8; padding-bottom: 12px; margin-bottom: 14px; }
  h1 { font-size: 24pt; font-weight: 700; letter-spacing: -0.02em; color: #1f3a8a; line-height: 1.1; }
  .cv-headline { font-size: 11.5pt; font-weight: 500; color: #3b4658; margin-top: 4px; }
  .cv-contact { font-size: 9.5pt; color: #5b6475; margin-top: 6px; }
  .cv-contact span { margin: 0 6px; color: #a0a7b4; }
  section { margin-top: 12px; }
  h2 { font-size: 9.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #1f3a8a; margin-bottom: 6px; }
  p { color: #2b3445; }
  ul { padding-left: 16px; }
  li { margin: 2px 0; color: #2b3445; }
  li::marker { color: #8a93a5; }
  .cv-skills { list-style: none; padding-left: 0; }
  .cv-skills li { margin: 2px 0; }
  .cv-job { margin-top: 10px; break-inside: avoid; }
  .cv-job:first-of-type { margin-top: 0; }
  .cv-job-head { display: flex; justify-content: space-between; gap: 12px; margin-top: 4px; }
  .cv-job-head span { color: #5b6475; white-space: nowrap; font-size: 9.5pt; }
  .cv-job-loc { font-size: 9.5pt; color: #6b7384; margin-bottom: 2px; }
  strong { font-weight: 600; color: #1d2433; }
  mark { background: none; color: inherit; }
  body.highlight mark { background: #fff2b3; border-radius: 2px; box-shadow: 0 0 0 1px #fff2b3; }
  @media print { .page { padding: 0; } body.highlight mark { background: none; box-shadow: none; } }
`;

function cvDocument(html, title, highlight) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap">
<style>${CV_DOC_CSS}</style></head><body class="${highlight ? 'highlight' : ''}"><div class="page">${html}</div></body></html>`;
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

async function runTailor() {
  const title = document.getElementById('tailor-title').value.trim();
  const company = document.getElementById('tailor-company').value.trim();
  const description = document.getElementById('tailor-desc').value.trim();
  const button = document.getElementById('tailor-run');

  if (!description) {
    showToast('Paste the job description first');
    document.getElementById('tailor-desc').focus();
    return;
  }

  button.disabled = true;
  button.textContent = 'Tailoring…';
  try {
    const res = await fetch(apiUrl('/api/tailor'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, company, description })
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

function renderTailorResult() {
  const r = tailorResult;
  const { analysis } = r;
  const req = analysis.matched.filter(m => m.required).length;
  const reqTotal = req + analysis.missing.filter(m => m.required).length;

  const ring = document.getElementById('tailor-score');
  ring.style.setProperty('--score', analysis.matchScore);
  ring.classList.remove('good', 'fair', 'low');
  ring.classList.add(analysis.matchScore >= 75 ? 'good' : analysis.matchScore >= 50 ? 'fair' : 'low');
  document.getElementById('tailor-score-num').textContent = `${analysis.matchScore}%`;
  document.getElementById('tailor-score-text').innerHTML = reqTotal
    ? `You cover <strong>${req} of ${reqTotal}</strong> required skills in this posting.`
    : `No specific required skills were detected in this posting.`;

  const chip = (m, kind) => `<span class="req-chip ${kind}">${escapeHtml(m.name)}${m.required ? '' : '<small>nice to have</small>'}</span>`;
  document.getElementById('tailor-matched').innerHTML = analysis.matched.length
    ? analysis.matched.map(m => chip(m, 'hit')).join('')
    : '<span class="muted">None detected</span>';
  document.getElementById('tailor-missing').innerHTML = analysis.missing.length
    ? analysis.missing.map(m => chip(m, 'gap')).join('')
    : '<span class="muted">No gaps - you cover everything we detected.</span>';
  document.getElementById('tailor-gap-block').hidden = false;

  document.getElementById('tailor-changes').innerHTML = r.changes.map(c => `<li>${escapeHtml(c)}</li>`).join('');

  document.getElementById('tailor-analysis').hidden = false;
  document.getElementById('tailor-empty').hidden = true;
  document.getElementById('tailor-preview').hidden = false;
  document.getElementById('tailor-file').textContent = r.filename;
  renderTailorPreview();
}

function renderTailorPreview() {
  if (!tailorResult) return;
  const frame = document.getElementById('tailor-frame');
  const highlight = document.getElementById('tailor-highlight').checked;
  frame.srcdoc = cvDocument(tailorResult.html, cvTitle(), highlight);
  frame.onload = () => {
    frame.style.height = `${frame.contentDocument.documentElement.scrollHeight}px`;
  };
}

function cvTitle() {
  const { title, company } = tailorResult.job;
  return `${tailorResult.cv.name} - CV${company ? ` - ${company}` : ''}${title ? ` - ${title}` : ''}`;
}

function downloadTailoredPdf() {
  if (!tailorResult) return;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  frame.srcdoc = cvDocument(tailorResult.html, cvTitle(), false);
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
  const blob = new Blob([tailorResult.latex], { type: 'application/x-tex' });
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
      body: JSON.stringify({ title, company, description: document.getElementById('tailor-desc').value, save: true })
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
