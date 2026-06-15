# Accessibility Demo App

Standalone single-page accessibility demo app.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Deploy split frontend/backend

The app is set up so Vercel serves the static frontend and a separate Node host runs the backend API.

### Backend host

Deploy this repo to Render, Railway, Fly.io, or another Node host with:

```bash
npm run render-build
npm start
```

Set these environment variables on the backend:

- `PORT`: provided by most hosts automatically.
- `ALLOWED_ORIGINS`: comma-separated frontend origins allowed to call the API, for example `https://your-vercel-app.vercel.app,https://your-domain.com`.
- `PUBLIC_BACKEND_ORIGIN`: public backend URL used when generating report links, for example `https://api.your-domain.com`.
- `DATA_ROOT`: optional writable storage path for generated reports and uploads. Defaults to the repo directory outside Vercel.
- `SCAN_TIMEOUT_MS`: optional page navigation timeout in milliseconds (default `120000`).
- `SUPABASE_URL`: Supabase project URL for storing PDF download leads.
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key (backend only; never expose to the browser).

After deploy, verify `https://api.your-domain.com/health` returns `{ "ok": true }`.

### Supabase PDF leads

Run `supabase/pdf_leads.sql` in the Supabase SQL editor to create the `pdf_leads` table.

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on Render. Leads from `/api/pdf-lead` are inserted into Supabase. Without those env vars, leads are logged to the server console only (local dev fallback).

View leads in Supabase: **Table Editor → pdf_leads**.

For Render, use:

- Build command: `npm run render-build`
- Start command: `npm start`

### Vercel frontend

Vercel builds the static frontend from `public/`.

Set this environment variable on Vercel:

- `PUBLIC_API_BASE_URL`: the backend origin, for example `https://api.your-domain.com`.

Vercel runs `npm run build`, which writes `public/config.js` so browser requests go to the backend API.

## Optional env vars

- `PORT`
- `PUBLIC_API_BASE_URL`
- `ALLOWED_ORIGINS`
- `PUBLIC_BACKEND_ORIGIN`
- `DATA_ROOT`
- `SCAN_TIMEOUT_MS`
- `SUPABASE_URL`: Supabase project URL for storing PDF download leads.
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

The app stores reports, previews, and artifacts under `runs/<runId>/` and serves them directly.
