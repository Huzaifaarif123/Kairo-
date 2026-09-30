import Anthropic from '@anthropic-ai/sdk';
import { resolveProfile, getProfileMarkdown } from '@/lib/profiles';
import { tailorCV, renderTailoredCV, saveTailoredCV } from '@/lib/tailor.js';
import { rewriteWithClaude, aiConfigured } from '@/lib/ai-tailor';
import { ROOT, usingDatabase } from '@/lib/store';

export const dynamic = 'force-dynamic';
// Claude's rewrite can take up to ~50 seconds
export const maxDuration = 60;

// A one-off CV sent from the page (as profile markdown)
const MAX_CV_MARKDOWN = 200_000;

// A short, user-facing reason when Claude's rewrite isn't available
function aiErrorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The Anthropic API key is not valid.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'The Anthropic API key is not allowed to use this model.';
  if (err instanceof Anthropic.RateLimitError) return 'Claude is busy right now (rate limit). Try again in a minute.';
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'Claude took too long to respond.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach Claude.';
  if (err instanceof Anthropic.APIError) return `Claude returned an error (${err.status ?? 'unknown'}).`;
  return (err as Error)?.message || 'Claude could not rewrite this CV.';
}

export async function POST(req: Request) {
  try {
    const profile = resolveProfile(new URL(req.url).searchParams.get('profile'));
    const { title = '', company = '', description = '', save = false, confirmedSkills = [], ai = true, latex, filename, template = '', styles = {}, profileMarkdown } = await req.json().catch(() => ({}));
    // Layout and style choices from the toolbar ({ layoutId: styleOptions })
    const options = { template: String(template || ''), styles: styles && typeof styles === 'object' && !Array.isArray(styles) ? styles : {} };

    // "Save to cv/": save the exact CV on screen instead of tailoring (and calling Claude) again
    if (save && typeof latex === 'string' && typeof filename === 'string') {
      if (usingDatabase) {
        return Response.json({ error: 'Saving to the cv/ folder only works when running locally. Use Download .tex instead.' }, { status: 501 });
      }
      if (!/^main_[A-Za-z0-9_]+\.tex$/.test(filename) || !latex.trim() || latex.length > 300_000) {
        return Response.json({ error: 'Nothing valid to save.' }, { status: 400 });
      }
      return Response.json({ savedTo: saveTailoredCV({ filename, latex }, ROOT) });
    }

    if (!String(description).trim()) {
      return Response.json({ error: 'Paste a job description first.' }, { status: 400 });
    }
    // "Another CV": a CV uploaded or pasted on the Tailor page, used just for this request
    // (never saved) instead of the selected profile
    const oneOff = typeof profileMarkdown === 'string' && profileMarkdown.trim() ? profileMarkdown : null;
    if (oneOff && oneOff.length > MAX_CV_MARKDOWN) {
      return Response.json({ error: 'That CV is too long to tailor.' }, { status: 413 });
    }
    const profileMd = oneOff ?? await getProfileMarkdown(profile);
    if (!profileMd.trim()) {
      return Response.json({ error: 'Candidate profile not found. Run /setup first.' }, { status: 404 });
    }
    // Skills the candidate confirmed they have, for gaps their profile doesn't mention
    const confirmed = Array.isArray(confirmedSkills) ? confirmedSkills.map(String).filter(s => s.trim() && s.length <= 60).slice(0, 60) : [];
    const job = { title: String(title), company: String(company), description: String(description), confirmedSkills: confirmed };
    let result: Record<string, any> = tailorCV(job, profileMd, options);
    if (!result.cv.name || !result.cv.experience.length) {
      return Response.json({ error: oneOff
        ? 'Could not find a name and work experience in that CV. Check the uploaded file or paste the CV text instead.'
        : `The ${profile.label} profile is still empty. Fill in its name and experience first.` }, { status: 422 });
    }

    // Claude rewrites the selected content; if it can't, the rule-based CV is kept
    const aiInfo: Record<string, unknown> = { configured: aiConfigured, used: false };
    if (ai !== false && aiConfigured) {
      try {
        const rewrite = await rewriteWithClaude({ base: result as any, profileMd, title: job.title, company: job.company, description: job.description, confirmed });
        if (rewrite) {
          const rendered = renderTailoredCV(rewrite.cv, job, profileMd, options);
          result = { ...result, ...rendered, changes: [...rewrite.notes, ...result.changes.filter((c: string) => /confirmed/i.test(c))] };
          Object.assign(aiInfo, { used: true, model: rewrite.model, rejected: rewrite.rejected });
        }
      } catch (err) {
        console.error('Claude rewrite failed:', err);
        aiInfo.error = aiErrorMessage(err);
      }
    }
    result.ai = aiInfo;

    if (save) {
      if (usingDatabase) {
        return Response.json({ error: 'Saving to the cv/ folder only works when running locally. Use Download .tex instead.' }, { status: 501 });
      }
      result.savedTo = saveTailoredCV(result, ROOT);
    }
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
