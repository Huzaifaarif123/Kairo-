import fs from 'node:fs';
import path from 'node:path';
import { registryCount } from '@/lib/profiles';
import { ROOT, storage, checkStorage } from '@/lib/store';
import { MAIN_PROFILE_MARKDOWN } from '@/lib/generated/main-profile';
import { aiConfigured, AI_MODEL } from '@/lib/ai-tailor';

export const dynamic = 'force-dynamic';

// Quick deployment check: open /api/health on the live site
export async function GET() {
  let database: string;
  try {
    database = await checkStorage();
  } catch (err) {
    database = `error: ${(err as Error).message}`;
  }
  const ok = !database.startsWith('error');
  return Response.json({
    ok,
    storage: storage === 'files' ? 'files (local only; on Vercel saving needs a database)' : storage,
    database,
    extraProfiles: registryCount(),
    mainProfileFileFound: fs.existsSync(path.join(ROOT, '.claude/skills/job-application-assistant/01-candidate-profile.md')),
    mainProfileBundled: MAIN_PROFILE_MARKDOWN.length > 0,
    // Tailor CV: Claude rewrites the CV when an Anthropic API key is set
    claudeRewrite: aiConfigured ? `on (${AI_MODEL})` : 'off (set ANTHROPIC_API_KEY)'
  }, { status: ok ? 200 : 503 });
}
