// CV import: read an uploaded CV (PDF, Word .docx, or text) in the browser and
// draft a profile from it. The draft opens in the profile editor so it can be
// checked and adjusted before saving; nothing is saved automatically.
// Relies on app.js / profiles-ui.js helpers (showToast, escapeHtml, openProfileEditor, profileData).

const CV_LIBS = {
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  docx: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js'
};
const CV_MAX_BYTES = 10 * 1024 * 1024;

const loadedScripts = {};
function loadScript(src) {
  if (!loadedScripts[src]) {
    loadedScripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { delete loadedScripts[src]; reject(new Error('Could not load the file reader. Check your internet connection.')); };
      document.head.appendChild(s);
    });
  }
  return loadedScripts[src];
}

// ---------- Entry points ----------

function chooseCvFile() {
  closeProfileMenu();
  const input = document.getElementById('cv-file');
  input.value = '';
  input.click();
}

async function handleCvFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.size > CV_MAX_BYTES) {
    showToast('That file is larger than 10 MB');
    return;
  }

  const current = typeof currentProfile === 'function' ? currentProfile() : null;
  if (current && current.complete && !confirm(
    `Replace ${current.name || current.label}'s profile with the details from "${file.name}"?\n\n` +
    'You can review the result before anything is saved.' +
    (current.builtin ? '\n\nThis is the main profile that /apply also uses.' : ''))) {
    return;
  }

  showToast('Reading your CV…');
  try {
    const text = await extractCvText(file);
    if (text.replace(/\s/g, '').length < 80) {
      throw new Error('No readable text found in this file. If it is a scanned PDF, upload a Word or text version instead.');
    }
    const cv = parseCvText(text);
    await openProfileEditor(buildProfileMarkdown(cv, profileData && profileData.rawMarkdown), importSummary(cv, file.name));
  } catch (err) {
    console.warn('CV import failed', err);
    showToast(err.message || 'Could not read this CV');
  }
}

// ---------- Text extraction ----------

async function extractCvText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return extractPdfText(file);
  if (name.endsWith('.docx')) return extractDocxText(file);
  if (name.endsWith('.doc')) throw new Error('Old .doc files aren\'t supported. Save it as .docx or PDF and try again.');
  if (/\.(txt|md|markdown|text)$/.test(name) || file.type.startsWith('text/')) return file.text();
  throw new Error('Please upload a PDF, Word (.docx) or text file.');
}

async function extractPdfText(file) {
  await loadScript(CV_LIBS.pdf);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = CV_LIBS.pdfWorker;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  const links = new Set();
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    pages.push(pdfItemsToLines((await page.getTextContent()).items));
    for (const a of await page.getAnnotations()) {
      if (a.url && /linkedin\.com|github\.com/i.test(a.url)) links.add(a.url);
    }
  }
  return pages.join('\n') + (links.size ? `\n${[...links].join('\n')}` : '');
}

