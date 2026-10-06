// Loads web/.env.local into process.env so the vanilla dashboard server shares the same
// API keys as the Next.js app (one place to set GROQ_API_KEY, ANTHROPIC_API_KEY, …)
// instead of duplicating secrets in a second file. Next.js loads .env.local on its own;
// this server doesn't, so it does the same thing by hand. Imported first in server.js so
// the variables are set before anything else reads them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', '.env.local');
try {
  const text = fs.readFileSync(envPath, 'utf-8');
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env) && m[2].trim()) process.env[m[1]] = m[2].trim();
  }
} catch { /* no .env.local, or not readable — fine, keys just stay unset */ }
