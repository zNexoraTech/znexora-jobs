-- =============================================================
-- 005: table permissions for the website's roles
-- Newer Supabase projects don't grant the "anon" (visitors) and
-- "authenticated" (logged-in users) roles access to new tables
-- automatically. Without this, login works but the site gets
-- "42501 permission denied". Row Level Security still decides
-- WHICH rows each person can see; these grants only open the door.
-- Safe to run more than once. Run AFTER 001-004.
-- =============================================================

grant usage on schema public to anon, authenticated;

-- Logged-in users: normal table access (RLS policies limit the rows)
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to anon, authenticated;

-- Visitors (not logged in): read live jobs and public employer info only
grant select on public.jobs to anon;
grant select on public.public_employers to anon;
grant select (id, company_name, website, description, verified) on public.employers to anon;

-- Keep the safety limits from 001
revoke insert, update on public.profiles from authenticated;
grant update (display_name, language, role, suspended) on public.profiles to authenticated;
revoke update on public.applications from authenticated;
grant update (status) on public.applications to authenticated;
revoke all on public.audit_log from authenticated;
grant select on public.audit_log to authenticated;
