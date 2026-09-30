// LaTeX → PDF, using an online TeX Live compile service (ported from the CV
// adjustment kit's lib/latex/compiler.ts). The default is texlive.net; set
// LATEX_API_URL to use another service with the same interface.
//
// The service answers a failed compile with HTTP 200 and the log as the body,
// so the body is checked for a PDF instead of trusting the status code.

const COMPILE_TIMEOUT_MS = 30000;

export class LatexCompileError extends Error {
  /** @param {'PDF_COMPILATION_FAILED'|'COMPILER_UNAVAILABLE'} code @param {string} signature */
  constructor(code, signature) {
    super(`${code}: ${signature}`);
    this.name = 'LatexCompileError';
    this.code = code;
    // The LaTeX error line only (never the CV content), for logs
    this.signature = signature;
  }
}

const isPdf = (buf) => buf.subarray(0, 5).toString('latin1') === '%PDF-';

function logSignature(buf) {
  const line = buf.toString('utf-8').split(/\r?\n/).map(l => l.trim()).find(l => l.startsWith('!'));
  return (line || 'no LaTeX error line in output').slice(0, 200);
}

/** @param {string} latex @returns {Promise<Buffer>} */
export async function compileLatex(latex) {
  const url = process.env.LATEX_API_URL || 'https://texlive.net/cgi-bin/latexcgi';
  const form = new FormData();
  form.append('filecontents[]', latex);
  form.append('filename[]', 'document.tex');
  form.append('engine', 'pdflatex');
  form.append('return', 'pdf');

  let buf;
  try {
    const res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(COMPILE_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`compile service returned ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    throw new LatexCompileError('COMPILER_UNAVAILABLE', String(err && err.message || err).slice(0, 200));
  }
  if (!isPdf(buf)) throw new LatexCompileError('PDF_COMPILATION_FAILED', logSignature(buf));
  return buf;
}

/** One retry after a short pause for a service hiccup; a LaTeX error is not retried. */
export async function compileLatexWithRetry(latex) {
  try {
    return await compileLatex(latex);
  } catch (err) {
    if (err instanceof LatexCompileError && err.code === 'PDF_COMPILATION_FAILED') throw err;
    await new Promise(r => setTimeout(r, 1500));
    return compileLatex(latex);
  }
}
