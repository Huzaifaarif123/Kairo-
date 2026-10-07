#!/usr/bin/env bun
// Self-contained CLI for searching remoteok.com's public JSON API (fully remote
// jobs, worldwide, tech-leaning). No external CLI framework and zero runtime
// dependencies, so it runs anywhere `bun` is available with nothing installed
// beyond the repo clone.
//
// Hosted-service dependency: reads are public (no API key), but they hit
// remoteok.com directly — a third-party site with no formal SLA.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { baseUrl } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

const ALIAS: Record<string, string> = { q: "query", n: "limit" }

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("-")) {
      ;(flags._ as string[]).push(a)
      continue
    }
    const name = a.replace(/^-+/, "")
    const key = ALIAS[name] ?? name
    const next = argv[i + 1]
    let value: string | boolean = true
    if (next !== undefined && !next.startsWith("-")) {
      value = next
      i++
    }
    if (key === "tag") {
      const acc = Array.isArray(flags.tag) ? flags.tag : []
      if (typeof value === "string") acc.push(value)
      flags.tag = acc
    } else {
      flags[key] = value
    }
  }
  return flags
}

type FlagValue = string | boolean | string[] | undefined

function stringFlag(raw: FlagValue): string | undefined {
  return typeof raw === "string" ? raw : undefined
}

function commaList(raw: FlagValue): string[] {
  if (typeof raw !== "string") return []
  return raw.split(",").map((s) => s.trim()).filter(Boolean)
}

const HELP = `remoteok-cli — search remoteok.com (fully remote jobs, worldwide, tech-leaning)

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [--tag <tag>] [--jobage <days>] [--limit <n>] [--format json|table|plain]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>   Keywords matched against title, company and tags (client-side).
  --tag <name>         RemoteOK tag filter, e.g. python, react, devops (repeatable; server-side).
  --jobage <days>      Only postings from the last N days (client-side; the feed covers ~2 months).
  --limit, -n <n>      Max results. Default 25.
  --format <fmt>       json (default) | table | plain.
  --no-description     Skip description text for a cheap discovery pass (other fields unaffected).

DETAIL
  <id|url>             A RemoteOK numeric id (a search result's id field) or a full remoteok.com job URL.

EXAMPLES
  bun run src/cli.ts search -q "full stack" --tag react --limit 10 --format table
  bun run src/cli.ts search --tag python --jobage 14 --format table
  bun run src/cli.ts detail 1137465 --format plain

Reads are public (no API key). Source: ${baseUrl()} — a third-party site, no SLA.
No server-side free-text search or pagination exists; --tag is the only server-side
filter, everything else (keywords, date window, limit) is applied client-side.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "tag", "jobage", "limit", "format", "no-description", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function parseIntFlag(name: string, raw: string | boolean | string[]): number | null {
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1) {
    process.stderr.write(JSON.stringify({ error: `--${name} must be a whole number of at least 1, got "${raw}"`, code: "BAD_ARG" }) + "\n")
    return null
  }
  return val
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    // No command at all is a usage error (exit 1); --help/-h was explicitly
    // asked for, even with no command, and succeeded (exit 0).
    return flags.help || flags.h ? 0 : 1
  }

  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      process.stderr.write(
        JSON.stringify({ error: `unknown flag --${key} for '${cmd}' - see --help for the supported flags`, code: "UNKNOWN_FLAG" }) + "\n",
      )
      return 1
    }
  }

  if (cmd === "search") {
    const fmt = (flags.format as string) || "json"
    for (const name of ["jobage", "limit"] as const) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }
    const opts: SearchOpts = {
      query: stringFlag(flags.query),
      tags: Array.isArray(flags.tag) ? flags.tag : commaList(flags.tag),
      jobage: flags.jobage ? parseInt(flags.jobage as string, 10) : 9999,
      limit: flags.limit ? Math.max(1, parseInt(flags.limit as string, 10)) : 25,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
      includeDescription: flags["no-description"] === undefined,
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires a <id|url>", code: "NO_ID" }) + "\n")
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = { id, format: fmt === "plain" ? "plain" : "json" }
    return runDetail(opts)
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n")
    process.exit(1)
  })
