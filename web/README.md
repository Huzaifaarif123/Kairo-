# Kairo web (Next.js)

The job search dashboard as a Next.js app. Same UI and features as `dashboard/`, with the
server rewritten as Next.js API routes so it deploys to Vercel.

## Run locally

```bash
cd web
npm install
npm run dev        # http://localhost:3001
```

Locally the app reads and writes the same files as the original dashboard and the
Claude Code commands: `job_search_tracker.csv`, the candidate profile in
`.claude/skills/job-application-assistant/`, and `profiles/<id>/`.

## Deploy to Vercel

1. Import the GitHub repo in Vercel.
2. **Root Directory:** `web`. Framework preset: Next.js (detected). Keep "Include files
   outside the root directory in the Build Step" enabled (the default); the app reads
   the candidate profile from the repo root.
3. **Storage:** in the project's **Storage** tab, add **Upstash for Redis** and connect it.
   This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` (`UPSTASH_REDIS_REST_URL` /
   `UPSTASH_REDIS_REST_TOKEN` also work). Without it the site loads, but saving fails
   because Vercel's filesystem is read-only.
4. Deploy.

On Vercel, the first read of each profile and tracker starts from the files in the repo;
every save after that goes to Redis. "Save to cv/" only works locally; use
"Download .tex" on Vercel.

## Notes

- Live job search calls Freehire's public API and LinkedIn's public job pages directly
  (ported from `.agents/skills/*-search`), so no Bun is needed. LinkedIn may block
  requests from cloud servers; Freehire is unaffected.
- The site has no login: anyone with the URL can view and edit profiles and pipelines.
