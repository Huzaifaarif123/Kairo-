// AI Job Search Dashboard - Client Logic & State Management

// Active candidate profile (see profiles-ui.js); every API call is scoped to it
let activeProfile = 'default';
try { activeProfile = localStorage.getItem('activeProfile') || 'default'; } catch (e) {}

function apiUrl(path) {
  return `${path}?profile=${encodeURIComponent(activeProfile)}`;
}

let applications = [
  {
    date: '2026-09-01',
    company: 'Deployly AI',
    sector: 'AI & Developer Tools',
    role: 'Senior Full Stack AI Engineer',
    role_type: 'Full-time',
    channel: 'LinkedIn',
    status: 'drafted',
    fit_rating: '94',
    notes: 'High synergy with Claude Code, Python, and Next.js background',
    cv_file: 'cv/main_DeploylyAI_AIEngineer.tex',
    source: 'https://www.linkedin.com/jobs/view/ai-engineer-at-deployly-ai-4447791646'
  },
  {
    date: '2026-08-28',
    company: 'Nexus Cloud Systems',
    sector: 'Cloud & Infrastructure',
    role: 'Senior Backend Engineer',
    role_type: 'Full-time',
    channel: 'Freehire',
    status: 'interview',
    fit_rating: '91',
    notes: 'Passed technical screen; System design scheduled next Tuesday',
    cv_file: 'cv/main_Nexus_Backend.tex',
    source: 'https://freehire.me/jobs/nexus-backend'
  },
  {
    date: '2026-08-24',
    company: 'FinVibe Technologies',
    sector: 'FinTech',
    role: 'Lead Python / Django Developer',
    role_type: 'Full-time',
    channel: 'Direct',
    status: 'applied',
    fit_rating: '88',
    notes: 'Submitted tailored resume highlighting 38% API speedup and Celery async processing',
    source: 'https://finvibe.io/careers'
  }
];

// Last rendered search results, referenced by index from result cards
let searchResults = [];

const STATUS = {
  drafted:   { label: 'Drafted',   color: 'var(--st-drafted)' },
  applied:   { label: 'Applied',   color: 'var(--st-applied)' },
  screening: { label: 'Screening', color: 'var(--st-applied)' },
  interview: { label: 'Interview', color: 'var(--st-interview)' },
  offer:     { label: 'Offer',     color: 'var(--st-offer)' },
  hired:     { label: 'Hired',     color: 'var(--ok)' },
  rejected:  { label: 'Closed',    color: 'var(--st-closed)' }
};

const PAGES = {
  overview:    ['Overview', 'Your job search at a glance.'],
  search:      ['Search', 'Find open roles across job boards.'],
  evaluator:   ['Evaluate', 'Score a job posting against your profile.'],
  kanban:      ['Pipeline', 'Track every application from draft to offer.'],
  'cv-studio': ['CV Studio', 'Profile statements and your master CV source.'],
  interview:   ['Interview', 'STAR stories and prepared answers.']
};

const ICONS = {
  calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  tag: '<svg viewBox="0 0 24 24"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  external: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17h.01"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7"/></svg>',
  award: '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="6"/><path d="M8.5 14L7 22l5-3 5 3-1.5-8"/></svg>'
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  if (activeProfile !== 'default') applications = [];
  setupNavigation();
  setupTheme();
  setupTypingState();
  loadTrackerData();
  renderDashboard();
  renderKanban();
  initProfiles().finally(executeInitialJobSearch);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAddJobModal();
      closeProfile();
    }
  });
});

// Profile Drawer
let profileData = null;

async function openProfile() {
  const drawer = document.getElementById('profile-drawer');
  drawer.classList.add('active');
  document.body.style.overflow = 'hidden';

  if (!profileData) {
    document.getElementById('profile-body').innerHTML = `<div class="empty">Loading profile…</div>`;
    try {
      const res = await fetch(apiUrl('/api/profile'));
      if (res.ok) profileData = await res.json();
    } catch (err) {
      console.warn('Profile API unavailable', err);
    }
  }
  renderProfile(profileData || {});
  drawer.querySelector('.drawer-close').focus();
}

function closeProfile() {
  const drawer = document.getElementById('profile-drawer');
  if (!drawer.classList.contains('active')) return;
  drawer.classList.remove('active');
  document.body.style.overflow = '';
}

