-- =============================================================
-- ZNexora Jobs — database schema, Row Level Security, storage
-- Run this in Supabase: SQL Editor -> New query -> paste -> Run
-- Run it on STAGING first. Re-run on PRODUCTION later.
-- =============================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------
-- 1. PROFILES (one row per login)
-- -------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          text not null default 'seeker' check (role in ('seeker','employer','admin')),
  display_name  text check (char_length(display_name) <= 80),
  language      text not null default 'en' check (language in ('en','my','ja')),
  suspended     boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Helper functions (security definer so they can read profiles inside RLS)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and not suspended);
$$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and not suspended;
$$;

-- Trusted = an admin user, OR the Supabase SQL editor / service_role key
-- (no logged-in user). Used by triggers so you can promote an admin manually.
create or replace function public.is_trusted()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (
    auth.uid() is null and (
      session_user in ('postgres','supabase_admin')
      or coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role'
    )
  );
$$;

-- Create a profile automatically when someone signs up.
-- Only 'seeker' or 'employer' can be chosen at signup; admin is set manually.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  requested text := coalesce(new.raw_user_meta_data->>'role', 'seeker');
begin
  if requested not in ('seeker','employer') then
    requested := 'seeker';
  end if;
  insert into public.profiles (id, role, display_name, language)
  values (
    new.id,
    requested,
    left(coalesce(new.raw_user_meta_data->>'display_name', ''), 80),
    case when new.raw_user_meta_data->>'language' in ('en','my','ja')
         then new.raw_user_meta_data->>'language' else 'en' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------------
-- 2. SEEKER PROFILES (no passport / residence card / NRC numbers!)
-- -------------------------------------------------------------
create table public.seeker_profiles (
  user_id               uuid primary key references public.profiles(id) on delete cascade,
  prefecture            text,
  japanese_level        text check (japanese_level in ('N1','N2','N3','N4','N5','none')),
  skills                text check (char_length(skills) <= 2000),
  job_types             text[] default '{}',
  visa_type             text check (char_length(visa_type) <= 60),   -- optional, self-declared
  visible_to_employers  boolean not null default true,    -- shared only with employers you apply to
  updated_at            timestamptz not null default now()
);

-- -------------------------------------------------------------
-- 3. EMPLOYERS
-- -------------------------------------------------------------
create table public.employers (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null unique references public.profiles(id) on delete cascade,
  company_name      text not null check (char_length(company_name) between 1 and 120),
  corporate_number  text check (corporate_number ~ '^[0-9]{13}$'),
  address           text check (char_length(address) <= 200),
  phone             text check (char_length(phone) <= 30),
  website           text check (char_length(website) <= 200),
  description       text check (char_length(description) <= 3000),
  verified          boolean not null default false,
  created_at        timestamptz not null default now()
);

-- -------------------------------------------------------------
-- 4. JOBS
-- -------------------------------------------------------------
create table public.jobs (
  id                       uuid primary key default gen_random_uuid(),
  employer_id              uuid not null references public.employers(id) on delete cascade,
  title                    text not null check (char_length(title) between 3 and 120),
  description              text not null check (char_length(description) between 20 and 8000),
  prefecture               text not null,
  city                     text check (char_length(city) <= 80),
  job_type                 text not null check (job_type in ('full_time','part_time','contract','arubaito')),
  wage_type                text not null default 'hourly' check (wage_type in ('hourly','monthly','yearly')),
  wage_min                 integer check (wage_min >= 0),
  wage_max                 integer check (wage_max >= 0),
  hours                    text check (char_length(hours) <= 200),
  japanese_level_required  text check (japanese_level_required in ('N1','N2','N3','N4','N5','none')),
  status                   text not null default 'pending'
                           check (status in ('draft','pending','live','closed','rejected')),
  reject_reason            text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  expires_at               timestamptz not null default (now() + interval '60 days'),
  check (wage_max is null or wage_min is null or wage_max >= wage_min)
);

create index jobs_status_idx on public.jobs (status, created_at desc);
create index jobs_employer_idx on public.jobs (employer_id);

-- -------------------------------------------------------------
-- 5. APPLICATIONS
-- -------------------------------------------------------------
create table public.applications (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  seeker_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  message     text check (char_length(message) <= 3000),
  cv_path     text,
  status      text not null default 'sent' check (status in ('sent','viewed','interview','rejected','hired')),
  created_at  timestamptz not null default now(),
  unique (job_id, seeker_id)
);

create index applications_job_idx on public.applications (job_id);

-- -------------------------------------------------------------
-- 6. REPORTS
-- -------------------------------------------------------------
create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  job_id       uuid references public.jobs(id) on delete cascade,
  employer_id  uuid references public.employers(id) on delete cascade,
  reason       text not null check (reason in ('scam','fee_requested','illegal_work','wrong_info','discrimination','other')),
  details      text check (char_length(details) <= 2000),
  status       text not null default 'open' check (status in ('open','reviewed','actioned')),
  created_at   timestamptz not null default now(),
  check (job_id is not null or employer_id is not null)
);

