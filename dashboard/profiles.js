// Multiple candidate profiles for the dashboard.
//
// The built-in profile is the framework's own candidate profile and tracker
// (the files /apply and the other Claude Code commands use). Extra profiles
// live in profiles/<id>/ with their own profile.md and job_search_tracker.csv,
// so each person's applications stay separate.

import fs from 'node:fs';
import path from 'node:path';
import { parseProfile, analyseJob, yearsOfExperience } from './tailor.js';

const BUILTIN = {
  id: 'default',
  label: 'AI Full Stack Engineer',
  builtin: true,
  profileFile: '.claude/skills/job-application-assistant/01-candidate-profile.md',
  trackerFile: 'job_search_tracker.csv'
};

function registryPath(rootDir) {
  return path.join(rootDir, 'profiles', 'profiles.json');
}

function readRegistry(rootDir) {
  try {
    const list = JSON.parse(fs.readFileSync(registryPath(rootDir), 'utf-8'));
    return Array.isArray(list) ? list.filter(p => /^[a-z0-9-]{1,40}$/.test(p.id) && p.id !== BUILTIN.id) : [];
  } catch {
    return [];
  }
}

function withPaths(rootDir, entry) {
  if (entry.builtin) {
    return {
      ...entry,
      profilePath: path.join(rootDir, entry.profileFile),
      trackerPath: path.join(rootDir, entry.trackerFile)
    };
  }
  const dir = path.join(rootDir, 'profiles', entry.id);
  return { ...entry, builtin: false, profilePath: path.join(dir, 'profile.md'), trackerPath: path.join(dir, 'job_search_tracker.csv') };
}

// Unknown or missing ids fall back to the built-in profile
export function resolveProfile(rootDir, id) {
  const entry = readRegistry(rootDir).find(p => p.id === id);
  const profile = withPaths(rootDir, entry || BUILTIN);
  if (!profile.builtin) ensureTemplate(profile);
  return profile;
}

export function listProfiles(rootDir) {
  return [BUILTIN, ...readRegistry(rootDir)].map(entry => {
    const profile = withPaths(rootDir, entry);
    if (!profile.builtin) ensureTemplate(profile);
    return summarize(profile);
  });
}

function summarize(profile) {
  const md = readProfileMarkdown(profile);
  const parsed = parseProfile(md);
  const title = profile.builtin ? 'Senior Full Stack & AI Engineer' : (field(md, 'Title') || profile.label);
  const name = parsed.name || '';
  return {
    id: profile.id,
    label: profile.label,
    builtin: !!profile.builtin,
    name,
    title,
    initials: initials(name || profile.label),
    complete: isComplete(parsed)
  };
}

export function readProfileMarkdown(profile) {
  try {
    return fs.readFileSync(profile.profilePath, 'utf-8');
  } catch {
    return '';
  }
}

export function writeProfileMarkdown(profile, markdown) {
  fs.mkdirSync(path.dirname(profile.profilePath), { recursive: true });
  fs.writeFileSync(profile.profilePath, markdown);
}

function field(md, label) {
  return (md.match(new RegExp(`\\*\\*${label}:\\*\\*[ \\t]*(.*)`)) || [])[1]?.trim() || '';
}

function initials(name) {
  return String(name).split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
}

function isComplete(parsed) {
  return !!(parsed.name && (parsed.experience.length || parsed.skills.length));
}

// Profile JSON for the dashboard's profile panel (non-built-in profiles)
export function profileDetails(profile) {
  const md = readProfileMarkdown(profile);
  const parsed = parseProfile(md);
  const years = yearsOfExperience(parsed.experience);
  return {
    id: profile.id,
    label: profile.label,
    name: parsed.name || profile.label,
    title: field(md, 'Title') || profile.label,
    experience: years ? `${years}+ Years` : '',
    email: parsed.email,
    location: parsed.location,
    linkedin: parsed.linkedin,
    skillGroups: parsed.skills.filter(g => g.items.length),
    complete: isComplete(parsed),
    rawMarkdown: md
  };
}

