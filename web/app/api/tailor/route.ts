import { resolveProfile, getProfileMarkdown } from '@/lib/profiles';
import { tailorCV, saveTailoredCV } from '@/lib/tailor.js';
import { ROOT, usingRedis } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const profile = resolveProfile(new URL(req.url).searchParams.get('profile'));
    const { title = '', company = '', description = '', save = false } = await req.json().catch(() => ({}));
    if (!String(description).trim()) {
      return Response.json({ error: 'Paste a job description first.' }, { status: 400 });
    }
    const profileMd = await getProfileMarkdown(profile);
    if (!profileMd.trim()) {
      return Response.json({ error: 'Candidate profile not found. Run /setup first.' }, { status: 404 });
    }
    const result = tailorCV({ title, company, description }, profileMd);
    if (!result.cv.name || !result.cv.experience.length) {
      return Response.json({ error: `The ${profile.label} profile is still empty. Fill in its name and experience first.` }, { status: 422 });
    }
    if (save) {
      if (usingRedis) {
        return Response.json({ error: 'Saving to the cv/ folder only works when running locally. Use Download .tex instead.' }, { status: 501 });
      }
      (result as Record<string, unknown>).savedTo = saveTailoredCV(result, ROOT);
    }
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
