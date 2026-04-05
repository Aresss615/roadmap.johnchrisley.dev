# roadmap.johnchrisley.dev

[![Live Site](https://img.shields.io/badge/Live%20Site-roadmap.johnchrisley.dev-blue?style=flat-square)](https://roadmap.johnchrisley.dev)
[![HTML](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/HTML)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)
[![Hosted on GitHub Pages](https://img.shields.io/badge/Hosted%20on-GitHub%20Pages-222?style=flat-square&logo=github)](https://pages.github.com)

A personal 10-year AI Engineering roadmap and interactive progress tracker built by John Chrisley. The site is a single HTML file with no build step — all state is saved to `localStorage` and optionally synced across devices with a free Supabase backend.

---

## Overview

This roadmap covers four career and wealth phases — from completing a Computer Engineering degree through landing a first AI engineering job, scaling a SaaS product, and ultimately crossing a $1M USD net worth target. Each phase contains milestones, a curated skill tree with resources, and a weekly-goal checklist. Every checkbox you tick is saved instantly in the browser, and optionally mirrored to Supabase so the same progress appears on any device you log into.

---

## Features

- **4-phase interactive roadmap** spanning 2025–2037 with phase-specific color themes
- **Clickable checklists** for milestones and skills — state persists in `localStorage` with zero setup
- **Expandable skill cards** showing why the skill matters, estimated time, difficulty, weekly goals, topics, and hand-picked free resources
- **Live progress bar** showing overall completion percentage across all phases
- **ADHD Mode** — one-click toggle that surfaces rotating focus tips to help maintain momentum
- **Cloud Sync via Supabase** — sign in with Google OAuth and your checklist state syncs across all devices in real time
- **Conflict resolution** — on sign-in, the client automatically merges local and cloud state by comparing `updatedAt` timestamps and keeping the newest
- **Status pill UI** — a visual indicator that shows "Local Only", "Cloud Active", "Syncing", or "Needs Attention"
- **Auto-save debounce** — remote saves are debounced 500 ms so rapid checkbox taps fire only one API call
- **Legacy Node.js backend** — a self-hosted HTTP server (zero npm dependencies) that can replace Supabase for fully offline or self-hosted deployments
- **Responsive layout** — fluid typography with `clamp()`, works on mobile and desktop
- **No build tooling required** — open the HTML file directly in a browser or serve it with any static host

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend | HTML5 + Vanilla JS (ES Modules) | — |
| Fonts | Syne (display), Inter (body) | via Google Fonts |
| Cloud sync client | Supabase JS SDK | `@supabase/supabase-js@2` (CDN) |
| Database | Supabase Postgres + Row Level Security | Free tier |
| Auth | Supabase Google OAuth | — |
| Legacy backend | Node.js HTTP server (no npm deps) | Node >= 18 (ESM) |
| Package manager | npm | — |
| Hosting | GitHub Pages (static) | — |
| Custom domain | `roadmap.johnchrisley.dev` via CNAME | — |

---

## Installation

### Option A — Static only (recommended for most people)

You only need a browser. No installs required.

```bash
# 1. Clone the repo
git clone https://github.com/johnchrisley/roadmap.johnchrisley.dev.git
cd roadmap.johnchrisley.dev

# 2. Open in your browser
open index.html
# or on Linux:
xdg-open index.html
```

That's it. Checklist progress saves to `localStorage` automatically.

---

### Option B — Local Node.js dev server

Use this if you want a proper local server with hot-reload and the legacy sync API.

**Prerequisites:** Node.js 18 or later.

```bash
# 1. Clone the repo
git clone https://github.com/johnchrisley/roadmap.johnchrisley.dev.git
cd roadmap.johnchrisley.dev

# 2. Install dependencies (validates package.json — there are none to fetch)
npm install

# 3. Start the dev server with file watching
npm run dev
# Server starts at http://localhost:8787

# To run without watch mode:
npm start
```

The Node server serves `index.html`, `sync-client.js`, and everything under `img/` as static files, and exposes the legacy REST API at `/api/state/load` and `/api/state/save`.

**Environment variables (optional):**

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8787` | TCP port for the HTTP server |
| `DATA_DIR` | `./backend/data` | Directory where profile JSON files are stored |

---

### Option C — Enable Supabase cloud sync

The recommended approach for real cross-device sync. Supabase's free tier is sufficient for personal use.

**1. Create a Supabase project** at [supabase.com](https://supabase.com).

**2. Run the following SQL** in the Supabase SQL editor to create the progress table and policies:

```sql
create table if not exists public.roadmap_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  payload jsonb not null default '{}'::jsonb,
  updated_at_ms bigint not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end; $$;

drop trigger if exists roadmap_progress_set_updated_at on public.roadmap_progress;

create trigger roadmap_progress_set_updated_at
before update on public.roadmap_progress
for each row execute function public.set_updated_at();

alter table public.roadmap_progress enable row level security;

create policy "Users can read their own roadmap progress"
  on public.roadmap_progress for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own roadmap progress"
  on public.roadmap_progress for insert to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own roadmap progress"
  on public.roadmap_progress for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

**3. Enable Google OAuth** in the Supabase dashboard:

- Go to **Authentication > Providers** and enable **Google**
- Add your live site URL to the allowed redirect URLs
- For local dev, also add `http://localhost:8787` (or whichever port you use)

**4. Add your project credentials** to `index.html` near the bottom of the file:

```html
<script>
  window.ROADMAP_SUPABASE_CONFIG = {
    url: "https://YOUR_PROJECT.supabase.co",
    anonKey: "YOUR_SUPABASE_ANON_KEY"
  };
</script>
```

Both values are safe to commit — they are the public anon key, not the service role secret.

If `url` and `anonKey` are left empty, the site gracefully falls back to local-only storage.

---

## Usage

1. Open the site in your browser.
2. Use the **phase tabs** at the top to navigate between the four roadmap phases.
3. Click any **checklist item** or **milestone** to mark it complete. Progress saves immediately.
4. Click a **skill card header** to expand it and see resources, topics, time estimates, and weekly goals.
5. Toggle **ADHD Mode** to display rotating focus tips. Click the banner to cycle to the next tip.
6. Click **Sign in with Google** in the Cloud Sync panel to link your progress to a Supabase account and sync across devices.
7. Use the **Sync Now** button to manually push local state to the cloud at any time.
8. Click **Sign Out** to disconnect the cloud session while keeping local progress intact.

---

## Screenshots

> Add screenshots to a `screenshots/` folder and update the paths below.

![Overview — Phase tabs and progress bar](./screenshots/overview.png)
![Phase 1 — Foundation checklist expanded](./screenshots/phase1.png)
![Skill card expanded with resources](./screenshots/skill-card.png)
![Cloud Sync panel — signed in](./screenshots/cloud-sync.png)
![ADHD Mode active with focus tip](./screenshots/adhd-mode.png)

---

## Folder Structure

```
roadmap.johnchrisley.dev/
├── index.html            # Entire frontend — all markup, styles, and JS in one file
├── sync-client.js        # Supabase cloud sync module (injected after page renders)
├── package.json          # npm metadata and dev/start scripts
├── CNAME                 # GitHub Pages custom domain: roadmap.johnchrisley.dev
├── img/
│   └── jc-logo.svg       # Site logo (SVG)
└── backend/
    ├── server.mjs        # Self-hosted Node.js HTTP server (legacy sync API, zero deps)
    ├── server.stdout.log # Runtime log (gitignored)
    ├── server.stderr.log # Error log (gitignored)
    └── data/
        └── .gitignore    # Excludes all profile JSON files from version control
```

---

## API Reference (Legacy Node Backend)

These endpoints are only relevant when running the self-hosted Node server instead of Supabase.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Returns server status and current timestamp |
| `POST` | `/api/state/load` | Load saved roadmap state by `profileId` + `syncKey` |
| `POST` | `/api/state/save` | Save roadmap state — creates a new profile on first call |

Example request body for `/api/state/save`:

```json
{
  "profileId": "john",
  "syncKey": "my-secret-passphrase",
  "payload": {
    "checked": { "phase-1-python": true },
    "adhdMode": false,
    "activePhase": 1,
    "tipIdx": 0,
    "openSkills": {}
  }
}
```

Sync keys are stored as `scrypt`-hashed salted secrets. Profile IDs are normalized and SHA-256-prefixed to prevent path traversal. Request bodies are capped at 256 KB.

---

## Future Improvements

- [ ] Dark/light mode toggle
- [ ] Export progress as a PDF or shareable image
- [ ] Streak counter and streak-protection reminders
- [ ] Email magic-link auth (in addition to Google OAuth)
- [ ] Per-skill notes field for journaling progress
- [ ] PWA manifest + service worker for offline support on mobile
- [ ] Editable phase content so others can fork and personalize their own roadmap
- [ ] Public read-only share URL that displays your progress to others
- [ ] Progress analytics dashboard showing completion velocity over time

---

## Deployment

### GitHub Pages (current setup)

The repo is configured for GitHub Pages with a `CNAME` file. Push to `main` and GitHub deploys automatically. No build step needed.

```bash
git push origin main
# Site updates at https://roadmap.johnchrisley.dev within ~30 seconds
```

### Vercel

```bash
npm install -g vercel
vercel
# When prompted, select "Other" for framework
# Set the output directory to: . (project root)
```

Add your Supabase credentials inline in `index.html` before deploying (the anon key is safe to expose publicly).

### Netlify

Drag and drop the project folder onto [app.netlify.com/drop](https://app.netlify.com/drop), or use the CLI:

```bash
npm install -g netlify-cli
netlify deploy --dir . --prod
```

Set a custom domain under **Domain Management** in the Netlify dashboard.

### Self-hosted (VPS with nginx)

```bash
# On your server
git clone https://github.com/johnchrisley/roadmap.johnchrisley.dev.git
cd roadmap.johnchrisley.dev

# Run the Node backend
PORT=8787 DATA_DIR=/var/data/roadmap node ./backend/server.mjs

# Keep it alive with pm2
npm install -g pm2
pm2 start ./backend/server.mjs --name roadmap
pm2 save
pm2 startup
```

Point nginx at `localhost:8787` and issue a TLS certificate with Certbot / Let's Encrypt.

---

## Author

**John Chrisley**
[johnchrisley.dev](https://johnchrisley.dev)

---

*Built without frameworks. No build step. No frontend dependencies.*
