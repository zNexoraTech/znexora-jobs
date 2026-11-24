// Supabase Edge Function: careerjet-search
// "More jobs from other sites": searches Careerjet's partner API for the visitor and returns
// a short list of results that link out to the original listings.
// Secrets: CAREERJET_API_KEY (from your Careerjet publisher account),
//          CAREERJET_LOCALE (optional, default "ja_JP"), ALLOWED_ORIGINS (comma-separated site origins)

const cache = new Map<string, { at: number; body: string }>();
const CACHE_MS = 10 * 60 * 1000;

function cors(req: Request) {
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] ?? "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const safeLink = (u: unknown) => { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
const str = (v: unknown, n: number) => String(v ?? "").replace(/<[^>]+>/g, "").slice(0, n);

Deno.serve(async (req) => {
  const headers = { ...cors(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  const key = Deno.env.get("CAREERJET_API_KEY");
  if (!key) return new Response(JSON.stringify({ jobs: [], disabled: true }), { headers });

  const body = await req.json().catch(() => ({}));
  const params = new URLSearchParams({
    locale_code: Deno.env.get("CAREERJET_LOCALE") ?? "ja_JP",
    keywords: str(body.keywords, 60),
    location: str(body.location, 60),
    page_size: "10",
    sort: "date",
    page: String(Math.min(10, Math.max(1, parseInt(body.page) || 1))),
    user_ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "0.0.0.0",
    user_agent: str(req.headers.get("user-agent"), 300) || "unknown",
  });
  if (body.work_hours === "f" || body.work_hours === "p") params.set("work_hours", body.work_hours);
  if (["p", "c", "t"].includes(body.contract_type)) params.set("contract_type", body.contract_type);

  const cacheKey = [params.get("keywords"), params.get("location"), params.get("work_hours"), params.get("contract_type"), params.get("page")].join("|");
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return new Response(hit.body, { headers });

  const res = await fetch(`https://search.api.careerjet.net/v4/query?${params}`, {
    headers: { Authorization: `Basic ${btoa(`${key}:`)}` },
  });
  if (!res.ok) return new Response(JSON.stringify({ jobs: [], error: res.status }), { status: 502, headers });
  const data = await res.json();
  const jobs = (data.type === "JOBS" ? data.jobs ?? [] : []).map((j: Record<string, unknown>) => ({
    title: str(j.title, 160), company: str(j.company, 120), locations: str(j.locations, 120),
    date: str(j.date, 40), salary: str(j.salary, 80), description: str(j.description, 300), url: safeLink(j.url),
  })).filter((j: { url: string | null }) => j.url);
  const out = JSON.stringify({ jobs, hits: data.hits ?? jobs.length });
  if (cache.size > 500) cache.clear();
  cache.set(cacheKey, { at: Date.now(), body: out });
  return new Response(out, { headers });
});
