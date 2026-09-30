// The whole profile as a CV (not tailored to a job), to edit on your own in the CV Editor.
import { resolveProfile, getProfileMarkdown } from '@/lib/profiles';
import { profileToCV, renderTailoredCV } from '@/lib/tailor.js';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const profile = resolveProfile(new URL(req.url).searchParams.get('profile'));
    const md = await getProfileMarkdown(profile);
    const cv = profileToCV(md);
    if (!cv.name && !cv.experience.length) {
      return Response.json({ error: `The ${profile.label} profile is still empty. Fill it in first, or start from a blank CV.` }, { status: 422 });
    }
    return Response.json(renderTailoredCV(cv, {}, ''));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
