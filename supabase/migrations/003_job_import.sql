-- =============================================================
-- 003: collecting jobs in bulk
--   * CSV upload by employers/recruiters (updates rows with the same "ref")
--   * Job feeds: an employer's careers page (schema.org JobPosting) or XML feed,
--     imported daily by the import-feeds function
-- Run AFTER 001 and 002.
-- =============================================================

-- Each employer's own id for a job (CSV "ref" column or the feed's job id/url).
alter table public.jobs
  add column source_ref text check (char_length(source_ref) <= 300),
  add column feed_id uuid;

create unique index jobs_employer_ref_uidx on public.jobs (employer_id, source_ref);

-- -------------------------------------------------------------
-- Job feeds
-- -------------------------------------------------------------
create table public.job_feeds (
  id             uuid primary key default gen_random_uuid(),
  employer_id    uuid not null references public.employers(id) on delete cascade,
  url            text not null check (url ~ '^https://' and char_length(url) <= 500),
  format         text not null default 'auto' check (format in ('auto','jsonld','xml')),
  active         boolean not null default true,
  last_run_at    timestamptz,
  last_status    text,          -- e.g. "ok: 12 jobs (3 new, 1 closed)" or "error: ..."
  created_at     timestamptz not null default now(),
  unique (employer_id, url)
);
alter table public.jobs add constraint jobs_feed_fk foreign key (feed_id) references public.job_feeds(id) on delete set null;
alter table public.job_feeds enable row level security;

-- Only verified employers may add feeds (stops strangers making us fetch random URLs), max 3 each
create or replace function public.enforce_feed_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_trusted() then
    if not exists (select 1 from public.employers e where e.id = new.employer_id and e.owner_id = auth.uid() and e.verified) then
      raise exception 'only verified employers can add job feeds';
    end if;
    if tg_op = 'INSERT' then
      if (select count(*) from public.job_feeds where employer_id = new.employer_id) >= 3 then
        raise exception 'maximum 3 feeds per employer';
      end if;
      new.last_run_at := null; new.last_status := null;
    else
      new.employer_id := old.employer_id;
      new.last_run_at := old.last_run_at; new.last_status := old.last_status;
    end if;
  end if;
  return new;
end;
$$;
create trigger job_feeds_rules before insert or update on public.job_feeds
  for each row execute function public.enforce_feed_rules();

create policy "owner manages feeds" on public.job_feeds for all to authenticated
  using (exists (select 1 from public.employers e where e.id = job_feeds.employer_id and e.owner_id = auth.uid()) or public.is_admin())
  with check (exists (select 1 from public.employers e where e.id = job_feeds.employer_id and e.owner_id = auth.uid()) or public.is_admin());
revoke all on public.job_feeds from anon;

-- Owners can't fake feed_id / source_ref of other employers (employer_id is already locked by the job trigger)
create or replace function public.enforce_job_feed_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_trusted() then
    if tg_op = 'INSERT' then new.feed_id := null; else new.feed_id := old.feed_id; end if;
  end if;
  return new;
end;
$$;
create trigger jobs_feed_link before insert or update on public.jobs
  for each row execute function public.enforce_job_feed_link();
