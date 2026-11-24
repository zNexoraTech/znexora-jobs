import { p } from "../paths.js";
import { initPage, $, showMsg, requireRole, qs, isUuid, fillPrefectureSelect, fillOptions, JOB_TYPES, JP_LEVELS, WAGE_TYPES } from "../ui.js";
import { sb } from "../supabase.js";
import { t } from "../i18n.js";

const profile = await initPage();
if (!requireRole(profile, ["employer"])) throw new Error("auth");

fillPrefectureSelect($("#prefecture"));
fillOptions($("#job_type"), JOB_TYPES, "jobtype");
fillOptions($("#japanese"), JP_LEVELS, "jp");
fillOptions($("#wage_type"), WAGE_TYPES, "wage");
$("#prefecture").value = "Tokyo";

const { data: company } = await sb.from("employers").select("id").eq("owner_id", profile.id).maybeSingle();
if (!company) { showMsg("#msg", t("dash.create_company_first"), "err"); $("#job-form").classList.add("hidden"); throw new Error("no company"); }

const editId = qs("id");
if (editId) {
  if (!isUuid(editId)) throw new Error("bad id");
  const { data: job } = await sb.from("jobs").select("*").eq("id", editId).maybeSingle();
  if (!job) { showMsg("#msg", t("job.not_found"), "err"); throw new Error("not found"); }
  $("#heading").textContent = t("post.title_edit");
  for (const k of ["title", "description", "prefecture", "city", "job_type", "wage_type", "wage_min", "wage_max", "hours"]) $(`#${k}`).value = job[k] ?? "";
  $("#japanese").value = job.japanese_level_required || "none";
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
    status,
  };
  if (row.wage_min !== null && row.wage_max !== null && row.wage_max < row.wage_min) { showMsg("#msg", t("post.wage_error"), "err"); return; }
  const res = editId ? await sb.from("jobs").update(row).eq("id", editId) : await sb.from("jobs").insert(row);
  if (res.error) { showMsg("#msg", t("common.error"), "err"); return; }
  showMsg("#msg", status === "draft" ? t("dash.saved") : t("post.submitted"), "ok");
  setTimeout(() => { location.href = p("dashboard.html"); }, 1200);
}

$("#job-form").addEventListener("submit", (e) => { e.preventDefault(); save("pending"); });
$("#draft").addEventListener("click", () => {
  if (!$("#title").reportValidity() || !$("#description").reportValidity()) return;
  save("draft");
});