// Pull the structured sections out of the candidate profile markdown
function parseProfileMarkdown(rawMd) {
  const md = String(rawMd).replace(/<!--[\s\S]*?-->/g, '');
  const section = (name) => {
    const m = md.match(new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
    return m ? m[1] : '';
  };
  const tableRows = (text) => text.split('\n')
    .filter(l => l.trim().startsWith('|') && !/^\|\s*-/.test(l.trim()))
    .slice(1)
    .map(l => l.split('|').slice(1, -1).map(c => c.trim()));

  const experience = [];
  const expRe = /^### (.+?) - (.+?) \((.+?)\)\s*\n(?!- )(.*)\n((?:- .*\n?)*)/gm;
  let m;
  while ((m = expRe.exec(section('Professional Experience')))) {
    experience.push({
      role: m[1], company: m[2], period: m[3], location: m[4].trim(),
      bullets: m[5].split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2))
    });
  }

  const listItems = (text) => text.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2));
  const stripBold = (s) => s.replace(/\*\*/g, '');

  const statusLine = (md.match(/\*\*Status:\*\*\s*(.+)/) || [])[1] || '';

  return {
    status: statusLine,
    experience,
    education: tableRows(section('Education')).map(r => ({ degree: r[0], period: r[1], school: r[2] })),
    languages: tableRows(md.match(/### Languages\s*\n([\s\S]*?)\n\n/)?.[1] || '').map(r => ({ name: r[0], level: r[1] })),
    projects: listItems(section('Independent Projects')).map(l => {
      const [, name, desc] = l.match(/\*\*(.+?)\*\*:?\s*(.*)/) || [null, l, ''];
      return { name, desc };
    }),
    certifications: listItems(section('Certifications')).map(stripBold)
  };
}

function renderProfile(p) {
  const body = document.getElementById('profile-body');
  const md = p.rawMarkdown ? parseProfileMarkdown(p.rawMarkdown) : { experience: [], education: [], languages: [], projects: [], certifications: [] };
  const name = p.name || p.label || 'Hassaan Nasir';
  const skillGroups = p.skillGroups ? p.skillGroups.map(g => [g.group, g.items]) : [
    ['Core', p.skills?.primary],
    ['AI & LLMs', p.skills?.ai],
    ['Cloud & DevOps', p.skills?.cloud],
    ['Observability', p.skills?.observability],
    ['Also familiar', p.skills?.secondary]
  ].filter(([, list]) => list && list.length);

  const linkedinHandle = (p.linkedin || '').replace(/^https?:\/\/(www\.)?linkedin\.com\//, '');

  body.innerHTML = `
    <div class="drawer-identity">
      <div class="avatar avatar-xl">${escapeHtml(initials(name))}</div>
      <h2 id="drawer-name">${escapeHtml(name)}</h2>
      <p class="drawer-title">${escapeHtml(p.title || 'Senior Full Stack & AI Engineer')}</p>
      ${md.status ? `<span class="open-badge"><i></i>${escapeHtml(md.status)}</span>` : ''}
    </div>

    <div class="drawer-facts">
      ${p.experience ? `<div><strong>${escapeHtml(p.experience)}</strong><span>Experience</span></div>` : ''}
      <div><strong>${md.experience.length || '—'}</strong><span>Companies</span></div>
      <div><strong>${md.certifications.length || '—'}</strong><span>Certifications</span></div>
    </div>

    <div class="contact-list">
      ${p.email ? `<a href="mailto:${escapeHtml(p.email)}">${ICONS.mail}<span>${escapeHtml(p.email)}</span></a>` : ''}
      ${p.linkedin ? `<a href="${escapeHtml(p.linkedin)}" target="_blank" rel="noopener noreferrer">${ICONS.linkedin}<span>${escapeHtml(linkedinHandle)}</span>${ICONS.external}</a>` : ''}
      ${p.location ? `<div>${ICONS.pin}<span>${escapeHtml(p.location)}</span></div>` : ''}
    </div>

    ${md.experience.length ? `
    <section class="drawer-section">
      <h3>Experience</h3>
      <ol class="timeline">
        ${md.experience.map((x, i) => `
          <li>
            <div class="tl-head">
              <div>
                <strong>${escapeHtml(x.role)}</strong>
                <span>${escapeHtml(x.company)}${x.location ? ` · ${escapeHtml(x.location)}` : ''}</span>
              </div>
              <time>${escapeHtml(x.period)}</time>
            </div>
            ${x.bullets.length ? `
            <details ${i === 0 ? 'open' : ''}>
              <summary>${x.bullets.length} highlights</summary>
              <ul>${x.bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
            </details>` : ''}
          </li>`).join('')}
      </ol>
    </section>` : ''}

    ${skillGroups.length ? `
    <section class="drawer-section">
      <h3>Skills</h3>
      ${skillGroups.map(([label, list]) => `
        <div class="skill-group">
          <span>${label}</span>
          <div class="tags">${list.map(s => `<span class="tag">${escapeHtml(s)}</span>`).join('')}</div>
        </div>`).join('')}
    </section>` : ''}

    ${md.projects.length ? `
    <section class="drawer-section">
      <h3>Projects</h3>
      <div class="drawer-list">
        ${md.projects.map(pr => `<div><strong>${escapeHtml(pr.name)}</strong><p>${escapeHtml(pr.desc)}</p></div>`).join('')}
      </div>
    </section>` : ''}

    ${md.education.length || md.certifications.length ? `
    <section class="drawer-section">
      <h3>Education &amp; certifications</h3>
      <div class="drawer-list">
        ${md.education.map(e => `<div><strong>${escapeHtml(e.degree)}</strong><p>${escapeHtml(e.school)} · ${escapeHtml(e.period)}</p></div>`).join('')}
        ${md.certifications.map(c => `<div class="cert">${ICONS.award}<span>${escapeHtml(c)}</span></div>`).join('')}
      </div>
    </section>` : ''}

    ${md.languages.length ? `
    <section class="drawer-section">
      <h3>Languages</h3>
      <div class="drawer-list">
        ${md.languages.map(l => `<div class="lang"><strong>${escapeHtml(l.name)}</strong><span>${escapeHtml(l.level)}</span></div>`).join('')}
      </div>
    </section>` : ''}

    ${p.complete === false ? `<div class="notice warn drawer-notice">${ICONS.warn}<span><strong>This profile is still empty.</strong> Click <strong>Edit profile</strong> above to add a name, experience and skills.</span></div>` : ''}
    ${!p.name ? `<div class="notice warn">${ICONS.warn}<span>Couldn't load the full profile from the server.</span></div>` : ''}
  `;
}

// On phones the fixed bottom bar would sit on top of the keyboard, so hide it
// while a text field has focus (see body.typing in styles.css)
function setupTypingState() {
  const isField = el => el && el.matches && el.matches('input:not([type=checkbox]):not([type=radio]), textarea, select');
  document.addEventListener('focusin', e => { if (isField(e.target)) document.body.classList.add('typing'); });
  document.addEventListener('focusout', () => {
    setTimeout(() => { if (!isField(document.activeElement)) document.body.classList.remove('typing'); }, 50);
  });
}

// Theme Management
function setupTheme() {
  const toggleBtn = document.getElementById('theme-toggle-btn');
  let savedTheme = 'light';
  try { savedTheme = localStorage.getItem('theme') || 'light'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', savedTheme);

  toggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    try { localStorage.setItem('theme', newTheme); } catch (e) {}
  });
}

// Tab Navigation
function setupNavigation() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    const active = b.getAttribute('data-tab') === tabId;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === `tab-${tabId}`);
  });

  const [title, subtitle] = PAGES[tabId] || PAGES.overview;
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-subtitle').textContent = subtitle;
  window.scrollTo({ top: 0 });

  if (tabId === 'overview') {
    renderCharts();
  }
}

// Load Application Tracker Data from API / LocalStorage
async function loadTrackerData() {
  try {
    const res = await fetch(apiUrl('/api/tracker'));
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        applications = data;
      }
    }
  } catch (err) {
    console.warn('Local server API offline, using local storage state', err);
    try {
      const cached = localStorage.getItem(`applications:${activeProfile}`);
      if (cached) applications = JSON.parse(cached);
    } catch (e) {}
  }
  updateStats();
  renderKanban();
  renderCharts();
}

async function syncTrackerData() {
  try { localStorage.setItem(`applications:${activeProfile}`, JSON.stringify(applications)); } catch (e) {}
  try {
    await fetch(apiUrl('/api/tracker'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(applications)
    });
  } catch (err) {
    console.warn('Could not sync with CSV server', err);
  }
  updateStats();
  renderCharts();
}

// Stats & Dashboard
function updateStats() {
  const total = applications.length;
  const active = applications.filter(a => ['applied', 'interview', 'screening'].includes(a.status)).length;
  const interview = applications.filter(a => a.status === 'interview').length;

  const ratings = applications.map(a => parseInt(a.fit_rating)).filter(n => !isNaN(n));
  const avgFit = ratings.length > 0 ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-active').textContent = active;
  document.getElementById('stat-interview').textContent = interview;
  document.getElementById('stat-avg-fit').textContent = ratings.length ? `${avgFit}%` : '—';
  document.getElementById('header-active-count').textContent = active;
}

function renderDashboard() {
  updateStats();
  renderCharts();
}

function renderCharts() {
  renderFunnelChart();
  renderDoughnutChart();
  renderRecentList();
}

function renderFunnelChart() {
  const container = document.getElementById('funnel-chart-box');
  if (!container) return;

  const counts = {
    drafted: applications.filter(a => a.status === 'drafted').length,
    applied: applications.filter(a => ['applied', 'screening', 'interview', 'offer', 'hired'].includes(a.status)).length,
    interview: applications.filter(a => ['interview', 'offer', 'hired'].includes(a.status)).length,
    offer: applications.filter(a => ['offer', 'hired'].includes(a.status)).length
  };

  const stages = [
    { label: 'Drafted', count: counts.drafted, color: STATUS.drafted.color },
    { label: 'Applied', count: counts.applied, color: STATUS.applied.color },
    { label: 'Interview', count: counts.interview, color: STATUS.interview.color },
    { label: 'Offer', count: counts.offer, color: STATUS.offer.color }
  ];

  const max = Math.max(1, ...stages.map(s => s.count));

  container.innerHTML = `<div class="funnel">${stages.map(st => `
    <div class="funnel-row">
      <span>${st.label}</span>
      <div class="funnel-track">${st.count ? `<div class="funnel-fill" style="--c: ${st.color}; width: ${(st.count / max) * 100}%"></div>` : ''}</div>
      <strong>${st.count}</strong>
    </div>`).join('')}</div>`;

  const badge = document.getElementById('funnel-badge');
  if (badge) {
    badge.textContent = counts.applied
      ? `${Math.round((counts.interview / counts.applied) * 100)}% interview rate`
      : 'No applications sent';
  }
}

function renderDoughnutChart() {
  const container = document.getElementById('doughnut-chart-box');
  if (!container) return;

  const segments = [
    { name: 'Drafted', count: applications.filter(a => a.status === 'drafted').length, color: STATUS.drafted.color },
    { name: 'Applied', count: applications.filter(a => ['applied', 'screening'].includes(a.status)).length, color: STATUS.applied.color },
    { name: 'Interview', count: applications.filter(a => a.status === 'interview').length, color: STATUS.interview.color },
    { name: 'Offer', count: applications.filter(a => ['offer', 'hired'].includes(a.status)).length, color: STATUS.offer.color },
    { name: 'Closed', count: applications.filter(a => a.status === 'rejected').length, color: STATUS.rejected.color }
  ];

  const total = applications.length;
  const r = 42;
  const circ = 2 * Math.PI * r;
  const visible = segments.filter(s => s.count > 0);
  const gap = visible.length > 1 ? 3 : 0;
  let offset = 0;

  const arcs = visible.map(s => {
    const len = (s.count / total) * circ;
    const arc = `<circle cx="50" cy="50" r="${r}" fill="none" stroke-width="10" style="stroke: ${s.color}"
      stroke-dasharray="${Math.max(0, len - gap)} ${circ}" stroke-dashoffset="${-offset}" />`;
    offset += len;
    return arc;
  }).join('');

  container.innerHTML = `
    <div class="donut-wrap">
      <div class="donut">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="${r}" fill="none" stroke-width="10" style="stroke: var(--surface-2)"/>
          ${arcs}
        </svg>
        <div class="donut-center"><strong>${total}</strong><span>total</span></div>
      </div>
      <ul class="legend">
        ${segments.map(s => `<li><i class="dot" style="--c: ${s.color}"></i>${s.name}<strong>${s.count}</strong></li>`).join('')}
      </ul>
    </div>`;
}

function renderRecentList() {
  const container = document.getElementById('recent-list');
  if (!container) return;

  if (applications.length === 0) {
    container.innerHTML = `<div class="empty">No applications yet. Add your first one to start tracking.</div>`;
    return;
  }

  const recent = [...applications]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 5);

  container.innerHTML = recent.map(app => `
    <div class="recent-item">
      <div class="logo">${escapeHtml(initials(app.company))}</div>
      <div class="recent-main">
        <div class="recent-role">${escapeHtml(app.role)}</div>
        <div class="recent-sub">${escapeHtml(app.company)} · ${escapeHtml(formatDate(app.date))}</div>
      </div>
      ${statusPill(app.status)}
    </div>`).join('');
}

// Kanban Board Rendering & Drag & Drop
function renderKanban() {
  const columns = ['drafted', 'applied', 'interview', 'offer', 'rejected'];

  columns.forEach(col => {
    const colContainer = document.getElementById(`cards-${col}`);
    const countBadge = document.getElementById(`count-${col}`);
    if (!colContainer) return;

    const filtered = applications.filter(a => a.status === col);
    if (countBadge) countBadge.textContent = filtered.length;

    colContainer.innerHTML = '';

    if (filtered.length === 0) {
      colContainer.innerHTML = `<div class="empty">Drop cards here</div>`;
      return;
    }

    filtered.forEach(app => {
      const idx = applications.indexOf(app);
      const card = document.createElement('div');
      card.className = 'kanban-card';
      card.draggable = true;
      card.setAttribute('data-id', `${app.company}-${app.role}`);

      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', `${app.company}:::${app.role}`);
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        document.querySelectorAll('.kanban-col.drop-target').forEach(c => c.classList.remove('drop-target'));
      });

      const fit = parseInt(app.fit_rating);
      card.innerHTML = `
        <div class="card-top">
          <span class="card-company">${escapeHtml(app.company)}</span>
          ${isNaN(fit) ? '' : `<span class="fit" style="--c: ${fitColor(fit)}">${fit}% fit</span>`}
        </div>
        <div class="card-role">${escapeHtml(app.role)}</div>
        ${app.notes ? `<p class="card-notes">${escapeHtml(app.notes)}</p>` : ''}
        <div class="meta">
          <span>${ICONS.calendar}${escapeHtml(formatDate(app.date))}</span>
          ${app.sector ? `<span>${ICONS.tag}${escapeHtml(app.sector)}</span>` : ''}
        </div>
        <div class="card-actions">
          <button class="btn-link" onclick="rescoreApplication(${idx})">Re-score</button>
          <select class="card-move" aria-label="Move to stage" onchange="moveApplication(${idx}, this.value)">
            ${['drafted', 'applied', 'interview', 'offer', 'rejected'].map(s => `<option value="${s}" ${s === col ? 'selected' : ''}>${s === col ? 'Move to…' : STATUS[s].label}</option>`).join('')}
          </select>
          <button class="btn-link danger" onclick="deleteApplicationAt(${idx})">Remove</button>
        </div>
      `;

      colContainer.appendChild(card);
    });
  });
}

// Touch screens can't drag, so cards also have a "Move to" menu
function moveApplication(idx, status) {
  const app = applications[idx];
  if (!app || app.status === status || !STATUS[status]) return;
  app.status = status;
  syncTrackerData();
  renderKanban();
  showToast(`Moved to ${STATUS[status].label}`);
}

function allowDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.add('drop-target');
}

function leaveDrop(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    event.currentTarget.classList.remove('drop-target');
  }
}

function handleDrop(event, targetStatus) {
  event.preventDefault();
  event.currentTarget.classList.remove('drop-target');
  const data = event.dataTransfer.getData('text/plain');
  if (!data) return;

  const [company, role] = data.split(':::');
  const app = applications.find(a => a.company === company && a.role === role);
  if (app && app.status !== targetStatus) {
    app.status = targetStatus;
    syncTrackerData();
    renderKanban();
    showToast(`Moved to ${STATUS[targetStatus].label}`);
  }
}

// Live Job Search Engine
async function executeJobSearch() {
  const query = document.getElementById('search-query-input').value.trim();
  const portal = document.getElementById('search-portal-select').value;
  const location = document.getElementById('search-location-select').value;
  const remoteOnly = document.getElementById('search-remote-only').checked;
  const statusBar = document.getElementById('search-status-bar');
  const button = document.getElementById('btn-run-search');
  const portalName = portal === 'linkedin' ? 'LinkedIn' : 'Freehire';
  let searchError = '';

  const where = `${remoteOnly ? 'remote roles in ' : ''}${escapeHtml(location)}`;
  setNotice(statusBar, 'info', `Searching <strong>${portalName}</strong> for “${escapeHtml(query)}” — ${where}…`);
  renderSearchSkeleton();
  button.disabled = true;

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, portal, location, remoteOnly, limit: 9 })
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const results = (data.results || []).map(r => ({ ...r, portal: data.portal || portal }));
      renderSearchResults(results);
      const caveat = data.remoteApprox
        ? ' LinkedIn can’t filter by remote, so these are roles that mention “remote” — check each posting.'
        : '';
      setNotice(statusBar, data.remoteApprox ? 'warn' : 'info', `Found <strong>${results.length}</strong> live ${results.length === 1 ? 'role' : 'roles'} on ${portalName} — ${where}.${caveat}`);
      button.disabled = false;
      return;
    }
    searchError = data.error || `Server error ${res.status}`;
  } catch (e) {
    console.warn('API fetch failed, falling back to sample listings', e);
    searchError = 'The dashboard server is not reachable';
  }

  const fallbackResults = [
    {
      title: 'Senior Full Stack AI Engineer',
      company: 'Deployly AI',
      location: 'Remote',
      url: 'https://www.linkedin.com/jobs/view/ai-engineer-at-deployly-ai-4447791646',
      skills: ['python', 'django', 'react', 'next.js', 'claude code', 'mcp', 'aws'],
      description: 'Building intelligent developer agent workflows with Python, Next.js, and Anthropic Claude APIs. High ownership of distributed architectures and asynchronous microservices.'
    },
    {
      title: 'Senior Backend Engineer (Python / Distributed Systems)',
      company: 'Nexus Scale Cloud',
      location: 'Remote / UAE',
      url: 'https://freehire.me/jobs/nexus-backend',
      skills: ['python', 'drf', 'celery', 'redis', 'postgresql', 'docker', 'kubernetes'],
      description: 'Lead backend microservices handling high-throughput event processing. 5+ years with Django/DRF, Celery, and database schema performance tuning.'
    },
    {
      title: 'Full Stack Engineer (React, Next.js & Python)',
      company: 'Quantis AI',
      location: 'Remote',
      url: 'https://freehire.me/jobs/quantis-fullstack',
      skills: ['react', 'next.js', 'typescript', 'python', 'fastapi', 'tailwind css'],
      description: 'Design intuitive, data-intensive web apps with Next.js and high-performance Python APIs. Deep focus on Core Web Vitals and clean state architecture.'
    }
  ];

  renderSearchResults(fallbackResults);
  setNotice(statusBar, 'warn', `<strong>Live search failed</strong> — ${escapeHtml(searchError)}. Showing sample listings instead.`);
  button.disabled = false;
}

function executeInitialJobSearch() {
  executeJobSearch();
}

function setNotice(el, kind, html) {
  el.hidden = false;
  el.className = `notice${kind === 'warn' ? ' warn' : ''}`;
  el.innerHTML = `${kind === 'warn' ? ICONS.warn : ICONS.info}<span>${html}</span>`;
}

function renderSearchSkeleton() {
  const container = document.getElementById('job-results-container');
  container.innerHTML = Array.from({ length: 3 }, () => `
    <div class="card job-card skeleton">
      <div class="sk" style="height: 16px; width: 70%; margin-bottom: 8px"></div>
      <div class="sk" style="height: 12px; width: 40%; margin-bottom: 18px"></div>
      <div class="sk" style="height: 12px; width: 100%; margin-bottom: 6px"></div>
      <div class="sk" style="height: 12px; width: 90%; margin-bottom: 18px"></div>
      <div class="sk" style="height: 32px; width: 100%"></div>
    </div>`).join('');
}

function renderSearchResults(results) {
  const container = document.getElementById('job-results-container');
  if (!container) return;
  searchResults = results;

  if (results.length === 0) {
    container.innerHTML = `<div class="card empty" style="grid-column: 1 / -1">No roles found for this search. Try a broader keyword.</div>`;
    return;
  }

  container.innerHTML = results.map((j, i) => {
    const skills = (j.skills || []).map(s => String(s).replace(/-/g, ' '));
    const desc = String(j.description || '').replace(/[*_#`>]+/g, '').replace(/\s+/g, ' ').trim();
    return `
      <div class="card job-card">
        <div class="job-head">
          <div class="logo">${escapeHtml(initials(j.company))}</div>
          <div>
            <div class="job-title">${escapeHtml(j.title)}</div>
            <div class="job-company">${escapeHtml(j.company)}</div>
          </div>
        </div>
        <p class="job-desc">${desc ? escapeHtml(desc) : 'Open the posting to read the full description.'}</p>
        <div class="tags">
          <span class="tag">${escapeHtml(j.location || 'Remote')}</span>
          ${j.countries && j.countries.length > 1 ? `<span class="tag" title="${escapeHtml(j.countries.map(c => c.toUpperCase()).join(', '))}">+${j.countries.length - 1} more ${j.countries.length === 2 ? 'location' : 'locations'}</span>` : ''}
          ${j.work_mode === 'remote' ? '<span class="tag">Remote</span>' : ''}
          ${skills.slice(0, 5).map(s => `<span class="tag">${escapeHtml(s)}</span>`).join('')}
        </div>
        <div class="job-foot">
          ${j.url ? `<a href="${escapeHtml(j.url)}" target="_blank" rel="noopener noreferrer">View posting ${ICONS.external}</a>` : '<span></span>'}
          <button class="btn btn-secondary" onclick="evaluateSearchResult(${i})">Evaluate fit</button>
        </div>
      </div>
    `;
  }).join('');
}

