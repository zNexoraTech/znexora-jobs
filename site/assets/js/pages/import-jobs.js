import { initPage, $, el, showMsg, requireRole, formatDate, prefectureName, formatWage,
  PREFECTURES, JOB_TYPES, JP_LEVELS, WAGE_TYPES, VISAS, SSW_FIELDS } from "../ui.js";
import { sb } from "../supabase.js";
import { t } from "../i18n.js";
import { CONFIG } from "../config.js";

const MAX_ROWS = 200;
const profile = await initPage();
if (!requireRole(profile, ["employer"])) throw new Error("auth");

const { data: company } = await sb.from("employers").select("id, verified, auto_publish").eq("owner_id", profile.id).maybeSingle();
if (!company) {
  showMsg("#msg", t("dash.create_company_first"), "err");
  document.querySelectorAll("section.card").forEach((s) => s.classList.add("hidden"));
  throw new Error("no company");
}

// ---------- Column help ----------
const COLS = [
  ["ref", t("imp.col_ref")], ["title", t("imp.col_title")], ["description", t("imp.col_description")],
  ["prefecture", t("imp.col_prefecture")], ["city", t("imp.col_city")],
  ["job_type", `${JOB_TYPES.join(", ")} (${t("imp.or_japanese")}: 正社員, パート, 契約, アルバイト)`],
  ["wage_type", WAGE_TYPES.join(", ")], ["wage_min", t("imp.col_wage")], ["wage_max", t("imp.col_wage")],
  ["hours", t("imp.col_hours")], ["japanese_level", JP_LEVELS.join(", ")],
  ["visas", `${t("imp.col_visas")}: ${VISAS.join("; ")}`], ["ssw_field", `${t("imp.col_ssw")}: ${SSW_FIELDS.join(", ")}`],
];
$("#columns-help").replaceChildren(el("table", {}, el("tbody", {}, ...COLS.map(([c, d]) => el("tr", {}, el("td", {}, el("code", {}, c)), el("td", {}, d))))));

// ---------- CSV parsing ----------
/** RFC 4180-style CSV parser (quoted fields, "" escapes, CRLF/LF) */
export function parseCsv(text) {
  const rows = []; let row = []; let field = ""; let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = ""; rows.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/** Excel in Japan often saves CSV as Shift_JIS: fall back if UTF-8 has broken characters */
async function readFileText(file) {
  const buf = await file.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("�")) {
    try { text = new TextDecoder("shift_jis").decode(buf); } catch (_) { /* keep utf-8 */ }
  }
  return text.replace(/^﻿/, "");
}

const JA_PREF = Object.fromEntries(PREFECTURES.map(([en, ja]) => [ja, en]));
function toPrefecture(v) {
  const s = v.trim();
  if (!s) return null;
  const en = PREFECTURES.find(([e]) => e.toLowerCase() === s.toLowerCase());
  if (en) return en[0];
  if (JA_PREF[s]) return JA_PREF[s];
  const ja = PREFECTURES.find(([, j]) => s.startsWith(j.replace(/[都府県]$/, "")));
  return ja ? ja[0] : null;
}
function toJobType(v) {
  const s = v.trim().toLowerCase();
  if (JOB_TYPES.includes(s)) return s;
  if (/正社員|full/.test(s)) return "full_time";
  if (/アルバイト|arubaito|baito/.test(s)) return "arubaito";
  if (/パート|part/.test(s)) return "part_time";
  if (/契約|派遣|contract|temp/.test(s)) return "contract";
  return null;
}
const toInt = (v) => { const n = parseInt(String(v).replace(/[,¥円\s]/g, ""), 10); return Number.isFinite(n) && n >= 0 ? n : null; };

