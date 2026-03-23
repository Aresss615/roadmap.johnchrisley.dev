# roadmap.johnchrisley.dev

This roadmap now supports a free web-based backend using Supabase, so the checklist can sync across devices while the site stays static.

## Why Supabase

- free tier available
- works with static hosting like GitHub Pages
- gives you hosted Postgres, auth, and API in one service
- email sign-in is enough for a personal roadmap

## What to edit in the site

Open [index.html](/c:/dev/projects/roadmap.johnchrisley.dev/index.html#L1480) and fill in:

```html
<script>
  window.ROADMAP_SUPABASE_CONFIG = {
    url: "https://YOUR_PROJECT.supabase.co",
    anonKey: "YOUR_SUPABASE_ANON_KEY"
  };
</script>
```

The roadmap uses the Supabase CDN script plus [sync-client.js](/c:/dev/projects/roadmap.johnchrisley.dev/sync-client.js), so no build step is required.

## Supabase setup

Create a table named `roadmap_progress` with this SQL:

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
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists roadmap_progress_set_updated_at on public.roadmap_progress;

create trigger roadmap_progress_set_updated_at
before update on public.roadmap_progress
for each row
execute function public.set_updated_at();

alter table public.roadmap_progress enable row level security;

create policy "Users can read their own roadmap progress"
on public.roadmap_progress
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own roadmap progress"
on public.roadmap_progress
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own roadmap progress"
on public.roadmap_progress
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

## Auth setup

In Supabase:

1. Go to `Authentication`
2. Enable `Email` sign-in
3. Add your site URL to the allowed redirect URLs

For local testing, add:

- `http://127.0.0.1:5500`
- `http://localhost:5500`

For GitHub Pages production, add your real site URL too.

## How it works

- the roadmap still saves to `localStorage`
- when the user signs in with email, it also saves to Supabase
- opening the same magic-link account on another device loads the same roadmap state

## Notes

- the old local Node backend files are still in the repo, but the roadmap page now uses Supabase for cloud sync
- if `url` and `anonKey` are empty, the roadmap falls back to local-only storage
