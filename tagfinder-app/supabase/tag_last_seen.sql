-- What each user last saw of each tag: one row per user and PTT.
--
-- Run once in the Supabase SQL editor, like tag_analyses.sql.
--
-- Written only by the service-role key from /api/analyses; never read or
-- written from the browser, so RLS stays on with no policies.
--
-- It lets the next upload of the same PTT say what changed: moved, new data,
-- nothing new (analysis/sinceLast.ts). A Wildlife Computers export is
-- cumulative, so the new upload already holds the record; all that is kept
-- from last time is a few timestamps and the position. Never a file.
--
-- Overwritten on every analysis. A release date more than a day from the
-- stored one is a new deployment of the PTT, and the comparison is skipped.

create table if not exists public.tag_last_seen (
  user_email        text not null,
  ptt               integer not null,
  release_at        timestamptz,
  first_data_at     timestamptz,     -- earliest fix in the upload
  last_fix_at       timestamptz,
  last_message_at   timestamptz,     -- newest Argos pass of any kind
  fix_count         integer,
  best_lat          double precision,
  best_lon          double precision,
  radius_m          double precision,
  tag_state         text,
  analyzed_at       timestamptz not null default now(),
  primary key (user_email, ptt)
);

alter table public.tag_last_seen enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) touches it.