/** Turn one CSV record into a job row, or a list of problems */
function toJob(rec, line) {
  const errors = [];
  const title = (rec.title || "").trim();
  const description = (rec.description || "").trim();
  const prefecture = toPrefecture(rec.prefecture || "");
  const job_type = toJobType(rec.job_type || "");
  const wage_type = (rec.wage_type || "hourly").trim().toLowerCase();
  const wage_min = rec.wage_min ? toInt(rec.wage_min) : null;
  const wage_max = rec.wage_max ? toInt(rec.wage_max) : null;
  const jp = (rec.japanese_level || "none").trim();
  const japanese = jp.toLowerCase() === "none" ? "none" : jp.toUpperCase();
  const visas = (rec.visas || "").split(/[;|\s]+/).map((v) => v.trim()).filter(Boolean);
  const ssw = (rec.ssw_field || "").trim() || null;

  if (title.length < 3 || title.length > 120) errors.push(t("imp.err_title"));
  if (description.length < 20 || description.length > 8000) errors.push(t("imp.err_description"));
  if (!prefecture) errors.push(t("imp.err_prefecture"));
  if (!job_type) errors.push(t("imp.err_job_type"));
  if (!WAGE_TYPES.includes(wage_type)) errors.push(t("imp.err_wage_type"));
  if ((rec.wage_min && wage_min === null) || (rec.wage_max && wage_max === null) || (wage_min !== null && wage_max !== null && wage_max < wage_min)) errors.push(t("imp.err_wage"));
  if (!JP_LEVELS.includes(japanese)) errors.push(t("imp.err_japanese"));
  if (!visas.length || visas.some((v) => !VISAS.includes(v))) errors.push(t("imp.err_visas"));
  if (ssw && !SSW_FIELDS.includes(ssw)) errors.push(t("imp.err_ssw"));

  const ref = (rec.ref || "").trim() || `csv-${title}-${prefecture || ""}`.slice(0, 300);
  return {
    line, errors,
    job: {
      employer_id: company.id, source_ref: ref, title, description, prefecture, city: (rec.city || "").trim().slice(0, 80) || null,
      job_type, wage_type, wage_min, wage_max, hours: (rec.hours || "").trim().slice(0, 200) || null,
      japanese_level_required: japanese, eligible_visas: visas,
      ssw_field: visas.some((v) => v.startsWith("ssw")) ? ssw : null, status: "pending",
    },
  };
}

let parsed = [];
$("#csv").addEventListener("change", async (e) => {
  $("#msg").replaceChildren();
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showMsg("#msg", t("imp.err_file_size"), "err"); return; }
  const rows = parseCsv(await readFileText(file));
  if (rows.length < 2) { showMsg("#msg", t("imp.err_empty"), "err"); return; }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  if (!header.includes("title") || !header.includes("description")) { showMsg("#msg", t("imp.err_header"), "err"); return; }
  const records = rows.slice(1, MAX_ROWS + 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
  parsed = records.map((rec, i) => toJob(rec, i + 2));
  if (rows.length - 1 > MAX_ROWS) showMsg("#msg", t("imp.err_too_many", { n: MAX_ROWS }), "info");
  renderPreview();
});

function renderPreview() {
  const ok = parsed.filter((p) => !p.errors.length);
  $("#preview").replaceChildren(
    el("p", { class: "meta" }, t("imp.preview_summary", { ok: ok.length, bad: parsed.length - ok.length })),
    el("div", { class: "table-scroll" }, el("table", {},
      el("thead", {}, el("tr", {}, el("th", {}, "#"), el("th", {}, t("post.job_title")), el("th", {}, t("filter.prefecture")),
        el("th", {}, t("filter.job_type")), el("th", {}, t("job.wage")), el("th", {}, t("app.status")))),
      el("tbody", {}, ...parsed.map((p) => el("tr", {},
        el("td", {}, String(p.line)),
        el("td", {}, p.job.title || "—"),
        el("td", {}, p.job.prefecture ? prefectureName(p.job.prefecture) : "—"),
        el("td", {}, p.job.job_type ? t(`jobtype.${p.job.job_type}`) : "—"),
        el("td", {}, p.job.wage_type && WAGE_TYPES.includes(p.job.wage_type) ? formatWage(p.job) : "—"),
        el("td", {}, p.errors.length ? el("span", { class: "badge bad" }, p.errors.join(" ")) : el("span", { class: "badge ok" }, "OK")),
      ))),
    )),
  );
  const btn = $("#do-import");
  btn.textContent = t("imp.import_n", { n: ok.length });
  btn.classList.toggle("hidden", !ok.length);
}

