// CV editing and styling (ported from the CV adjustment kit's InlineEditor, the section
// editors and PreviewToolbar). Used in two places:
//   - Tailor CV: an "Edit CV" panel and a style toolbar for the tailored CV
//   - CV Editor tab: build and style a CV on your own, from the profile or from scratch
// Relies on app.js helpers (escapeHtml, showToast, apiUrl, PAGES, activeProfile).

PAGES['cv-editor'] = ['CV Editor', 'Edit and style your CV yourself, starting from your profile or a blank page.'];

const CVE_FONTS = [['template', 'Template font'], ['helvetica', 'Helvetica'], ['times', 'Times'], ['palatino', 'Palatino'], ['century-gothic', 'Century Gothic']];
const CVE_SIZES = [10, 11, 12];
const CVE_ACCENTS = ['#111111', '#1F4E79', '#0F766E', '#A81450', '#B45309', '#4C1D95', '#166534', '#6B7280'];
const CVE_LINE = [[1, 'Single'], [1.15, '1.15'], [1.3, '1.3'], [1.5, '1.5']];
const CVE_GAP = [[0.7, 'Compact'], [1, 'Normal'], [1.3, 'Relaxed'], [1.6, 'Airy']];
const CVE_SECTION_IDS = ['summary', 'experience', 'education', 'skills', 'projects', 'certifications'];
const CVE_SECTION_LABELS = { summary: 'Summary', experience: 'Experience', education: 'Education', skills: 'Skills', projects: 'Projects', certifications: 'Certifications' };
const CVE_PANELS = [
  ['personal', 'Personal information'], ['summary', 'Professional summary'], ['experience', 'Work experience'],
  ['education', 'Education'], ['skills', 'Skills'], ['projects', 'Projects'], ['certifications', 'Certifications']
];

// ---------- Workspaces ----------

// One CV being edited, with its per-layout style choices and last render
function cveWorkspace(opts) {
  return Object.assign({ cv: null, styles: {}, layout: 'ats-classic', result: null, timer: null, seq: 0, open: 'personal', edited: false, menu: null, aiNotes: {}, aiDrafts: {}, aiUndo: [] }, opts);
}

const tailorWs = cveWorkspace({
  key: 'tailor',
  // "Another CV" on the Tailor page stands in for the profile
  oneOff: () => (typeof tailorOneOffMarkdown === 'function' ? tailorOneOffMarkdown() : ''),
  editorId: 'tailor-editor-body',
  barId: 'tailor-style-bar',
  job: () => ({
    title: document.getElementById('tailor-title').value.trim(),
    company: document.getElementById('tailor-company').value.trim(),
    description: document.getElementById('tailor-desc').value.trim(),
    confirmedSkills: typeof tailorConfirmed !== 'undefined' ? [...tailorConfirmed] : []
  }),
  onRendered(data) {
    if (!tailorResult) return;
    Object.assign(tailorResult, { cv: data.cv, layouts: data.layouts, text: data.text, html: data.html, css: data.css, latex: data.latex });
    if (data.coverage) tailorResult.coverage = data.coverage;
    if (data.review) {
      // Keep the list of wording fixes made when the CV was tailored
      const rewrites = tailorResult.review && tailorResult.review.xyz ? tailorResult.review.xyz.rewrites : [];
      tailorResult.review = { ...data.review, xyz: { ...data.review.xyz, rewrites } };
    }
    if (typeof renderTailorScore === 'function') renderTailorScore();
    if (typeof renderTailorReview === 'function') renderTailorReview();
    if (typeof instructSync === 'function') instructSync();
    renderTailorPreview();
  }
});

const ownWs = cveWorkspace({
  key: 'own',
  editorId: 'own-editor-body',
  barId: 'own-style-bar',
  job: () => ({}),
  onRendered() {
    renderOwnPreview();
    cveSaveDraft(ownWs);
  }
});

function cveLayoutDefaults(ws) {
  const layouts = (ws.result && ws.result.layouts) || {};
  return (layouts[ws.layout] && layouts[ws.layout].defaults) || { fontFamily: 'template', fontSize: 10, headerAlign: 'center', accentColor: '#000000', lineSpacing: 1, sectionSpacing: 1, boldHeadings: true, italicHeadings: false, sections: CVE_SECTION_IDS };
}

