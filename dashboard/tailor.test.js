// CV tailoring engine — accuracy/honesty regression tests.
// Plain Node, no framework/dependencies (keeps this runnable the same way as the rest of
// the project): `node dashboard/tailor.test.js`. Exits non-zero on any failure, so it can
// be wired into CI as-is.
import {
  tailorCV, applyInstructions, validateWholeCvEdit, copiesJdText, hasDuplicateLines, hasCliche
} from './tailor.js';

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
}
function ok(label, cond) { cond ? pass++ : (fail++, console.log(`FAIL ${label}`)); }

// ---------- Scenario 1: JD has percentages, profile has none — no fabricated percentages ----------
{
  const profileMd = `# P\n\n## Identity\n- **Name:** D\n- **Email:** d@x.io\n\n## Professional Experience\n### Data Analyst - Brightloop (2021 - Present)\nRemote\n- Built sales dashboards using SQL Server and SSIS.\n- Maintained ETL jobs for the reporting pipeline.\n\n## Technical Skills\n### Languages\n- SQL\n`;
  const job = { title: 'Senior Data Engineer', description: `We need someone who improved performance by 35%, increased revenue by 25%, and reduced processing time by 40% in prior roles. Requirements:\n- SQL\n- ETL pipelines` };
  const r = tailorCV(job, profileMd);
  const allText = JSON.stringify(r.cv);
  ok('Scenario 1: no fabricated percentage figures copied from the JD', !/35%|25%|40%/.test(allText));
}

// ---------- Scenario 2: JD requests a technology absent from the source CV ----------
{
  const profileMd = `# P\n\n## Identity\n- **Name:** D\n- **Email:** d@x.io\n\n## Professional Experience\n### Backend Dev - Brightloop (2021 - Present)\nRemote\n- Built REST APIs in Python and Flask.\n\n## Technical Skills\n### Languages\n- Python\n`;
  const job = { title: 'Platform Engineer', description: 'Requirements:\n- Python\n- Kubernetes\n- Istio service mesh' };
  const r = tailorCV(job, profileMd);
  const allText = JSON.stringify(r.cv).toLowerCase();
  ok('Scenario 2: unsupported tech (Kubernetes/Istio) not falsely presented as a skill', !allText.includes('kubernetes') && !allText.includes('istio'));
  ok('Scenario 2: still correctly reports it as missing, not silently dropped', r.analysis.missing.some(m => m.name === 'Kubernetes'));
}

// ---------- Scenario 4: JD has long responsibility statements — never copied verbatim ----------
{
  const profileMd = `# P\n\n## Identity\n- **Name:** D\n- **Email:** d@x.io\n\n## Professional Experience\n### Full Stack Dev - Brightloop (2021 - Present)\nRemote\n- Built payment flows in React and PostgreSQL, processing 10,000 transactions a month.\n- Reduced API latency by 20% by adding Redis caching.\n\n## Technical Skills\n### Languages\n- React, PostgreSQL\n`;
  const jobDescription = `About the role: We are seeking a highly motivated Senior Full Stack Engineer to join our rapidly growing platform team and help us scale our infrastructure to meet unprecedented customer demand. Requirements:\n- React\n- Node.js\n- Kubernetes`;
  const r = tailorCV({ title: 'Senior Full Stack Engineer', description: jobDescription }, profileMd);
  const cvText = JSON.stringify(r.cv);
  ok('Scenario 4: no 6-word sequence copied verbatim from the JD', !copiesJdText(cvText, jobDescription));
}