// Rebuild reading-order lines from positioned PDF text. Large horizontal gaps
// (separate columns, e.g. dates beside a job title) become triple spaces.
function pdfItemsToLines(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = it.transform[5];
    const size = Math.abs(it.transform[0]) || 10;
    let row = rows.find(r => Math.abs(r.y - y) < size * 0.5);
    if (!row) rows.push(row = { y, size, items: [] });
    row.items.push({ x: it.transform[4], w: it.width, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => {
    r.items.sort((a, b) => a.x - b.x);
    let line = '';
    let end = null;
    for (const it of r.items) {
      if (end !== null) {
        const gap = it.x - end;
        if (gap > r.size * 2) line += '   ';
        else if (gap > r.size * 0.15 && !line.endsWith(' ') && !it.s.startsWith(' ')) line += ' ';
      }
      line += it.s;
      end = it.x + it.w;
    }
    return line.trim();
  }).join('\n');
}

async function extractDocxText(file) {
  await loadScript(CV_LIBS.docx);
  const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

// ---------- Parsing ----------

const CV_SECTIONS = [
  ['summary', /^(professional |career |personal )?(summary|profile|about( me)?|objective|overview|statement)$/],
  ['experience', /^((professional|work|relevant|employment|career) )?(experience|history|employment( history)?)$|^work history$|^employment$/],
  ['education', /^(education|academic (background|qualifications)|qualifications|education (and|&) training)$/],
  ['skills', /^((technical|core|key|professional) )?(skills|competencies|expertise|technologies|tech stack|tools)( (and|&) (tools|technologies|expertise))?$|^skills (and|&) (tools|technologies|expertise)$/],
  ['projects', /^((key|selected|personal|independent|academic|notable|featured|side|recent|major|relevant|open[- ]source|professional) )?projects( (and|&) \w+)?$|^portfolio$/],
  ['certifications', /^(certifications?|certificates|licenses?( (and|&) certifications)?|courses( (and|&) certifications)?|training)$/],
  ['languages', /^languages?( skills)?$/],
  ['ignore', /^(awards?|honou?rs|interests|hobbies|references|publications|volunteer(ing| experience)?|achievements|activities|extracurricular.*)$/]
];

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const CV_DATE = `(?:${MONTH}\\s*,?\\s*)?(?:19|20)\\d{2}|\\d{1,2}[/.](?:19|20)\\d{2}`;
const RANGE_RE = new RegExp(`(${CV_DATE})\\s*(?:–|—|-|to|until)+\\s*(${CV_DATE}|present|current|now|today|ongoing)`, 'i');
const YEAR_RE = /(?:19|20)\d{2}/g;

const ROLE_WORDS = /\b(engineer|developer|designer|manager|analyst|lead|architect|consultant|scientist|intern|specialist|director|officer|administrator|devops|sre|head|founder|co-founder|coordinator|associate|executive|programmer|researcher|technician|product owner|owner|assistant|trainee|freelancer|contractor|tester|qa)\b/i;
const PLACE_WORDS = /\b(remote|hybrid|on-?site|pakistan|uae|united arab emirates|dubai|abu dhabi|india|usa|united states|uk|united kingdom|england|germany|canada|australia|singapore|saudi arabia|ksa|qatar|egypt|netherlands|france|spain|italy|ireland|sweden|poland|turkey|türkiye|china|japan|nigeria|kenya|south africa|bangladesh|sri lanka|malaysia|indonesia|philippines|new zealand|switzerland|austria|belgium|denmark|norway|finland|portugal|brazil|mexico|lahore|karachi|islamabad|london|berlin|new york|toronto|sydney|bangalore|bengaluru|mumbai|delhi|hyderabad|riyadh|doha|cairo)\b/i;
const EDU_WORDS = /\b(bachelor|master|b\.?\s?sc|m\.?\s?sc|bsc|msc|b\.?s\.?|m\.?s\.?|b\.?a\.?|m\.?a\.?|mba|ph\.?\s?d|doctorate|diploma|associate degree|b\.?\s?tech|m\.?\s?tech|b\.?\s?e\.?|beng|meng|bcs|bscs|mcs|a-?levels?|o-?levels?|intermediate|matric(ulation)?|hssc|ssc|high school|fsc|ics)\b/i;
const SCHOOL_WORDS = /\b(university|college|institute|school|academy|polytechnic|nuces|fast|lums|nust|comsats|iit|mit)\b/i;

const BULLET_RE = /^\s*(?:[\p{So}\p{Co}•●▪■◦‣∙·➢➤►▶✓✔]\s*|[*\-–—]\s+|\d+[.)]\s+)/u;

// Lines that read like an achievement rather than a job title / company
const ACTION_START = /^(built|led|leading|designed|developed|created|implemented|managed|wrote|written|cut|reduced|improved|increased|modell?ed|mentored|delivered|launched|owned|drove|introduced|migrated|automated|optimi[sz]ed|architected|maintained|collaborated|worked|responsible|supported|established|spearheaded|streamlined|engineered|analy[sz]ed|coordinated|conducted|achieved|integrated|deployed|shipped|scaled|partnered|researched|tested|trained|oversaw|handled|prepared|produced|planned|organi[sz]ed|contributed|assisted|helped|ran|set up|refactored)\b/i;

function cleanLine(l) {
  return l.replace(/ /g, ' ').replace(/[​﻿]/g, '').replace(/[ \t]+$/g, '');
}

function sectionOf(line) {
  const t = line.trim().replace(/[:：]$/, '').replace(/\s+/g, ' ').toLowerCase();
  if (!t || t.split(' ').length > 5) return null;
  for (const [name, re] of CV_SECTIONS) if (re.test(t)) return name;
  return null;
}

function parseCvText(raw) {
  const lines = raw.split(/\r?\n/).map(cleanLine);
  const sections = { header: [] };
  let current = 'header';
  for (const line of lines) {
    const name = sectionOf(line);
    if (name) { current = name; sections[current] = sections[current] || []; continue; }
    (sections[current] = sections[current] || []).push(line);
  }

  const all = raw;
  const email = (all.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [])[0] || '';
  const linkedinMatch = all.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[\w%-]+\/?/i);
  const linkedinShort = all.match(/linkedin\s*:?\s*(?:\/?in\/)([\w%-]{3,})/i);
  const linkedin = linkedinMatch
    ? (linkedinMatch[0].startsWith('http') ? linkedinMatch[0] : `https://${linkedinMatch[0]}`).replace(/\/$/, '')
    : linkedinShort ? `https://linkedin.com/in/${linkedinShort[1]}` : '';
  const githubMatch = all.match(/(?:https?:\/\/)?github\.com\/[\w-]+/i);
  const github = githubMatch ? (githubMatch[0].startsWith('http') ? githubMatch[0] : `https://${githubMatch[0]}`) : '';
  const phone = (all.match(/(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{3,4}/g) || [])
    .map(p => p.trim())
    .find(p => p.replace(/\D/g, '').length >= 9 && !RANGE_RE.test(p)) || '';

  const header = parseHeader(sections.header.filter(l => l.trim()), { email, phone });

  return {
    ...header,
    email,
    phone,
    linkedin,
    github,
    summary: (sections.summary || []).map(l => l.trim()).filter(Boolean).join(' ').replace(BULLET_RE, ''),
    experience: parseExperience(sections.experience || []),
    education: parseEducation(sections.education || []),
    skills: parseSkills(sections.skills || []),
    projects: parseProjects(sections.projects || []),
    certifications: (sections.certifications || []).map(l => l.replace(BULLET_RE, '').trim()).filter(l => l.length > 2),
    languages: parseLanguages(sections.languages || [])
  };
}

function isContactish(s, contact) {
  return /@|https?:|www\.|linkedin|github|\d{6,}/i.test(s) || (contact.phone && s.includes(contact.phone));
}

function splitSegments(line) {
  return line.split(/\s*[|•·●▪]\s*|\s{3,}/).map(s => s.trim()).filter(Boolean);
}

function parseHeader(lines, contact) {
  let name = '';
  let title = '';
  let location = '';
  const segments = lines.slice(0, 10).flatMap(l => splitSegments(l.trim()));

  for (const seg of segments) {
    if (isContactish(seg, contact)) continue;
    if (!name && /^[A-Za-zÀ-ÿ.'’-]+(?:\s+[A-Za-zÀ-ÿ.'’-]+){1,3}$/.test(seg) && !ROLE_WORDS.test(seg) && !PLACE_WORDS.test(seg) && /[A-Z]/.test(seg[0])) {
      name = seg.split(/\s+/).map(w => (w === w.toUpperCase() && w.length > 2 ? w[0] + w.slice(1).toLowerCase() : w)).join(' ');
      continue;
    }
    if (name && !title && seg.split(/\s+/).length <= 10 && (ROLE_WORDS.test(seg) || /&/.test(seg)) && !PLACE_WORDS.test(seg)) {
      title = seg;
      continue;
    }
    if (!location && PLACE_WORDS.test(seg) && seg.length <= 80 && !ROLE_WORDS.test(seg)) {
      location = seg.replace(/^(address|location)\s*:\s*/i, '');
    }
  }
  return { name, title, location };
}