function cveStyle(ws) {
  return Object.assign({}, cveLayoutDefaults(ws), ws.styles[ws.layout] || {});
}

// Re-render on the server after a change (debounced; stale answers are ignored)
function cveRender(ws, delay = 500) {
  clearTimeout(ws.timer);
  ws.timer = setTimeout(async () => {
    const seq = ++ws.seq;
    try {
      const res = await fetch(apiUrl('/api/cv/render'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv: ws.cv, styles: ws.styles, template: ws.layout, job: ws.job(), profileMarkdown: ws.oneOff ? ws.oneOff() || undefined : undefined })
      });
      const data = await res.json();
      if (seq !== ws.seq) return;
      if (!res.ok) throw new Error(data.error || 'Could not update the preview');
      ws.result = data;
      ws.onRendered(data);
    } catch (err) {
      if (seq === ws.seq) showToast(err.message || 'Could not update the preview');
    }
  }, delay);
}

// ---------- Style toolbar ----------

function cveSetStyle(ws, patch) {
  ws.styles[ws.layout] = Object.assign({}, ws.styles[ws.layout] || {}, patch);
  renderStyleBar(ws);
  cveRender(ws, 120);
}

function cveResetStyle(ws) {
  delete ws.styles[ws.layout];
  ws.menu = null;
  renderStyleBar(ws);
  cveRender(ws, 0);
}

function cveToggleMenu(ws, name) {
  ws.menu = ws.menu === name ? null : name;
  renderStyleBar(ws);
}

function cveMoveSection(ws, id, dir) {
  const order = [...cveStyle(ws).sections];
  const from = order.indexOf(id), to = from + dir;
  if (from < 0 || to < 0 || to >= order.length) return;
  [order[from], order[to]] = [order[to], order[from]];
  cveSetStyle(ws, { sections: order });
}

function cveToggleSection(ws, id) {
  const shown = cveStyle(ws).sections;
  if (shown.includes(id)) {
    if (shown.length === 1) return showToast('A CV needs at least one section');
    cveSetStyle(ws, { sections: shown.filter(x => x !== id) });
  } else {
    cveSetStyle(ws, { sections: [...shown, id] });
  }
}

