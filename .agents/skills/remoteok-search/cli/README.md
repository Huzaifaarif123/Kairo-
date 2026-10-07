# remoteok-cli

Zero-dependency CLI for searching [remoteok.com](https://remoteok.com)'s public JSON
API — fully remote jobs worldwide, tech-leaning. No API key.

```bash
bun install
bun run src/cli.ts search -q "full stack" --tag react --limit 10 --format table
bun run src/cli.ts detail 1137465 --format plain
```

See `--help` for the full flag reference, and `../url-reference.md` for the API's
endpoint and response shape.

## Notes

- No server-side free-text search or pagination: the API returns the full recent
  feed (~100 postings, roughly the last two months) for a given `tags=` filter (or
  none). `--query`, `--jobage` and `--limit` are all applied client-side here.
- `--tag` is the only server-side filter; it's an exact RemoteOK tag match (e.g.
  `python`, `react`, `devops`), not free text.
- Descriptions are frequently double-encoded on RemoteOK's end (UTF-8 bytes
  reinterpreted as Latin-1), producing mojibake like `â€“` for an en dash;
  `cleanHtml` in `src/helpers.ts` fixes the handful of sequences actually observed.
- `detail <id>` re-queries the API with `?id=<id>` (RemoteOK's only way to fetch one
  job) rather than hitting a dedicated per-job endpoint, since none is published.