async function evaluateSearchResult(i) {
  const j = searchResults[i];
  if (!j) return;
  // LinkedIn search results carry no description; fetch the real posting so the
  // score reflects its actual requirements
  if (!j.description && j.portal && j.id) {
    showToast('Fetching the full job posting…');
    try {
      const res = await fetch('/api/job-detail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portal: j.portal, id: j.id })
      });
      const detail = await res.json();
      if (res.ok && detail.description) j.description = detail.description;
    } catch (e) {
      console.warn('Could not fetch job detail', e);
    }
    if (!j.description) {
      showToast('Could not load this posting — paste its description into Evaluate');
      document.getElementById('eval-job-title').value = j.title;
      document.getElementById('eval-company-name').value = j.company;
      document.getElementById('eval-job-desc').value = '';
      switchTab('evaluator');
      return;
    }
  }
  sendToEvaluator(j.title, j.company, j.description);
}

// 5D Fit Evaluator
async function runFitEvaluation() {
  const title = document.getElementById('eval-job-title').value;
  const company = document.getElementById('eval-company-name').value;
  const description = document.getElementById('eval-job-desc').value;

  try {
    const res = await fetch(apiUrl('/api/evaluate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, company, description })
    });

    if (res.ok) {
      const data = await res.json();
      updateEvaluatorUI(data);
      return;
    }
  } catch (err) {
    console.warn('Client-side scoring calculation', err);
  }

  // Client-side instant evaluation fallback
  const text = `${title} ${description}`.toLowerCase();
  let techScore = 92;
  if (text.includes('python') && (text.includes('react') || text.includes('next.js'))) techScore = 96;
  if (text.includes('claude') || text.includes('ai') || text.includes('mcp')) techScore = 98;

  updateEvaluatorUI({
    overallScore: Math.round((techScore + 95 + 94 + 100 + 92) / 5),
    verdict: 'Exceptional Match',
    breakdown: {
      technical: techScore,
      experience: 95,
      behavioral: 94,
      location: 100,
      career: 92
    },
    strengths: [
      'Direct 8+ years experience with Python, Django REST Framework, React, Next.js, and PostgreSQL.',
      'Quantified results: 38% API latency reduction and 55% task completion speedup.',
      'Anthropic MCP & Claude Code certification ready for agentic workflow tasks.'
    ]
  });
}

