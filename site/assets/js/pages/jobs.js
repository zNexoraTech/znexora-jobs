import { initPage, $, el, qs, cleanSearch, fillPrefectureSelect, fillOptions, JOB_TYPES, JP_LEVELS } from "../ui.js";
import { sb } from "../supabase.js";
import { t } from "../i18n.js";
import { CONFIG } from "../config.js";
import { jobCard, JOB_CARD_COLUMNS } from "../cards.js";

await initPage();
const form = $("#filters");
fillPrefectureSelect($("#pref"), { withAny: true });
fillOptions($("#type"), JOB_TYPES, "jobtype", { withAny: true });
fillOptions($("#jp"), JP_LEVELS, "jp", { withAny: true });

// restore filters from URL
$("#q").value = qs("q") || "";
$("#pref").value = qs("pref") || "";
$("#type").value = qs("type") || "";
$("#jp").value = qs("jp") || "";
let page = Math.max(0, parseInt(qs("page") || "0", 10) || 0);

async function load() {
  const results = $("#results");
  results.replaceChildren(el("p", { class: "meta" }, t("common.loading")));
  const per = CONFIG.JOBS_PER_PAGE;
  let query = sb.from("jobs").select(JOB_CARD_COLUMNS, { count: "exact" })
    .eq("status", "live").order("created_at", { ascending: false })
    .range(page * per, page * per + per - 1);

  const q = cleanSearch($("#q").value);
  if (q) query = query.or(`title.ilike.*${q}*,description.ilike.*${q}*`);
  if ($("#pref").value) query = query.eq("prefecture", $("#pref").value);
  if (JOB_TYPES.includes($("#type").value)) query = query.eq("job_type", $("#type").value);
  const jp = $("#jp").value;
  if (JP_LEVELS.includes(jp)) {
    // show jobs that require this level or easier (N5 easiest ... N1 hardest)
    const allowed = JP_LEVELS.slice(0, JP_LEVELS.indexOf(jp) + 1);
    query = query.in("japanese_level_required", allowed);
  }

  const { data, error, count } = await query;
  if (error) { results.replaceChildren(el("p", { class: "msg err" }, t("common.error"))); return; }
  $("#count").textContent = t("jobs.count", { n: count ?? 0 });
  results.replaceChildren(...(data.length ? data.map(jobCard) : [el("p", { class: "meta" }, t("jobs.none"))]));
  $("#prev").disabled = page === 0;
  $("#next").disabled = (page + 1) * per >= (count ?? 0);
}

function pushState() {
  const p = new URLSearchParams();
  for (const k of ["q", "pref", "type", "jp"]) if ($(`#${k}`).value) p.set(k, $(`#${k}`).value);
  if (page) p.set("page", page);
  history.replaceState(null, "", `?${p}`);
}

form.addEventListener("submit", (e) => { e.preventDefault(); page = 0; pushState(); load(); });
$("#prev").addEventListener("click", () => { page = Math.max(0, page - 1); pushState(); load(); });
$("#next").addEventListener("click", () => { page += 1; pushState(); load(); });
load();
