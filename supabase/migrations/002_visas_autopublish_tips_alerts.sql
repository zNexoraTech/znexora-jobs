-- =============================================================
-- 002: visa requirements, instant publishing for trusted employers,
--      job tips from social media, admin imports, job alerts, auto-share
-- Run AFTER 001_schema.sql (SQL Editor -> New query -> paste -> Run)
-- =============================================================

-- -------------------------------------------------------------
-- 1. VISA REQUIREMENTS ON JOBS
-- -------------------------------------------------------------
-- Codes (labels and explanations live in the website's i18n files):
--   unrestricted   永住者 / 日本人の配偶者等 / 永住者の配偶者等 / 定住者
--   student        留学 (with 資格外活動許可, generally 28 h/week)
--   dependent      家族滞在 (with 資格外活動許可, generally 28 h/week)
--   designated     特定活動 (incl. Myanmar emergency measure) — depends on designation
--   engineer       技術・人文知識・国際業務
--   ssw1 / ssw2    特定技能 1号 / 2号 (field must match ssw_field)
--   skilled        技能 (e.g. foreign cuisine cook)
--   nursing        介護
--   highly_skilled 高度専門職
create or replace function public.valid_visa_codes(codes text[])
returns boolean language sql immutable as $$
  select coalesce(codes <@ array['unrestricted','student','dependent','designated','engineer',
                                 'ssw1','ssw2','skilled','nursing','highly_skilled']::text[], true);
$$;

alter table public.jobs
  add column eligible_visas text[] not null default '{}' check (public.valid_visa_codes(eligible_visas)),
  add column ssw_field text check (ssw_field in (
    'nursing_care','building_cleaning','manufacturing','construction','shipbuilding','auto_repair',
    'aviation','accommodation','auto_transport','railway','agriculture','fishery',
    'food_manufacturing','food_service','forestry','wood_industry')),
  -- Jobs imported by the admin from social media: applicants contact the employer directly
  add column external      boolean not null default false,
  add column apply_contact text check (char_length(apply_contact) <= 300),
  add column source_url    text check (char_length(source_url) <= 500),
  -- Set by the share-job function after posting to Facebook / Telegram
  add column shared_at     timestamptz;

create index jobs_visas_idx on public.jobs using gin (eligible_visas);

-- -------------------------------------------------------------
-- 2. INSTANT PUBLISHING FOR TRUSTED EMPLOYERS
-- -------------------------------------------------------------
-- auto_publish turns on automatically the first time an admin approves one
-- of the employer's jobs (and the employer is verified). Admin can switch it off.
alter table public.employers
  add column auto_publish boolean not null default false,
  alter column owner_id drop not null;   -- admin-managed listings (imports) have no owner

-- Scam phrases that always force manual review (English / Japanese / Burmese)
create or replace function public.job_needs_review(title text, description text, contact text default null)
returns boolean language sql immutable as $$
  select concat_ws(' ', title, description, contact) ~* (
    'deposit|registration fee|training fee|visa fee|pay (us|first)|cash only|no visa|without visa|'
    || 'western union|crypto|bitcoin|telegram only|保証金|登録料|手数料|研修費|ビザ不要|在留資格不問|'
    || '現金払いのみ|日払い現金|ကြိုတင်ငွေ|အာမခံငွေ|ဗီဇာမလို|ပွဲခ'
  );
$$;

create or replace function public.enforce_job_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  trusted boolean;
  flagged boolean;
begin
  new.updated_at := now();
  if new.eligible_visas is not null then
    new.eligible_visas := array(select distinct unnest(new.eligible_visas));
  end if;

  if public.is_trusted() then
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      insert into public.audit_log (actor_id, action, target, detail)
      values (auth.uid(), 'job_status', new.id::text,
              jsonb_build_object('from', old.status, 'to', new.status, 'reason', new.reject_reason));
      -- First approval by an admin makes a verified employer trusted
      if new.status = 'live' and public.is_admin() then
        update public.employers set auto_publish = true
        where id = new.employer_id and verified and not auto_publish;
      end if;
    end if;
    return new;
  end if;

  -- Only admins can create external (imported) jobs
  if tg_op = 'INSERT' then
    new.external := false; new.source_url := null; new.shared_at := null;
  else
    new.external := old.external; new.source_url := old.source_url; new.shared_at := old.shared_at;
  end if;

  select e.verified and e.auto_publish into trusted from public.employers e where e.id = new.employer_id;
  flagged := public.job_needs_review(new.title, new.description, new.apply_contact);

  if tg_op = 'INSERT' then
    if new.status not in ('draft','pending') then new.status := 'pending'; end if;
    -- Trusted employers' jobs go live instantly unless a scam phrase is found
    if new.status = 'pending' and coalesce(trusted, false) and not flagged then
      new.status := 'live';
    end if;
    new.reject_reason := null;
    new.expires_at := now() + interval '60 days';
    return new;
  end if;

  -- UPDATE by owner
  if new.employer_id is distinct from old.employer_id then
    raise exception 'employer_id cannot be changed';
  end if;
  if new.status = 'rejected' and old.status is distinct from 'rejected' then
    raise exception 'only an admin can reject a job';
  end if;
  if new.status in ('live','pending') then
    if old.status = 'rejected' then
      new.status := 'pending';                          -- resubmitted after rejection: always reviewed
    elsif coalesce(trusted, false) and not flagged then
      new.status := 'live';                             -- trusted employer, clean text: instant
    elsif old.status = 'live' and new.status = 'live' and (
        new.title, new.description, new.prefecture, new.city, new.job_type, new.wage_type, new.wage_min,
        new.wage_max, new.hours, new.japanese_level_required, new.eligible_visas, new.ssw_field, new.apply_contact
      ) is not distinct from (
        old.title, old.description, old.prefecture, old.city, old.job_type, old.wage_type, old.wage_min,
        old.wage_max, old.hours, old.japanese_level_required, old.eligible_visas, old.ssw_field, old.apply_contact
      ) then
      new.status := 'live';                             -- untouched live job stays live
    else
      new.status := 'pending';                          -- everything else goes to review
    end if;
  end if;
  new.reject_reason := old.reject_reason;
  new.expires_at := old.expires_at;
  return new;
end;
$$;

-- Employers can't switch on auto_publish themselves
create or replace function public.enforce_employer_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_trusted() then
    if tg_op = 'INSERT' then
      new.verified := false;
      new.auto_publish := false;
      new.owner_id := auth.uid();
    else
      new.verified := old.verified;
      new.auto_publish := old.auto_publish;
      new.owner_id := old.owner_id;
    end if;
  elsif tg_op = 'UPDATE' and (new.verified is distinct from old.verified or new.auto_publish is distinct from old.auto_publish) then
    insert into public.audit_log (actor_id, action, target, detail)
    values (auth.uid(), 'employer_trust', new.id::text,
            jsonb_build_object('verified', new.verified, 'auto_publish', new.auto_publish));
  end if;
  return new;
end;
$$;

-- Admin creates listings without an owner, and imported jobs under them
create policy "admin creates employers" on public.employers for insert to authenticated
  with check (public.is_admin());
create policy "admin creates jobs" on public.jobs for insert to authenticated
  with check (public.is_admin());

-- -------------------------------------------------------------
-- 3. JOB TIPS: jobs people saw on Facebook / Telegram / LINE
-- -------------------------------------------------------------
create table public.job_tips (
  id            uuid primary key default gen_random_uuid(),
  submitter_id  uuid default auth.uid() references public.profiles(id) on delete set null,
  platform      text not null check (platform in ('facebook','telegram','line','tiktok','viber','website','other')),
  source_url    text check (char_length(source_url) <= 500),
  company_name  text check (char_length(company_name) <= 120),
  prefecture    text,
  details       text not null check (char_length(details) between 10 and 5000),
  contact       text check (char_length(contact) <= 300),
  status        text not null default 'new' check (status in ('new','imported','rejected')),
  created_at    timestamptz not null default now()
);
alter table public.job_tips enable row level security;

create or replace function public.enforce_tip_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_trusted() then
    new.submitter_id := auth.uid();
    new.status := 'new';
  end if;
  return new;
end;
$$;
create trigger job_tips_rules before insert on public.job_tips
  for each row execute function public.enforce_tip_rules();

create policy "logged in users send tips" on public.job_tips for insert to authenticated
  with check (auth.uid() is not null and public.my_role() is not null);
create policy "own tips read"   on public.job_tips for select to authenticated using (submitter_id = auth.uid() or public.is_admin());
create policy "admin updates tips" on public.job_tips for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin deletes tips" on public.job_tips for delete to authenticated using (public.is_admin());
revoke all on public.job_tips from anon;

-- -------------------------------------------------------------
-- 4. JOB ALERTS (saved searches, emailed by the send-job-alerts function)
-- -------------------------------------------------------------
create table public.job_alerts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  keyword       text check (char_length(keyword) <= 60),
  prefecture    text,
  job_type      text check (job_type in ('full_time','part_time','contract','arubaito')),
  jp_max        text check (jp_max in ('none','N5','N4','N3','N2','N1')),
  visa          text check (visa is null or public.valid_visa_codes(array[visa])),
  active        boolean not null default true,
  last_sent_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
alter table public.job_alerts enable row level security;
create index job_alerts_active_idx on public.job_alerts (active, last_sent_at);

create or replace function public.enforce_alert_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_trusted() then
    if tg_op = 'INSERT' then
      new.user_id := auth.uid();
      new.last_sent_at := now();
      if (select count(*) from public.job_alerts where user_id = auth.uid()) >= 5 then
        raise exception 'maximum 5 job alerts';
      end if;
    else
      new.user_id := old.user_id;
      new.last_sent_at := old.last_sent_at;
    end if;
  end if;
  return new;
end;
$$;
create trigger job_alerts_rules before insert or update on public.job_alerts
  for each row execute function public.enforce_alert_rules();

create policy "own alerts" on public.job_alerts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.job_alerts from anon;

-- -------------------------------------------------------------
-- 5. Applications: imported (external) jobs are applied to directly, not here
-- -------------------------------------------------------------
create or replace function public.enforce_application_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.seeker_id := auth.uid();
    new.status := 'sent';
    if public.my_role() is distinct from 'seeker' then
      raise exception 'only job seekers can apply';
    end if;
    if not exists (select 1 from public.jobs where id = new.job_id and status = 'live'
                   and expires_at > now() and not external) then
      raise exception 'this job is not open';
    end if;
    if new.cv_path is not null and split_part(new.cv_path, '/', 1) <> auth.uid()::text then
      raise exception 'invalid CV path';
    end if;
  else
    new.job_id := old.job_id;
    new.seeker_id := old.seeker_id;
    new.message := old.message;
    new.cv_path := old.cv_path;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