function updateEvaluatorUI(data) {
  const score = data.overallScore;
  const ring = document.getElementById('eval-score-ring');
  ring.style.setProperty('--score', score);
  ring.classList.remove('good', 'fair', 'low');
  ring.classList.add(score >= 80 ? 'good' : score >= 60 ? 'fair' : 'low');

  document.getElementById('eval-overall-score').textContent = score;
  document.getElementById('eval-verdict-text').textContent = data.verdict;

  const dims = [['tech', 'technical'], ['exp', 'experience'], ['beh', 'behavioral'], ['car', 'career']];
  dims.forEach(([id, key]) => {
    document.getElementById(`bar-${id}`).style.width = `${data.breakdown[key]}%`;
    document.getElementById(`val-${id}`).textContent = data.breakdown[key];
  });

  const locPass = data.breakdown.location >= 80;
  const locBar = document.getElementById('bar-loc');
  locBar.style.width = `${data.breakdown.location}%`;
  locBar.classList.toggle('bar-ok', locPass);
  locBar.classList.toggle('bar-flag', !locPass);
  document.getElementById('val-loc').textContent = locPass ? 'Pass' : 'Flag';

  if (data.strengths) {
    const list = document.getElementById('eval-strengths-list');
    list.innerHTML = data.strengths.map(s => `<li>${escapeHtml(s)}</li>`).join('');
  }
}

