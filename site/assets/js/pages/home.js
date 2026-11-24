import { BASE } from "../paths.js";
import { initPage, $, el, fillPrefectureSelect } from "../ui.js";
import { sb } from "../supabase.js";
import { t } from "../i18n.js";
import { jobCard, emptyRow, initial, JOB_CARD_COLUMNS } from "../cards.js";

await initPage();
fillPrefectureSelect($("#pref"), { withAny: true });

// Latest jobs + live count (one query)
const box = $("#latest");
box.replaceChildren(emptyRow(t("common.loading")));
const { data, error, count } = await sb.from("jobs").select(JOB_CARD_COLUMNS, { count: "exact" })
  .eq("status", "live").order("created_at", { ascending: false }).limit(6);
if (error) box.replaceChildren(emptyRow(t("common.error")));
else if (!data.length) box.replaceChildren(emptyRow(t("jobs.none")));
else box.replaceChildren(...data.map(jobCard));
if (!error && count) $("#hero-count").textContent = t("home.count", { n: count });

// Companies hiring now (verified employers only; visitors can read just these columns)
const { data: emps } = await sb.from("employers").select("id, company_name").eq("verified", true).order("company_name").limit(12);
if (emps && emps.length) {
  $("#employers").replaceChildren(...emps.map((e) =>
    el("a", { class: "employer-chip", href: `${BASE}jobs.html?emp=${encodeURIComponent(e.id)}` },
      el("span", { class: "avatar", "aria-hidden": "true" }, initial(e.company_name)), e.company_name)));
} else {
  $("#employers-section").classList.add("hidden");
}