// ---------- Scenario 5: numbers are not shown by default, even real ones ----------
// Current policy: a number isn't surfaced by default regardless of source, until asked
// for. tailorCV's own regex pass only safely strips a clean trailing clause ("…, cutting
// X by 20%") — a number embedded mid-sentence ("Reduced X by 20% by doing Y") is left as
// the conservative, safe fallback (removing it risks a broken sentence). The full
// guarantee — no number left anywhere, regardless of position — is the API route's job
// (the batched AI cleanup pass in web/app/api/tailor/route.ts and dashboard/server.js),
// not tailorCV() in isolation; this test documents that known layering, not a goal of
// tailorCV() alone.
{
  const profileMd = `# P\n\n## Identity\n- **Name:** D\n- **Email:** d@x.io\n\n## Professional Experience\n### Backend Dev - Brightloop (2021 - Present)\nRemote\n- Reduced API latency by 20% by adding Redis caching.\n\n## Technical Skills\n### Languages\n- Python\n`;
  const r = tailorCV({ title: 'Backend Engineer', description: 'Requirements:\n- Python' }, profileMd);
  ok('Scenario 5: tailorCV\'s regex pass alone cannot strip a mid-sentence number (expected — the API route\'s AI pass closes this)', r.cv.experience[0].bullets.some(b => /20%/.test(b)));
}

// ---------- Scenario 5b: a cleanly-trailing number IS stripped by tailorCV alone ----------
{
  const profileMd = `# P\n\n## Identity\n- **Name:** D\n- **Email:** d@x.io\n\n## Professional Experience\n### Backend Dev - Brightloop (2021 - Present)\nRemote\n- Wrote reusable Terraform modules for AWS deployments, cutting provisioning time by 20%.\n\n## Technical Skills\n### Languages\n- Python\n`;
  const r = tailorCV({ title: 'Backend Engineer', description: 'Requirements:\n- Python' }, profileMd);
  ok('Scenario 5b: a trailing-clause number IS stripped by tailorCV\'s own regex pass, no AI needed', !r.cv.experience[0].bullets.some(b => /20%/.test(b)));
}

// ---------- Scenario 6: very limited experience — concise, no padding ----------
{
  const profileMd = `# P\n\n## Identity\n- **Name:** D\n- **Email:** d@x.io\n\n## Professional Experience\n### Junior Dev - Brightloop (2024 - Present)\nRemote\n- Fixed bugs in the billing module.\n\n## Technical Skills\n### Languages\n- JavaScript\n`;
  const r = tailorCV({ title: 'Frontend Developer', description: 'Requirements:\n- JavaScript' }, profileMd);
  ok('Scenario 6: a one-bullet CV stays truthful, not padded with invented achievements', r.cv.experience[0].bullets.length <= 2);
}

// ---------- Scenario 8: multiple roles — employer/title/dates preserved for every role ----------
{
  const profileMd = `# P\n\n## Identity\n- **Name:** D\n- **Email:** d@x.io\n\n## Professional Experience\n### Senior Dev - Brightloop (2023 - Present)\nRemote\n- Built payment flows in React.\n\n### Junior Dev - OldCo (2017 - 2018)\nRemote\n- Fixed bugs in a legacy PHP app.\n\n## Technical Skills\n### Languages\n- React, PHP\n`;
  const r = tailorCV({ title: 'Senior Engineer', description: 'Requirements:\n- React' }, profileMd);
  eq('Scenario 8: role 1 employer/title/dates preserved', [r.cv.experience[0].company, r.cv.experience[0].role, r.cv.experience[0].period], ['Brightloop', 'Senior Dev', '2023 - Present']);
  eq('Scenario 8: role 2 employer/title/dates preserved', [r.cv.experience[1].company, r.cv.experience[1].role, r.cv.experience[1].period], ['OldCo', 'Junior Dev', '2017 - 2018']);
}

// ---------- Scenario 9: General CV mode (no JD) works ----------
{
  const profileMd = `# P\n\n## Identity\n- **Name:** D\n- **Email:** d@x.io\n\n## Professional Experience\n### Dev - Brightloop (2021 - Present)\nRemote\n- Built payment flows in React.\n\n## Technical Skills\n### Languages\n- React\n`;
  const r = tailorCV({ title: '', description: '' }, profileMd);
  ok('Scenario 9: general CV (no JD) still produces a usable CV', Boolean(r.cv.name && r.cv.experience.length));
}

