// Parsing job feeds into ZNexora job rows.
// Supports: schema.org JobPosting in JSON-LD (Google for Jobs markup on careers pages)
//           and XML feeds in the common Indeed-style <job> format.

export type JobRow = {
  source_ref: string;
  title: string;
  description: string;
  prefecture: string;
  city: string | null;
  job_type: "full_time" | "part_time" | "contract" | "arubaito";
  wage_type: "hourly" | "monthly" | "yearly";
  wage_min: number | null;
  wage_max: number | null;
};

export const PREFECTURES: [string, string][] = [
  ["Hokkaido","北海道"],["Aomori","青森"],["Iwate","岩手"],["Miyagi","宮城"],["Akita","秋田"],["Yamagata","山形"],
  ["Fukushima","福島"],["Ibaraki","茨城"],["Tochigi","栃木"],["Gunma","群馬"],["Saitama","埼玉"],["Chiba","千葉"],
  ["Tokyo","東京"],["Kanagawa","神奈川"],["Niigata","新潟"],["Toyama","富山"],["Ishikawa","石川"],["Fukui","福井"],
  ["Yamanashi","山梨"],["Nagano","長野"],["Gifu","岐阜"],["Shizuoka","静岡"],["Aichi","愛知"],["Mie","三重"],
  ["Shiga","滋賀"],["Kyoto","京都"],["Osaka","大阪"],["Hyogo","兵庫"],["Nara","奈良"],["Wakayama","和歌山"],
  ["Tottori","鳥取"],["Shimane","島根"],["Okayama","岡山"],["Hiroshima","広島"],["Yamaguchi","山口"],["Tokushima","徳島"],
  ["Kagawa","香川"],["Ehime","愛媛"],["Kochi","高知"],["Fukuoka","福岡"],["Saga","佐賀"],["Nagasaki","長崎"],
  ["Kumamoto","熊本"],["Oita","大分"],["Miyazaki","宮崎"],["Kagoshima","鹿児島"],["Okinawa","沖縄"],
];

/** Find a prefecture (English name) in any text such as "東京都新宿区" or "Shinjuku, Tokyo" */
export function findPrefecture(...texts: (string | null | undefined)[]): string | null {
  const s = texts.filter(Boolean).join(" ");
  if (!s) return null;
  for (const [en, ja] of PREFECTURES) {
    if (s.includes(ja)) return en;
    if (new RegExp(`\\b${en}(-ken|-fu|-to)?\\b`, "i").test(s)) return en;
  }
  if (/\bHyōgo\b|\bHyougo\b/i.test(s)) return "Hyogo";
  if (/\bŌsaka\b/i.test(s)) return "Osaka";
  if (/\bTōkyō\b/i.test(s)) return "Tokyo";
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML -> plain text with line breaks (no markup survives) */
export function htmlToText(html: string): string {
  return decodeEntities(String(html || "")
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, ""))
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export function mapJobType(...values: unknown[]): JobRow["job_type"] {
  const s = values.flat().filter(Boolean).map(String).join(" ").toLowerCase();
  if (/アルバイト|arubaito|baito/.test(s)) return "arubaito";
  if (/part[\s_-]?time|パート|parttime/.test(s)) return "part_time";
  if (/contract|temporary|intern|派遣|契約|temp\b|seasonal/.test(s)) return "contract";
  return "full_time";
}

function unitToWageType(u: unknown): JobRow["wage_type"] | null {
  const s = String(u || "").toUpperCase();
  if (s.startsWith("HOUR") || s === "H") return "hourly";
  if (s.startsWith("MONTH") || s === "M") return "monthly";
  if (s.startsWith("YEAR") || s === "Y") return "yearly";
  return null;
}

const toYen = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[,\s¥円]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 1e9 ? Math.round(n) : null;
};

function clean(row: Partial<JobRow> & { title?: string; description?: string }, fallbackRef: string): JobRow | null {
  const title = htmlToText(row.title || "").slice(0, 120);
  let description = htmlToText(row.description || "").slice(0, 8000);
  if (title.length < 3) return null;
  if (description.length < 20) description = `${title}\n\n${description}`.trim();
  if (description.length < 20) return null;
  let { wage_min = null, wage_max = null } = row;
  if (wage_min && wage_max && wage_max < wage_min) [wage_min, wage_max] = [wage_max, wage_min];
  return {
    source_ref: String(row.source_ref || fallbackRef).slice(0, 300),
    title,
    description,
    prefecture: row.prefecture || "Tokyo",
    city: row.city ? htmlToText(row.city).slice(0, 80) : null,
    job_type: row.job_type || "full_time",
    wage_type: row.wage_type || "hourly",
    wage_min,
    wage_max,
  };
}