function renderStyleBar(ws) {
  const bar = document.getElementById(ws.barId);
  if (!bar) return;
  if (!ws.result) { bar.hidden = true; return; }
  bar.hidden = false;
  const s = cveStyle(ws);
  const touched = Boolean(ws.styles[ws.layout] && Object.keys(ws.styles[ws.layout]).length);
  const w = `CVE_WS['${ws.key}']`;
  const opt = (value, label, current) => `<option value="${escapeHtml(String(value))}"${String(value) === String(current) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const toggle = (on, label, title, action) => `<button type="button" class="sb-btn${on ? ' on' : ''}" aria-pressed="${on}" title="${title}" onclick="${action}">${label}</button>`;
  const hidden = CVE_SECTION_IDS.filter(id => !s.sections.includes(id));

  bar.innerHTML = `
    <button type="button" class="sb-btn" title="Reset to this layout's own styling" onclick="cveResetStyle(${w})" ${touched ? '' : 'disabled'}>↺</button>
    <span class="sb-sep"></span>
    <select class="input sb-select" aria-label="Font" onchange="cveSetStyle(${w}, { fontFamily: this.value })">${CVE_FONTS.map(([v, l]) => opt(v, l, s.fontFamily)).join('')}</select>
    <select class="input sb-select sb-narrow" aria-label="Font size" onchange="cveSetStyle(${w}, { fontSize: Number(this.value) })">${CVE_SIZES.map(v => opt(v, `${v} pt`, s.fontSize)).join('')}</select>
    <span class="sb-sep"></span>
    ${toggle(s.boldHeadings, '<b>B</b>', 'Bold section headings', `cveSetStyle(${w}, { boldHeadings: ${!s.boldHeadings} })`)}
    ${toggle(s.italicHeadings, '<i>I</i>', 'Italic section headings', `cveSetStyle(${w}, { italicHeadings: ${!s.italicHeadings} })`)}
    <span class="sb-sep"></span>
    ${[['left', '⇤', 'Header left'], ['center', '↔', 'Header centred'], ['right', '⇥', 'Header right']].map(([a, icon, t]) => toggle(s.headerAlign === a, icon, t, `cveSetStyle(${w}, { headerAlign: '${a}' })`)).join('')}
    <span class="sb-sep"></span>
    <div class="sb-pop">
      <button type="button" class="sb-btn" title="Accent colour" aria-expanded="${ws.menu === 'colour'}" onclick="cveToggleMenu(${w}, 'colour')"><span class="sb-swatch" style="background:${escapeHtml(s.accentColor)}"></span></button>
      ${ws.menu === 'colour' ? `<div class="sb-menu sb-colours">
        ${CVE_ACCENTS.map(c => `<button type="button" class="sb-colour${c.toLowerCase() === String(s.accentColor).toLowerCase() ? ' on' : ''}" style="background:${c}" title="${c}" aria-label="Accent ${c}" onclick="cveSetStyle(${w}, { accentColor: '${c}' }); CVE_WS['${ws.key}'].menu = null; renderStyleBar(${w})"></button>`).join('')}
        <label class="sb-custom">Custom <input type="color" value="${escapeHtml(s.accentColor)}" onchange="cveSetStyle(${w}, { accentColor: this.value })"></label>
      </div>` : ''}
    </div>
    <select class="input sb-select" aria-label="Line spacing" title="Line spacing" onchange="cveSetStyle(${w}, { lineSpacing: Number(this.value) })">${CVE_LINE.map(([v, l]) => opt(v, `Lines: ${l}`, s.lineSpacing)).join('')}</select>
    <select class="input sb-select" aria-label="Space between sections" title="Space between sections" onchange="cveSetStyle(${w}, { sectionSpacing: Number(this.value) })">${CVE_GAP.map(([v, l]) => opt(v, `Sections: ${l}`, s.sectionSpacing)).join('')}</select>
    <div class="sb-pop sb-right">
      <button type="button" class="sb-btn sb-text" aria-expanded="${ws.menu === 'sections'}" onclick="cveToggleMenu(${w}, 'sections')">Sections ▾</button>
      ${ws.menu === 'sections' ? `<div class="sb-menu sb-sections">
        <p class="sb-menu-label">Shown, in order</p>
        ${s.sections.map((id, i) => `<div class="sb-row">
          <label><input type="checkbox" checked onchange="cveToggleSection(${w}, '${id}')"> ${CVE_SECTION_LABELS[id]}</label>
          <button type="button" aria-label="Move ${CVE_SECTION_LABELS[id]} up" onclick="cveMoveSection(${w}, '${id}', -1)" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" aria-label="Move ${CVE_SECTION_LABELS[id]} down" onclick="cveMoveSection(${w}, '${id}', 1)" ${i === s.sections.length - 1 ? 'disabled' : ''}>↓</button>
        </div>`).join('')}
        ${hidden.length ? `<p class="sb-menu-label">Hidden</p>${hidden.map(id => `<button type="button" class="sb-add" onclick="cveToggleSection(${w}, '${id}')">+ ${CVE_SECTION_LABELS[id]}</button>`).join('')}` : ''}
      </div>` : ''}
    </div>`;
}

// Close an open style menu when clicking elsewhere
document.addEventListener('mousedown', (e) => {
  for (const ws of Object.values(CVE_WS)) {
    if (ws.menu && !e.target.closest(`#${ws.barId} .sb-pop`)) {
      ws.menu = null;
      renderStyleBar(ws);
    }
  }
});

// ---------- Content editor ----------

const CVE_BLANK = {
  experience: () => ({ role: '', company: '', period: '', location: '', bullets: [''] }),
  education: () => ({ degree: '', school: '', period: '' }),
  skills: () => ({ group: '', items: [] }),
  projects: () => ({ name: '', desc: '', bullets: [''], tech: [] })
};

function cveBlankCV() {
  return { name: '', headline: '', tagline: [], email: '', phone: '', location: '', linkedin: '', github: '', summary: '', skills: [CVE_BLANK.skills()], experience: [CVE_BLANK.experience()], projects: [], education: [CVE_BLANK.education()], certifications: [], languages: [] };
}

// "2021 – Present" -> ['2021', 'Present']
function cvePeriodParts(period) {
  const parts = String(period || '').split(/\s+[–—-]\s+|\s+to\s+|[–—]/i).map(x => x.trim());
  return [parts[0] || '', parts.slice(1).join(' ') || ''];
}

