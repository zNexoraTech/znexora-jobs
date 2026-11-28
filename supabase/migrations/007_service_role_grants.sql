-- =============================================================
-- 007: give the server functions (service role) access to the tables.
-- New Supabase projects don't grant this automatically, so the
-- daily robot, alerts, sharing and imports can't read or write.
-- Safe to run more than once. Run AFTER 006.
-- =============================================================
grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Tables created later get the same access automatically
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

-- The robot's own helper functions
grant execute on function public.close_stale_jobs() to service_role;
grant execute on function public.reserve_jooble_requests(int) to service_role;

-- Storage (CV files) for account deletion
grant usage on schema storage to service_role;
grant all on all tables in schema storage to service_role;
