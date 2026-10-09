// Profile switcher and editor. Each profile has its own profile file and
// application tracker on the server; app.js scopes every request to
// `activeProfile` via apiUrl().

let profilesList = [];
let profilesLoadFailed = false;

async function initProfiles() {
  try {
    const res = await fetch('/api/profiles');
    if (res.ok) profilesList = await res.json();
    else profilesLoadFailed = true;
  } catch (e) {
    console.warn('Profiles unavailable', e);
    profilesLoadFailed = true;
  }
  if (!profilesList.some(p => p.id === activeProfile)) {
    activeProfile = 'default';
  }
  applyProfileIdentity();
  const current = currentProfile();
  if (current && !current.original) {
    document.getElementById('search-query-input').value = current.title;
  }
}

function currentProfile() {
  return profilesList.find(p => p.id === activeProfile) || null;
}

function applyProfileIdentity() {
  const p = currentProfile();
  const name = p ? (p.name || p.label) : 'Hassaan Nasir';
  const role = p ? p.title : 'Senior Full Stack & AI Engineer';
  const initials = p ? p.initials : 'HN';

  document.getElementById('side-avatar').textContent = initials;
  document.getElementById('side-name').textContent = name;
  document.getElementById('side-role').textContent = role;
  document.getElementById('top-avatar').textContent = initials;
  document.title = `Job Engine | ${name}`;
  // Hassaan's hand-written CV Studio, Interview and sample evaluation only show while
  // the main profile still holds his details (not after someone else's CV is imported)
  const original = !p || p.original ? 'true' : 'false';
  if (original === 'false' && document.body.dataset.builtin !== 'false') resetEvaluator();
  document.body.dataset.builtin = original;
  document.querySelectorAll('.profile-custom-name').forEach(el => { el.textContent = name; });
}

// ---------- Menu ----------