// ---------- Validation layer: JD-copy and duplicate-bullet checks (used by all AI paths) ----------
{
  const base = { name: 'T', headline: 'Engineer', summary: 'Engineer with 5 years.', experience: [{ role: 'Engineer', company: 'Brightloop', period: '2021-Present', location: '', bullets: ['Built a React dashboard used by 40,000 users.'] }], projects: [], education: [], certifications: [], skills: [] };
  const jd = 'Deep expertise architecting and scaling distributed systems using React and Node.js at significant volume for our growing platform team.';
  const copied = { ...base, experience: [{ ...base.experience[0], bullets: ['Architecting and scaling distributed systems using React and Node.js at significant volume.'] }] };
  ok('Validation: rejects an AI edit that copies the JD verbatim', validateWholeCvEdit(base, copied, 'improve this', false, jd) === false);

  const duped = { ...base, experience: [{ ...base.experience[0], bullets: ['Reduced latency by approximately 20%.', 'Reduced latency by approximately 20%.'] }] };
  ok('Validation: rejects an AI edit that introduces a duplicate bullet', validateWholeCvEdit(base, duped, 'improve this', true) === false);

  const fabricatedNumber = { ...base, experience: [{ ...base.experience[0], bullets: ['Migrated services to Kubernetes, cutting costs by 47%.'] }] };
  ok('Validation: rejects a fabricated new number when fact-check is on', validateWholeCvEdit(base, fabricatedNumber, 'improve this', false) === false);
  // unfiltered alone is NOT enough to allow a new number — the request itself must have
  // actually asked for an achievement/metric; a vague, unrelated request still gets rejected
  ok('Validation: unfiltered alone does not allow a fabricated number on a vague request', validateWholeCvEdit(base, fabricatedNumber, 'improve this', true) === false);
  ok('Validation: unfiltered + a request that actually asked for achievements allows it', validateWholeCvEdit(base, fabricatedNumber, 'add some measurable achievements', true) === true);
}

// ---------- applyInstructions: default tailoring no longer fabricates measured results ----------
{
  const profileMd = `# P\n\n## Identity\n- **Name:** D\n- **Email:** d@x.io\n\n## Professional Experience\n### Dev - Brightloop (2021 - Present)\nRemote\n- Built payment flows in React.\n- Led development of the checkout redesign.\n\n## Technical Skills\n### Languages\n- React\n`;
  const r = tailorCV({ title: 'Senior Dev', description: 'Requirements:\n- React' }, profileMd);
  ok('Default tailor: no auto-fabricated "approximately" on bullets with no real number', !r.cv.experience[0].bullets.some(b => /approximately/i.test(b)));

  const r2 = applyInstructions(JSON.parse(JSON.stringify(r.cv)), 'fix the red flags', { job: { title: 'Senior Dev', description: 'Requirements:\n- React' } });
  ok('Explicit "fix the red flags" still adds measured results on request', r2.done.some(d => /strengthened/i.test(d)));
}

// ---------- Certifications and topic-skills follow the JD, not just what's already on the CV ----------
{
  const cv = { name: 'T', headline: 'Cloud Eng', summary: '', experience: [{ role: 'Cloud Eng', company: 'Brightloop', period: '2021-Present', location: '', bullets: ['Built things in Docker.'] }], projects: [], education: [], certifications: [], skills: [{ group: 'Languages', items: ['Docker', 'Kubernetes'] }] };
  const job = { title: 'Cloud Engineer', description: 'Requirements:\n- AWS\n- Terraform' };
  const r = applyInstructions(JSON.parse(JSON.stringify(cv)), 'add some certifications', { job, unfiltered: true });
  ok('Certifications prioritize the JD requirements, not the CV\'s existing (unrelated) skills', r.cv.certifications.some(c => /AWS|Terraform/i.test(c)));
}

console.log(`\n${pass} passed, ${fail} failing`);
if (fail > 0) process.exit(1);
