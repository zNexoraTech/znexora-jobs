-- =============================================================
-- 006: the daily collector ("robot")
--   * Every day it collects jobs from approved sources (employer feeds, Jooble)
--   * Removes duplicates, sorts them into categories (004), and publishes them
--   * Closes jobs that are no longer listed at the source or are too old
--   * Writes a report of every run for Admin -> Daily robot
-- Run AFTER 001-005.
-- =============================================================

-- Where a collected job came from, and when the robot last saw it at the source
alter table public.jobs
  add column if not exists collector_source text check (collector_source in ('jooble','hellowork')),
  add column if not exists last_seen_at timestamptz;

create index if not exists jobs_collector_idx on public.jobs (collector_source, last_seen_at) where collector_source is not null;
create index if not exists jobs_source_url_idx on public.jobs (source_url) where source_url is not null;

-- Companies the robot creates for collected jobs (no account, not shown in "Companies hiring now")
alter table public.employers
  add column if not exists collected boolean not null default false;
grant select (collected) on public.employers to anon;

-- -------------------------------------------------------------
-- Settings (one row)
-- -------------------------------------------------------------
create table if not exists public.collector_settings (
  id                    int primary key default 1 check (id = 1),
  enabled               boolean not null default true,
  -- 'live'   = clean jobs go live straight away (scam phrases still go to review)
  -- 'review' = every collected job waits in Admin -> Jobs to review
  publish_mode          text not null default 'live' check (publish_mode in ('live','review')),
  -- Post collected jobs to Telegram/Facebook too? (your own employers' jobs are always posted)
  share_collected       boolean not null default false,
  share_daily_limit     int not null default 10 check (share_daily_limit between 0 and 100),
  -- Jooble's free key has a small total request allowance; the robot stops before it
  jooble_daily_requests int not null default 8 check (jooble_daily_requests between 0 and 50),
  jooble_total_limit    int not null default 480 check (jooble_total_limit >= 0),
  jooble_requests_used  int not null default 0,
  -- A collected job that the source hasn't shown for this many days is closed
  unseen_days           int not null default 7 check (unseen_days between 1 and 60),
  -- A collected job is closed this many days after it was first collected
  max_age_days          int not null default 30 check (max_age_days between 7 and 60),
  updated_at            timestamptz not null default now()
);
insert into public.collector_settings (id) values (1) on conflict (id) do nothing;

-- -------------------------------------------------------------
-- Saved searches (what the robot looks for at Jooble)
-- -------------------------------------------------------------
create table if not exists public.collector_searches (
  id          uuid primary key default gen_random_uuid(),
  source      text not null default 'jooble' check (source in ('jooble')),
  keywords    text not null check (char_length(keywords) between 2 and 100),
  location    text not null default '' check (char_length(location) <= 60),
  active      boolean not null default true,
  last_run_at timestamptz,
  last_status text,
  created_at  timestamptz not null default now(),
  unique (source, keywords, location)
);

insert into public.collector_searches (keywords, location) values
  ('外国人歓迎', '東京都'),
  ('外国人歓迎', '大阪府'),
  ('外国人歓迎', '愛知県'),
  ('ミャンマー語', ''),
  ('特定技能', ''),
  ('介護 外国人', ''),
  ('英語 日本語不要', '東京都'),
  ('English speaking', 'Tokyo')
on conflict do nothing;

-- -------------------------------------------------------------
-- Run reports
-- -------------------------------------------------------------
create table if not exists public.collector_runs (
  id           uuid primary key default gen_random_uuid(),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  trigger      text not null default 'schedule' check (trigger in ('schedule','manual')),
  added        int not null default 0,
  updated      int not null default 0,
  closed       int not null default 0,
  for_review   int not null default 0,
  skipped      int not null default 0,
  requests     int not null default 0,
  details      jsonb not null default '{}'::jsonb,   -- per source / per search results and errors
  ok           boolean
);
create index if not exists collector_runs_started_idx on public.collector_runs (started_at desc);

-- Only admins see or change any of this (the robot itself uses the service key)
alter table public.collector_settings enable row level security;
alter table public.collector_searches enable row level security;
alter table public.collector_runs     enable row level security;

drop policy if exists "admin settings" on public.collector_settings;
create policy "admin settings" on public.collector_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin searches" on public.collector_searches;
create policy "admin searches" on public.collector_searches for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin runs" on public.collector_runs;
create policy "admin runs" on public.collector_runs for select to authenticated
  using (public.is_admin());

revoke all on public.collector_settings, public.collector_searches, public.collector_runs from anon;
grant select, update on public.collector_settings to authenticated;
grant select, insert, update, delete on public.collector_searches to authenticated;
grant select on public.collector_runs to authenticated;

-- Admins may change settings but not the request counter (stops it being reset by mistake)
create or replace function public.enforce_collector_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.jooble_requests_used := old.jooble_requests_used;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists collector_settings_rules on public.collector_settings;
create trigger collector_settings_rules before update on public.collector_settings
  for each row execute function public.enforce_collector_settings();

-- Only the robot (service key / SQL editor) may set collector_source / last_seen_at on jobs
create or replace function public.enforce_job_collector_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_trusted() or public.is_admin() then
    if tg_op = 'INSERT' then
      new.collector_source := null; new.last_seen_at := null;
    else
      new.collector_source := old.collector_source; new.last_seen_at := old.last_seen_at;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists jobs_collector_fields on public.jobs;
create trigger jobs_collector_fields before insert or update on public.jobs
  for each row execute function public.enforce_job_collector_fields();

-- -------------------------------------------------------------
-- Keeping listings accurate: close old / no-longer-listed jobs
-- Called by the robot every day; safe to run by hand.
-- -------------------------------------------------------------
create or replace function public.close_stale_jobs()
returns int language plpgsql security definer set search_path = public as $$
declare
  s public.collector_settings;
  n int := 0;
  m int := 0;
begin
  if not public.is_trusted() then raise exception 'not allowed'; end if;
  select * into s from public.collector_settings where id = 1;

  -- Every job past its expiry date (all jobs, not only collected ones)
  update public.jobs set status = 'closed'
  where status in ('live','pending') and expires_at < now();
  get diagnostics n = row_count;

  -- Collected jobs the source stopped showing, or that are simply too old
  update public.jobs set status = 'closed'
  where collector_source is not null and status in ('live','pending')
    and (coalesce(last_seen_at, created_at) < now() - make_interval(days => s.unseen_days)
         or created_at < now() - make_interval(days => s.max_age_days));
  get diagnostics m = row_count;
  return n + m;
end;
$$;
revoke execute on function public.close_stale_jobs() from public, anon, authenticated;

-- Atomically reserve Jooble requests so two runs can't overspend the key
create or replace function public.reserve_jooble_requests(wanted int)
returns int language plpgsql security definer set search_path = public as $$
declare
  used_before int;
  lim int;
  granted int;
begin
  if not public.is_trusted() or public.is_admin() then raise exception 'not allowed'; end if;
  select jooble_requests_used, jooble_total_limit into used_before, lim
    from public.collector_settings where id = 1 for update;
  granted := least(greatest(coalesce(wanted, 0), 0), greatest(lim - used_before, 0));
  update public.collector_settings set jooble_requests_used = used_before + granted where id = 1;
  return granted;
end;
$$;
revoke execute on function public.reserve_jooble_requests(int) from public, anon, authenticated;
