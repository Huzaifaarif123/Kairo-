// Data source: remoteok.com's public JSON API (https://remoteok.com/api) — fully
// remote tech/non-tech jobs worldwide. Reads are unauthenticated (no API key); the
// response is a single JSON array whose first element is a {legal: "..."} notice,
// not a job (stripped by every caller here). No pagination or free-text search
// exists server-side: the endpoint returns the full recent feed (~100 postings,
// roughly the last two months) and an optional `tags=` filter narrows it by tag.
// Everything else (keyword match, date window, limit) is applied client-side.

export const DEFAULT_BASE_URL = "https://remoteok.com"

/** API base URL: REMOTEOK_API_URL (rarely needed) or the default. */
export function baseUrl(): string {
  const raw = (process.env.REMOTEOK_API_URL ?? "").trim()
  return (raw || DEFAULT_BASE_URL).replace(/\/+$/, "")
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; remoteok-search-cli/1.0)"

/** A raw RemoteOK API entry (the fields this skill reads; the wire shape carries more). */
export interface RemoteOkJob {
  id: string
  slug: string
  date: string | null
  company: string
  position: string
  tags: string[]
  location: string
  description: string
  url: string
  salary_min?: number
  salary_max?: number
}

/**
 * GET the RemoteOK API. Retries 429/5xx with backoff; returns `null` on a 404.
 * A connection failure throws immediately — no retry — so an outage degrades
 * this source quickly rather than hanging the caller.
 */
export async function apiGet(path: string): Promise<RemoteOkJob[] | null> {
  const url = `${baseUrl()}${path}`
  const maxRetries = 6
  let delay = 500

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      })
    } catch (e) {
      throw new Error(`could not reach the RemoteOK API at ${baseUrl()} (${e instanceof Error ? e.message : String(e)})`)
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`RemoteOK API request failed: ${response.status} ${response.statusText}`)
      }
      await sleep(delay + Math.floor(Math.random() * 500))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null

    const body = (await response.json().catch(() => null)) as unknown
    if (!response.ok) {
      throw new Error(`RemoteOK API request failed: ${response.status} ${response.statusText}`)
    }
    if (!Array.isArray(body)) throw new Error("RemoteOK API returned an unparseable response body")
    // First element is always a {legal: "..."} notice, not a job — strip it.
    return body.filter((j): j is RemoteOkJob => typeof j === "object" && j !== null && "id" in j && "position" in j)
  }
  throw new Error("RemoteOK API request failed after retries")
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  tags: string[]
  salary: string | null
  description: string | null
}

function formatSalary(j: RemoteOkJob): string | null {
  if (!j.salary_min && !j.salary_max) return null
  if (j.salary_min && j.salary_max && j.salary_min !== j.salary_max) return `$${j.salary_min.toLocaleString()}–$${j.salary_max.toLocaleString()}`
  return `$${(j.salary_min || j.salary_max || 0).toLocaleString()}`
}

// RemoteOK's description field is frequently double-encoded: the original UTF-8
// bytes were decoded as Windows-1252 (not just Latin-1 — 0x80-0x9F holds smart
// quotes, dashes and € in CP1252, which is where "â€™" for ' comes from) and
// re-encoded as UTF-8, so every non-ASCII character and multi-byte emoji comes
// through mangled, e.g. "Delineaâ€™s" for "Delinea's". This reverses that exact
// step: each character is mapped back to the CP1252 byte it came from, and the
// resulting bytes are decoded as UTF-8 (CP1252's only difference from Latin-1 is
// the 0x80-0x9F block, mapped explicitly here; everything else is its own code
// point). A character outside both tables means this text was never mojibake —
// bail out unchanged rather than risk corrupting text that was already correct.
const CP1252_HIGH_TO_CODEPOINT: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d,
  0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
}
const CODEPOINT_TO_CP1252_HIGH: Record<number, number> = Object.fromEntries(
  Object.entries(CP1252_HIGH_TO_CODEPOINT).map(([b, cp]) => [cp, Number(b)]),
)

function fixMojibake(text: string): string {
  const bytes: number[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number
    if (cp <= 0xff) {
      bytes.push(cp)
      continue
    }
    const byte = CODEPOINT_TO_CP1252_HIGH[cp]
    if (byte === undefined) return text
    bytes.push(byte)
  }
  try {
    return Buffer.from(bytes).toString("utf8")
  } catch {
    return text
  }
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

/** Strip a RemoteOK description's HTML into readable prose. Null for empty input. */
export function cleanHtml(html: string | null | undefined): string | null {
  if (!html) return null
  const withBreaks = fixMojibake(html).replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  let text = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

/** Reshape a RemoteOK job into the contract search-result fields. */
export function toResult(j: RemoteOkJob): JobResult {
  return {
    id: j.id,
    title: j.position || "(untitled)",
    company: j.company || null,
    location: j.location || null,
    date: j.date,
    url: j.url || `${DEFAULT_BASE_URL}/remote-jobs/${j.slug}`,
    tags: j.tags || [],
    salary: formatSalary(j),
    description: null,
  }
}

/** Reshape a RemoteOK job into the detail result (adds the cleaned description). */
export function toDetail(j: RemoteOkJob): JobResult {
  return { ...toResult(j), description: cleanHtml(j.description) }
}
