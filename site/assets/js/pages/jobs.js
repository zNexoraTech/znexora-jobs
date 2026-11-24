import { initPage, $, el, qs, isUuid, cleanSearch, showMsg, fillPrefectureSelect, fillOptions, JOB_TYPES, JP_LEVELS, VISAS } from "../ui.js";
import { p as path } from "../paths.js";
import { sb } from "../supabase.js";
import { t } from "../i18n.js";
import { CONFIG } from "../config.js";
import { jobCard, emptyRow, JOB_CARD_COLUMNS } from "../cards.js";

const profile = await initPage();
const form = $("#filters");
fillPrefectureSelect($("#pref"), { withAny: true });
fillOptions($("#type"), JOB_TYPES, "jobtype", { withAny: true });
fillOptions($("#jp"), JP_LEVELS, "jp", { withAny: true });
fillOptions($("#visa"), VISAS, "visa", { withAny: true });

// restore filters from URL
$("#q").value = qs("q") || "";
$("#pref").value = qs("pref") || "";
$("#type").value = qs("type") || "";
$("#jp").value = qs("jp") || "";
$("#visa").value = VISAS.includes(qs("visa")) ? qs("visa") : "";
const emp = isUuid(qs("emp")) ? qs("emp") : null;
let page = Math.max(0, parseInt(qs("page") || "0", 10) || 0);

async function load() {
  const results = $("#results");
  results.replaceChildren(emptyRow(t("common.loading")));
  const per = CONFIG.JOBS_PER_PAGE;
  let query = sb.from("jobs").select(JOB_CARD_COLUMNS, { count: "exact" })
    .eq("status", "live").order("created_at", { ascending: false })
    .range(page * per, page * per + per - 1);

  const q = cleanSearch($("#q").value);
  if (q) query = query.or(`title.ilike.*${q}*,description.ilike.*${q}*`);
  if (emp) query = query.eq("employer_id", emp);
  if ($("#pref").value) query = query.eq("prefecture", $("#pref").value);
  if (JOB_TYPES.includes($("#type").value)) query = query.eq("job_type", $("#type").value);
  if (VISAS.includes($("#visa").value)) query = query.contains("eligible_visas", [$("#visa").value]);
  const jp = $("#jp").value;
  if (JP_LEVELS.includes(jp)) {
    // show jobs that require this level or easier (N5 easiest ... N1 hardest)
    const allowed = JP_LEVELS.slice(0, JP_LEVELS.indexOf(jp) + 1);
    query = query.in("japanese_level_required", allowed);
  }

  const { data, error, count } = await query;
  if (error) { results.replaceChildren(emptyRow(t("common.error"))); return; }
  $("#count").textContent = t("jobs.count", { n: count ?? 0 });
  results.replaceChildren(...(data.length ? data.map(jobCard) : [emptyRow(t("jobs.none"))]));
  $("#prev").disabled = page === 0;
  $("#next").disabled = (page + 1) * per >= (count ?? 0);
}

function pushState() {
  const p = new URLSearchParams();
  for (const k of ["q", "pref", "type", "jp", "visa"]) if ($(`#${k}`).value) p.set(k, $(`#${k}`).value);
  if (emp) p.set("emp", emp);
  if (page) p.set("page", page);
  history.replaceState(null, "", `?${p}`);
}

form.addEventListener("submit", (e) => { e.preventDefault(); page = 0; pushState(); load(); });
$("#prev").addEventListener("click", () => { page = Math.max(0, page - 1); pushState(); load(); });
$("#next").addEventListener("click", () => { page += 1; pushState(); load(); });
load();

// Save the current filters as an email alert
$("#save-alert").addEventListener("click", async () => {
  if (!profile) { location.href = `${path("login.html")}?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
  if (profile.role !== "seeker") { showMsg("#alert-msg", t("alerts.seekers_only"), "info"); return; }
  const row = {
    keyword: cleanSearch($("#q").value) || null,
    prefecture: $("#pref").value || null,
    job_type: JOB_TYPES.includes($("#type").value) ? $("#type").value : null,
    jp_max: JP_LEVELS.includes($("#jp").value) ? $("#jp").value : null,
    visa: VISAS.includes($("#visa").value) ? $("#visa").value : null,
  };
  const { error } = await sb.from("job_alerts").insert(row);
  if (error) showMsg("#alert-msg", /maximum/.test(error.message) ? t("alerts.max") : t("common.error"), "err");
  else showMsg("#alert-msg", t("alerts.saved"), "ok");
});
