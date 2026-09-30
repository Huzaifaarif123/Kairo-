// A small per-visitor request limit (ported from the CV adjustment kit's lib/rate-limit.ts).
//
// Counts live in the memory of each server instance, so on Vercel the limit applies
// per instance rather than globally; that's enough to stop one visitor hammering the
// PDF compile service or the renderer.

const buckets = new Map<string, { count: number; reset: number }>();

export function clientKey(req: Request, route: string): string {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
  return `${route}:${ip}`;
}

/** Returns a 429 Response when over the limit, otherwise null (and counts the request). */
export function rateLimit(req: Request, route: string, limit: number, windowMs: number): Response | null {
  const key = clientKey(req, route);
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (buckets.size > 5000) for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
    return null;
  }
  if (bucket.count >= limit) {
    const seconds = Math.ceil((bucket.reset - now) / 1000);
    return Response.json(
      { error: `Too many requests. Try again in ${seconds} seconds.`, code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(seconds) } }
    );
  }
  bucket.count++;
  return null;
}

/** Reads a JSON body no larger than maxBytes; null when missing, too large or not JSON. */
export async function readJson(req: Request, maxBytes: number): Promise<Record<string, unknown> | null> {
  const raw = await req.text().catch(() => '');
  if (!raw || raw.length > maxBytes) return null;
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}
