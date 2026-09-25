-- One row per analysis run on tagfinder.turtleops.org.
--
-- Run once in the Supabase SQL editor. The other tables this app uses
-- (tag_reports, tag_rate_limits, tag_feedback) were created the same way;
-- this file exists so the next one is written down.
--
-- Written only by the service-role key from /api/analyses and /api/summarize;
-- never read or written from the browser, so RLS stays on with no policies.
--
-- What goes in: the same computed summary the AI brief already sends off-site
-- (tag number, position, drift state, radius) plus who ran it and which file
-- types they dropped. Never a raw file, never a file's contents.
--
-- The recovered_* columns are filled in by hand later, from the field: they
-- are what turns this from a usage log into the record behind "found within
-- 200 m of the estimate".

create table if not exists public.tag_analyses (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  user_email            text not null,
  ptt                   integer,
  manufacturer          text,            -- 'lotek' | 'wildlife_computers' | 'unknown'
  tag_category          text,            -- 'psat' | 'tracker' | ...
  file_types            text[] not null default '{}',
  fix_count             integer,
  last_fix_at           timestamptz,
  release_at            timestamptz,
  release_category      text,
  drift_recent          text,
  drift_medium          text,
  drift_all_time        text,
  drift_speed_kmh       double precision,
  drift_heading_deg     double precision,
  best_lat              double precision,
  best_lon              double precision,
  position_method       text,
  primary_radius_m      double precision,
  tag_state             text,
  summary               jsonb,           -- the compact record the page posted
  brief_generated       boolean not null default false,
  brief_input_tokens    integer,
  brief_output_tokens   integer,
  -- filled in later, by hand
  recovered             boolean,
  recovered_at          timestamptz,
  recovery_distance_m   double precision,
  recovery_notes        text
);

create index if not exists tag_analyses_created_at_idx on public.tag_analyses (created_at desc);
create index if not exists tag_analyses_ptt_idx on public.tag_analyses (ptt);
create index if not exists tag_analyses_email_idx on public.tag_analyses (user_email);

alter table public.tag_analyses enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) touches it.
