import { initPage, $, el, fillPrefectureSelect } from "../ui.js";
import { sb } from "../supabase.js";
import { t } from "../i18n.js";
import { jobCard, JOB_CARD_COLUMNS } from "../cards.js";

await initPage();
fillPrefectureSelect($("#pref"), { withAny: true });

const box = $("#latest");
box.replaceChildren(el("p", { class: "meta" }, t("common.loading")));
const { data, error } = await sb.from("jobs").select(JOB_CARD_COLUMNS)
  .eq("status", "live").order("created_at", { ascending: false }).limit(6);
if (error) box.replaceChildren(el("p", { class: "msg err" }, t("common.error")));
else if (!data.length) box.replaceChildren(el("p", { class: "meta" }, t("jobs.none")));
else box.replaceChildren(...data.map(jobCard));
