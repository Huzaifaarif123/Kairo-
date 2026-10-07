import { apiGet, cleanHtml, toResult, writeError, type JobResult } from "../helpers.js"

export interface SearchOpts {
  query?: string
  tags: string[]
  jobage: number
  limit: number
  format: "json" | "table" | "plain"
  includeDescription: boolean
}

/** Days since an ISO date string, or null if unparseable. */
function daysSince(date: string | null): number | null {
  if (!date) return null
  const t = Date.parse(date)
  if (Number.isNaN(t)) return null
  return (Date.now() - t) / 86_400_000
}

/** Case-insensitive whole-word-ish match of `query` against a result's title/tags/company. */
function matchesQuery(r: JobResult, query: string): boolean {
  const q = query.toLowerCase()
  const haystack = `${r.title} ${r.company ?? ""} ${r.tags.join(" ")}`.toLowerCase()
  return haystack.includes(q)
}

function shortDate(date: string | null): string {
  return date ? date.slice(0, 10) : "—"
}

interface Column {
  header: string
  width: number
  cell: (r: JobResult) => string
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const columns: Column[] = [
    { header: "ID", width: Math.max(2, ...rows.map((r) => r.id.length)), cell: (r) => r.id },
    { header: "TITLE", width: 40, cell: (r) => r.title },
    { header: "COMPANY", width: 22, cell: (r) => r.company ?? "—" },
    { header: "LOCATION", width: 18, cell: (r) => r.location || "Remote" },
    { header: "DATE", width: 10, cell: (r) => shortDate(r.date) },
  ]
  const row = (cells: string[]) => cells.map((c, i) => c.slice(0, columns[i].width).padEnd(columns[i].width)).join("  ")
  const header = row(columns.map((c) => c.header))
  const body = rows.map((r) => row(columns.map((c) => c.cell(r))))
  return [header, "-".repeat(header.length), ...body].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const block = (r: JobResult) =>
    [r.title, `  ${r.company ?? "—"} · ${r.location || "Remote"} · ${shortDate(r.date)}`, `  tags: ${r.tags.join(", ")}`, `  id: ${r.id}`, `  ${r.url}`].join("\n")
  return rows.map(block).join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const params = new URLSearchParams()
    for (const tag of opts.tags) params.append("tags", tag)
    const path = params.toString() ? `/api?${params.toString()}` : "/api"
    const jobs = await apiGet(path)
    if (!jobs) {
      writeError("RemoteOK API returned no data", "SEARCH_FAILED")
      return 1
    }
    let rows = jobs.map(toResult)
    if (opts.query) rows = rows.filter((r) => matchesQuery(r, opts.query as string))
    if (opts.jobage > 0 && opts.jobage < 9999) {
      rows = rows.filter((r) => {
        const d = daysSince(r.date)
        return d === null || d <= opts.jobage
      })
    }
    rows = rows.slice(0, opts.limit)
    if (opts.includeDescription) {
      const bySlug = new Map(jobs.map((j) => [j.id, j]))
      rows = rows.map((r) => ({ ...r, description: cleanHtml(bySlug.get(r.id)?.description) }))
    }

    if (opts.format === "table") process.stdout.write(renderTable(rows) + "\n")
    else if (opts.format === "plain") process.stdout.write(renderPlain(rows) + "\n")
    else process.stdout.write(JSON.stringify({ meta: { count: rows.length, page: 1 }, results: rows }, null, 2) + "\n")
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
