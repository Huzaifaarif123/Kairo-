import fs from 'node:fs';
import path from 'node:path';
import { registryCount } from '@/lib/profiles';
import { ROOT, usingRedis } from '@/lib/store';
import { MAIN_PROFILE_MARKDOWN } from '@/lib/generated/main-profile';

export const dynamic = 'force-dynamic';

// Quick deployment check: open /api/health on the live site
export async function GET() {
  return Response.json({
    ok: true,
    storage: usingRedis ? 'upstash-redis' : 'files (read-only on Vercel: saving will fail)',
    extraProfiles: registryCount(),
    mainProfileFileFound: fs.existsSync(path.join(ROOT, '.claude/skills/job-application-assistant/01-candidate-profile.md')),
    mainProfileBundled: MAIN_PROFILE_MARKDOWN.length > 0
  });
}
