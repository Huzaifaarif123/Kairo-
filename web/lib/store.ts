// Storage for profiles and application trackers.
//
// - Postgres (recommended for production): used whenever a connection string is set
//   (POSTGRES_URL / DATABASE_URL, as added by Vercel's Neon integration).
// - Upstash Redis: used if only the Upstash REST variables are set.
// - Local files: the default when running on your computer; the same files as the
//   original dashboard and the Claude Code commands.
//
// The profile/tracker functions return null when nothing is stored yet, so callers
// can fall back to the files shipped with the repo.

import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

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

const POSTGRES_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL || '';
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

export type StorageKind = 'postgres' | 'redis' | 'files';
export const storage: StorageKind = POSTGRES_URL ? 'postgres' : REDIS_URL && REDIS_TOKEN ? 'redis' : 'files';

// True when data lives in a database rather than local files
export const usingDatabase = storage !== 'files';

// ---------- Postgres ----------

// One small pool per server instance. Serverless functions handle one request at a
// time, so a couple of connections is plenty and keeps well inside Neon's limits.
let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function isLocalHost(url: string): boolean {
  return /@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(url);
}

function getPool(): Pool {
  if (!pool) {
    // sslmode in the URL would override the ssl option below, so it's handled here instead
    const sslDisabled = /sslmode=disable/i.test(POSTGRES_URL) || isLocalHost(POSTGRES_URL);
    const connectionString = POSTGRES_URL.replace(/([?&])sslmode=[^&]*(&|$)/i, '$1').replace(/[?&]$/, '');
    pool = new Pool({
      connectionString,
      ssl: sslDisabled ? false : { rejectUnauthorized: true },
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000
    });
    // An idle connection dropped by the server must not crash the process
    pool.on('error', err => console.error('Postgres pool error:', err.message));
  }
  return pool;
}

async function db(): Promise<Pool> {
  const p = getPool();
  if (!schemaReady) {
    schemaReady = p.query(`
      CREATE TABLE IF NOT EXISTS kairo_profiles (
        profile_id  TEXT PRIMARY KEY,
        markdown    TEXT NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS kairo_trackers (
        profile_id  TEXT PRIMARY KEY,
        rows        JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `).then(() => undefined).catch(err => {
      schemaReady = null; // retry on the next request
      throw new Error(`Database setup failed: ${err.message}`);
    });
  }
  await schemaReady;
  return p;
}

// ---------- Upstash Redis (REST) ----------

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

// ---------- Profiles and trackers ----------

export async function getStoredProfile(id: string): Promise<string | null> {
  if (storage === 'postgres') {
    const { rows } = await (await db()).query('SELECT markdown FROM kairo_profiles WHERE profile_id = $1', [id]);
    return rows[0]?.markdown ?? null;
  }
  if (storage === 'redis') {
    const result = await redis(['GET', `kairo:profile:${id}`]);
    return typeof result === 'string' ? result : null;
  }
  return null;
}

export async function saveStoredProfile(id: string, markdown: string): Promise<void> {
  if (storage === 'postgres') {
    await (await db()).query(
      `INSERT INTO kairo_profiles (profile_id, markdown, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (profile_id) DO UPDATE SET markdown = EXCLUDED.markdown, updated_at = now()`,
      [id, markdown]
    );
    return;
  }
  if (storage === 'redis') {
    await redis(['SET', `kairo:profile:${id}`, markdown]);
    return;
  }
  throw new Error('No database configured');
}

export async function getStoredTracker<T>(id: string): Promise<T[] | null> {
  if (storage === 'postgres') {
    const { rows } = await (await db()).query('SELECT rows FROM kairo_trackers WHERE profile_id = $1', [id]);
    return rows[0] ? (rows[0].rows as T[]) : null;
  }
  if (storage === 'redis') {
    const result = await redis(['GET', `kairo:tracker:${id}`]);
    return typeof result === 'string' ? JSON.parse(result) : null;
  }
  return null;
}

export async function saveStoredTracker<T>(id: string, rows: T[]): Promise<void> {
  if (storage === 'postgres') {
    await (await db()).query(
      `INSERT INTO kairo_trackers (profile_id, rows, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (profile_id) DO UPDATE SET rows = EXCLUDED.rows, updated_at = now()`,
      [id, JSON.stringify(rows)]
    );
    return;
  }
  if (storage === 'redis') {
    await redis(['SET', `kairo:tracker:${id}`, JSON.stringify(rows)]);
    return;
  }
  throw new Error('No database configured');
}

// Used by /api/health to confirm the database is reachable
export async function checkStorage(): Promise<string> {
  if (storage === 'postgres') {
    await (await db()).query('SELECT 1');
    return 'connected';
  }
  if (storage === 'redis') {
    await redis(['PING']);
    return 'connected';
  }
  return 'local files';
}

// ---------- Local files ----------

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