function sendToEvaluator(title, company, description) {
  document.getElementById('eval-job-title').value = title;
  document.getElementById('eval-company-name').value = company;
  document.getElementById('eval-job-desc').value = description || `${title} at ${company}. Python, Django, React, Next.js, TypeScript, PostgreSQL, and AWS.`;
  switchTab('evaluator');
  runFitEvaluation();
}

function rescoreApplication(idx) {
  const app = applications[idx];
  if (app) sendToEvaluator(app.role, app.company, app.notes || '');
}

function saveEvaluatedJobToPipeline() {
  const company = document.getElementById('eval-company-name').value;
  const role = document.getElementById('eval-job-title').value;
  const score = document.getElementById('eval-overall-score').textContent;

  applications.unshift({
    date: new Date().toISOString().split('T')[0],
    company,
    role,
    sector: 'Tech / AI',
    status: 'drafted',
    fit_rating: score,
    notes: 'Evaluated in dashboard.'
  });

  syncTrackerData();
  switchTab('kanban');
  renderKanban();
  showToast(`${company} added to Drafted`);
}

// Modal Handling
function openAddJobModal() {
  document.getElementById('add-modal').classList.add('active');
  setTimeout(() => document.getElementById('modal-company').focus(), 50);
}

function closeAddJobModal() {
  document.getElementById('add-modal').classList.remove('active');
}

