// Supabase Edge Function: daily-collector (the "robot")
// Runs once a day (pg_cron) or when an admin clicks "Run now" in Admin -> Daily robot.
//   1. Imports every active employer feed (careers pages / XML feeds)
//   2. Runs the saved Jooble searches and adds new jobs as external listings
//   3. Closes jobs that expired, that the source stopped showing, or that are too old
//   4. Saves a report in collector_runs
// New jobs then flow through the existing robot: category (004), social posts (share-job),
// email alerts (send-job-alerts) and the Excel export.
//
// Secrets:
//   CRON_SECRET       same one used by send-job-alerts / import-feeds
//   ALLOWED_ORIGINS   your site origin(s), e.g. "https://znexoratech.github.io"
//   JOOBLE_API_KEY    optional; without it the Jooble step is skipped
//   JOOBLE_HOST       optional, default "jp.jooble.org" (use the host your key was issued for)
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { runFeed, Feed } from "../_shared/feeds.ts";
import { joobleToRow, JoobleJob, CollectedRow } from "../_shared/jooble.ts";

const MAX_NEW_PER_RUN = 400;
const MANUAL_COOLDOWN_MIN = 15;

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

type Settings = {
  enabled: boolean; publish_mode: "live" | "review"; jooble_daily_requests: number;
  unseen_days: number; max_age_days: number;
};
type Totals = { added: number; updated: number; closed: number; for_review: number; skipped: number; requests: number };

// ---------------------------------------------------------------- employers for collected jobs
async function employerFor(db: SupabaseClient, cache: Map<string, string>, company: string): Promise<string | null> {
  const key = company.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  const { data: found } = await db.from("employers").select("id")
    .is("owner_id", null).eq("collected", true).eq("company_name", company).limit(1).maybeSingle();
  let id = found?.id as string | undefined;
  if (!id) {
    const { data: made, error } = await db.from("employers")
      .insert({ company_name: company, owner_id: null, verified: true, collected: true }).select("id").single();
    if (error) return null;
    id = made.id;
  }
  cache.set(key, id!);
  return id!;
}

