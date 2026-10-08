import './env.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tailorCV, saveTailoredCV, renderTailoredCV, profileToCV, applyInstructions, scopeCV, scopeText, mergeScoped } from './tailor.js';
import { applyWithLocalModel, localModelReady } from './local-llm.js';
import { cloudAiConfigured, applyWithCloudModel, answerQuestions } from './cloud-llm.js';
import { compileLatexWithRetry, LatexCompileError } from './latex-compile.js';
import { resolveProfile, listProfiles, profileDetails, usesOriginalOwner, readProfileMarkdown, writeProfileMarkdown, evaluateAgainstProfile } from './profiles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf'
};

// ---------- Job portal CLIs (.agents/skills/*-search) ----------

const PORTAL_CLIS = {
  freehire: '.agents/skills/freehire-search/cli/src/cli.ts',
  linkedin: '.agents/skills/linkedin-search/cli/src/cli.ts'
};

// Dashboard regions mapped onto each portal's filters. Freehire tags jobs with
// overlapping region codes, so each region ORs every code that belongs to it.
const FREEHIRE_REGIONS = {
  'APAC': ['--region', 'apac,asia'],
  'APJ': ['--region', 'apac,asia,jp'],
  'MENA': ['--region', 'mena,middle_east'],
  'EMEA': ['--region', 'emea,eu,mena,middle_east,africa'],
  'NAMER': ['--region', 'north_america,us,ca'],
  'Worldwide': []
};

// LinkedIn resolves these names to its own geo regions
const LINKEDIN_REGIONS = {
  'APAC': 'APAC',
  'APJ': 'APJ',
  'MENA': 'MENA',
  'EMEA': 'EMEA',
  'NAMER': 'North America',
  'Worldwide': 'Worldwide'
};

const CLI_TIMEOUT_MS = 45000;