// Keyword-based fit score against any profile (the built-in profile keeps its
// original scorer in server.js)
export function evaluateAgainstProfile(profile, { title = '', description = '' }) {
  const md = readProfileMarkdown(profile);
  const parsed = parseProfile(md);

  if (!isComplete(parsed)) {
    return {
      overallScore: 0,
      verdict: 'Profile incomplete',
      breakdown: { technical: 0, experience: 0, behavioral: 0, location: 0, career: 0 },
      matchedKeywords: [],
      strengths: [`Fill in the ${profile.label} profile (name, experience and skills) to score jobs against it.`]
    };
  }

  const { matched, missing } = analyseJob(description, title, md);
  const text = `${title}\n${description}`.toLowerCase();

  const reqMatched = matched.filter(t => t.required).length;
  const reqTotal = reqMatched + missing.filter(t => t.required).length;
  const technical = reqTotal ? Math.round((reqMatched / reqTotal) * 100) : 60;

  const years = yearsOfExperience(parsed.experience);
  const asked = Math.max(0, ...[...text.matchAll(/(\d{1,2})\+?\s*(?:\+\s*)?years?/g)].map(m => Number(m[1])).filter(n => n < 30));
  const experience = !asked ? 80 : years >= asked ? 95 : Math.max(35, 95 - (asked - years) * 15);

  const behavioral = 75;

  const place = parsed.location.toLowerCase();
  const placeWords = place.split(/[^a-z]+/).filter(w => w.length > 3 && !['remote', 'open', 'worldwide', 'hybrid'].includes(w));
  const location = /remote|anywhere|worldwide|work from home/.test(text) || placeWords.some(w => text.includes(w)) ? 95 : 70;

  const targetTitle = (field(md, 'Title') || profile.label).toLowerCase();
  const titleWords = targetTitle.split(/[^a-z]+/).filter(w => w.length > 2 && !['senior', 'junior', 'lead'].includes(w));
  const career = titleWords.length && titleWords.every(w => title.toLowerCase().includes(w)) ? 92
    : titleWords.some(w => text.includes(w)) ? 80 : 60;

  const overallScore = Math.round(technical * 0.35 + experience * 0.25 + behavioral * 0.15 + location * 0.10 + career * 0.15);
  const verdict = overallScore >= 90 ? 'Exceptional Match' : overallScore >= 80 ? 'Strong Fit' : overallScore >= 70 ? 'Good Fit' : overallScore >= 55 ? 'Moderate Fit' : 'Weak Fit';

  // Strengths come straight from the profile: the bullets that evidence most requirements
  const bullets = parsed.experience.flatMap(x => x.bullets.map(b => ({ b, hits: matched.filter(t => { t.re.lastIndex = 0; return t.re.test(b); }).length })))
    .filter(x => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 2)
    .map(x => x.b);
  const strengths = [];
  if (matched.length) strengths.push(`Covers ${matched.slice(0, 6).map(t => t.name).join(', ')} from the posting.`);
  strengths.push(...bullets);
  if (missing.some(t => t.required)) strengths.push(`Gaps to address: ${missing.filter(t => t.required).slice(0, 5).map(t => t.name).join(', ')}.`);

  return {
    overallScore,
    verdict,
    breakdown: { technical, experience, behavioral, location, career },
    matchedKeywords: matched.map(t => t.name),
    strengths
  };
}

// Blank, commented template for a new profile. HTML comments are ignored by the
// parser, so the examples never leak into CVs or scores.
function template(profile) {
  return `---
profile_label: ${profile.label}
---

# Candidate Profile

<!-- Fill in each section below. Text inside comment blocks like this one is only an example and is ignored. -->

## Identity
- **Name:**
- **Title:** ${profile.label}
- **Location:**
- **Email:**
- **LinkedIn:**
- **Status:**

### Languages
| Language | Level | Notes |
|----------|-------|-------|

## Education

| Degree | Period | Institution | Key Topics |
|--------|--------|-------------|------------|

## Professional Experience
<!-- One block per role, most recent first:
### Job Title - Company (2022 – 2025)
City, Country / Remote
- What you achieved, with a measurable result where possible
-->

## Independent Projects
<!-- - **Project name**: one-line description -->

## Technical Skills
<!-- Group skills under ### headings, for example:
### Core
- **Main skill** (Expert): related tool, related tool
-->

## Certifications
<!-- - **Certification name** - Issuer -->
`;
}

function ensureTemplate(profile) {
  if (fs.existsSync(profile.profilePath)) return;
  writeProfileMarkdown(profile, template(profile));
}
