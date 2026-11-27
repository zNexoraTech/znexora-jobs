// Supabase Edge Function: import-feeds
// Imports jobs from employers' careers pages (schema.org JobPosting) or XML feeds.
//  * Daily for all active feeds: called by pg_cron with header x-cron-secret
//  * On demand for one feed: called from the website by the feed's owner (their login token)
// New/changed jobs follow the same rules as the website: trusted employers' clean jobs go
// live, everything else waits for admin review. Jobs that disappear from a feed are closed.
//
// Secrets: CRON_SECRET (shared with send-job-alerts), ALLOWED_ORIGINS (comma-separated site origins)
import { createClient } from "npm:@supabase/supabase-js@2";
import { runFeed, Feed } from "../_shared/feeds.ts";

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

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let feeds: Feed[] = [];

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
