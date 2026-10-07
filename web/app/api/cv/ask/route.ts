// "Tell it what to add or change": a question the rule-based review couldn't answer
// specifically (e.g. not "what's missing" or "what's my score") goes to AI for a real,
// CV-grounded answer instead of the generic fallback recap. Read-only — never edits the CV.
import { aiConfigured, answerQuestionsWithClaude } from '@/lib/ai-tailor';
import { cloudAiConfigured, answerQuestions as answerQuestionsWithCloud } from '@/lib/cloud-llm.js';
import { rateLimit, readJson } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
  const limited = rateLimit(req, 'cv-ask', 60, 60_000);
  if (limited) return limited;
  const body = await readJson(req, 300_000);
  if (!body || !body.cv || typeof body.cv !== 'object') return Response.json({ error: 'Tailor a CV first.' }, { status: 400 });
  const questions = Array.isArray(body.questions) ? body.questions.map(String).filter(q => q.trim()).slice(0, 10) : [];
  if (!questions.length) return Response.json({ answers: {} });
  const jobInput = body.job && typeof body.job === 'object' ? body.job as Record<string, unknown> : null;
  const job = jobInput ? { title: String(jobInput.title || ''), description: String(jobInput.description || '').slice(0, 10_000) } : null;
  const cv = body.cv as Record<string, unknown>;

  try {
    if (aiConfigured) return Response.json({ answers: await answerQuestionsWithClaude(cv, job, questions) });
    if (cloudAiConfigured) return Response.json({ answers: await answerQuestionsWithCloud(cv, job, questions) });
  } catch (err) {
    console.error('Question answering failed:', err);
  }
  return Response.json({ answers: {} });
}