function normalisePeriod(match) {
  const year = s => (s.match(/(?:19|20)\d{2}/) || [''])[0];
  const end = /present|current|now|today|ongoing/i.test(match[2]) ? 'Present' : year(match[2]);
  return `${year(match[1])} – ${end}`;
}

function parseExperience(lines) {
  const jobs = [];
  let job = null;
  let pendingHeader = [];

  const startJob = (headerParts, period) => {
    job = { headerParts, period, bullets: [], extraHeader: 0 };
    jobs.push(job);
  };

  // A bullet that doesn't end a sentence continues on the next line, whatever its case
  const continues = (last, line) => last && !/[.!?]$/.test(last) && !ACTION_START.test(line);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    // Skip empty lines and stray bullet symbols on their own line
    if (!line || !line.replace(BULLET_RE, '').trim()) continue;
    const range = line.match(RANGE_RE);
    const isBullet = BULLET_RE.test(line);

    if (range && !isBullet) {
      const rest = line.replace(range[0], ' ').replace(/[()]/g, ' ').replace(/\s{2,}/g, '   ').trim();
      const parts = [...pendingHeader];
      if (rest) parts.push(rest);
      startJob(parts, normalisePeriod(range));
      pendingHeader = [];
      continue;
    }

    if (isBullet) {
      if (job) job.bullets.push(line.replace(BULLET_RE, '').trim());
      pendingHeader = [];
      continue;
    }

    const words = line.split(/\s+/).length;
    const looksLikeAchievement = ACTION_START.test(line) || /[.!]$/.test(line) || /\d+\s*%/.test(line);
    const last = job ? job.bullets[job.bullets.length - 1] : null;
    if (job && continues(last, line) && !range) {
      job.bullets[job.bullets.length - 1] = `${last} ${line}`;
    } else if (job && looksLikeAchievement) {
      job.bullets.push(line);
    } else if (job && job.bullets.length === 0 && job.extraHeader < 2 && words <= 12) {
      // Company / location line right under a dated job title
      job.headerParts.push(line);
      job.extraHeader++;
    } else if (job && words > 12) {
      job.bullets.push(line);
    } else {
      pendingHeader.push(line);
      if (pendingHeader.length > 3) pendingHeader.shift();
    }
  }

  return jobs.map(j => {
    const pieces = j.headerParts
      .flatMap(p => p.split(/\s*(?:\||·|•|—|–|\s-\s|\s@\s|,\s|\s{3,})\s*|\s+at\s+/i))
      .map(s => s.trim().replace(/^[,;:]+|[,;:]+$/g, ''))
      .filter(Boolean);
    const role = pieces.find(p => ROLE_WORDS.test(p)) || pieces[0] || 'Role';
    const locationParts = pieces.filter(p => p !== role && PLACE_WORDS.test(p));
    const company = pieces.find(p => p !== role && !locationParts.includes(p)) || 'Company';
    return {
      role: role.replace(/\s+-\s+/g, ' – '),
      company: company.replace(/\s+-\s+/g, ' – '),
      location: locationParts.join(', '),
      period: j.period,
      bullets: j.bullets.filter(b => b.length > 3)
    };
  });
}