-- -------------------------------------------------------------
-- 7. AUDIT LOG (written by triggers, read by admin)
-- -------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  action      text not null,
  target      text not null,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

-- =============================================================
-- BUSINESS-RULE TRIGGERS
-- =============================================================

-- Jobs: non-admins can never publish (live) or reject; editing a live
-- job sends it back to review; employer_id cannot be moved.
create or replace function public.enforce_job_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if public.is_trusted() then
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      insert into public.audit_log (actor_id, action, target, detail)
      values (auth.uid(), 'job_status', new.id::text,
              jsonb_build_object('from', old.status, 'to', new.status, 'reason', new.reject_reason));
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('draft','pending') then new.status := 'pending'; end if;
    new.reject_reason := null;
    new.expires_at := now() + interval '60 days';
    return new;
  end if;

  -- UPDATE by owner
  if new.employer_id is distinct from old.employer_id then
    raise exception 'employer_id cannot be changed';
  end if;
  if new.status in ('live','rejected') and new.status is distinct from old.status then
    raise exception 'only an admin can publish or reject a job';
  end if;
  new.reject_reason := old.reject_reason;
  new.expires_at := old.expires_at;
  if old.status = 'live' and new.status = 'live' and (
       new.title, new.description, new.prefecture, new.city, new.job_type,
       new.wage_type, new.wage_min, new.wage_max, new.hours, new.japanese_level_required
     ) is distinct from (
       old.title, old.description, old.prefecture, old.city, old.job_type,
       old.wage_type, old.wage_min, old.wage_max, old.hours, old.japanese_level_required
     ) then
    new.status := 'pending';   -- re-moderate edited live jobs (stops bait-and-switch)
  end if;
  return new;
end;
$$;

create trigger jobs_rules before insert or update on public.jobs
  for each row execute function public.enforce_job_rules();

-- Employers: only admin can change "verified"; log it.
create or replace function public.enforce_employer_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_trusted() then
    if tg_op = 'INSERT' then
      new.verified := false;
      new.owner_id := auth.uid();
    else
      new.verified := old.verified;
      new.owner_id := old.owner_id;
    end if;
  elsif tg_op = 'UPDATE' and new.verified is distinct from old.verified then
    insert into public.audit_log (actor_id, action, target, detail)
    values (auth.uid(), 'employer_verified', new.id::text, jsonb_build_object('verified', new.verified));
  end if;
  return new;
end;
$$;

create trigger employers_rules before insert or update on public.employers
  for each row execute function public.enforce_employer_rules();

-- Profiles: users can't change their own role or suspension; log admin changes.
create or replace function public.enforce_profile_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_trusted() then
    new.role := old.role;
    new.suspended := old.suspended;
  elsif new.role is distinct from old.role or new.suspended is distinct from old.suspended then
    insert into public.audit_log (actor_id, action, target, detail)
    values (auth.uid(), 'profile_admin_change', new.id::text,
            jsonb_build_object('role', new.role, 'suspended', new.suspended));
  end if;
  return new;
end;
$$;

create trigger profiles_rules before update on public.profiles
  for each row execute function public.enforce_profile_rules();

-- Applications: seeker can only apply to live jobs, as a seeker, as themselves.
create or replace function public.enforce_application_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.seeker_id := auth.uid();
    new.status := 'sent';
    if public.my_role() is distinct from 'seeker' then
      raise exception 'only job seekers can apply';
    end if;
    if not exists (select 1 from public.jobs where id = new.job_id and status = 'live' and expires_at > now()) then
      raise exception 'this job is not open';
    end if;
    if new.cv_path is not null and split_part(new.cv_path, '/', 1) <> auth.uid()::text then
      raise exception 'invalid CV path';
    end if;
  else
    -- only status may change after sending
    new.job_id := old.job_id;
    new.seeker_id := old.seeker_id;
    new.message := old.message;
    new.cv_path := old.cv_path;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger applications_rules before insert or update on public.applications
  for each row execute function public.enforce_application_rules();

-- Reports: reporter is always the current user.
create or replace function public.enforce_report_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_trusted() then
    new.reporter_id := auth.uid();
    new.status := 'open';
  end if;
  return new;
end;
$$;

create trigger reports_rules before insert on public.reports
  for each row execute function public.enforce_report_rules();

-- =============================================================
-- ROW LEVEL SECURITY — default deny, then allow narrowly
-- =============================================================
alter table public.profiles        enable row level security;
alter table public.seeker_profiles enable row level security;
alter table public.employers       enable row level security;
alter table public.jobs            enable row level security;
alter table public.applications    enable row level security;
alter table public.reports         enable row level security;
alter table public.audit_log       enable row level security;

-- Is the current user the employer that owns this job?
create or replace function public.owns_job(j uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.jobs jb join public.employers e on e.id = jb.employer_id
    where jb.id = j and e.owner_id = auth.uid()
  );
$$;

-- PROFILES
create policy "own profile read"    on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "own profile update"  on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin())
                                                           with check (id = auth.uid() or public.is_admin());
-- employers can see display name of people who applied to their jobs
create policy "employer sees applicant profile" on public.profiles for select to authenticated using (
  exists (select 1 from public.applications a where a.seeker_id = profiles.id and public.owns_job(a.job_id))
);