// ---------------- JSON-LD (schema.org JobPosting) ----------------
function collectPostings(node: unknown, out: Record<string, unknown>[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach((n) => collectPostings(n, out)); return; }
  const o = node as Record<string, unknown>;
  const type = o["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) out.push(o);
  for (const k of ["@graph", "itemListElement", "item", "mainEntity"]) if (o[k]) collectPostings(o[k], out);
}

export function parseJsonLd(html: string, now = new Date()): JobRow[] {
  const postings: Record<string, unknown>[] = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    try { collectPostings(JSON.parse(m[1].trim()), postings); } catch { /* skip broken block */ }
  }
  const rows: JobRow[] = [];
  postings.forEach((p, i) => {
    if (p.validThrough && new Date(String(p.validThrough)) < now) return; // expired
    const locs = ([] as unknown[]).concat(p.jobLocation ?? []);
    const addr = (locs[0] as any)?.address ?? {};
    const region = typeof addr === "string" ? addr : [addr.addressRegion, addr.addressLocality, addr.streetAddress].join(" ");
    const sal = (p.baseSalary as any) ?? {};
    const val = sal.value ?? {};
    const currency = String(sal.currency ?? val.currency ?? "JPY").toUpperCase();
    const isYen = currency === "JPY";
    const id = typeof p.identifier === "object" ? (p.identifier as any)?.value : p.identifier;
    const row = clean({
      source_ref: String(id || p.url || ""),
      title: String(p.title ?? p.name ?? ""),
      description: String(p.description ?? ""),
      prefecture: findPrefecture(region) ?? undefined,
      city: typeof addr === "object" ? addr.addressLocality ?? null : null,
      job_type: mapJobType(p.employmentType),
      wage_type: unitToWageType(val.unitText ?? sal.unitText) ?? "hourly",
      wage_min: isYen ? toYen(val.minValue ?? val.value) : null,
      wage_max: isYen ? toYen(val.maxValue) : null,
    }, `jsonld-${i}-${String(p.title ?? "").slice(0, 60)}`);
    if (row) rows.push(row);
  });
  return rows;
}

// ---------------- XML feeds (Indeed-style <job> elements) ----------------
function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  if (!m) return "";
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();
}

export function parseXml(xml: string): JobRow[] {
  // Refuse DTDs / entity declarations outright (no XXE-style tricks)
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("XML with DOCTYPE/ENTITY is not accepted");
  const rows: JobRow[] = [];
  const blocks = [...xml.matchAll(/<(job|item)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  blocks.forEach((b, i) => {
    const salaryText = decodeEntities(tag(b, "salary"));
    const nums = salaryText.replace(/,/g, "").match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
    const wageType = /hour|時給|時間/i.test(salaryText) ? "hourly" : /month|月給|月/i.test(salaryText) ? "monthly" : /year|年収|年俸|年/i.test(salaryText) ? "yearly" : "hourly";
    const row = clean({
      source_ref: tag(b, "referencenumber") || tag(b, "id") || tag(b, "guid") || tag(b, "url") || tag(b, "link"),
      title: decodeEntities(tag(b, "title")),
      description: tag(b, "description"),
      prefecture: findPrefecture(decodeEntities(tag(b, "state")), decodeEntities(tag(b, "city")), decodeEntities(tag(b, "location"))) ?? undefined,
      city: decodeEntities(tag(b, "city")) || null,
      job_type: mapJobType(tag(b, "jobtype"), tag(b, "employmenttype")),
      wage_type: wageType,
      wage_min: toYen(nums[0]),
      wage_max: toYen(nums[1]),
    }, `xml-${i}-${tag(b, "title").slice(0, 60)}`);
    if (row) rows.push(row);
  });
  return rows;
}

export function parseFeed(body: string, format: "auto" | "jsonld" | "xml"): JobRow[] {
  if (format === "jsonld") return parseJsonLd(body);
  if (format === "xml") return parseXml(body);
  const head = body.slice(0, 500).trim();
  return head.startsWith("<?xml") || /^<(source|jobs|rss)\b/i.test(head) ? parseXml(body) : parseJsonLd(body);
}
