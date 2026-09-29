// Storage for profiles and trackers.
//
// Locally the app reads and writes the same files as the original dashboard and
// the Claude Code commands (profile markdown, job_search_tracker.csv). On Vercel,
// where the filesystem is read-only, it uses Upstash Redis through its REST API
// whenever the Upstash environment variables are present.

import fs from 'node:fs';
import path from 'node:path';

// The repo root: the folder holding profiles/profiles.json (one level above web/)
function findRoot(): string {
  const cwd = process.cwd();
  for (const dir of [path.join(cwd, '..'), cwd, path.join(cwd, '..', '..')]) {
    // Needed files are listed in next.config.mjs (outputFileTracingIncludes)
    if (fs.existsSync(path.join(/*turbopackIgnore: true*/ dir, 'profiles', 'profiles.json'))) return path.resolve(/*turbopackIgnore: true*/ dir);
  }
  return path.resolve(/*turbopackIgnore: true*/ cwd, '..');
}

export const ROOT = findRoot();

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

export const usingRedis = Boolean(REDIS_URL && REDIS_TOKEN);

async function redis(command: string[]): Promise<unknown> {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store'
  });
  const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: string };
  if (!res.ok || body.error) throw new Error(`Storage error: ${body.error || res.status}`);
  return body.result;
}

export async function kvGet(key: string): Promise<string | null> {
  const result = await redis(['GET', `kairo:${key}`]);
  return typeof result === 'string' ? result : null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  await redis(['SET', `kairo:${key}`, value]);
}

export function readFile(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

export function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
