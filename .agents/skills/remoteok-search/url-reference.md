# RemoteOK API Reference

Investigated live, 2026-10-07.

## Endpoint

```
GET https://remoteok.com/api
GET https://remoteok.com/api?tags=<tag>
```

- **Auth:** none. Public, unauthenticated.
- **robots.txt:** `Allow: /` for `User-agent: *`, 1-second crawl delay requested — no
  path restricts `/api`. (Several SEO bots are explicitly disallowed; this CLI's
  User-Agent names itself honestly and is not one of them.)
- **API Terms of Service** (included as the response's first element, see below):
  requires linking back to RemoteOK as the data source and crediting "Remote OK"
  when the API is used to power another site. Not a credential or payment
  requirement — a usage-attribution term.

## Response Shape

A single JSON array. **The first element is always a notice, not a job:**

```json
[
  { "legal": "API Terms of Service: Please link back ..." },
  { "slug": "...", "id": "...", "date": "...", "company": "...", "position": "...", "tags": [...], "location": "...", "description": "...", "url": "...", "salary_min": 0, "salary_max": 0 },
  ...
]
```

`helpers.ts`'s `apiGet` strips the notice element before returning (filters for
objects that have both `id` and `position`).

### Per-job fields used by this skill

| Field | Notes |
|---|---|
| `id` | Numeric string. Stable; also embedded as the trailing `-<id>` segment of `slug`/`url`. |
| `slug` | URL-safe slug, e.g. `remote-platform-and-integration-engineer-...-1137465`. |
| `date` | ISO 8601 posting date. Can be `null`. |
| `company` | Company name. |
| `position` | Job title. |
| `tags` | Array of lowercase facet strings (role, skill, employment type — all mixed into one list, no sub-typing). |
| `location` | Often `""` (blank) or `"Remote"`. Occasionally a city when the role has a regional constraint. |
| `description` | Full HTML description. **Frequently double-encoded** — see Mojibake below. Always ends with RemoteOK's own anti-spam "mention the word ..." boilerplate paragraph; not stripped (harmless, and stripping it risks false-positive matches on legitimate description text). |
| `url` | Full posting URL. **Domain casing is inconsistent** (`remoteOK.com` on many entries, `remoteok.com` on others) — RemoteOK's own data, not a parsing bug; treat case-insensitively. |
| `salary_min`, `salary_max` | USD, `0` when not given (never omitted — check for falsy, not for key presence). |

### Query Parameters

| Param | Behavior (verified live) |
|---|---|
| `tags=<tag>` | **Works.** Narrows the feed to postings carrying that tag. Repeatable in this CLI (appended as multiple `tags=` params); RemoteOK's own site UI uses one tag per request, multi-tag behavior beyond that wasn't exercised. |
| `id=<id>` | **Does not filter.** Verified live 2026-10-07: `?id=1136796` returned the full ~100-entry feed, unfiltered, with an unrelated job first. `detail` in this CLI fetches the full feed and matches the id client-side instead. |
| *(none)* | Full feed, ~100 most recent postings (roughly the last two months at time of writing). |

No documented `page`, `limit`, `q`, or date-range parameter exists. `--jobage` and
`--limit` in this CLI are applied client-side against the fetched feed; `--query`
is a simple case-insensitive substring match against title + company + tags.

## Mojibake (description field encoding)

RemoteOK's `description` text is frequently corrupted by a double-encoding step on
their end: the original UTF-8 bytes were decoded as **Windows-1252** (not plain
Latin-1 — CP1252's 0x80-0x9F range holds smart quotes, dashes, €, and other
punctuation that Latin-1 leaves as C1 control codes) and the resulting characters
were then re-encoded as UTF-8. The visible symptom is sequences like `â€™` where an
apostrophe should be, `â€"` for an em dash, or multi-character garbage where a
multi-byte emoji should be.

`helpers.ts`'s `fixMojibake` reverses this exactly: each character in the string is
mapped back to the single CP1252 byte it must have come from (the 0x80-0x9F block
via an explicit table, everything else 1:1 with its code point), and the resulting
byte sequence is decoded as UTF-8. A character that doesn't fit either mapping means
the text was never mojibake in the first place, and the function returns it
unchanged rather than risk corrupting already-correct text.

## Detail / Single-Job Lookup

No dedicated per-job endpoint is published. `detail <id>` in this CLI re-fetches
the full feed (same `GET /api` as `search`) and finds the matching `id` client-side.
This costs one extra full-feed fetch per lookup but is the only reliable mechanism
available — the `?id=` parameter does not do this itself (see above).

## Rate Limiting / Retry

No documented rate limit was found; `robots.txt` requests a 1-second crawl delay.
`helpers.ts` retries 429/5xx responses with exponential backoff (base 500ms, capped
at 8s, up to 6 attempts) as a general courtesy and resilience measure, matching the
pattern used by `freehire-search` and the Danish portal skills.
