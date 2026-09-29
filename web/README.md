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
3. **Database (Postgres):** in the project's **Storage** tab, create a **Neon** (Postgres)
   database and connect it to the project for all environments. This sets `DATABASE_URL`
   (or `POSTGRES_URL`). The app creates its two tables (`kairo_profiles`,
   `kairo_trackers`) automatically on first use. Without a database the site loads, but
   saving fails because Vercel's filesystem is read-only. (Upstash Redis still works as
   an alternative via `KV_REST_API_URL` / `KV_REST_API_TOKEN`; Postgres wins if both are set.)
4. Deploy.

On Vercel, the first read of each profile and tracker starts from the files in the repo;
every save after that goes to the database. Check `/api/health` on the live site: it
should show `"storage":"postgres","database":"connected"`. "Save to cv/" only works locally; use
"Download .tex" on Vercel.

## Notes

- Live job search calls Freehire's public API and LinkedIn's public job pages directly
  (ported from `.agents/skills/*-search`), so no Bun is needed. LinkedIn may block
  requests from cloud servers; Freehire is unaffected.
- The site has no login: anyone with the URL can view and edit profiles and pipelines.
