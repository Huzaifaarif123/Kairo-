// "Tell it what to add or change" on the Tailor page: applies plain instructions
// ("Under Brightloop add: …", "Add skills: …", "Remove PHP") to the CV being edited.
// Anything the rules don't understand goes to Claude when it is set up, or else to the
// local model (Ollama) when it is running on this computer.
import { applyInstructions, normalizeCV } from '@/lib/tailor.js';
import { aiConfigured, editCvWithClaude } from '@/lib/ai-tailor';
import { applyWithLocalModel, localModelReady } from '@/lib/local-llm.js';
import { rateLimit, readJson } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  const limited = rateLimit(req, 'cv-instruct', 60, 60_000);
  if (limited) return limited;
  const body = await readJson(req, 300_000);
  if (!body || !body.cv || typeof body.cv !== 'object') return Response.json({ error: 'Tailor a CV first.' }, { status: 400 });
  const text = String(body.text || '').slice(0, 4000);
  if (!text.trim()) return Response.json({ error: 'Write what you want to add or change.' }, { status: 400 });
  const result = applyInstructions(body.cv, text);
  if (aiConfigured && result.pending.length) {
    try {
      const edit = await editCvWithClaude(result.cv, result.pending);
      if (edit) {
        result.cv = normalizeCV(edit.cv);
        result.done.push(...edit.changes);
        result.unclear = edit.notDone;
      }
    } catch (err) {
      console.error('Claude edit failed:', err);
    }
  }
  // No Claude: the local model (Ollama on this computer), when it's running
  let local = false;
  if (!aiConfigured && result.pending.length && await localModelReady()) {
    local = true;
    await applyWithLocalModel(result);
  }
  return Response.json({ ...result, ai: aiConfigured || local });
}