function parseEducation(lines) {
  const entries = [];
  let entry = null;
  for (const rawLine of lines) {
    const line = rawLine.replace(BULLET_RE, '').trim();
    if (!line) continue;
    const years = line.match(YEAR_RE) || [];
    const schoolPart = () => (splitSegments(line).find(p => SCHOOL_WORDS.test(p)) || line)
      .replace(RANGE_RE, '').replace(YEAR_RE, '').replace(/[|,–-]+\s*$/, '').trim();
    if (EDU_WORDS.test(line)) {
      const pieces = line.split(/\s*(?:\||·|•|—|–|\s-\s|,\s|\s{3,})\s*/).map(s => s.trim()).filter(Boolean);
      const degree = (pieces.find(p => EDU_WORDS.test(p)) || line).replace(RANGE_RE, '').replace(YEAR_RE, '').replace(/[()]/g, '').trim();
      const school = pieces.find(p => SCHOOL_WORDS.test(p) && !EDU_WORDS.test(p)) || '';
      if (entry && !entry.degree) {
        entry.degree = degree;
        entry.school = entry.school || school;
        entry.years.push(...years);
      } else {
        entry = { degree, school, years: [...years] };
        entries.push(entry);
      }
    } else if (SCHOOL_WORDS.test(line) && (!entry || entry.school)) {
      entry = { degree: '', school: schoolPart(), years: [...years] };
      entries.push(entry);
    } else if (entry) {
      if (!entry.school && SCHOOL_WORDS.test(line)) entry.school = schoolPart();
      entry.years.push(...years);
    }
  }
  return entries.map(e => ({
    degree: e.degree || 'Degree',
    school: e.school,
    period: e.years.length > 1 ? `${e.years[0]} - ${e.years[e.years.length - 1]}` : (e.years[0] || '')
  }));
}