// ---------------------------------------------------------------- Jooble
async function joobleSearch(key: string, host: string, keywords: string, location: string): Promise<JoobleJob[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`https://${host}/api/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords, location, page: "1", ResultOnPage: "50" }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`Jooble answered HTTP ${r.status}${r.status === 403 ? " (check JOOBLE_API_KEY / JOOBLE_HOST)" : ""}`);
    const text = await r.text();
    if (text.length > 3_000_000) throw new Error("response too large");
    const body = JSON.parse(text);
    return Array.isArray(body?.jobs) ? body.jobs.slice(0, 100) : [];
  } finally {
    clearTimeout(timer);
  }
}

async function saveCollected(db: SupabaseClient, rows: CollectedRow[], s: Settings, t: Totals, cache: Map<string, string>, seenRefs: Set<string>) {
  // De-duplicate inside this run (the same job often appears in several searches)
  rows = rows.filter((r) => {
    if (seenRefs.has(r.source_ref) || seenRefs.has(r.source_url)) { t.skipped++; return false; }
    seenRefs.add(r.source_ref); seenRefs.add(r.source_url);
    return true;
  });
  if (!rows.length) return;

  const now = new Date().toISOString();
  // Already known? (by Jooble id, or by the same original link from any route)
  // Look-ups in small chunks so the request URL stays short
  const byRef: { id: string; source_ref: string; status: string; title: string; description: string; wage_min: number | null; wage_max: number | null }[] = [];
  const byUrl: { id: string; source_url: string; collector_source: string | null }[] = [];
  for (let i = 0; i < rows.length; i += 20) {
    const part = rows.slice(i, i + 20);
    const { data: a } = await db.from("jobs").select("id, source_ref, status, title, description, wage_min, wage_max")
      .eq("collector_source", "jooble").in("source_ref", part.map((r) => r.source_ref));
    const { data: b } = await db.from("jobs").select("id, source_url, collector_source")
      .in("source_url", part.map((r) => r.source_url));
    byRef.push(...(a ?? [])); byUrl.push(...(b ?? []));
  }
  const refMap = new Map(byRef.map((j) => [j.source_ref, j]));
  const urlMap = new Map(byUrl.map((j) => [j.source_url, j]));

  const seenIds: string[] = [];
  for (const r of rows) {
    const old = refMap.get(r.source_ref);
    if (old) {
      if (old.status === "live" || old.status === "pending") {
        seenIds.push(old.id);
        const changed = old.title !== r.title || old.description !== r.description || old.wage_min !== r.wage_min || old.wage_max !== r.wage_max;
        if (changed) {
          const { error } = await db.from("jobs").update({
            title: r.title, description: r.description, city: r.city, job_type: r.job_type,
            wage_type: r.wage_type, wage_min: r.wage_min, wage_max: r.wage_max, last_seen_at: now,
          }).eq("id", old.id);
          if (!error) t.updated++;
        }
      } else {
        t.skipped++; // closed or rejected: leave it alone
      }
      continue;
    }
    const sameLink = urlMap.get(r.source_url);
    if (sameLink) { if (sameLink.collector_source === "jooble") seenIds.push(sameLink.id); t.skipped++; continue; }

    if (t.added >= MAX_NEW_PER_RUN) { t.skipped++; continue; }
    const employer_id = await employerFor(db, cache, r.company);
    if (!employer_id) { t.skipped++; continue; }
    const { data: flagged } = await db.rpc("job_needs_review", { title: r.title, description: r.description });
    const status = s.publish_mode === "live" && !flagged ? "live" : "pending";
    const { error } = await db.from("jobs").insert({
      employer_id,
      source_ref: r.source_ref,
      title: r.title,
      description: r.description,
      prefecture: r.prefecture,
      city: r.city,
      job_type: r.job_type,
      wage_type: r.wage_type,
      wage_min: r.wage_min,
      wage_max: r.wage_max,
      eligible_visas: [],
      external: true,
      apply_contact: `Apply on the original listing${r.source_site ? ` (${r.source_site})` : ""} / 元の求人ページから応募`.slice(0, 300),
      source_url: r.source_url,
      collector_source: "jooble",
      last_seen_at: now,
      status,
      expires_at: new Date(Date.now() + s.max_age_days * 864e5).toISOString(),
    });
    if (error) { t.skipped++; continue; }
    t.added++;
    if (status === "pending") t.for_review++;
  }
  // Mark everything we saw again today, so it isn't closed as "no longer listed"
  for (let i = 0; i < seenIds.length; i += 200) {
    await db.from("jobs").update({ last_seen_at: now }).in("id", seenIds.slice(i, i + 200));
  }
}

async function runJooble(db: SupabaseClient, s: Settings, t: Totals, details: Record<string, unknown>) {
  const key = Deno.env.get("JOOBLE_API_KEY");
  if (!key) { details.jooble = "skipped: JOOBLE_API_KEY not set"; return; }
  const host = (Deno.env.get("JOOBLE_HOST") || "jp.jooble.org").replace(/[^a-z0-9.-]/gi, "");
  if (!/(^|\.)jooble\.org$/i.test(host)) { details.jooble = "error: JOOBLE_HOST must be a jooble.org host"; return; }

  const { data: searches } = await db.from("collector_searches").select("id, keywords, location")
    .eq("source", "jooble").eq("active", true)
    .order("last_run_at", { ascending: true, nullsFirst: true }).limit(Math.max(0, s.jooble_daily_requests));
  if (!searches?.length) { details.jooble = "skipped: no active searches"; return; }

  const { data: granted } = await db.rpc("reserve_jooble_requests", { wanted: searches.length });
  const allowed = Number(granted) || 0;
  if (!allowed) { details.jooble = "stopped: Jooble request allowance used up (see Admin -> Daily robot)"; return; }

  const per: Record<string, string> = {};
  const cache = new Map<string, string>();
  const seen = new Set<string>();
  for (const q of searches.slice(0, allowed)) {
    const label = `${q.keywords}${q.location ? ` @ ${q.location}` : ""}`;
    let status: string;
    try {
      t.requests++;
      const jobs = await joobleSearch(key, host, q.keywords, q.location);
      const rows = jobs.map((j) => joobleToRow(j, q.location)).filter(Boolean) as CollectedRow[];
      const before = { ...t };
      t.skipped += jobs.length - rows.length;
      await saveCollected(db, rows, s, t, cache, seen);
      status = `ok: ${jobs.length} found, ${t.added - before.added} new, ${t.updated - before.updated} updated`;
    } catch (e) {
      status = `error: ${(e as Error).message}`.slice(0, 200);
    }
    per[label] = status;
    await db.from("collector_searches").update({ last_run_at: new Date().toISOString(), last_status: status }).eq("id", q.id);
  }
  details.jooble = per;
}

// ---------------------------------------------------------------- employer feeds
async function runFeeds(db: SupabaseClient, t: Totals, details: Record<string, unknown>) {
  const { data: feeds } = await db.from("job_feeds").select("id, employer_id, url, format").eq("active", true).limit(500);
  const per: Record<string, string> = {};
  for (const f of (feeds ?? []) as Feed[]) {
    const status = await runFeed(db, f);
    per[f.url] = status;
    const m = status.match(/\((\d+) new, (\d+) updated, (\d+) closed, (\d+) waiting/);
    if (m) { t.added += +m[1]; t.updated += +m[2]; t.closed += +m[3]; t.for_review += +m[4]; }
    await db.from("job_feeds").update({ last_run_at: new Date().toISOString(), last_status: status }).eq("id", f.id);
  }
  details.feeds = Object.keys(per).length ? per : "no employer feeds yet";
}

// ---------------------------------------------------------------- entry point
Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers });

  const url = Deno.env.get("SUPABASE_URL")!;
  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let trigger: "schedule" | "manual" = "schedule";

  const secret = Deno.env.get("CRON_SECRET");
  if (!(secret && req.headers.get("x-cron-secret") === secret)) {
    // Manual run: must be a logged-in admin
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401, headers);
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: isAdmin } = await user.rpc("is_admin");
    if (isAdmin !== true) return json({ error: "admins only" }, 403, headers);
    const { data: last } = await db.from("collector_runs").select("started_at").order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - new Date(last.started_at).getTime() < MANUAL_COOLDOWN_MIN * 60000) {
      return json({ error: `wait ${MANUAL_COOLDOWN_MIN} minutes between runs` }, 429, headers);
    }
    trigger = "manual";
  }

  const { data: s } = await db.from("collector_settings").select("*").eq("id", 1).maybeSingle();
  if (!s) return json({ error: "run migration 006 first" }, 500, headers);
  const { data: run } = await db.from("collector_runs").insert({ trigger }).select("id").single();

  const t: Totals = { added: 0, updated: 0, closed: 0, for_review: 0, skipped: 0, requests: 0 };
  const details: Record<string, unknown> = {};
  let ok = true;

  if (!s.enabled && trigger === "schedule") {
    details.note = "robot is switched off in Admin -> Daily robot";
  } else {
    for (const [name, step] of [
      ["feeds", () => runFeeds(db, t, details)],
      ["jooble", () => runJooble(db, s as Settings, t, details)],
    ] as const) {
      try { await step(); } catch (e) { ok = false; details[name] = `error: ${(e as Error).message}`.slice(0, 300); }
    }
  }
  // Always tidy up old listings, even when collecting is off
  const { data: closed, error: closeErr } = await db.rpc("close_stale_jobs");
  if (closeErr) { ok = false; details.cleanup = `error: ${closeErr.message}`; }
  else { t.closed += Number(closed) || 0; details.cleanup = `${Number(closed) || 0} old jobs closed`; }

  if (JSON.stringify(details).includes('"error:')) ok = false;
  if (run) await db.from("collector_runs").update({ ...t, details, ok, finished_at: new Date().toISOString() }).eq("id", run.id);
  return json({ ok, ...t, details }, 200, headers);
});
