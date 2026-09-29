// CV tailoring engine.
//
// Builds a job-specific CV from the candidate profile markdown. Everything in
// the output is taken from the profile - the engine only selects, reorders and
// emphasises. Requirements the profile doesn't cover are reported as gaps and
// never written into the CV.

import fs from 'node:fs';
import path from 'node:path';

// Terms recognised in job descriptions. The first entry is the display name,
// the rest are aliases matched case-insensitively on word boundaries.
const LEXICON = [
  // Languages
  ['Python', 'python'], ['TypeScript', 'typescript'], ['JavaScript', 'javascript', 'es6'],
  ['Java', 'java'], ['Go', 'golang'], ['Rust', 'rust'], ['C#', 'c#'], ['C++', 'c++'],
  ['Ruby', 'ruby'], ['PHP', 'php'], ['Kotlin', 'kotlin'], ['Swift', 'swiftui'], ['Scala', 'scala'],
  ['SQL', 'sql'], ['HTML', 'html', 'html5'], ['CSS', 'css', 'css3'],
  // Backend
  ['Django', 'django'], ['Django REST Framework', 'django rest framework', 'drf'], ['FastAPI', 'fastapi'],
  ['Flask', 'flask'], ['Node.js', 'node.js', 'nodejs', 'node'], ['Express.js', 'express.js', 'expressjs'],
  ['NestJS', 'nestjs'], ['Spring', 'spring boot', 'spring'], ['.NET', '.net', 'asp.net'], ['Rails', 'rails', 'ruby on rails'],
  ['Laravel', 'laravel'], ['Celery', 'celery'], ['REST APIs', 'rest api', 'rest apis', 'restful'],
  ['GraphQL', 'graphql'], ['gRPC', 'grpc'], ['WebSockets', 'websocket', 'websockets'],
  ['Microservices', 'microservices', 'microservice'], ['Distributed systems', 'distributed systems', 'distributed system'],
  ['Event-driven architecture', 'event-driven', 'event driven'], ['System design', 'system design'],
  // Frontend
  ['React', 'react', 'react.js', 'reactjs'], ['Next.js', 'next.js', 'nextjs'], ['Vue', 'vue', 'vue.js', 'vuejs'],
  ['Angular', 'angular'], ['Svelte', 'svelte'], ['Redux', 'redux', 'redux toolkit'], ['Zustand', 'zustand'],
  ['Tailwind CSS', 'tailwind', 'tailwind css'], ['React Native', 'react native'], ['Flutter', 'flutter'],
  ['Accessibility', 'accessibility', 'a11y', 'wcag'], ['Core Web Vitals', 'core web vitals', 'web vitals', 'lighthouse'],
  ['Frontend performance', 'code splitting', 'lazy loading', 'bundle size', 'bundle sizes'],
  // Data
  ['PostgreSQL', 'postgresql', 'postgres'], ['MySQL', 'mysql'], ['MongoDB', 'mongodb', 'mongo'], ['Redis', 'redis'],
  ['Elasticsearch', 'elasticsearch'], ['ClickHouse', 'clickhouse'], ['SQLite', 'sqlite'], ['DynamoDB', 'dynamodb'],
  ['Kafka', 'kafka'], ['RabbitMQ', 'rabbitmq'], ['Snowflake', 'snowflake'], ['BigQuery', 'bigquery'],
  ['Airflow', 'airflow'], ['Spark', 'spark', 'pyspark'], ['dbt', 'dbt'], ['pgvector', 'pgvector'],
  ['Vector databases', 'vector database', 'vector databases', 'vector db', 'vector search', 'pinecone', 'weaviate'],
  ['Query optimization', 'query optimization', 'indexing', 'schema design'],
  // AI
  ['LLMs', 'llm', 'llms', 'large language model', 'large language models'], ['AI', 'ai', 'artificial intelligence'],
  ['Machine learning', 'machine learning', 'ml'], ['OpenAI API', 'openai'], ['Anthropic Claude', 'anthropic', 'claude'],
  ['Claude Code', 'claude code'], ['LangChain', 'langchain'], ['LangGraph', 'langgraph'],
  ['MCP', 'mcp', 'model context protocol'], ['Agentic workflows', 'agentic', 'ai agents', 'agents', 'agent workflows'],
  ['RAG', 'rag', 'retrieval-augmented', 'retrieval augmented'], ['Prompt engineering', 'prompt engineering'],
  ['Embeddings', 'embeddings'], ['Fine-tuning', 'fine-tuning', 'fine tuning'], ['PyTorch', 'pytorch'],
  ['TensorFlow', 'tensorflow'], ['Cursor AI', 'cursor'],
  // Cloud & DevOps
  ['AWS', 'aws', 'amazon web services'], ['GCP', 'gcp', 'google cloud'], ['Azure', 'azure'],
  ['Docker', 'docker', 'containerized', 'containers'], ['Kubernetes', 'kubernetes', 'k8s'], ['Terraform', 'terraform'],
  ['CI/CD', 'ci/cd', 'cicd', 'continuous integration', 'continuous delivery', 'continuous deployment'],
  ['GitHub Actions', 'github actions'], ['GitLab CI', 'gitlab ci', 'gitlab ci/cd', 'gitlab'], ['Linux', 'linux'],
  ['Nginx', 'nginx'], ['Serverless', 'serverless', 'lambda'], ['Vercel', 'vercel'],
  // Observability & quality
  ['Observability', 'observability', 'monitoring', 'tracing', 'logging'], ['Sentry', 'sentry'], ['Datadog', 'datadog'],
  ['Grafana', 'grafana'], ['Prometheus', 'prometheus'], ['OpenTelemetry', 'opentelemetry'],
  ['Testing', 'unit tests', 'unit testing', 'integration tests', 'automated testing', 'test coverage', 'tdd'],
  ['PyTest', 'pytest'], ['Jest', 'jest'], ['Cypress', 'cypress'], ['Playwright', 'playwright'], ['Vitest', 'vitest'],
  // Ways of working
  ['Mentoring', 'mentoring', 'mentor', 'mentored', 'coaching'], ['Code review', 'code review', 'code reviews', 'pull request reviews'],
  ['Technical leadership', 'technical leadership', 'tech lead', 'lead engineer', 'led the architecture'],
  ['Agile', 'agile', 'scrum'], ['Cross-functional collaboration', 'cross-functional', 'product designers', 'stakeholders'],
  ['Security', 'security', 'authentication', 'authorization', 'oauth']
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termRegex = (aliases) =>
  new RegExp(`(?<![a-z0-9])(?:${aliases.map(escapeRe).sort((a, b) => b.length - a.length).join('|')})(?![a-z0-9])`, 'gi');

const TERMS = LEXICON.map(([name, ...aliases]) => ({ name, re: termRegex(aliases) }));

// ---------- Profile parsing ----------

function section(md, name) {
  const m = md.match(new RegExp(`^## ${escapeRe(name)}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
  return m ? m[1] : '';
}

function splitTopLevel(text) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}

// Template comments (<!-- ... -->) are guidance, not profile content
export const stripComments = (md) => String(md || '').replace(/<!--[\s\S]*?-->/g, '');

export function parseProfile(rawMd) {
  const md = stripComments(rawMd);
  const field = (label) => (md.match(new RegExp(`\\*\\*${label}:\\*\\*[ \\t]*(.*)`)) || [])[1]?.trim() || '';

  const experience = [];
  const expRe = /^### (.+?) - (.+?) \((.+?)\)\s*\n(?!- )(.*)\n((?:- .*\n?)*)/gm;
  let m;
  const expText = section(md, 'Professional Experience');
  while ((m = expRe.exec(expText))) {
    experience.push({
      role: m[1].trim(), company: m[2].trim(), period: m[3].trim(), location: m[4].trim(),
      bullets: m[5].split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim())
    });
  }

  // Technical skills: one group per bullet line, labelled by its bold head
  const skills = [];
  let heading = '';
  for (const line of section(md, 'Technical Skills').split('\n')) {
    if (line.startsWith('### ')) { heading = line.slice(4).trim(); continue; }
    if (!line.startsWith('- ')) continue;
    const clean = line.slice(2).replace(/\*\*/g, '').replace(/\s*\((Expert|Advanced|Intermediate|Proficient|Basic)\)/gi, '');
    const colon = clean.indexOf(':');
    if (colon > -1) {
      skills.push({ group: clean.slice(0, colon).trim(), items: splitTopLevel(clean.slice(colon + 1)) });
    } else {
      skills.push({ group: heading, items: splitTopLevel(clean) });
    }
  }

  const tableRows = (text) => text.split('\n')
    .filter(l => l.trim().startsWith('|') && !/^\|\s*-/.test(l.trim()))
    .slice(1)
    .map(l => l.split('|').slice(1, -1).map(c => c.trim()));

  const listItems = (text) => text.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).trim());

  return {
    name: field('Name'),
    email: field('Email'),
    linkedin: field('LinkedIn'),
    location: field('Location'),
    experience,
    skills,
    education: tableRows(section(md, 'Education')).map(r => ({ degree: r[0], period: r[1], school: r[2] })),
    projects: listItems(section(md, 'Independent Projects')).map(l => {
      const [, name, desc] = l.match(/\*\*(.+?)\*\*:?\s*(.*)/) || [null, l, ''];
      return { name, desc };
    }),
    certifications: listItems(section(md, 'Certifications')).map(l => l.replace(/\*\*/g, '')),
    languages: tableRows((md.match(/### Languages\s*\n([\s\S]*?)\n\n/) || [])[1] || '').map(r => ({ name: r[0], level: r[1] }))
  };
}

// ---------- Job description analysis ----------

function countMatches(re, text) {
  re.lastIndex = 0;
  return (text.match(re) || []).length;
}

export function analyseJob(description, title, rawProfileText) {
  const profileText = stripComments(rawProfileText);
  const jd = `${title}\n${description}`;
  // Anything after a "nice to have" style heading counts as optional
  const split = jd.search(/nice[- ]to[- ]haves?|preferred|bonus points|\bbonus\b|a plus|good to have/i);
  const required = split > -1 ? jd.slice(0, split) : jd;
  const optional = split > -1 ? jd.slice(split) : '';

  const found = [];
  for (const t of TERMS) {
    const req = countMatches(t.re, required);
    const opt = countMatches(t.re, optional);
    if (!req && !opt) continue;
    t.re.lastIndex = 0;
    found.push({
      name: t.name,
      re: t.re,
      weight: req * 2 + opt,
      required: req > 0,
      firstSeen: jd.search(t.re),
      inProfile: countMatches(t.re, profileText) > 0
    });
  }
  found.sort((a, b) => b.weight - a.weight || a.firstSeen - b.firstSeen);
  return {
    matched: found.filter(f => f.inProfile),
    missing: found.filter(f => !f.inProfile)
  };
}

// ---------- Markup ----------

// Wrap every mention of a matched term in `text` using the given renderer.
function markup(text, terms, esc, wrap) {
  const ranges = [];
  for (const t of terms) {
    t.re.lastIndex = 0;
    let m;
    while ((m = t.re.exec(text))) ranges.push([m.index, m.index + m[0].length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  let out = '', pos = 0;
  for (const [s, e] of merged) {
    out += esc(text.slice(pos, s)) + wrap(esc(text.slice(s, e)));
    pos = e;
  }
  return out + esc(text.slice(pos));
}

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const escTex = (s) => String(s)
  .replace(/\\/g, '\\textbackslash{}')
  .replace(/([&%$#_{}])/g, '\\$1')
  .replace(/~/g, '\\textasciitilde{}')
  .replace(/\^/g, '\\textasciicircum{}')
  .replace(/[–—]/g, '--');

// ---------- Tailoring ----------

// Turn a bullet's quantified result into a short noun phrase for the summary,
// e.g. "...lowering database latency by 47%" -> "a 47% reduction in database latency".
function metricPhrase(text) {
  const by = text.match(/^(.*?)\s+by\s+(\d+(?:\.\d+)?%)/i);
  if (by) {
    const verbs = [...by[1].matchAll(/\b(reduc|cut|lower|decreas|shorten|improv|increas|boost|accelerat)\w*\s+/gi)];
    const verb = verbs[verbs.length - 1];
    if (verb) {
      const object = by[1].slice(verb.index + verb[0].length).trim();
      if (object && object.split(/\s+/).length <= 6) {
        const kind = /^(improv|increas|boost|accelerat)/i.test(verb[1]) ? 'improvement' : 'reduction';
        return `a ${by[2]} ${kind} in ${object}`;
      }
    }
  }
  const coverage = text.match(/(\d+%)\s+test coverage/i);
  if (coverage) return `${coverage[1]} test coverage`;
  const users = text.match(/(\d{1,3}(?:,\d{3})+\+?)\s+concurrent users/i);
  if (users) return `systems serving ${users[1]} concurrent users`;
  return null;
}

export function yearsOfExperience(experience) {
  const years = experience.flatMap(x => (x.period.match(/\d{4}/g) || []).map(Number));
  const current = experience.some(x => /present|current/i.test(x.period)) ? new Date().getFullYear() : Math.max(...years);
  return years.length ? current - Math.min(...years) : 0;
}

export function tailorCV({ title = '', company = '', description = '' }, profileMd) {
  const profile = parseProfile(profileMd);
  const { matched, missing } = analyseJob(description, title, profileMd);
  const terms = matched;
  const changes = [];

  // Experience: rank bullets by how many job requirements they evidence
  let dropped = 0, reordered = 0;
  const experience = profile.experience.map((job, i) => {
    const scored = job.bullets.map((text, idx) => {
      const hits = terms.filter(t => countMatches(t.re, text) > 0);
      return { text, idx, score: hits.reduce((s, t) => s + t.weight, 0), hits: hits.map(t => t.name) };
    });
    const ranked = [...scored].sort((a, b) => b.score - a.score || a.idx - b.idx);
    // Recent roles keep more detail; older roles are trimmed to what's most relevant
    const limit = [5, 4][i] || 3;
    const kept = ranked.slice(0, limit);
    dropped += job.bullets.length - kept.length;
    if (kept.some((b, n) => b.idx !== n)) reordered++;
    return { ...job, bullets: kept };
  });
  if (reordered) changes.push(`Reordered bullets in ${reordered} role${reordered > 1 ? 's' : ''} so the most relevant achievements come first`);
  if (dropped) changes.push(`Trimmed ${dropped} less relevant bullet${dropped > 1 ? 's' : ''} to keep the CV focused`);

  // Skills: matched items first inside each group, most relevant groups first
  const isMatch = (item) => terms.some(t => countMatches(t.re, item) > 0);
  const skills = profile.skills.map(g => {
    const items = g.items.map(name => ({ name, matched: isMatch(name) }));
    items.sort((a, b) => b.matched - a.matched);
    return { group: g.group, items, score: items.filter(i => i.matched).length + (isMatch(g.group) ? 1 : 0) };
  }).sort((a, b) => b.score - a.score);
  const matchedSkillCount = skills.reduce((n, g) => n + g.items.filter(i => i.matched).length, 0);
  if (matchedSkillCount) changes.push(`Moved ${matchedSkillCount} matching skill${matchedSkillCount > 1 ? 's' : ''} to the front of your skills section`);

  // Summary built only from profile facts
  const years = yearsOfExperience(profile.experience);
  const recent = profile.experience[0];
  const focus = terms.filter(t => !['AI', 'Testing', 'Observability'].includes(t.name)).slice(0, 6).map(t => t.name);
  const metrics = [];
  for (const b of experience.flatMap(x => x.bullets)) {
    const phrase = b.score > 0 ? metricPhrase(b.text) : null;
    if (phrase) metrics.push(phrase);
    if (metrics.length === 2) break;
  }
  let summary = `${recent ? recent.role : 'Engineer'} with ${years ? `${years}+ years of` : ''} experience`;
  summary += focus.length ? ` building production systems with ${joinList(focus)}.` : ' building production software.';
  if (metrics.length) summary += ` Proven impact includes ${joinList(metrics)}.`;
  if (profile.experience.length > 1) {
    summary += ` Brings hands-on experience across ${profile.experience.length} engineering roles, from product delivery to architecture and mentoring.`;
  }
  changes.unshift(focus.length
    ? `Wrote a new summary around ${joinList(focus.slice(0, 3))}`
    : 'Wrote a general summary (no specific technologies detected in the posting)');

  // Projects that support the posting
  const projects = profile.projects
    .map(p => ({ ...p, score: terms.filter(t => countMatches(t.re, `${p.name} ${p.desc}`) > 0).length }))
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  if (projects.length) changes.push(`Added ${projects.length} relevant side project${projects.length > 1 ? 's' : ''}`);

  const requiredTotal = matched.filter(t => t.required).length + missing.filter(t => t.required).length;
  const requiredMatched = matched.filter(t => t.required).length;
  const matchScore = requiredTotal ? Math.round((requiredMatched / requiredTotal) * 100) : (matched.length ? 100 : 0);

  const cv = {
    name: profile.name,
    headline: recent ? recent.role : '',
    email: profile.email,
    linkedin: profile.linkedin,
    location: profile.location.replace(/\s*\(.*\)\s*$/, ''),
    summary,
    skills: skills.map(({ group, items }) => ({ group, items })),
    experience: experience.map(({ bullets, ...job }) => ({ ...job, bullets: bullets.map(b => b.text) })),
    projects: projects.map(({ name, desc }) => ({ name, desc })),
    education: profile.education,
    certifications: profile.certifications,
    languages: profile.languages
  };

  return {
    job: { title, company },
    analysis: {
      matchScore,
      matched: matched.map(t => ({ name: t.name, required: t.required })),
      missing: missing.map(t => ({ name: t.name, required: t.required }))
    },
    changes,
    cv,
    html: renderHtml(cv, terms),
    text: renderText(cv),
    latex: renderLatex(cv, terms, title, company),
    filename: cvFilename(company, title)
  };
}

function joinList(list) {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

export function cvFilename(company, title) {
  const clean = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ')
    .filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('').slice(0, 32);
  return `main_${clean(company) || 'Company'}_${clean(title) || 'Role'}.tex`;
}

// ---------- Renderers ----------

function renderHtml(cv, terms) {
  const hl = (s) => markup(s, terms, escHtml, (x) => `<mark>${x}</mark>`);
  return `
<header class="cv-header">
  <h1>${escHtml(cv.name)}</h1>
  <p class="cv-headline">${escHtml(cv.headline)}</p>
  <p class="cv-contact">${[cv.location, cv.email, cv.linkedin.replace(/^https?:\/\/(www\.)?/, '')].filter(Boolean).map(escHtml).join('<span>·</span>')}</p>
</header>
<section><h2>Profile</h2><p>${hl(cv.summary)}</p></section>
<section><h2>Core Competencies</h2><ul class="cv-skills">${cv.skills.map(g => `<li><strong>${escHtml(g.group)}:</strong> ${g.items.map(i => i.matched ? `<mark>${escHtml(i.name)}</mark>` : escHtml(i.name)).join(', ')}</li>`).join('')}</ul></section>
<section><h2>Professional Experience</h2>${cv.experience.map(x => `
  <div class="cv-job">
    <div class="cv-job-head"><div><strong>${escHtml(x.role)}</strong> · ${escHtml(x.company)}</div><span>${escHtml(x.period)}</span></div>
    <div class="cv-job-loc">${escHtml(x.location)}</div>
    <ul>${x.bullets.map(b => `<li>${hl(b)}</li>`).join('')}</ul>
  </div>`).join('')}</section>
${cv.projects.length ? `<section><h2>Selected Projects</h2><ul>${cv.projects.map(p => `<li><strong>${escHtml(p.name)}:</strong> ${hl(p.desc)}</li>`).join('')}</ul></section>` : ''}
<section><h2>Education</h2>${cv.education.map(e => `<div class="cv-job-head"><div><strong>${escHtml(e.degree)}</strong> · ${escHtml(e.school)}</div><span>${escHtml(e.period)}</span></div>`).join('')}</section>
${cv.certifications.length ? `<section><h2>Certifications</h2><ul>${cv.certifications.map(c => `<li>${escHtml(c)}</li>`).join('')}</ul></section>` : ''}
${cv.languages.length ? `<section><h2>Languages</h2><p>${cv.languages.map(l => `<strong>${escHtml(l.name)}</strong> (${escHtml(l.level)})`).join(' · ')}</p></section>` : ''}`;
}

function renderText(cv) {
  const lines = [
    cv.name, cv.headline, [cv.location, cv.email, cv.linkedin].filter(Boolean).join(' | '), '',
    'PROFILE', cv.summary, '',
    'CORE COMPETENCIES', ...cv.skills.map(g => `${g.group}: ${g.items.map(i => i.name).join(', ')}`), '',
    'PROFESSIONAL EXPERIENCE'
  ];
  for (const x of cv.experience) {
    lines.push(`${x.role} - ${x.company} (${x.period}) | ${x.location}`, ...x.bullets.map(b => `- ${b}`), '');
  }
  if (cv.projects.length) lines.push('SELECTED PROJECTS', ...cv.projects.map(p => `- ${p.name}: ${p.desc}`), '');
  lines.push('EDUCATION', ...cv.education.map(e => `${e.degree} - ${e.school} (${e.period})`), '');
  if (cv.certifications.length) lines.push('CERTIFICATIONS', ...cv.certifications.map(c => `- ${c}`), '');
  if (cv.languages.length) lines.push('LANGUAGES', cv.languages.map(l => `${l.name} (${l.level})`).join(', '));
  return lines.join('\n').trim();
}

function renderLatex(cv, terms, title, company) {
  // Matched keywords are already worked into the wording; keep the final document unhighlighted
  const bold = (s) => escTex(s);
  const nameParts = cv.name.split(' ');
  const last = nameParts.pop() || '';
  const first = nameParts.join(' ');
  const linkedinShort = cv.linkedin.replace(/^https?:\/\/(www\.)?linkedin\.com\//, '');

  return `%% Tailored CV - ${escTex(cv.name)}
%% Target: ${escTex(title)}${company ? ` at ${escTex(company)}` : ''}
%% Generated by the dashboard Tailor CV tool from the candidate profile.

\\documentclass[11pt,a4paper,sans]{moderncv}
\\moderncvstyle{banking}
\\moderncvcolor{blue}

\\renewcommand*{\\namefont}{\\fontsize{32}{34}\\bfseries\\upshape}
\\colorlet{firstnamecolor}{color1}
\\colorlet{lastnamecolor}{color1}
\\colorlet{namecolor}{color1}
\\renewcommand*{\\sectionstyle}[1]{{\\sectionfont\\color{color1}#1}}

\\usepackage[utf8]{inputenc}
\\AtEndPreamble{\\hypersetup{
    colorlinks=true,
    urlcolor=blue,
    pdftitle={${escTex(cv.name)} - CV},
    pdfpagemode=UseNone,
}}
\\usepackage[scale=0.80]{geometry}
\\usepackage{needspace}

\\name{${escTex(first)}}{${escTex(last)}}
\\address{${escTex(cv.location)}}{}{}
\\email{${escTex(cv.email)}}
\\extrainfo{\\href{${cv.linkedin}}{LinkedIn: ${escTex(linkedinShort)}}}

\\begin{document}

\\makecvtitle

\\vspace{4pt}
\\small{${bold(cv.summary)}}

\\section{Core Competencies}
\\vspace{1pt}
\\begin{itemize}
${cv.skills.map(g => `\\item \\textbf{${escTex(g.group)}}: ${g.items.map(i => escTex(i.name)).join(', ')}.`).join('\n')}
\\end{itemize}

\\section{Professional Experience}
\\vspace{3pt}
\\begin{itemize}
${cv.experience.map(x => `
\\needspace{5\\baselineskip}
\\item{\\cventry{${escTex(x.period.replace(/\s*[–—-]\s*/, '--'))}}{${escTex(x.role)}}{${escTex(x.company)}}{${escTex(x.location)}}{}{\\vspace{1pt}
\\begin{itemize}
${x.bullets.map(b => `    \\item {${bold(b)}}`).join('\n')}
\\end{itemize}}}
\\vspace{3pt}`).join('\n')}
\\end{itemize}
${cv.projects.length ? `
\\section{Selected Projects}
\\begin{itemize}
${cv.projects.map(p => `\\item \\textbf{${escTex(p.name)}}: ${bold(p.desc)}`).join('\n')}
\\end{itemize}
` : ''}
\\section{Education}
${cv.education.map(e => `\\cventry{${escTex(e.period.replace(/\s*[–—-]\s*/, '--'))}}{${escTex(e.degree)}}{${escTex(e.school)}}{}{}{}`).join('\n')}
${cv.certifications.length ? `
\\section{Certifications}
${cv.certifications.map(c => `\\cvitem{}{${escTex(c)}}`).join('\n')}
` : ''}${cv.languages.length ? `
\\section{Languages}
${cv.languages.map(l => `\\cvitem{${escTex(l.name)}}{${escTex(l.level)}}`).join('\n')}
` : ''}
\\end{document}
`;
}

// Write the tailored LaTeX next to the master CV (cv/main_*.tex is gitignored).
export function saveTailoredCV(result, rootDir) {
  const dir = path.join(rootDir, 'cv');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, path.basename(result.filename));
  fs.writeFileSync(file, result.latex);
  return path.relative(rootDir, file);
}