$("#do-import").addEventListener("click", async (e) => {
  const btn = e.currentTarget; btn.disabled = true;
  const jobs = parsed.filter((p) => !p.errors.length).map((p) => p.job);
  let done = 0, live = 0, failed = 0;
  for (let i = 0; i < jobs.length; i += 50) {
    const chunk = jobs.slice(i, i + 50);
    const { data, error } = await sb.from("jobs").upsert(chunk, { onConflict: "employer_id,source_ref" }).select("status");
    if (error) failed += chunk.length;
    else { done += data.length; live += data.filter((r) => r.status === "live").length; }
  }
  btn.disabled = false;
  showMsg("#msg", t("imp.done", { n: done, live, review: done - live }) + (failed ? ` ${t("imp.failed", { n: failed })}` : ""), failed ? "err" : "ok");
  if (done) { parsed = []; $("#preview").replaceChildren(); btn.classList.add("hidden"); $("#csv").value = ""; }
});

// ---------- Feeds ----------
if (!company.verified) {
  $("#feed-form").classList.add("hidden");
  showMsg("#feeds-msg", t("imp.feeds_verified_only"), "info");
}

async function loadFeeds() {
  const { data, error } = await sb.from("job_feeds").select("*").eq("employer_id", company.id).order("created_at");
  if (error) { showMsg("#feeds-msg", t("common.error"), "err"); return; }
  if (!data.length) { $("#feeds").replaceChildren(el("p", { class: "meta" }, t("imp.no_feeds"))); return; }
  $("#feeds").replaceChildren(...data.map((f) => el("div", { class: "alert-row" },
    el("div", { class: "u-flex1" },
      el("div", {}, el("code", {}, f.url)),
      el("div", { class: "hint" }, f.last_run_at ? `${formatDate(f.last_run_at)}: ${f.last_status || ""}` : t("imp.not_run_yet")),
    ),
    el("button", { class: "secondary small", onclick: () => runFeed(f.id) }, t("imp.run_now")),
    el("button", { class: "secondary small", onclick: async () => {
      if (!confirm(t("imp.delete_feed_confirm"))) return;
      await sb.from("job_feeds").delete().eq("id", f.id); loadFeeds();
    } }, t("alerts.delete")),
  )));
}

async function runFeed(id) {
  showMsg("#feeds-msg", t("imp.running"), "info");
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/import-feeds`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: CONFIG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ feed_id: id }),
  }).catch(() => null);
  if (!res) { showMsg("#feeds-msg", t("imp.function_missing"), "err"); return; }
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) showMsg("#feeds-msg", t("imp.wait"), "info");
  else if (!res.ok) showMsg("#feeds-msg", t("imp.function_missing"), "err");
  else showMsg("#feeds-msg", body.results?.[id] || t("dash.saved"), String(body.results?.[id] || "").startsWith("ok") ? "ok" : "err");
  loadFeeds();
}

$("#feed-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("#feed-url").value.trim();
  if (!/^https:\/\//i.test(url)) { showMsg("#feeds-msg", t("imp.https_only"), "err"); return; }
  const { error } = await sb.from("job_feeds").insert({ employer_id: company.id, url, format: $("#feed-format").value });
  if (error) {
    const m = /maximum/.test(error.message) ? t("imp.max_feeds") : /duplicate/.test(error.message) ? t("imp.duplicate_feed") : t("common.error");
    showMsg("#feeds-msg", m, "err");
    return;
  }
  $("#feed-form").reset();
  showMsg("#feeds-msg", t("imp.feed_added"), "ok");
  loadFeeds();
});

loadFeeds();
