---
name: remoteok-search
version: 1.0.0
description: >
  Use this skill to search live, fully-remote job listings worldwide via
  remoteok.com's public JSON API, or to look up a specific posting. Tech-leaning
  (engineering, data, design, product, devops) but covers business/marketing/support
  roles too. Trigger phrases: remote job search, fully remote jobs, work from
  anywhere, remote developer jobs, remote engineering roles, digital nomad jobs,
  look up this RemoteOK job posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/remoteok-search/cli/src/cli.ts *)
---

# RemoteOK Search Skill

Search live job listings from **[remoteok.com](https://remoteok.com)** — one of
the largest boards dedicated entirely to fully-remote roles. No authentication, no
API key, and **zero runtime dependencies** — it runs with just `bun`.

> Worked example of the repo's job-portal-skill pattern, like `freehire-search`:
> queries a public JSON API directly, so results are structured rather than parsed
> from markup. Unlike freehire, RemoteOK's API has no server-side free-text search
> or pagination — it returns the full recent feed (~100 postings, roughly the last
> two months) for an optional `tags=` filter, with keyword matching, a date window,
> and the result limit all applied client-side by this CLI.

## ℹ️ Hosted-service dependency (best-effort, no SLA)

This skill depends on a third-party site, remoteok.com. Reads are **public and
unauthenticated**. If the API is unreachable, the CLI fails gracefully — a
non-zero exit with a clear error message — so an outage degrades this source
rather than breaking the surrounding workflow.

## When to use this skill

- Search for fully-remote job openings by keyword or RemoteOK tag (e.g. `python`,
  `react`, `devops`) — each search hit can include the full description, no
  per-hit follow-up needed, via `--no-description` to opt out for a cheap
  discovery pass instead.
- Look up one posting's full detail (description, salary if listed, tags) by its
  RemoteOK id or job URL.

## Command Reference

```bash
bun run .agents/skills/remoteok-search/cli/src/cli.ts search [-q "<keywords>"] [--tag <tag>] [--jobage <days>] [--limit <n>] [--format json|table|plain]
bun run .agents/skills/remoteok-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

| Flag | Description |
|---|---|
| `--query`, `-q` | Keywords matched against title, company and tags (client-side). |
| `--tag` | RemoteOK tag filter, e.g. `python`, `react`, `devops` (repeatable; the only **server-side** filter). |
| `--jobage` | Only postings from the last N days (client-side; the feed covers ~2 months). |
| `--limit`, `-n` | Max results. Default 25. |
| `--format` | `json` (default) \| `table` \| `plain`. |
| `--no-description` | Skip description text for a cheap discovery pass. |

## Usage Examples

```bash
# Full-stack roles, React tag, table view
bun run .agents/skills/remoteok-search/cli/src/cli.ts search -q "full stack" --tag react --limit 10 --format table

# Python roles posted in the last 2 weeks
bun run .agents/skills/remoteok-search/cli/src/cli.ts search --tag python --jobage 14 --format table

# DevOps roles, JSON for downstream processing
bun run .agents/skills/remoteok-search/cli/src/cli.ts search --tag devops --format json

# One posting's full detail
bun run .agents/skills/remoteok-search/cli/src/cli.ts detail 1136796 --format plain

# Discovery pass without paying for description text
bun run .agents/skills/remoteok-search/cli/src/cli.ts search --tag golang --no-description --format table
```

## Output Format

`search --format json` returns:
```json
{ "meta": { "count": 5, "page": 1 }, "results": [
  { "id": "1136796", "title": "...", "company": "...", "location": "...", "date": "...", "url": "...", "tags": ["..."], "salary": "...", "description": "..." }
] }
```

`detail` returns one such object (with `description` always populated when found).

## Notes

- **No server-side search or pagination.** `--tag` is the only filter RemoteOK's
  API actually applies; everything else is client-side against the ~100-entry feed
  it returns. A very specific `--query` on a niche term may turn up nothing if the
  matching job has scrolled out of that feed — this is a small, recent-postings
  board, not a full archive.
- **`?id=` does not filter server-side** (verified live — it silently returns the
  unfiltered feed regardless of the value given). `detail` fetches the full feed
  and matches the id client-side instead of trusting the API's own id parameter.
- **Descriptions are frequently double-encoded** on RemoteOK's end (the original
  UTF-8 was decoded as Windows-1252 and re-encoded), producing mojibake like
  `â€™` for an apostrophe. `cleanHtml` in `cli/src/helpers.ts` reverses this
  exactly rather than guessing — see the comment there for the mechanism.
- Location is often blank or just `"Remote"` — this board doesn't require a
  specific base location the way hybrid-role boards do.