function cveGet(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function cveSet(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

// Updates the CV from one form field (no re-render of the form, so typing keeps focus)
function cveField(ws, el) {
  const path = el.dataset.f;
  const kind = el.dataset.t || 'text';
  const v = el.value;
  if (kind === 'lines') cveSet(ws.cv, path, v.split('\n'));
  else if (kind === 'csv') cveSet(ws.cv, path, v.split(',').map(x => x.trim()).filter(Boolean));
  else if (kind === 'skills') cveSet(ws.cv, path, v.split(',').map(x => x.trim()).filter(Boolean).map(name => ({ name })));
  else if (kind === 'start' || kind === 'end') {
    const [start, end] = cvePeriodParts(cveGet(ws.cv, path));
    const next = kind === 'start' ? [v.trim(), end] : [start, v.trim()];
    cveSet(ws.cv, path, next[0] && next[1] ? `${next[0]} – ${next[1]}` : next[0] || next[1]);
  } else cveSet(ws.cv, path, v);
  // A project's description follows its bullets
  const pm = path.match(/^projects\.(\d+)\.bullets$/);
  if (pm) ws.cv.projects[pm[1]].desc = ws.cv.projects[pm[1]].bullets.filter(b => b.trim()).join(' ');
  ws.edited = true;
  cveRender(ws, 600);
}

function cveAction(ws, act, section, index) {
  const listOf = (name) => (ws.cv[name] = ws.cv[name] || []);
  const arr = listOf(section);
  const i = Number(index);
  if (act === 'add') arr.push(CVE_BLANK[section] ? CVE_BLANK[section]() : '');
  if (act === 'remove') arr.splice(i, 1);
  if (act === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
  if (act === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
  ws.edited = true;
  renderEditor(ws);
  cveRender(ws, 150);
}

function cveOpen(ws, panel) {
  ws.open = ws.open === panel ? '' : panel;
  renderEditor(ws);
}

function renderEditor(ws) {
  const box = document.getElementById(ws.editorId);
  if (!box || !ws.cv) return;
  const cv = ws.cv;
  const w = `CVE_WS['${ws.key}']`;
  const v = (x) => escapeHtml(x == null ? '' : String(x));
  const field = (label, path, value, kind = 'text', ph = '', type = 'text') => `
    <label class="cve-field"><span>${label}</span><input class="input" type="${type}" data-f="${path}" data-t="${kind}" value="${v(value)}" placeholder="${v(ph)}" autocomplete="off"></label>`;
  const area = (label, path, value, kind = 'text', ph = '', rows = 4) => `
    <label class="cve-field cve-wide"><span>${label}</span><textarea class="input" rows="${rows}" data-f="${path}" data-t="${kind}" placeholder="${v(ph)}">${v(value)}</textarea></label>`;
  const itemTools = (section, i, n) => `<div class="cve-tools">
    <button type="button" onclick="cveAction(${w}, 'up', '${section}', ${i})" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
    <button type="button" onclick="cveAction(${w}, 'down', '${section}', ${i})" ${i === n - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
    <button type="button" class="cve-remove" onclick="cveAction(${w}, 'remove', '${section}', ${i})">Remove</button></div>`;
  // "Ask AI to change this section": what's typed here changes this section only
  const AI_HINTS = {
    personal: 'e.g. "phone +92 300 1234567", "headline: Lead AI Engineer"',
    summary: 'e.g. "make it shorter", "mention that I work across AI and cloud", "improve it"',
    skills: 'e.g. "Kafka, Terraform" or "remove PHP"',
    experience: 'e.g. "led a team of 4 on the billing service", "improve these points", "add more skills here"',
    projects: 'e.g. "built a WhatsApp agent for 500 clinics", "remove the point about X"',
    education: 'e.g. "MSc Data Science, LUMS, 2020"',
    certifications: 'e.g. "AWS Certified Developer – Associate"'
  };
  const aiBox = (section, i = 0, what = 'this section') => {
    const key = `${section}:${i}`;
    const id = `cve-ai-${ws.key}-${section}-${i}`;
    return `<div class="cve-ai">
      <label class="cve-ai-label" for="${id}">Ask AI to change ${v(what)}</label>
      <div class="cve-ai-row">
        <textarea class="input cve-ai-box" id="${id}" rows="1" placeholder="${v(AI_HINTS[section])}" onkeydown="cveAiKey(event, '${ws.key}', '${section}', ${i})">${v(ws.aiDrafts[key] || '')}</textarea>
        <button type="button" class="btn btn-primary cve-ai-go" onclick="cveAiApply('${ws.key}', '${section}', ${i}, this)">Apply</button>
      </div>
      ${ws.aiNotes[key] ? `<div class="cve-ai-note">${ws.aiNotes[key]}</div>` : ''}
    </div>`;
  };
  const addBtn = (section, label) => `<button type="button" class="btn btn-secondary cve-add" onclick="cveAction(${w}, 'add', '${section}')">+ ${label}</button>`;

  const bodies = {
    personal: () => `<div class="cve-grid">
      ${field('Full name', 'name', cv.name, 'text', 'e.g. Amir Sharif')}
      ${field('Headline', 'headline', cv.headline, 'text', 'e.g. Senior AI Engineer')}
      ${field('Email', 'email', cv.email, 'text', 'you@example.com', 'email')}
      ${field('Phone', 'phone', cv.phone, 'text', '+92 300 0000000', 'tel')}
      ${field('Location', 'location', cv.location, 'text', 'City, Country')}
      ${field('LinkedIn', 'linkedin', cv.linkedin, 'text', 'linkedin.com/in/you')}
      ${field('GitHub', 'github', cv.github, 'text', 'github.com/you')}
      ${field('Key skills line', 'tagline', (cv.tagline || []).join(', '), 'csv', 'Python, LLMs, RAG, AWS')}
    </div><p class="cve-hint">The key skills line appears under the headline in layouts that have one.</p>${aiBox('personal', 0, 'your details')}`,
    summary: () => `${area('Summary', 'summary', cv.summary, 'text', '3–4 sentences about your experience and strengths.', 6)}${aiBox('summary', 0, 'the summary')}`,
    experience: () => `${(cv.experience || []).map((x, i, all) => {
      const [start, end] = cvePeriodParts(x.period);
      return `<div class="cve-item"><div class="cve-item-head"><strong>${v(x.role || 'New role')}${x.company ? ` · ${v(x.company)}` : ''}</strong>${itemTools('experience', i, all.length)}</div>
        <div class="cve-grid">
          ${field('Job title', `experience.${i}.role`, x.role)}
          ${field('Company', `experience.${i}.company`, x.company)}
          ${field('Start', `experience.${i}.period`, start, 'start', 'e.g. Mar 2022')}
          ${field('End', `experience.${i}.period`, end, 'end', 'e.g. Present')}
          ${field('Location', `experience.${i}.location`, x.location, 'text', 'City, Country / Remote')}
        </div>
        ${area('Achievements — one per line', `experience.${i}.bullets`, (x.bullets || []).join('\n'), 'lines', 'Start each with a verb and include the result.', 5)}
        ${aiBox('experience', i, `this job${x.company ? ` (${x.company})` : ''}`)}</div>`;
    }).join('')}${addBtn('experience', 'Add role')}`,
    education: () => `${(cv.education || []).map((e, i, all) => `<div class="cve-item"><div class="cve-item-head"><strong>${v(e.degree || 'New entry')}</strong>${itemTools('education', i, all.length)}</div>
        <div class="cve-grid">
          ${field('Degree', `education.${i}.degree`, e.degree, 'text', 'e.g. BSc Computer Science')}
          ${field('School', `education.${i}.school`, e.school)}
          ${field('Dates', `education.${i}.period`, e.period, 'text', 'e.g. 2014 – 2018')}
        </div></div>`).join('')}${addBtn('education', 'Add education')}${aiBox('education', 0, 'your education')}`,
    skills: () => `${(cv.skills || []).map((g, i, all) => `<div class="cve-item"><div class="cve-item-head"><strong>${v(g.group || 'New group')}</strong>${itemTools('skills', i, all.length)}</div>
        <div class="cve-grid">
          ${field('Category', `skills.${i}.group`, g.group, 'text', 'e.g. Languages')}
        </div>
        ${area('Skills — separated by commas', `skills.${i}.items`, (g.items || []).map(s => (typeof s === 'string' ? s : s.name)).join(', '), 'skills', 'Python, TypeScript, SQL', 2)}</div>`).join('')}${addBtn('skills', 'Add skill group')}${aiBox('skills', 0, 'your skills')}`,
    projects: () => `${(cv.projects || []).map((pr, i, all) => `<div class="cve-item"><div class="cve-item-head"><strong>${v(pr.name || 'New project')}</strong>${itemTools('projects', i, all.length)}</div>
        <div class="cve-grid">
          ${field('Project name', `projects.${i}.name`, pr.name)}
          ${field('Technologies', `projects.${i}.tech`, (pr.tech || []).join(', '), 'csv', 'Next.js, Python')}
        </div>
        ${area('Description — one point per line', `projects.${i}.bullets`, (pr.bullets && pr.bullets.length ? pr.bullets : [pr.desc || '']).join('\n'), 'lines', 'What it is and what you built.', 3)}
        ${aiBox('projects', i, `this project${pr.name ? ` (${pr.name})` : ''}`)}</div>`).join('')}${addBtn('projects', 'Add project')}`,
    certifications: () => `${area('Certifications — one per line', 'certifications', (cv.certifications || []).join('\n'), 'lines', 'e.g. AWS Certified Developer — Amazon Web Services (2022)', 4)}${aiBox('certifications', 0, 'your certifications')}`
  };

  box.innerHTML = CVE_PANELS.map(([id, label]) => `
    <div class="cve-panel${ws.open === id ? ' open' : ''}">
      <button type="button" class="cve-panel-head" aria-expanded="${ws.open === id}" onclick="cveOpen(${w}, '${id}')"><span>${label}</span><span class="cve-chevron">▾</span></button>
      ${ws.open === id ? `<div class="cve-panel-body">${bodies[id]()}</div>` : ''}
    </div>`).join('');
}

// Typing in any editor field updates that workspace's CV
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-f]');
  if (!el) return;
  const ws = Object.values(CVE_WS).find(x => el.closest(`#${x.editorId}`));
  if (ws) cveField(ws, el);
});

const CVE_WS = { tailor: tailorWs, own: ownWs };

// ---------- Tailor CV: edit the tailored CV ----------

// Called after each tailoring run
function cveLoadTailored(result) {
  tailorWs.cv = JSON.parse(JSON.stringify(result.cv));
  tailorWs.result = result;
  tailorWs.layout = typeof tailorLayout !== 'undefined' ? tailorLayout : result.template;
  tailorWs.edited = false;
  if (typeof instructLoaded === 'function') instructLoaded(result);
  renderStyleBar(tailorWs);
  if (!document.getElementById('tailor-edit-card').hidden) renderEditor(tailorWs);
}

function toggleTailorEditor() {
  const card = document.getElementById('tailor-edit-card');
  card.hidden = !card.hidden;
  if (!card.hidden) {
    renderEditor(tailorWs);
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ---------- CV Editor tab: your own CV ----------

const draftKey = () => `kairo.cvDraft.${typeof activeProfile !== 'undefined' ? activeProfile : 'default'}`;
let cveDraftTimer = null;

function cveSaveDraft(ws) {
  clearTimeout(cveDraftTimer);
  cveDraftTimer = setTimeout(() => {
    try {
      localStorage.setItem(draftKey(), JSON.stringify({ cv: ws.cv, styles: ws.styles, layout: ws.layout, savedAt: new Date().toISOString() }));
      const note = document.getElementById('own-draft-note');
      if (note) note.textContent = `Draft saved on this device at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
    } catch (e) { /* storage full or blocked: the editor still works */ }
  }, 400);
}

function cveReadDraft() {
  try { return JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch (e) { return null; }
}

// Opens the CV Editor: the saved draft if there is one, otherwise the profile
async function openCvEditor() {
  if (ownWs.cv && ownWs.profile === activeProfile) return;
  const draft = cveReadDraft();
  if (draft && draft.cv) {
    ownWs.cv = draft.cv;
    ownWs.styles = draft.styles || {};
    ownWs.layout = draft.layout || ownWs.layout;
    ownWs.profile = activeProfile;
    cveShowOwn();
    renderEditor(ownWs);
    cveRender(ownWs, 0);
    return;
  }
  await ownStartFromProfile(true);
}

async function ownStartFromProfile(silent) {
  if (!silent && ownWs.cv && !confirm('Replace the CV in the editor with a fresh copy of your profile?')) return;
  try {
    const res = await fetch(apiUrl('/api/cv/from-profile'));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load your profile');
    ownWs.cv = data.cv;
    ownWs.result = data;
    ownWs.profile = activeProfile;
    ownWs.open = 'personal';
    cveShowOwn();
    renderEditor(ownWs);
    renderStyleBar(ownWs);
    renderOwnPreview();
    cveSaveDraft(ownWs);
    if (!silent) showToast('Loaded your profile into the editor');
  } catch (err) {
    showToast(err.message || 'Could not load your profile');
    if (!ownWs.cv) ownStartBlank(true);
  }
}

function ownStartBlank(silent) {
  if (!silent && ownWs.cv && !confirm('Start a blank CV? The current draft will be replaced.')) return;
  ownWs.cv = cveBlankCV();
  ownWs.profile = activeProfile;
  ownWs.open = 'personal';
  cveShowOwn();
  renderEditor(ownWs);
  cveRender(ownWs, 0);
}

function cveShowOwn() {
  document.getElementById('own-workspace').hidden = false;
}

// A different profile has its own draft
function cveProfileChanged() {
  ownWs.cv = null;
  ownWs.result = null;
  ownWs.styles = {};
  if (document.getElementById('tab-cv-editor').classList.contains('active')) openCvEditor();
}

function ownLayout() {
  const layouts = (ownWs.result && ownWs.result.layouts) || {};
  return layouts[ownWs.layout] || Object.values(layouts)[0] || null;
}

function renderOwnPreview() {
  const layout = ownLayout();
  const select = document.getElementById('own-layout');
  const layouts = (ownWs.result && ownWs.result.layouts) || {};
  select.innerHTML = Object.entries(layouts).map(([id, l]) => `<option value="${escapeHtml(id)}"${id === ownWs.layout ? ' selected' : ''}>${escapeHtml(l.label)}</option>`).join('');
  renderStyleBar(ownWs);
  if (!layout) return;
  const frame = document.getElementById('own-frame');
  frame.srcdoc = cvDocument(layout.html, `${ownWs.cv.name || 'CV'} - CV`, false, layout.css);
  frame.onload = () => { frame.style.height = `${frame.contentDocument.documentElement.scrollHeight}px`; };
}

function setOwnLayout(id) {
  ownWs.layout = id;
  ownWs.menu = null;
  renderOwnPreview();
  cveSaveDraft(ownWs);
}

function ownDownloadTex() {
  const layout = ownLayout();
  if (!layout) return;
  cveSaveFile(new Blob([layout.latex], { type: 'application/x-tex' }), `${cveFileBase(ownWs.cv)}.tex`);
}

function ownCopyText() {
  if (!ownWs.result) return;
  navigator.clipboard.writeText(ownWs.result.text || '').then(() => showToast('CV copied as plain text')).catch(() => showToast('Copy failed'));
}

// ---------- Downloads ----------

function cveFileBase(cv) {
  return `${(cv && cv.name) || 'CV'}`.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '_') + '_CV';
}

function cveSaveFile(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// Real PDF compiled from the LaTeX layout on the server; falls back to printing the preview
async function cveDownloadPdf(ws, button, fallback) {
  if (!ws.cv) return;
  const label = button ? button.innerHTML : '';
  if (button) { button.disabled = true; button.textContent = 'Building PDF…'; }
  try {
    const job = ws.job();
    const res = await fetch(apiUrl('/api/cv/pdf'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cv: ws.cv, styles: ws.styles, template: ws.layout, job: { title: job.title || '', company: job.company || '' } })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Could not build the PDF');
    }
    cveSaveFile(await res.blob(), `${cveFileBase(ws.cv)}.pdf`);
    showToast('PDF downloaded');
  } catch (err) {
    showToast(`${err.message} Opening print instead…`, 5000);
    if (fallback) fallback();
  } finally {
    if (button) { button.disabled = false; button.innerHTML = label; }
  }
}

function ownPrintPdf() {
  const layout = ownLayout();
  if (!layout) return;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  frame.srcdoc = cvDocument(layout.html, `${ownWs.cv.name || 'CV'} - CV`, false, layout.css);
  frame.onload = () => setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 1000); }, 400);
}

// ---------- "Ask AI to change this section" ----------

// Enter applies; Shift+Enter starts a new line
function cveAiKey(e, key, section, i) {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  const btn = e.target.closest('.cve-ai').querySelector('.cve-ai-go');
  if (btn && !btn.disabled) cveAiApply(key, section, i, btn);
}

async function cveAiApply(key, section, i, btn) {
  const ws = CVE_WS[key];
  const noteKey = `${section}:${i}`;
  const box = document.getElementById(`cve-ai-${key}-${section}-${i}`);
  const text = box ? box.value.trim() : '';
  if (!ws || !ws.cv) return;
  if (!text) { if (box) box.focus(); return; }
  const done = (html) => { ws.aiNotes[noteKey] = html; renderEditor(ws); };
  const before = JSON.parse(JSON.stringify(ws.cv));
  // Summary: "improve it" / "rewrite it" = the summary Kairo wrote for this job (Tailor page)
  if (section === 'summary' && key === 'tailor' && typeof instructBaseSummary === 'string' && instructBaseSummary
    && /^(?:please\s+)?(?:improve|rewrite|regenerate|generate|redo|polish|refresh|better|tailor)(?:\s+(?:it|this|the summary|my summary))?(?:\s+for (?:this|the) (?:job|jd|role))?[.!]*$/i.test(text)) {
    ws.aiUndo.push(before);
    if (typeof instructUndo !== 'undefined') { instructUndo.push(before); updateInstructUndo(); }
    ws.cv.summary = instructBaseSummary;
    ws.edited = true;
    ws.aiDrafts[noteKey] = '';
    done(`<ul class="instruct-done"><li>Rewrote the summary for this job.</li></ul><button type="button" class="btn-link" onclick="cveAiUndo('${key}', '${noteKey}')">Undo</button>`);
    cveRender(ws, 0);
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Working…';
  ws.aiNotes[noteKey] = '<p class="instruct-wait">Working on it… requests in your own words can take up to a minute with the local AI.</p>';
  const note = btn.closest('.cve-ai').querySelector('.cve-ai-note');
  if (note) note.innerHTML = ws.aiNotes[noteKey];
  else btn.closest('.cve-ai').insertAdjacentHTML('beforeend', `<div class="cve-ai-note">${ws.aiNotes[noteKey]}</div>`);
  try {
    const res = await fetch(apiUrl('/api/cv/instruct'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(160_000),
      body: JSON.stringify({ cv: ws.cv, text, scope: { section, index: i }, job: ws.job() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not apply that');
    if (data.done.length) {
      ws.aiUndo.push(before);
      if (key === 'tailor' && typeof instructUndo !== 'undefined') { instructUndo.push(before); updateInstructUndo(); }
      ws.cv = data.cv;
      ws.edited = true;
      for (const skill of data.skills || []) if (key === 'tailor' && typeof instructConfirmSkill === 'function') instructConfirmSkill(skill);
      cveRender(ws, 0);
    }
    // what wasn't understood stays in the box
    ws.aiDrafts[noteKey] = data.done.length ? '' : text;
    done((data.done.length ? `<ul class="instruct-done">${data.done.map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul><button type="button" class="btn-link" onclick="cveAiUndo('${key}', '${noteKey}')">Undo</button>` : '')
      + (data.unclear.length ? `<div class="instruct-unclear"><strong>Not changed:</strong><ul>${data.unclear.map(u => `<li>${escapeHtml(u)}</li>`).join('')}</ul>${data.ai ? 'Try describing it a different way.' : 'Try one of the examples above.'}</div>` : ''));
  } catch (err) {
    ws.aiDrafts[noteKey] = text;
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    done(`<div class="instruct-unclear">${escapeHtml(timedOut ? 'That took too long and was cancelled — try again, or describe it more simply.' : (err.message || 'Could not reach the server'))}</div>`);
  }
}

function cveAiUndo(key, noteKey) {
  const ws = CVE_WS[key];
  if (!ws || !ws.aiUndo.length) return;
  ws.cv = ws.aiUndo.pop();
  if (key === 'tailor' && typeof instructUndo !== 'undefined' && instructUndo.length) { instructUndo.pop(); updateInstructUndo(); }
  ws.aiNotes[noteKey] = '<ul class="instruct-done"><li>Undid that change.</li></ul>';
  renderEditor(ws);
  cveRender(ws, 0);
}