function runPortalCli(portal, args) {
  return new Promise((resolve) => {
    const child = spawn('bun', ['run', path.join(ROOT_DIR, PORTAL_CLIS[portal]), ...args], {
      cwd: ROOT_DIR,
      env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` }
    });
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ stdout: '', stderr: 'The job board took too long to respond. Try again.', code: -1 });
    }, CLI_TIMEOUT_MS);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      finish({ stdout: '', stderr: err.code === 'ENOENT' ? 'bun is not installed (https://bun.sh)' : err.message, code: -1 });
    });
    child.on('close', (code) => finish({ stdout, stderr, code }));
  });
}

// CLIs print a one-line JSON or plain error on stderr; surface just the message
function cliError(stderr, code) {
  const text = (stderr || '').trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed.error) return String(parsed.error.message || parsed.error);
  } catch {}
  return text.split('\n').filter(Boolean).pop() || `Search tool exited with code ${code}`;
}

// A proper CSV parser, not a line-splitter: a quoted field (e.g. a note with "Add a
// note:" joining several lines with "\n") can itself contain a real newline, so rows can
// only be split on a newline that isn't inside quotes — splitting the whole text on "\n"
// first (the previous approach) tears a multi-line field into two broken rows.
function parseCSV(csvText) {
  const text = String(csvText || '').trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text) return [];
  const rows = [];
  let row = [], field = '', insideQuotes = false;
  const pushField = () => { row.push(field.trim()); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (insideQuotes) {
      if (char === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else insideQuotes = false; }
      else field += char;
      continue;
    }
    if (char === '"') insideQuotes = true;
    else if (char === ',') pushField();
    else if (char === '\n') pushRow();
    else field += char;
  }
  if (field !== '' || row.length) pushRow();
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).filter(r => r.some(v => v !== '')).map(values => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = values[idx] !== undefined ? values[idx] : ''; });
    return obj;
  });
}

function stringifyCSV(headers, rows) {
  const headerLine = headers.join(',');
  const rowLines = rows.map(r => {
    return headers.map(h => {
      let val = r[h] !== undefined ? String(r[h]) : '';
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        val = `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    }).join(',');
  });
  return [headerLine, ...rowLines].join('\n') + '\n';
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // CORS headers for local versatility
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Every API call works on the profile selected in the dashboard (?profile=<id>)
  const profile = resolveProfile(ROOT_DIR, parsedUrl.searchParams.get('profile'));

  // API Endpoints
  if (pathname === '/api/profiles' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(listProfiles(ROOT_DIR)));
    return;
  }

  if (pathname === '/api/profile' && req.method === 'GET' && !usesOriginalOwner(profile)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(profileDetails(profile)));
    return;
  }

  if (pathname === '/api/profile' && req.method === 'PUT') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { markdown } = JSON.parse(body || '{}');
        if (typeof markdown !== 'string' || !markdown.trim() || markdown.length > 200000) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Profile text is empty or too long.' }));
          return;
        }
        writeProfileMarkdown(profile, markdown);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/profile' && req.method === 'GET') {
    try {
      const profilePath = path.join(ROOT_DIR, '.claude/skills/job-application-assistant/01-candidate-profile.md');
      let profileText = '';
      if (fs.existsSync(profilePath)) {
        profileText = fs.readFileSync(profilePath, 'utf-8');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: profile.id,
        label: profile.label,
        builtin: true,
        original: true,
        complete: true,
        name: 'Hassaan Nasir',
        title: 'Senior Full Stack & AI Engineer',
        experience: '8+ Years',
        email: 'hasaan.engineer1@gmail.com',
        location: 'Pakistan / UAE / Worldwide Remote',
        linkedin: 'https://linkedin.com/in/hassaan713-nasir',
        skills: {
          primary: ['Python 3', 'Django', 'Django REST Framework', 'React.js', 'Next.js', 'TypeScript', 'PostgreSQL', 'Celery', 'Redis', 'REST APIs', 'Microservices'],
          ai: ['Claude Code', 'Anthropic Claude API', 'OpenAI API', 'LangChain', 'LangGraph', 'Model Context Protocol (MCP)', 'Cursor AI'],
          cloud: ['Docker', 'Kubernetes', 'AWS (EC2, ECS, S3, RDS)', 'GitLab CI/CD', 'GitHub Actions', 'Terraform', 'Linux'],
          observability: ['Sentry', 'Datadog', 'Grafana', 'Prometheus', 'OpenTelemetry'],
          secondary: ['FastAPI', 'Node.js', 'Express.js', 'ClickHouse', 'Elasticsearch', 'GraphQL', 'Tailwind CSS']
        },
        rawMarkdown: profileText
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // CV tailoring (see tailor.js)
  // Edit CV / CV Editor: re-render an edited CV, start from the profile, real PDF
  if (pathname === '/api/cv/from-profile' && req.method === 'GET') {
    const cv = profileToCV(readProfileMarkdown(profile));
    const ok = cv.name || cv.experience.length;
    res.writeHead(ok ? 200 : 422, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ok ? renderTailoredCV(cv, {}, '') : { error: `The ${profile.label} profile is still empty. Fill it in first, or start from a blank CV.` }));
    return;
  }

  // A question the review's fixed categories can't answer specifically: a real,
  // CV-grounded answer from the cloud model (if configured). Read-only; never edits the CV.
  if (pathname === '/api/cv/ask' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 300000) req.destroy(); });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        if (!data.cv || typeof data.cv !== 'object') throw Object.assign(new Error('Tailor a CV first.'), { status: 400 });
        const questions = Array.isArray(data.questions) ? data.questions.map(String).filter(q => q.trim()).slice(0, 10) : [];
        let answers = {};
        if (questions.length && cloudAiConfigured) {
          const job = data.job && typeof data.job === 'object' ? data.job : null;
          answers = await answerQuestions(data.cv, job, questions);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ answers }));
      } catch (err) {
        console.error('Question answering failed:', err);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ answers: {} }));
      }
    });
    return;
  }

  // "Tell it what to add or change": plain instructions applied to the CV being edited
  if (pathname === '/api/cv/instruct' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 300000) req.destroy(); });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        if (!data.cv || typeof data.cv !== 'object') throw Object.assign(new Error('Tailor a CV first.'), { status: 400 });
        const text = String(data.text || '').slice(0, 4000);
        if (!text.trim()) throw Object.assign(new Error('Write what you want to add or change.'), { status: 400 });
        const job = data.job && typeof data.job === 'object' ? data.job : {};
        // one Edit CV section (and which job or project): only that section changes
        const sc = data.scope && typeof data.scope === 'object' && ['personal', 'summary', 'skills', 'experience', 'projects', 'education', 'certifications'].includes(String(data.scope.section))
          ? { section: String(data.scope.section), index: Math.max(0, Math.floor(Number(data.scope.index) || 0)) } : null;
        // Explicit, per-request opt-out of the fabrication check — off unless the caller
        // (an explicit, user-visible toggle) asks for an unverified draft. Never the
        // default: without it the AI can invent technologies, numbers or employers.
        const unfiltered = data.unfiltered === true;
        const result = applyInstructions(sc ? scopeCV(data.cv, sc) : data.cv, sc ? scopeText(text, sc, data.cv) : text, { job: { title: String(job.title || '').slice(0, 200), description: String(job.description || '').slice(0, 30000) }, unfiltered });
        let cloud = false;
        if (result.pending.length > 0 && cloudAiConfigured) {
          const pendingBefore = [...result.pending];
          const unclearBefore = [...result.unclear];
          cloud = await applyWithCloudModel(result, unfiltered);
          if (!cloud) { result.pending = pendingBefore; result.unclear = unclearBefore; }
        }
        const local = !cloud && result.pending.length > 0 && await localModelReady();
        if (local) await applyWithLocalModel(result, unfiltered);
        if (sc) result.cv = mergeScoped(data.cv, result.cv, sc);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...result, ai: cloud || local, unfiltered: unfiltered && (cloud || local) }));
      } catch (err) {
        res.writeHead(err.status || 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if ((pathname === '/api/cv/render' || pathname === '/api/cv/pdf') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 300000) req.destroy(); });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        if (!data.cv || typeof data.cv !== 'object') throw Object.assign(new Error('Nothing to render.'), { status: 400 });
        const job = data.job && typeof data.job === 'object' ? data.job : {};
        const jobInput = {
          title: String(job.title || '').slice(0, 200),
          company: String(job.company || '').slice(0, 200),
          description: String(job.description || '').slice(0, 30000),
          confirmedSkills: Array.isArray(job.confirmedSkills) ? job.confirmedSkills.map(String).slice(0, 60) : []
        };
        const options = { template: String(data.template || ''), styles: data.styles && typeof data.styles === 'object' ? data.styles : {} };
        const oneOff = typeof data.profileMarkdown === 'string' && data.profileMarkdown.trim() ? data.profileMarkdown.slice(0, 200000) : '';
        const rendered = renderTailoredCV(data.cv, jobInput, jobInput.description ? (oneOff || readProfileMarkdown(profile)) : '', options);
        if (pathname === '/api/cv/render') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(rendered));
          return;
        }
        if (!rendered.cv.name) throw Object.assign(new Error('Add your name before downloading.'), { status: 400 });
        const pdf = await compileLatexWithRetry(rendered.latex);
        const safeName = `${rendered.cv.name}-CV`.replace(/[^A-Za-z0-9 _-]+/g, '').replace(/\s+/g, '_').slice(0, 60) || 'CV';
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${safeName}.pdf"` });
        res.end(pdf);
      } catch (err) {
        const status = err instanceof LatexCompileError ? 502 : err.status || (err instanceof SyntaxError ? 400 : 500);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof LatexCompileError
          ? (err.code === 'COMPILER_UNAVAILABLE' ? 'The PDF service is not reachable right now. Try again, or download the .tex file.' : 'This CV could not be compiled to PDF. Download the .tex file to see why.')
          : err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/tailor' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { title = '', company = '', description = '', save = false, confirmedSkills = [], latex, filename, template = '', styles = {}, profileMarkdown } = JSON.parse(body || '{}');
        // "Save to cv/": the exact CV on screen
        if (save && typeof latex === 'string' && typeof filename === 'string') {
          if (!/^main_[A-Za-z0-9_]+\.tex$/.test(filename) || !latex.trim() || latex.length > 300000) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Nothing valid to save.' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ savedTo: saveTailoredCV({ filename, latex }, ROOT_DIR) }));
          return;
        }
        if (!description.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Paste a job description first.' }));
          return;
        }
        // "Another CV" from the Tailor page, used for this request only (never saved)
        const oneOff = typeof profileMarkdown === 'string' && profileMarkdown.trim() ? profileMarkdown.slice(0, 200000) : '';
        const profileMd = oneOff || readProfileMarkdown(profile);
        if (!profileMd.trim()) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Candidate profile not found. Run /setup first.' }));
          return;
        }
        // Skills the candidate confirmed they have, for gaps their profile doesn't mention
        const confirmed = Array.isArray(confirmedSkills) ? confirmedSkills.map(String).filter(s => s.trim() && s.length <= 60).slice(0, 60) : [];
        const result = tailorCV({ title, company, description, confirmedSkills: confirmed }, profileMd, { template: String(template || ''), styles: styles && typeof styles === 'object' ? styles : {} });
        if (!result.cv.name || !result.cv.experience.length) {
          res.writeHead(422, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `The ${profile.label} profile is still empty. Fill in its name and experience first.` }));
          return;
        }
        if (save) result.savedTo = saveTailoredCV(result, ROOT_DIR);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/tracker' && req.method === 'GET') {
    try {
      const trackerPath = profile.trackerPath;
      if (!fs.existsSync(trackerPath) && !profile.builtin) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
        return;
      }
      if (!fs.existsSync(trackerPath)) {
        // Return starter template if empty
        const starterHeaders = ['date', 'company', 'sector', 'role', 'role_type', 'channel', 'status', 'contact_person', 'fit_rating', 'notes', 'cv_file', 'cover_letter_file', 'source', 'deadline'];
        const starterData = [
          {
            date: '2026-09-01',
            company: 'Deployly AI',
            sector: 'AI & Developer Tools',
            role: 'Senior Full Stack AI Engineer',
            role_type: 'Full-time',
            channel: 'LinkedIn',
            status: 'drafted',
            contact_person: 'Talent Acquisition',
            fit_rating: '94',
            notes: 'High synergy with Claude Code, Python, and Next.js background',
            cv_file: 'cv/main_DeploylyAI_AIEngineer.tex',
            cover_letter_file: 'cover_letters/cover_DeploylyAI.tex',
            source: 'https://www.linkedin.com/jobs/view/ai-engineer-at-deployly-ai-4447791646',
            deadline: '2026-09-30'
          },
          {
            date: '2026-08-28',
            company: 'Nexus Cloud Systems',
            sector: 'Cloud & Infrastructure',
            role: 'Senior Backend Engineer (Python/PostgreSQL)',
            role_type: 'Full-time',
            channel: 'Freehire',
            status: 'interview',
            contact_person: 'Engineering Manager',
            fit_rating: '91',
            notes: 'Completed technical take-home; System design interview scheduled',
            cv_file: 'cv/main_Nexus_Backend.tex',
            cover_letter_file: 'cover_letters/cover_Nexus.tex',
            source: 'https://freehire.me/jobs/nexus-backend',
            deadline: '2026-09-15'
          }
        ];
        fs.writeFileSync(trackerPath, stringifyCSV(starterHeaders, starterData));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(starterData));
        return;
      }
      const content = fs.readFileSync(trackerPath, 'utf-8');
      const rows = parseCSV(content);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === '/api/tracker' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const trackerPath = profile.trackerPath;
        fs.mkdirSync(path.dirname(trackerPath), { recursive: true });
        const headers = ['date', 'company', 'sector', 'role', 'role_type', 'channel', 'status', 'contact_person', 'fit_rating', 'notes', 'cv_file', 'cover_letter_file', 'source', 'deadline'];
        
        let rows = [];
        if (fs.existsSync(trackerPath)) {
          rows = parseCSV(fs.readFileSync(trackerPath, 'utf-8'));
        }
        
        if (Array.isArray(payload)) {
          // Replace all rows
          rows = payload;
        } else if (payload.action === 'delete') {
          rows = rows.filter(r => !(r.company === payload.company && r.role === payload.role));
        } else {
          // Update or insert
          const existingIdx = rows.findIndex(r => r.company === payload.company && r.role === payload.role);
          if (existingIdx >= 0) {
            rows[existingIdx] = { ...rows[existingIdx], ...payload };
          } else {
            rows.unshift({
              date: payload.date || new Date().toISOString().split('T')[0],
              company: payload.company || 'Unknown',
              sector: payload.sector || 'Tech',
              role: payload.role || 'Senior Engineer',
              role_type: payload.role_type || 'Full-time',
              channel: payload.channel || 'Direct',
              status: payload.status || 'drafted',
              contact_person: payload.contact_person || '',
              fit_rating: payload.fit_rating || '85',
              notes: payload.notes || '',
              cv_file: payload.cv_file || '',
              cover_letter_file: payload.cover_letter_file || '',
              source: payload.source || '',
              deadline: payload.deadline || ''
            });
          }
        }
        
        fs.writeFileSync(trackerPath, stringifyCSV(headers, rows));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: rows.length, data: rows }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Live Scraper Endpoint
  if (pathname === '/api/search' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { query = 'Senior Full Stack Engineer', location = 'Worldwide', remoteOnly = false, portal = 'freehire', limit = 10 } = JSON.parse(body || '{}');
        const n = String(Math.min(25, Math.max(1, parseInt(limit) || 10)));
        // "all": this classic server has Freehire and LinkedIn; search both together
        if (portal === 'all') {
          const n = String(Math.min(25, Math.max(1, parseInt(limit) || 10)));
          const jobs = [
            // Last 7 days only, like the Next.js app
            ['freehire', 'Freehire', ['search', '-q', query, '--limit', n, '--jobage', '7', '--description-format', 'text', ...(FREEHIRE_REGIONS[location] || [])]],
            ['linkedin', 'LinkedIn', ['search', '-q', remoteOnly ? `${query} remote` : query, '-l', LINKEDIN_REGIONS[location] || 'Worldwide', '--limit', n, '--jobage', '7']]
          ];
          const outputs = await Promise.all(jobs.map(async ([tool, label, args]) => {
            const cliArgs = remoteOnly ? [...args, '--remote', 'remote'] : args;
            const { stdout, stderr, code } = await runPortalCli(tool, cliArgs);
            if (code !== 0 && !stdout) return { label, results: [], error: cliError(stderr, code) };
            try { return { label, results: (JSON.parse(stdout).results || []).map(r => ({ ...r, source: label, portal: tool })) }; }
            catch { return { label, results: [], error: 'unreadable response' }; }
          }));
          const boards = outputs.map(o => ({ source: o.label, count: o.results.length, ...(o.error ? { error: o.error } : {}) }));
          if (outputs.every(o => o.error)) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: outputs.map(o => `${o.label}: ${o.error}`).join('; ') }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ portal: 'all', results: outputs.flatMap(o => o.results), boards, remoteApprox: !!remoteOnly }));
          return;
        }
        if (!PORTAL_CLIS[portal]) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'This job board is only available in the Next.js version of the dashboard (web/, http://localhost:3001)' }));
          return;
        }
        const tool = portal;
        // LinkedIn's public listings ignore the workplace-type filter, so for
        // remote-only searches also require the word "remote" in the posting
        const linkedinQuery = remoteOnly ? `${query} remote` : query;
        const args = tool === 'linkedin'
          ? ['search', '-q', linkedinQuery, '-l', LINKEDIN_REGIONS[location] || 'Worldwide', '--limit', n]
          : ['search', '-q', query, '--limit', n, '--description-format', 'text',
             ...(FREEHIRE_REGIONS[location] || [])];
        if (remoteOnly) args.push('--remote', 'remote');

        const { stdout, stderr, code } = await runPortalCli(tool, args);
        if (code !== 0 && !stdout) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: cliError(stderr, code) }));
          return;
        }
        let data;
        try { data = JSON.parse(stdout); } catch { data = { results: [] }; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ portal: tool, results: data.results || [], remoteApprox: tool === 'linkedin' && !!remoteOnly }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Full posting for a single search result (LinkedIn search results carry no description)
  if (pathname === '/api/job-detail' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { portal = 'linkedin', id = '' } = JSON.parse(body || '{}');
        if (!PORTAL_CLIS[portal] || !/^[A-Za-z0-9_-]{1,200}$/.test(String(id))) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid job reference' }));
          return;
        }
        const { stdout, stderr, code } = await runPortalCli(portal, ['detail', String(id), '--format', 'json']);
        if (code !== 0 && !stdout) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: cliError(stderr, code) }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(stdout);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Fit Evaluator Endpoint
  if (pathname === '/api/evaluate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { title = '', company = '', description = '' } = JSON.parse(body || '{}');
        if (!usesOriginalOwner(profile)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(evaluateAgainstProfile(profile, { title, description })));
          return;
        }
        const text = `${title} ${description}`.toLowerCase();
        
        // Comprehensive scoring engine against Hassaan Nasir's profile
        const techKeywords = {
          'python': 10, 'django': 10, 'drf': 8, 'rest': 6, 'postgresql': 10, 'postgres': 10,
          'react': 9, 'next.js': 10, 'nextjs': 10, 'typescript': 10, 'javascript': 6,
          'celery': 9, 'redis': 8, 'fastapi': 8, 'docker': 8, 'kubernetes': 8, 'aws': 9,
          'ai': 9, 'llm': 9, 'claude': 10, 'openai': 9, 'langchain': 9, 'langgraph': 9,
          'mcp': 10, 'observability': 7, 'sentry': 8, 'datadog': 8, 'grafana': 7,
          'microservices': 8, 'ci/cd': 7, 'pytest': 7, 'jest': 7, 'cypress': 7
        };

        let matchedTech = [];
        let missingTech = [];
        let techPoints = 0;
        let totalPossibleTech = 0;

        for (const [kw, pts] of Object.entries(techKeywords)) {
          if (text.includes(kw)) {
            matchedTech.push(kw);
            techPoints += pts;
          }
        }

        // Normalize tech score (60 - 98 scale for reasonable matches)
        let techScore = Math.min(98, Math.max(50, Math.round(55 + (matchedTech.length * 3.5))));
        
        // Experience / Seniority match
        let expScore = 88;
        if (text.includes('senior') || text.includes('lead') || text.includes('staff') || text.includes('architect') || text.includes('5+') || text.includes('8+')) {
          expScore = 95;
        } else if (text.includes('principal')) {
          expScore = 88;
        } else if (text.includes('junior') || text.includes('entry')) {
          expScore = 65;
        }

        // Behavioral & Culture match
        let behavioralScore = 92;
        if (text.includes('ownership') || text.includes('distributed') || text.includes('autonomous') || text.includes('scale') || text.includes('mentor')) {
          behavioralScore = 96;
        }

        // Location & Remote match
        let locationScore = 95;
        let isRemote = text.includes('remote') || text.includes('anywhere') || text.includes('worldwide') || text.includes('work from home');
        let isUAE = text.includes('dubai') || text.includes('uae') || text.includes('abu dhabi');
        let isPakistan = text.includes('pakistan') || text.includes('lahore') || text.includes('karachi') || text.includes('islamabad');
        let isVisa = text.includes('visa') || text.includes('sponsor') || text.includes('relocation');

        if (!isRemote && !isUAE && !isPakistan && !isVisa) {
          locationScore = 70; // requires investigation
        }

        // Career alignment
        let careerScore = Math.round((techScore * 0.5) + (expScore * 0.3) + 18);
        careerScore = Math.min(97, Math.max(60, careerScore));

        // Overall weighted average
        const overallScore = Math.round((techScore * 0.35) + (expScore * 0.25) + (behavioralScore * 0.15) + (locationScore * 0.10) + (careerScore * 0.15));

        let verdict = 'Strong Fit';
        if (overallScore < 70) verdict = 'Moderate Fit';
        else if (overallScore < 80) verdict = 'Good Fit';
        else if (overallScore >= 90) verdict = 'Exceptional Match';

        const strengths = [
          `Direct 8+ years alignment with ${matchedTech.slice(0, 5).join(', ').toUpperCase() || 'Full Stack & Backend'} architecture`,
          'Proven record of high performance (38% API speedup, 55% task completion speedup)',
          'Extensive experience with AI workflows, Claude Code, and autonomous tooling'
        ];

        const suggestions = [
          'Highlight PostgreSQL optimization and query indexing metrics in the custom CV',
          'Emphasize asynchronous pipelines (Celery/Redis) and distributed microservices',
          'Mention Anthropic MCP & Claude Code certification in the opening elevator pitch'
        ];

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          overallScore,
          verdict,
          breakdown: {
            technical: techScore,
            experience: expScore,
            behavioral: behavioralScore,
            location: locationScore,
            career: careerScore
          },
          matchedKeywords: matchedTech,
          strengths,
          suggestions
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Static File Serving
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  
  // Security sandbox: don't allow directory traversal outside dashboard/ and root assets
  if (!filePath.startsWith(__dirname) && !filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(__dirname, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const fileContent = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(fileContent);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`AI Job Search Dashboard running at http://localhost:${PORT}`);
});
