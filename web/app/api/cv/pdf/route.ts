// Real PDF of a CV: the LaTeX for the chosen layout and styles is built here from the
// CV (never taken from the request), then compiled by an online TeX Live service.
import { renderTailoredCV } from '@/lib/tailor.js';
import { compileLatexWithRetry, LatexCompileError } from '@/lib/latex-compile.js';
import { rateLimit, readJson } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
// The compile service can take up to ~30 seconds, with one retry
export const maxDuration = 60;

const MAX_BODY = 300_000;

export async function POST(req: Request) {
  const limited = rateLimit(req, 'cv-pdf', 15, 10 * 60_000);
  if (limited) return limited;
  try {
    const body = await readJson(req, MAX_BODY);
    if (!body || !body.cv || typeof body.cv !== 'object') {
      return Response.json({ error: 'Nothing to turn into a PDF.' }, { status: 400 });
    }
    const job = body.job && typeof body.job === 'object' ? (body.job as Record<string, unknown>) : {};
    const styles = body.styles && typeof body.styles === 'object' ? body.styles : {};
    const rendered = renderTailoredCV(
      body.cv,
      { title: String(job.title || '').slice(0, 200), company: String(job.company || '').slice(0, 200) },
      '',
      { template: String(body.template || ''), styles: styles as Record<string, object> }
    );
    if (!rendered.cv.name) return Response.json({ error: 'Add your name before downloading.' }, { status: 400 });

    const pdf = await compileLatexWithRetry(rendered.latex);
    const safeName = `${rendered.cv.name}-CV`.replace(/[^A-Za-z0-9 _-]+/g, '').replace(/\s+/g, '_').slice(0, 60) || 'CV';
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    if (err instanceof LatexCompileError) {
      console.error('CV PDF compile failed:', err.code, err.signature);
      const message = err.code === 'COMPILER_UNAVAILABLE'
        ? 'The PDF service is not reachable right now. Try again, or download the .tex file.'
        : 'This CV could not be compiled to PDF. Download the .tex file to see why.';
      return Response.json({ error: message, code: err.code }, { status: 502 });
    }
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
