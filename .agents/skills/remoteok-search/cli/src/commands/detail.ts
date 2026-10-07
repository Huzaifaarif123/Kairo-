import { apiGet, toDetail, writeError, type JobResult } from "../helpers.js"

export interface DetailOpts {
  id: string // a RemoteOK numeric id (from a search result's id field) or a full job URL
  format: "json" | "plain"
}

/** Extract a RemoteOK numeric id from a bare id or a remoteok.com job URL. */
function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const m = trimmed.match(/-(\d+)\/?(?:[?#].*)?$/)
  if (m) return m[1]
  if (/^\d+$/.test(trimmed)) return trimmed
  return null
}

function renderPlain(job: JobResult): string {
  const lines = [job.title, `${job.company ?? "—"} · ${job.location || "Remote"}`]
  if (job.date) lines.push(`Posted: ${job.date.slice(0, 10)}`)
  if (job.salary) lines.push(`Salary: ${job.salary}`)
  if (job.tags.length) lines.push(`Tags: ${job.tags.join(", ")}`)
  lines.push("", job.description ?? "(no description)", "", `URL: ${job.url}`, `id: ${job.id}`)
  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`could not parse a RemoteOK job id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    // RemoteOK has no per-job endpoint and its ?id= query param is silently
    // ignored server-side (verified live: it always returns the full feed,
    // unfiltered) — so the match has to happen here, against the same feed
    // `search` reads, rather than trusting the API to filter.
    const jobs = await apiGet("/api")
    const job = jobs?.find((j) => j.id === id)
    if (!job) {
      writeError("job not found (it may have scrolled out of RemoteOK's ~2-month feed)", "NOT_FOUND")
      return 1
    }
    const detail = toDetail(job)
    if (opts.format === "plain") process.stdout.write(renderPlain(detail) + "\n")
    else process.stdout.write(JSON.stringify(detail, null, 2) + "\n")
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
