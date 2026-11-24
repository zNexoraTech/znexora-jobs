// Supabase Edge Function: share-job
// Posts newly live jobs to your Telegram channel and Facebook Page.
// Called by a Supabase Database Webhook on the "jobs" table (INSERT and UPDATE).
// Each job is shared once (jobs.shared_at). Channels without secrets are skipped.
//
// Secrets:
//   WEBHOOK_SECRET      any long random string; add it as header x-webhook-secret in the webhook
//   SITE_URL            e.g. "https://znexoratech.github.io/znexora-jobs/" (with trailing slash)
//   TELEGRAM_BOT_TOKEN  from @BotFather (add the bot as admin of your channel)
//   TELEGRAM_CHAT_ID    e.g. "@your_channel" or the numeric chat id
//   FB_PAGE_ID          your Facebook Page id
//   FB_PAGE_TOKEN       long-lived Page access token with pages_manage_posts
//   FB_GRAPH_VERSION    optional, default "v21.0"
import { createClient } from "npm:@supabase/supabase-js@2";

const TYPE: Record<string, string> = { full_time: "Full-time / 正社員", part_time: "Part-time / パート", contract: "Contract / 契約", arubaito: "Arubaito / アルバイト" };
const UNIT: Record<string, string> = { hourly: "hour", monthly: "month", yearly: "year" };

function message(job: Record<string, any>, company: string, link: string) {
  const yen = (n: number) => `¥${Number(n).toLocaleString("ja-JP")}`;
  const pay = job.wage_min ? `${yen(job.wage_min)}${job.wage_max ? ` – ${yen(job.wage_max)}` : "~"} / ${UNIT[job.wage_type] ?? ""}` : "";
  return [
    `🆕 ${job.title}`,
    company && `🏢 ${company}`,
    `📍 ${job.prefecture}${job.city ? `, ${job.city}` : ""}`,
    `💼 ${TYPE[job.job_type] ?? job.job_type}`,
    pay && `💴 ${pay}`,
    job.japanese_level_required && `🗣 Japanese: ${job.japanese_level_required === "none" ? "not required / မလိုအပ်" : job.japanese_level_required}`,
    "",
    `👉 ${link}`,
    "",
    "Free for job seekers. Never pay to get a job. / အလုပ်ရရန် ငွေမပေးပါနှင့်။",
  ].filter((x) => x !== false && x !== null && x !== undefined).join("\n");
}

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== Deno.env.get("WEBHOOK_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const payload = await req.json();
  const job = payload.record;
  if (!job || job.status !== "live" || job.shared_at) return new Response("skip");

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Re-read to confirm it's still live, its employer is verified, and it hasn't been shared meanwhile
  const { data: fresh } = await db.from("jobs").select("*, employers(company_name, verified)").eq("id", job.id).maybeSingle();
  if (!fresh || fresh.status !== "live" || fresh.shared_at || !fresh.employers?.verified) return new Response("skip");

  // Claim it first so two webhook calls can't double-post
  const { data: claimed } = await db.from("jobs").update({ shared_at: new Date().toISOString() })
    .eq("id", job.id).is("shared_at", null).select("id");
  if (!claimed?.length) return new Response("skip");

  const link = `${Deno.env.get("SITE_URL")}job.html?id=${job.id}`;
  const text = message(fresh, fresh.employers?.company_name ?? "", link);
  const results: Record<string, number | string> = {};

  const tgToken = Deno.env.get("TELEGRAM_BOT_TOKEN"), tgChat = Deno.env.get("TELEGRAM_CHAT_ID");
  if (tgToken && tgChat) {
    const r = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: tgChat, text, disable_web_page_preview: false }),
    });
    results.telegram = r.status;
  }

  const fbPage = Deno.env.get("FB_PAGE_ID"), fbToken = Deno.env.get("FB_PAGE_TOKEN");
  if (fbPage && fbToken) {
    const v = Deno.env.get("FB_GRAPH_VERSION") ?? "v21.0";
    const body = new URLSearchParams({ message: text, link, access_token: fbToken });
    const r = await fetch(`https://graph.facebook.com/${v}/${fbPage}/feed`, { method: "POST", body });
    results.facebook = r.status;
  }

  return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
});