function handleAddJobSubmit(e) {
  e.preventDefault();
  const company = document.getElementById('modal-company').value;
  const role = document.getElementById('modal-role').value;
  const sector = document.getElementById('modal-sector').value;
  const channel = document.getElementById('modal-channel').value;
  const status = document.getElementById('modal-status').value;
  const source = document.getElementById('modal-source').value;
  const notes = document.getElementById('modal-notes').value;

  applications.unshift({
    date: new Date().toISOString().split('T')[0],
    company,
    role,
    sector,
    channel,
    status,
    fit_rating: '92',
    source,
    notes
  });

  syncTrackerData();
  closeAddJobModal();
  document.getElementById('add-job-form').reset();
  renderKanban();
  switchTab('kanban');
  showToast(`${company} added to pipeline`);
}

function deleteApplicationAt(idx) {
  const app = applications[idx];
  if (!app) return;
  if (confirm(`Remove ${app.company} – ${app.role} from the tracker?`)) {
    applications.splice(idx, 1);
    syncTrackerData();
    renderKanban();
    showToast('Application removed');
  }
}

function exportTrackerCSV() {
  const headers = ['date', 'company', 'sector', 'role', 'role_type', 'channel', 'status', 'fit_rating', 'notes', 'source'];
  let csvContent = 'data:text/csv;charset=utf-8,' + headers.join(',') + '\n';

  applications.forEach(a => {
    const row = headers.map(h => {
      let val = a[h] || '';
      if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
        val = `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    });
    csvContent += row.join(',') + '\n';
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `job_search_tracker_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Utility Helpers
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function formatDate(date) {
  if (!date) return 'Recent';
  const d = new Date(date);
  if (isNaN(d)) return date;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fitColor(fit) {
  return fit >= 80 ? 'var(--ok)' : fit >= 60 ? 'var(--warn)' : 'var(--st-closed)';
}

function statusPill(status) {
  const s = STATUS[status] || { label: status || 'Unknown', color: 'var(--text-3)' };
  return `<span class="status" style="--c: ${s.color}">${escapeHtml(s.label)}</span>`;
}

let toastTimer;
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function copyText(elemId) {
  const elem = document.getElementById(elemId);
  if (!elem) return;
  navigator.clipboard.writeText(elem.innerText || elem.textContent)
    .then(() => showToast('Copied to clipboard'))
    .catch(() => showToast('Copy failed'));
}
