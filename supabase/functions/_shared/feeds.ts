// Shared by import-feeds (on demand) and daily-collector (every day).
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { parseFeed, JobRow } from "./jobparse.ts";
import { safeFetchText } from "./safefetch.ts";

export const MAX_JOBS_PER_FEED = 300;
export type Feed = { id: string; employer_id: string; url: string; format: "auto" | "jsonld" | "xml" };

/** Import one feed. Returns a status line such as "ok: 12 jobs (3 new, ...)" or "error: ...". */
export async function runFeed(db: SupabaseClient, feed: Feed) {
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