-- SEEKER PROFILES
create policy "seeker own read"   on public.seeker_profiles for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "seeker own insert" on public.seeker_profiles for insert to authenticated with check (user_id = auth.uid() and public.my_role() = 'seeker');
create policy "seeker own update" on public.seeker_profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "employer sees applicant" on public.seeker_profiles for select to authenticated using (
  seeker_profiles.visible_to_employers
  and exists (select 1 from public.applications a where a.seeker_id = seeker_profiles.user_id and public.owns_job(a.job_id))
);

-- EMPLOYERS
create policy "public sees verified employers" on public.employers for select to anon, authenticated using (verified);
create policy "owner reads employer"   on public.employers for select to authenticated using (owner_id = auth.uid() or public.is_admin());
create policy "employer creates own"   on public.employers for insert to authenticated with check (owner_id = auth.uid() and public.my_role() = 'employer');
create policy "owner updates employer" on public.employers for update to authenticated using (owner_id = auth.uid() or public.is_admin())
                                                                 with check (owner_id = auth.uid() or public.is_admin());

-- JOBS
create policy "public sees live jobs" on public.jobs for select to anon, authenticated using (
  status = 'live' and expires_at > now()
  and exists (select 1 from public.employers e where e.id = jobs.employer_id and e.verified)
);
create policy "owner sees own jobs" on public.jobs for select to authenticated using (
  exists (select 1 from public.employers e where e.id = jobs.employer_id and e.owner_id = auth.uid())
  or public.is_admin()
);
create policy "owner creates jobs" on public.jobs for insert to authenticated with check (
  exists (select 1 from public.employers e where e.id = jobs.employer_id and e.owner_id = auth.uid())
);
create policy "owner updates jobs" on public.jobs for update to authenticated using (
  exists (select 1 from public.employers e where e.id = jobs.employer_id and e.owner_id = auth.uid())
  or public.is_admin()
) with check (
  exists (select 1 from public.employers e where e.id = jobs.employer_id and e.owner_id = auth.uid())
  or public.is_admin()
);
create policy "owner deletes jobs" on public.jobs for delete to authenticated using (
  exists (select 1 from public.employers e where e.id = jobs.employer_id and e.owner_id = auth.uid())
  or public.is_admin()
);

-- APPLICATIONS
create policy "seeker applies"        on public.applications for insert to authenticated with check (seeker_id = auth.uid());
create policy "seeker sees own apps"  on public.applications for select to authenticated using (seeker_id = auth.uid());
create policy "seeker withdraws"      on public.applications for delete to authenticated using (seeker_id = auth.uid());
create policy "employer sees apps"    on public.applications for select to authenticated using (public.owns_job(job_id) or public.is_admin());
create policy "employer sets status"  on public.applications for update to authenticated using (public.owns_job(job_id) or public.is_admin())
                                                                   with check (public.owns_job(job_id) or public.is_admin());

-- REPORTS
create policy "anyone logged in reports" on public.reports for insert to authenticated with check (auth.uid() is not null);
create policy "admin reads reports"      on public.reports for select to authenticated using (public.is_admin());
create policy "admin updates reports"    on public.reports for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- AUDIT LOG
create policy "admin reads audit" on public.audit_log for select to authenticated using (public.is_admin());

-- Column-level privileges (defence in depth on top of triggers)
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

revoke insert, update on public.profiles from anon, authenticated;
grant update (display_name, language, role, suspended) on public.profiles to authenticated;  -- role/suspended guarded by trigger

revoke insert, update, delete on public.applications from anon;
revoke update on public.applications from authenticated;
grant update (status) on public.applications to authenticated;

revoke insert, update, delete on public.jobs, public.employers, public.seeker_profiles, public.reports from anon;
revoke select on public.seeker_profiles, public.reports, public.applications, public.profiles from anon;

-- Anonymous visitors may only read these employer columns (no phone / address / corporate number)
revoke select on public.employers from anon;
grant select (id, company_name, website, description, verified) on public.employers to anon;

-- Public view: what anonymous visitors see of an employer (no phone/address)
create or replace view public.public_employers
with (security_invoker = true) as
  select id, company_name, website, description from public.employers where verified;
grant select on public.public_employers to anon, authenticated;

-- =============================================================
-- STORAGE: private bucket for CVs (PDF only, 5 MB)
-- Path format: <user_id>/<random>.pdf
-- =============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cvs', 'cvs', false, 5242880, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['application/pdf'];

create policy "seeker uploads own cv" on storage.objects for insert to authenticated
  with check (bucket_id = 'cvs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "seeker reads own cv" on storage.objects for select to authenticated
  using (bucket_id = 'cvs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "seeker deletes own cv" on storage.objects for delete to authenticated
  using (bucket_id = 'cvs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "employer reads applicant cv" on storage.objects for select to authenticated
  using (
    bucket_id = 'cvs' and exists (
      select 1 from public.applications a
      where a.cv_path = storage.objects.name and public.owns_job(a.job_id)
    )
  );
