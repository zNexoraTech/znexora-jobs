// Jooble REST API connector: turns Jooble search results into ZNexora job rows.
// Jooble returns short snippets and a link to the original listing, so every
// collected job is an "external" listing: seekers read the summary here and
// apply on the original site.
import { findPrefecture, htmlToText, mapJobType, JobRow } from "./jobparse.ts";

export type JoobleJob = {
  id?: string | number;
  title?: string;
  location?: string;
  snippet?: string;
  salary?: string;
  source?: string;
  type?: string;
  link?: string;
  company?: string;
  updated?: string;
};

export type CollectedRow = JobRow & {
  company: string;
  source_url: string;
  source_site: string;
};

/** Parse Japanese / English salary text into yen amounts and a pay period. */
export function parseSalary(text: string | undefined | null): Pick<JobRow, "wage_type" | "wage_min" | "wage_max"> {
  const none = { wage_type: "monthly" as const, wage_min: null, wage_max: null };
  const s = htmlToText(String(text || "")).replace(/，/g, ",").replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  if (!s) return none;
  // Daily / weekly pay can't be stored as hourly/monthly/yearly without guessing: keep the job, drop the number
  if (/日給|日払|週給|per day|daily|per week|weekly/i.test(s)) return none;

  const nums: number[] = [];
  for (const m of s.matchAll(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(万|千|k\b)?/gi)) {
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (m[2] === "万") n *= 10000;
    else if (m[2] === "千" || /k/i.test(m[2] ?? "")) n *= 1000;
    if (n >= 100 && n < 1e8) nums.push(Math.round(n));
    if (nums.length === 2) break;
  }
  if (!nums.length) return none;

  let wage_type: JobRow["wage_type"] | null = null;
  if (/時給|時間|hour|\/h\b|hourly/i.test(s)) wage_type = "hourly";
  else if (/月給|月収|月額|month|monthly|\/月/i.test(s)) wage_type = "monthly";
  else if (/年収|年俸|年給|year|annual|yearly|\/年/i.test(s)) wage_type = "yearly";
  if (!wage_type) {
    const n = nums[0];
    wage_type = n < 10000 ? "hourly" : n < 1_500_000 ? "monthly" : "yearly";
  }
  // Sanity limits per period, so a typo or a phone number doesn't become a wage
  const [lo, hi] = wage_type === "hourly" ? [500, 20000] : wage_type === "monthly" ? [50000, 5_000_000] : [1_000_000, 100_000_000];
  const ok = nums.filter((n) => n >= lo && n <= hi);
  if (!ok.length) return none;
  const wage_min = Math.min(...ok);
  const wage_max = ok.length > 1 ? Math.max(...ok) : null;
  return { wage_type, wage_min, wage_max: wage_max && wage_max > wage_min ? wage_max : null };
}

/** Only http(s) links to a real host; strips anything else */
export function cleanLink(link: string | undefined): string | null {
  try {
    const u = new URL(String(link || ""));
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    const out = u.toString();
    return out.length <= 500 ? out : null;
  } catch {
    return null;
  }
}

export function joobleToRow(j: JoobleJob, defaultLocation = ""): CollectedRow | null {
  const title = htmlToText(j.title || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (title.length < 3) return null;
  const link = cleanLink(j.link);
  if (!link) return null;

  const location = htmlToText(j.location || "").replace(/\s+/g, " ").trim();
  const prefecture = findPrefecture(location, defaultLocation, title);
  if (!prefecture) return null; // every job on the site needs a prefecture; unknown = skip, don't guess

  const company = htmlToText(j.company || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const site = htmlToText(j.source || "").replace(/\s+/g, " ").trim().slice(0, 80);
  const snippet = htmlToText(j.snippet || "").replace(/\s+\n/g, "\n").trim();
  const salaryLine = htmlToText(j.salary || "").trim();

  const lines: string[] = [];
  if (snippet) lines.push(snippet);
  if (salaryLine) lines.push(`Salary / 給与: ${salaryLine}`);
  if (location) lines.push(`Location / 勤務地: ${location}`);
  lines.push(
    "",
    "This is a summary collected automatically. Please read the full details and apply on the original listing (link below).",
    "自動で収集した求人の概要です。詳細の確認と応募は元の求人ページから行ってください。",
  );
  const description = lines.join("\n").trim().slice(0, 8000);

  const ref = j.id != null && String(j.id).trim() ? `jooble:${String(j.id).trim()}` : `jooble:${link}`;

  return {
    source_ref: ref.slice(0, 300),
    title,
    description: description.length >= 20 ? description : `${title}\n\n${description}`,
    prefecture,
    city: location ? location.slice(0, 80) : null,
    job_type: mapJobType(j.type, title, snippet),
    ...parseSalary(salaryLine || snippet),
    company: company || (site ? `Company via ${site}` : "Company not named"),
    source_url: link,
    source_site: site,
  };
}
