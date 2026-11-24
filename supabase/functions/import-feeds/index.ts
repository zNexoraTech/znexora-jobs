// Supabase Edge Function: import-feeds
// Imports jobs from employers' careers pages (schema.org JobPosting) or XML feeds.
//  * Daily for all active feeds: called by pg_cron with header x-cron-secret
//  * On demand for one feed: called from the website by the feed's owner (their login token)
// New/changed jobs follow the same rules as the website: trusted employers' clean jobs go
// live, everything else waits for admin review. Jobs that disappear from a feed are closed.
//
// Secrets: CRON_SECRET (shared with send-job-alerts), ALLOWED_ORIGINS (comma-separated site origins)
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { parseFeed, JobRow } from "../_shared/jobparse.ts";
import { safeFetchText } from "../_shared/safefetch.ts";

const MAX_JOBS_PER_FEED = 300;

function cors(req: Request) {
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] ?? "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

async function runFeed(db: SupabaseClient, feed: { id: string; employer_id: string; url: string; format: "auto" | "jsonld" | "xml" }) {
  const { data: emp } = await db.from("employers").select("verified, auto_publish").eq("id", feed.employer_id).maybeSingle();
  if (!emp?.verified) return "skipped: employer not verified";

  let rows: JobRow[];
  try {
    rows = parseFeed(await safeFetchText(feed.url), feed.format).slice(0, MAX_JOBS_PER_FEED);
  } catch (e) {
    return `error: ${(e as Error).message}`.slice(0, 200);
  }
  if (!rows.length) return "error: no jobs found (check the URL and that it contains JobPosting markup or <job> items)";

  // Same-ref duplicates inside one feed: keep the first
  const seen = new Set<string>();
  rows = rows.filter((r) => (seen.has(r.source_ref) ? false : (seen.add(r.source_ref), true)));

  const { data: existing } = await db.from("jobs")
    .select("id, source_ref, status, title, description, prefecture, city, job_type, wage_type, wage_min, wage_max")
    .eq("employer_id", feed.employer_id).eq("feed_id", feed.id);
  const byRef = new Map((existing ?? []).map((j) => [j.source_ref, j]));

  let created = 0, updated = 0, closed = 0, review = 0;
  for (const r of rows) {
    const { data: flagged } = await db.rpc("job_needs_review", { title: r.title, description: r.description });
    const status = emp.auto_publish && !flagged ? "live" : "pending";
    const old = byRef.get(r.source_ref);
    if (!old) {
      const { error } = await db.from("jobs").insert({ ...r, employer_id: feed.employer_id, feed_id: feed.id, status, eligible_visas: [] });
      if (!error) { created++; if (status === "pending") review++; }
      continue;
    }
    byRef.delete(r.source_ref);
    const changed = (["title", "description", "prefecture", "city", "job_type", "wage_type", "wage_min", "wage_max"] as const)
      .some((k) => (old as any)[k] !== (r as any)[k]);
    // Respect manual decisions: rejected stays rejected; an unchanged job keeps its status
    if (old.status === "rejected" || (!changed && old.status !== "closed")) continue;
    const { error } = await db.from("jobs").update({ ...r, status, expires_at: new Date(Date.now() + 60 * 864e5).toISOString() }).eq("id", old.id);
    if (!error) { updated++; if (status === "pending") review++; }
  }
  // Jobs no longer in the feed are closed
  const gone = [...byRef.values()].filter((j) => j.status === "live" || j.status === "pending").map((j) => j.id);
  if (gone.length) {
    await db.from("jobs").update({ status: "closed" }).in("id", gone);
    closed = gone.length;
  }
  return `ok: ${rows.length} jobs (${created} new, ${updated} updated, ${closed} closed, ${review} waiting for review)`;
}

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let feeds: { id: string; employer_id: string; url: string; format: "auto" | "jsonld" | "xml" }[] = [];

  if (req.headers.get("x-cron-secret") && req.headers.get("x-cron-secret") === Deno.env.get("CRON_SECRET")) {
    const { data } = await admin.from("job_feeds").select("id, employer_id, url, format").eq("active", true).limit(500);
    feeds = data ?? [];
  } else {
    // On-demand run by the feed owner: RLS on job_feeds proves ownership
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401, headers);
    const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const body = await req.json().catch(() => ({}));
    if (typeof body.feed_id !== "string") return json({ error: "feed_id required" }, 400, headers);
    const { data: feed } = await user.from("job_feeds").select("id, employer_id, url, format, last_run_at").eq("id", body.feed_id).maybeSingle();
    if (!feed) return json({ error: "not found" }, 404, headers);
    if (feed.last_run_at && Date.now() - new Date(feed.last_run_at).getTime() < 10 * 60 * 1000) {
      return json({ error: "wait 10 minutes between manual runs" }, 429, headers);
    }
    feeds = [feed];
  }

  const results: Record<string, string> = {};
  for (const f of feeds) {
    const status = await runFeed(admin, f);
    results[f.id] = status;
    await admin.from("job_feeds").update({ last_run_at: new Date().toISOString(), last_status: status }).eq("id", f.id);
  }
  return json({ feeds: feeds.length, results }, 200, headers);
});
