// Re-renders an edited CV in every layout with the chosen styles (Edit CV panel and
// the CV Editor). The CV is checked and cleaned before use; with a job attached, the
// skills that match it are marked and the CV match is recalculated.
import { resolveProfile, getProfileMarkdown } from '@/lib/profiles';
import { renderTailoredCV } from '@/lib/tailor.js';
import { rateLimit, readJson } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const MAX_BODY = 300_000;

export async function POST(req: Request) {
  const limited = rateLimit(req, 'cv-render', 120, 60_000);
  if (limited) return limited;
  try {
    const body = await readJson(req, MAX_BODY);
    if (!body || !body.cv || typeof body.cv !== 'object') {
      return Response.json({ error: 'Nothing to render.' }, { status: 400 });
    }
    const job = body.job && typeof body.job === 'object' ? (body.job as Record<string, unknown>) : {};
    const confirmed = Array.isArray(job.confirmedSkills) ? job.confirmedSkills.map(String).filter(s => s.trim() && s.length <= 60).slice(0, 60) : [];
    const jobInput = {
      title: String(job.title || '').slice(0, 200),
      company: String(job.company || '').slice(0, 200),
      description: String(job.description || '').slice(0, 30_000),
      confirmedSkills: confirmed
    };
    // A one-off CV ("Another CV" on the Tailor page) stands in for the profile
    const oneOff = typeof body.profileMarkdown === 'string' && body.profileMarkdown.trim() ? body.profileMarkdown.slice(0, 200_000) : '';
    const profileMd = !jobInput.description ? '' : oneOff || await getProfileMarkdown(resolveProfile(new URL(req.url).searchParams.get('profile')));
    const styles = body.styles && typeof body.styles === 'object' ? body.styles : {};
    const result = renderTailoredCV(body.cv, jobInput, profileMd, { template: String(body.template || ''), styles: styles as Record<string, object> });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