function parseSkills(lines) {
  const groups = [];
  const loose = [];
  let lastGroup = null;
  for (const rawLine of lines) {
    const line = rawLine.replace(BULLET_RE, '').trim();
    if (!line) { lastGroup = null; continue; }
    const labelled = line.match(/^([^:]{2,40}):\s*(.+)$/);
    const split = s => s.split(/\s*(?:,|;|\||•|·|●|▪|\s{3,})\s*/).map(x => x.replace(/\*\*/g, '').replace(/\.$/, '').trim()).filter(x => x && x.length <= 50);
    if (labelled) {
      lastGroup = { label: labelled[1].replace(/\*\*/g, '').trim(), items: split(labelled[2]) };
      groups.push(lastGroup);
    } else if (lastGroup && !BULLET_RE.test(rawLine)) {
      // A wrapped continuation of the previous group's list
      lastGroup.items.push(...split(line));
    } else {
      loose.push(...split(line));
    }
  }
  if (loose.length) groups.push({ label: groups.length ? 'Other' : 'Skills', items: loose });
  return groups.map(g => ({ ...g, items: [...new Set(g.items)] })).filter(g => g.items.length);
}

function parseProjects(lines) {
  const projects = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const text = line.replace(BULLET_RE, '').trim();
    const named = text.match(/^([^:–—]{2,60})\s*[:–—]\s+(.+)$/);
    const last = projects[projects.length - 1];
    if (named) projects.push({ name: named[1].trim(), desc: named[2].trim() });
    else if (text.split(/\s+/).length <= 6 && !/[.]$/.test(text)) projects.push({ name: text, desc: '' });
    else if (last) last.desc = `${last.desc} ${text}`.trim();
    else projects.push({ name: text.split(/\s+/).slice(0, 4).join(' '), desc: text });
  }
  return projects;
}

function parseLanguages(lines) {
  return lines
    .flatMap(l => l.replace(BULLET_RE, '').split(/\s*(?:,|;|\||•|·)\s*(?![^()]*\))/))
    .map(s => s.trim().replace(/\.+$/, ''))
    .filter(Boolean)
    .map(s => {
      const m = s.match(/^([A-Za-zÀ-ÿ]+(?:\s[A-Za-zÀ-ÿ]+)?)\s*(?:(?:[(:–—-]|\s{2,})\s*([^)]+)\)?)?$/);
      return m ? { name: m[1].trim(), level: (m[2] || '').trim() } : null;
    })
    .filter(Boolean)
    .slice(0, 8);
}

// ---------- Profile markdown ----------

