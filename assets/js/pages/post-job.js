import { p } from "../paths.js";
import { initPage, $, showMsg, requireRole, qs, isUuid, fillPrefectureSelect, fillOptions, fillCategorySelect, visaCheckboxes, JOB_TYPES, JP_LEVELS, WAGE_TYPES, SSW_FIELDS } from "../ui.js";
import { sb } from "../supabase.js";
import { t } from "../i18n.js";

const profile = await initPage();
if (!requireRole(profile, ["employer"])) throw new Error("auth");

fillPrefectureSelect($("#prefecture"));
fillCategorySelect($("#category"));
fillOptions($("#job_type"), JOB_TYPES, "jobtype");
fillOptions($("#japanese"), JP_LEVELS, "jp");
fillOptions($("#wage_type"), WAGE_TYPES, "wage");
fillOptions($("#ssw_field"), SSW_FIELDS, "ssw");
$("#prefecture").value = "Tokyo";
let readVisas = visaCheckboxes($("#visas"));
const toggleSsw = () => $("#ssw-row").classList.toggle("hidden", !readVisas().some((v) => v === "ssw1" || v === "ssw2"));
$("#visas").addEventListener("change", toggleSsw);

const { data: company } = await sb.from("employers").select("id, verified, auto_publish").eq("owner_id", profile.id).maybeSingle();
if (!company) { showMsg("#msg", t("dash.create_company_first"), "err"); $("#job-form").classList.add("hidden"); throw new Error("no company"); }
if (company.verified && company.auto_publish) $("#review-note").textContent = t("post.instant_note");

const editId = qs("id");
if (editId) {
  if (!isUuid(editId)) throw new Error("bad id");
  const { data: job } = await sb.from("jobs").select("*").eq("id", editId).maybeSingle();
  if (!job) { showMsg("#msg", t("job.not_found"), "err"); throw new Error("not found"); }
  $("#heading").textContent = t("post.title_edit");
  for (const k of ["title", "description", "prefecture", "city", "job_type", "wage_type", "wage_min", "wage_max", "hours", "category"]) $(`#${k}`).value = job[k] ?? "";
  $("#japanese").value = job.japanese_level_required || "none";
  $("#visas").replaceChildren();
  readVisas = visaCheckboxes($("#visas"), job.eligible_visas || []);
  if (job.ssw_field) $("#ssw_field").value = job.ssw_field;
  toggleSsw();
}

async function save(status) {
  const num = (v) => (v === "" ? null : Math.max(0, parseInt(v, 10)));
  const row = {
    employer_id: company.id,
    title: $("#title").value.trim(),
    description: $("#description").value.trim(),
    prefecture: $("#prefecture").value,
    city: $("#city").value.trim() || null,
    job_type: $("#job_type").value,
    japanese_level_required: $("#japanese").value,
    wage_type: $("#wage_type").value,
    wage_min: num($("#wage_min").value),
    wage_max: num($("#wage_max").value),
    hours: $("#hours").value.trim() || null,
    category: $("#category").value || null,
    eligible_visas: readVisas(),
    ssw_field: readVisas().some((v) => v === "ssw1" || v === "ssw2") ? $("#ssw_field").value : null,
    status,
  };
  if (status !== "draft" && !row.eligible_visas.length) { showMsg("#msg", t("post.visas_required"), "err"); $("#visas").scrollIntoView({ block: "center" }); return; }
  if (row.wage_min !== null && row.wage_max !== null && row.wage_max < row.wage_min) { showMsg("#msg", t("post.wage_error"), "err"); return; }
  const res = editId
    ? await sb.from("jobs").update(row).eq("id", editId).select("status").single()
    : await sb.from("jobs").insert(row).select("status").single();
  if (res.error) { showMsg("#msg", t("common.error"), "err"); return; }
  const saved = res.data?.status;
  showMsg("#msg", saved === "draft" ? t("dash.saved") : saved === "live" ? t("post.published") : t("post.submitted"), "ok");
  setTimeout(() => { location.href = p("dashboard.html"); }, 1200);
}

$("#job-form").addEventListener("submit", (e) => { e.preventDefault(); save("pending"); });
$("#draft").addEventListener("click", () => {
  if (!$("#title").reportValidity() || !$("#description").reportValidity()) return;
  save("draft");
});