function toggleProfileMenu(anchor) {
  const menu = document.getElementById('profile-menu');
  if (!menu.hidden) {
    closeProfileMenu();
    return;
  }
  renderProfileMenu();
  menu.hidden = false;

  // Open above the sidebar card, or below the mobile avatar
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(300, window.innerWidth - 24);
  menu.style.width = `${width}px`;
  if (rect.top > window.innerHeight / 2) {
    menu.style.top = '';
    menu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    menu.style.left = `${Math.max(12, rect.left)}px`;
  } else {
    menu.style.bottom = '';
    menu.style.top = `${rect.bottom + 8}px`;
    menu.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`;
  }
  setTimeout(() => document.addEventListener('click', outsideMenuClick), 0);
}

function closeProfileMenu() {
  document.getElementById('profile-menu').hidden = true;
  document.removeEventListener('click', outsideMenuClick);
}

function outsideMenuClick(e) {
  if (!e.target.closest('#profile-menu')) closeProfileMenu();
}

function renderProfileMenu() {
  const menu = document.getElementById('profile-menu');
  const items = profilesList.length ? profilesList : [{ id: 'default', name: 'Hassaan Nasir', title: 'Senior Full Stack & AI Engineer', initials: 'HN', complete: true }];
  menu.innerHTML = `
    <div class="pm-label">Switch profile</div>
    ${profilesLoadFailed ? '<div class="pm-error">Couldn’t load the other profiles from the server. If this is the live site, check that the app is deployed from the <code>web</code> folder.</div>' : ''}
    ${items.map(p => `
      <button class="pm-item ${p.id === activeProfile ? 'active' : ''}" onclick="switchProfile('${p.id}')" role="menuitemradio" aria-checked="${p.id === activeProfile}">
        <span class="avatar pm-avatar">${escapeHtml(p.initials)}</span>
        <span class="pm-text">
          <strong>${escapeHtml(p.name || p.label)}</strong>
          <small>${escapeHtml(p.title)}</small>
        </span>
        ${p.complete ? '' : '<span class="pm-badge">Empty</span>'}
        ${p.id === activeProfile ? '<svg class="pm-check" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>' : ''}
      </button>`).join('')}
    <div class="pm-divider"></div>
    <button class="pm-action" onclick="closeProfileMenu(); openProfile()">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>View profile
    </button>
    <button class="pm-action" onclick="closeProfileMenu(); openProfileEditor()">
      <svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>Edit profile
    </button>
    <button class="pm-action" onclick="chooseCvFile()">
      <svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5M4 21h16"/></svg>Import from CV
    </button>`;
}

// ---------- Switching ----------

async function switchProfile(id) {
  closeProfileMenu();
  if (id === activeProfile) return;
  activeProfile = id;
  try { localStorage.setItem('activeProfile', id); } catch (e) {}

  profileData = null;
  applications = [];
  applyProfileIdentity();
  resetEvaluator();
  resetTailor();
  cveProfileChanged();

  await loadTrackerData();
  renderKanban();
  renderDashboard();

  const p = currentProfile();
  document.getElementById('search-query-input').value = p && !p.original ? p.title : 'Senior Full Stack Engineer';
  if (document.getElementById('tab-search').classList.contains('active')) executeJobSearch();

  showToast(`Switched to ${p ? (p.name || p.label) : 'profile'}${p && !p.complete ? ' — this profile is still empty' : ''}`);
}

function resetEvaluator() {
  const ring = document.getElementById('eval-score-ring');
  ring.style.setProperty('--score', 0);
  ring.classList.remove('good', 'fair', 'low');
  document.getElementById('eval-overall-score').textContent = '–';
  document.getElementById('eval-verdict-text').textContent = 'No evaluation yet';
  ['tech', 'exp', 'beh', 'car'].forEach(id => {
    document.getElementById(`bar-${id}`).style.width = '0%';
    document.getElementById(`val-${id}`).textContent = '–';
  });
  document.getElementById('bar-loc').style.width = '0%';
  document.getElementById('val-loc').textContent = '–';
  document.getElementById('eval-strengths-list').innerHTML = '<li class="muted-li">Paste a job and click Calculate fit score.</li>';
}

function resetTailor() {
  tailorResult = null;
  tailorWs.cv = null;
  tailorWs.result = null;
  tailorWs.edited = false;
  document.getElementById('tailor-edit-card').hidden = true;
  document.getElementById('tailor-style-bar').hidden = true;
  document.getElementById('tailor-analysis').hidden = true;
  document.getElementById('tailor-preview').hidden = true;
  document.getElementById('tailor-empty').hidden = false;
  if (typeof clearTailorDraft === 'function') clearTailorDraft();
}

// ---------- Editor ----------

// `draft` is profile markdown to review before saving (e.g. read from an uploaded CV)
async function openProfileEditor(draft = null, noticeHtml = '') {
  await openProfile();
  const p = profileData || {};
  const current = currentProfile();
  document.getElementById('profile-body').innerHTML = `
    <div class="editor">
      <div class="editor-head">
        <h2 class="editor-title">${draft ? 'Review imported profile' : 'Edit profile'}</h2>
        <button class="btn btn-secondary editor-upload" onclick="chooseCvFile()">
          <svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5M4 21h16"/></svg>
          <span>Upload CV</span>
        </button>
      </div>
      ${noticeHtml}
      <p class="muted editor-help">
        ${current && current.builtin
          ? 'This is the main profile that <code>/apply</code> and the other Claude Code commands also use.'
          : 'Fill in each section. Lines inside <code>&lt;!-- --&gt;</code> are examples and are ignored.'}
        Keep the headings and the <code>- **Label:**</code> format so the dashboard can read it.
      </p>
      <textarea id="profile-editor" class="input editor-area" spellcheck="false">${escapeHtml(draft ?? p.rawMarkdown ?? '')}</textarea>
      <div class="editor-actions">
        <button class="btn btn-secondary" onclick="cancelProfileEditor()">Cancel</button>
        <button class="btn btn-primary" id="profile-save" onclick="saveProfileEditor()">Save profile</button>
      </div>
    </div>`;
  document.getElementById('profile-editor').focus();
}

function cancelProfileEditor() {
  renderProfile(profileData || {});
}

async function saveProfileEditor() {
  const markdown = document.getElementById('profile-editor').value;
  const button = document.getElementById('profile-save');
  button.disabled = true;
  try {
    const res = await fetch(apiUrl('/api/profile'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');

    const [profileRes, listRes] = await Promise.all([fetch(apiUrl('/api/profile')), fetch('/api/profiles')]);
    profileData = await profileRes.json();
    profilesList = await listRes.json();
    applyProfileIdentity();
    renderProfile(profileData);
    showToast('Profile saved');
  } catch (err) {
    showToast(err.message || 'Save failed');
    button.disabled = false;
  }
}