function buildProfileMarkdown(cv, existingMarkdown) {
  const md = (s) => String(s || '').replace(/\|/g, '/').trim();
  const front = (existingMarkdown || '').match(/^---\n[\s\S]*?\n---\n/);
  const out = [];
  out.push(front ? front[0].trimEnd() : '---\nprofile_label: Imported from CV\n---');
  out.push('', '# Candidate Profile', '', '<!-- Imported from a CV. Check every section, fix anything that was read wrongly, then click Save profile. -->', '');
  out.push('## Identity');
  out.push(`- **Name:** ${cv.name}`);
  out.push(`- **Title:** ${cv.title}`);
  out.push(`- **Location:** ${cv.location}`);
  if (cv.phone) out.push(`- **Phone:** ${cv.phone}`);
  out.push(`- **Email:** ${cv.email}`);
  out.push(`- **LinkedIn:** ${cv.linkedin}`);
  if (cv.github) out.push(`- **GitHub:** ${cv.github}`);
  out.push('- **Status:**', '');

  out.push('### Languages', '| Language | Level | Notes |', '|----------|-------|-------|');
  cv.languages.forEach(l => out.push(`| ${md(l.name)} | ${md(l.level)} | |`));
  out.push('');

  if (cv.summary) out.push('## Summary', cv.summary, '');

  out.push('## Education', '', '| Degree | Period | Institution | Key Topics |', '|--------|--------|-------------|------------|');
  cv.education.forEach(e => out.push(`| ${md(e.degree)} | ${md(e.period)} | ${md(e.school)} | |`));
  out.push('');

  out.push('## Professional Experience', '');
  cv.experience.forEach(j => {
    out.push(`### ${j.role} - ${j.company} (${j.period})`);
    out.push(j.location || '');
    j.bullets.forEach(b => out.push(`- ${b}`));
    out.push('');
  });
  if (!cv.experience.length) out.push('<!-- No jobs were recognised. Add them like this:\n### Job Title - Company (2022 – 2025)\nCity, Country / Remote\n- What you achieved\n-->', '');

  out.push('## Independent Projects');
  cv.projects.forEach(p => out.push(`- **${p.name}**${p.desc ? `: ${p.desc}` : ''}`));
  out.push('');

  out.push('## Technical Skills', '', '### From CV');
  cv.skills.forEach(g => out.push(`- **${g.label}**: ${g.items.join(', ')}`));
  out.push('');

  out.push('## Certifications');
  cv.certifications.forEach(c => out.push(`- **${c.replace(/\*\*/g, '')}**`));
  out.push('');

  return out.join('\n');
}

function importSummary(cv, fileName) {
  const found = [];
  const missing = [];
  (cv.name ? found : missing).push('name');
  (cv.email ? found : missing).push('email');
  if (cv.experience.length) found.push(`${cv.experience.length} ${cv.experience.length === 1 ? 'job' : 'jobs'} (${cv.experience.reduce((n, j) => n + j.bullets.length, 0)} bullet points)`);
  else missing.push('work experience');
  if (cv.education.length) found.push(`${cv.education.length} education ${cv.education.length === 1 ? 'entry' : 'entries'}`);
  else missing.push('education');
  const skillCount = cv.skills.reduce((n, g) => n + g.items.length, 0);
  if (skillCount) found.push(`${skillCount} skills`);
  else missing.push('skills');
  if (cv.projects.length) found.push(`${cv.projects.length} projects`);
  if (cv.certifications.length) found.push(`${cv.certifications.length} certifications`);

  return `
    <div class="notice ${missing.length ? 'warn' : ''} import-notice">
      <span>
        <strong>Read from ${escapeHtml(fileName)}:</strong> ${escapeHtml(found.join(', ') || 'very little')}.
        ${missing.length ? `<br>Couldn't find: ${escapeHtml(missing.join(', '))}. Add ${missing.length === 1 ? 'it' : 'them'} below.` : ''}
        <br>Check each section and fix anything read wrongly, then click <strong>Save profile</strong>. Nothing is saved until you do.
      </span>
    </div>`;
}
