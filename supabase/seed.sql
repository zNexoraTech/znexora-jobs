-- =============================================================
-- DUMMY DATA for STAGING ONLY. Never run on production.
-- Step 1: create test users in the website (sign up) or in
--         Supabase -> Authentication -> Users -> Add user, e.g.
--           admin@test.local, employer1@test.local, employer2@test.local,
--           seeker1@test.local, seeker2@test.local
--         (for employers, add user metadata {"role":"employer"} or sign up
--          through the site choosing "An employer").
-- Step 2: make yourself admin (run in SQL editor, change the email):
-- =============================================================
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'admin@test.local');

-- Step 3 (optional): verify an employer and publish a sample job
-- after employer1 has saved a company profile in the dashboard.
update public.employers set verified = true
where owner_id = (select id from auth.users where email = 'employer1@test.local');

insert into public.jobs (employer_id, title, description, prefecture, city, job_type, wage_type, wage_min, wage_max, hours, japanese_level_required, status)
select e.id, 'Restaurant kitchen staff (TEST)',
       'TEST JOB. Preparing ingredients and washing dishes. Training provided. Myanmar staff on the team.',
       'Tokyo', 'Shinjuku', 'arubaito', 'hourly', 1200, 1400, 'Evenings 17:00-22:00, 3 days a week', 'N4', 'live'
from public.employers e
where e.owner_id = (select id from auth.users where email = 'employer1@test.local');
