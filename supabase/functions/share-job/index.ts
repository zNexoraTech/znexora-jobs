// Supabase Edge Function: share-job
// Posts newly live jobs to your Telegram channel and Facebook Page.
// Called by a Supabase Database Webhook on the "jobs" table (INSERT and UPDATE).
// Each job is shared once (jobs.shared_at). Channels without secrets are skipped.
//
// Secrets:
//   WEBHOOK_SECRET      any long random string; add it as header x-webhook-secret in the webhook
//   SITE_URL            e.g. "https://znexoratech.github.io/znexora-jobs/" (with trailing slash)
//   TELEGRAM_BOT_TOKEN  from @BotFather (add the bot as admin of every channel)
//   TELEGRAM_CHAT_ID    main channel, e.g. "@your_channel" (every job goes here)
//   TELEGRAM_CHANNELS   optional JSON, industry -> channel, e.g. {"restaurant":"@jobs_food","care":"@jobs_care"}
//   FB_PAGE_ID / FB_PAGE_TOKEN  main Facebook Page (every job goes here)
//   FB_PAGES            optional JSON, industry -> {"id":"...","token":"..."} for industry Pages
//   FB_GRAPH_VERSION    optional, default "v21.0"
// A job is posted to the main channel/Page AND to its industry's channel/Page (once each).
import { createClient } from "npm:@supabase/supabase-js@2";

const TYPE: Record<string, string> = { full_time: "Full-time / 正社員", part_time: "Part-time / パート", contract: "Contract / 契約", arubaito: "Arubaito / アルバイト" };
const UNIT: Record<string, string> = { hourly: "hour", monthly: "month", yearly: "year" };
const CAT: Record<string, string> = { restaurant: "Restaurant / 飲食", care: "Care / 介護", factory: "Factory / 工場", construction: "Construction / 建設",
  logistics: "Logistics / 物流", retail: "Retail / 販売", hotel: "Hotel / ホテル", cleaning: "Cleaning / 清掃", agriculture: "Agriculture / 農業",
  it: "IT", office: "Office / 事務", education: "Education / 教育", other: "Other / その他" };

function jsonEnv<T>(name: string): Record<string, T> {
  try { return JSON.parse(Deno.env.get(name) ?? "{}"); } catch { return {}; }
}

function message(job: Record<string, any>, company: string, link: string) {
  const yen = (n: number) => `¥${Number(n).toLocaleString("ja-JP")}`;
  const pay = job.wage_min ? `${yen(job.wage_min)}${job.wage_max ? ` – ${yen(job.wage_max)}` : "~"} / ${UNIT[job.wage_type] ?? ""}` : "";
  return [
    `🆕 ${job.title}`,
    company && `🏢 ${company}`,
    job.category && `🗂 ${CAT[job.category] ?? job.category}  #${job.category}`,
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

  // Telegram: main channel + the job's industry channel
  const tgToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const tgChats = new Set([Deno.env.get("TELEGRAM_CHAT_ID"), jsonEnv<string>("TELEGRAM_CHANNELS")[fresh.category]].filter(Boolean) as string[]);
  if (tgToken) {
    for (const chat of tgChats) {
      const r = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: false }),
      });
      results[`telegram:${chat}`] = r.status;
    }
  }

  // Facebook: main Page + the job's industry Page
  const v = Deno.env.get("FB_GRAPH_VERSION") ?? "v21.0";
  const pages = new Map<string, string>();
  const mainId = Deno.env.get("FB_PAGE_ID"), mainToken = Deno.env.get("FB_PAGE_TOKEN");
  if (mainId && mainToken) pages.set(mainId, mainToken);
  const catPage = jsonEnv<{ id: string; token: string }>("FB_PAGES")[fresh.category];
  if (catPage?.id && catPage?.token) pages.set(catPage.id, catPage.token);
  for (const [pageId, token] of pages) {
    const body = new URLSearchParams({ message: text, link, access_token: token });
    const r = await fetch(`https://graph.facebook.com/${v}/${pageId}/feed`, { method: "POST", body });
    results[`facebook:${pageId}`] = r.status;
  }

  return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
});
