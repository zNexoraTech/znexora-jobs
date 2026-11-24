// Supabase Edge Function: send-job-alerts
// Emails each job seeker the new live jobs matching their saved alerts.
// Run once a day (see docs/SOCIAL-AND-ALERTS.md for the pg_cron schedule).
//
// Secrets (supabase secrets set ...):
//   RESEND_API_KEY     API key from resend.com
//   ALERT_FROM_EMAIL   e.g. "ZNexora Jobs <alerts@your-domain.com>" (domain verified in Resend)
//   SITE_URL           e.g. "https://znexoratech.github.io/znexora-jobs/" (with trailing slash)
//   CRON_SECRET        any long random string; the scheduler sends it as x-cron-secret
import { createClient } from "npm:@supabase/supabase-js@2";

const JP_ORDER = ["none", "N5", "N4", "N3", "N2", "N1"];

const TEXT: Record<string, { subject: string; intro: string; view: string; stop: string }> = {
  en: { subject: "New jobs matching your alert", intro: "New jobs that match your saved search:", view: "View job", stop: "Manage or stop alerts in your dashboard:" },
  my: { subject: "သင့်အတွက် အလုပ်အသစ်များ", intro: "သင် သိမ်းထားသော ရှာဖွေမှုနှင့် ကိုက်ညီသော အလုပ်အသစ်များ:", view: "အလုပ် ကြည့်ရန်", stop: "အသိပေးချက်များကို ကျွန်ုပ်၏စာမျက်နှာတွင် ပြင်ဆင် သို့မဟုတ် ရပ်နိုင်သည်:" },
  ja: { subject: "条件に合う新着求人", intro: "保存した検索条件に合う新着求人です：", view: "求人を見る", stop: "通知の変更・停止はマイページから：" },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const site = Deno.env.get("SITE_URL")!;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: alerts, error } = await db.from("job_alerts").select("*").eq("active", true).limit(5000);
  if (error) return new Response(error.message, { status: 500 });

  // Group alerts by user so each person gets at most one email
  const byUser = new Map<string, typeof alerts>();
  for (const a of alerts ?? []) byUser.set(a.user_id, [...(byUser.get(a.user_id) ?? []), a]);

  let sent = 0;
  for (const [userId, userAlerts] of byUser) {
    const found = new Map<string, { id: string; title: string; prefecture: string }>();
    for (const a of userAlerts!) {
      let q = db.from("jobs").select("id, title, prefecture, employers!inner(verified)")
        .eq("status", "live").eq("employers.verified", true)
        .gt("created_at", a.last_sent_at).gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false }).limit(20);
      if (a.prefecture) q = q.eq("prefecture", a.prefecture);
      if (a.job_type) q = q.eq("job_type", a.job_type);
      if (a.jp_max) q = q.in("japanese_level_required", JP_ORDER.slice(0, JP_ORDER.indexOf(a.jp_max) + 1));
      if (a.visa) q = q.contains("eligible_visas", [a.visa]);
      if (a.keyword) {
        const k = a.keyword.replace(/[,()*%\\:."']/g, " ").trim();
        if (k) q = q.or(`title.ilike.*${k}*,description.ilike.*${k}*`);
      }
      const { data: jobs } = await q;
      for (const j of jobs ?? []) found.set(j.id, j);
    }

    const now = new Date().toISOString();
    await db.from("job_alerts").update({ last_sent_at: now }).in("id", userAlerts!.map((a) => a.id));
    if (!found.size) continue;

    const { data: u } = await db.auth.admin.getUserById(userId);
    const email = u?.user?.email;
    if (!email || !u.user.email_confirmed_at) continue;
    const { data: prof } = await db.from("profiles").select("language, suspended").eq("id", userId).maybeSingle();
    if (prof?.suspended) continue;
    const L = TEXT[prof?.language ?? "en"] ?? TEXT.en;

    const items = [...found.values()].slice(0, 20).map((j) =>
      `<li style="margin:0 0 10px"><strong>${esc(j.title)}</strong> (${esc(j.prefecture)})<br><a href="${site}job.html?id=${j.id}">${L.view}</a></li>`).join("");
    const html = `<p>${L.intro}</p><ul>${items}</ul><p style="color:#666;font-size:13px">${L.stop} <a href="${site}dashboard.html">${site}dashboard.html</a></p>`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: Deno.env.get("ALERT_FROM_EMAIL"), to: [email], subject: `${L.subject} (${found.size})`, html }),
    });
    if (r.ok) sent++;
  }
  return new Response(JSON.stringify({ users: byUser.size, sent }), { headers: { "Content-Type": "application/json" } });
});
