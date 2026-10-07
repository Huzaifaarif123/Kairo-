// "Tell it what to add or change" on the Tailor page, and the box in each Edit CV
// section: applies plain instructions ("Under Brightloop add: …", "Add skills: …",
// "Remove PHP") to the CV being edited. With a section (scope), only that section changes.
// Anything the rules don't understand goes to Claude when it is set up, else a free-tier
// cloud model (Groq or OpenRouter) when one is configured, else the local model (Ollama)
// when it is running on this computer.
import { applyInstructions, normalizeCV, scopeCV, scopeText, mergeScoped } from '@/lib/tailor.js';
import { aiConfigured, editCvWithClaude } from '@/lib/ai-tailor';
import { cloudAiConfigured, applyWithCloudModel } from '@/lib/cloud-llm.js';
import { applyWithLocalModel, localModelReady } from '@/lib/local-llm.js';
import { rateLimit, readJson } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SECTIONS = ['personal', 'summary', 'skills', 'experience', 'projects', 'education', 'certifications'];

export async function POST(req: Request) {
  const limited = rateLimit(req, 'cv-instruct', 60, 60_000);
  if (limited) return limited;
  const body = await readJson(req, 300_000);
  if (!body || !body.cv || typeof body.cv !== 'object') return Response.json({ error: 'Tailor a CV first.' }, { status: 400 });
  const text = String(body.text || '').slice(0, 4000);
  if (!text.trim()) return Response.json({ error: 'Write what you want to add or change.' }, { status: 400 });
  const job = body.job && typeof body.job === 'object' ? body.job as Record<string, unknown> : {};
  const jobInput = { title: String(job.title || '').slice(0, 200), description: String(job.description || '').slice(0, 30_000) };
  // One section of Edit CV (and which job or project)
  const s = body.scope && typeof body.scope === 'object' ? body.scope as Record<string, unknown> : null;
  const scope = s && SECTIONS.includes(String(s.section)) ? { section: String(s.section), index: Math.max(0, Math.floor(Number(s.index) || 0)) } : null;

  const working = scope ? scopeCV(body.cv, scope) : body.cv;
  const result = applyInstructions(working, scope ? scopeText(text, scope, body.cv) : text, { job: jobInput });
  if (aiConfigured && result.pending.length) {
    try {
      const edit = await editCvWithClaude(result.cv, result.pending);
      if (edit) {
        // skills Claude added, so the page can mark them as matched against the job
        const skillName = (i: unknown) => (typeof i === 'string' ? i : (i as { name?: string }).name || '');
        const before = new Set(result.cv.skills.flatMap((g: { items: unknown[] }) => g.items.map((i) => skillName(i).toLowerCase())));
        result.cv = normalizeCV(edit.cv);
        const added = result.cv.skills.flatMap((g: { items: { name: string }[] }) => g.items.map((i) => i.name)).filter((n: string) => !before.has(n.toLowerCase()));
        result.done.push(...edit.changes);
        result.skills.push(...added);
        result.unclear = edit.notDone;
        // keep the box's "try again" text in sync with what's actually still unresolved
        result.pending = edit.notDone;
      }
    } catch (err) {
      console.error('Claude edit failed:', err);
    }
  }
  // No Claude: a free-tier cloud model (Groq/OpenRouter), when one is configured
  let cloud = false;
  if (!aiConfigured && cloudAiConfigured && result.pending.length) {
    // Saved so a failed cloud call (e.g. rate-limited) can hand the local model a
    // clean, original request instead of its own "rate limit" message to chew on.
    const pendingBefore = [...result.pending];
    const unclearBefore = [...result.unclear];
    cloud = await applyWithCloudModel(result);
    if (!cloud) { result.pending = pendingBefore; result.unclear = unclearBefore; }
  }
  // Cloud wasn't configured, or it was tried and genuinely failed (not just
  // declined the request): the local model (Ollama on this computer), if running
  let local = false;
  if (!aiConfigured && !cloud && result.pending.length && await localModelReady()) {
    local = true;
    await applyWithLocalModel(result);
  }
  if (scope) result.cv = mergeScoped(body.cv, result.cv, scope);
  return Response.json({ ...result, ai: aiConfigured || cloud || local });
}
