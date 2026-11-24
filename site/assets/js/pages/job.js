import { initPage, $, el, qs, isUuid, showMsg, formatWage, formatDate, prefectureName, safeUrl, fillOptions, REPORT_REASONS } from "../ui.js";
import { sb } from "../supabase.js";
import { t } from "../i18n.js";

const profile = await initPage();
const id = qs("id");
if (!isUuid(id)) { showMsg("#msg", t("job.not_found"), "err"); throw new Error("bad id"); }

const { data: job, error } = await sb.from("jobs")
  .select("id, title, description, prefecture, city, job_type, wage_type, wage_min, wage_max, hours, japanese_level_required, status, created_at, employer_id, employers(company_name, website, description)")
  .eq("id", id).maybeSingle();

if (error || !job) { showMsg("#msg", t("job.not_found"), "err"); throw new Error("not found"); }
document.title = `${job.title} | ${document.title.split("|").pop().trim()}`;

const art = $("#job");
const website = safeUrl(job.employers?.website || "");
const fact = (k, v) => v ? [el("dt", {}, k), el("dd", {}, v)] : [];
art.replaceChildren(...[
  el("h1", {}, job.title),
  el("div", { class: "meta" }, job.employers?.company_name || ""),
  job.status !== "live" ? el("p", {}, el("span", { class: `badge ${job.status}` }, t(`status.${job.status}`))) : null,
  el("dl", { class: "facts" },
    ...fact(t("job.location"), [prefectureName(job.prefecture), job.city].filter(Boolean).join(" · ")),
    ...fact(t("filter.job_type"), t(`jobtype.${job.job_type}`)),
    ...fact(t("job.wage"), formatWage(job)),
    ...fact(t("job.hours"), job.hours),
    ...fact(t("job.japanese"), job.japanese_level_required ? t(`jp.${job.japanese_level_required}`) : ""),
    ...fact(t("job.posted"), formatDate(job.created_at)),
  ),
  el("div", { class: "description" }, job.description),
  job.employers?.description ? el("div", {}, el("h3", {}, t("job.company")), el("p", { class: "description" }, job.employers.description)) : null,
  website ? el("p", {}, el("a", { href: website, rel: "noopener noreferrer nofollow", target: "_blank" }, website)) : null,
].filter(Boolean));
art.classList.remove("hidden");

// ---------- Apply ----------
const applyBox = $("#apply");
if (job.status === "live") {
  applyBox.classList.remove("hidden");
  if (!profile) {
    $("#apply-form").replaceChildren(el("a", { class: "btn", href: `/login.html?next=${encodeURIComponent(location.pathname + location.search)}` }, t("job.login_to_apply")));
  } else if (profile.role !== "seeker") {
    $("#apply-form").replaceChildren(el("p", { class: "meta" }, t("job.employers_cannot_apply")));
  } else {
    const { data: existing } = await sb.from("applications").select("id, status").eq("job_id", id).eq("seeker_id", profile.id).maybeSingle();
    if (existing) {
      $("#apply-form").replaceChildren(el("p", {}, t("job.already_applied"), " ", el("span", { class: `badge ${existing.status}` }, t(`status.${existing.status}`))));
    } else {
      $("#apply-form").addEventListener("submit", onApply);
    }
  }
}

async function onApply(e) {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true;
  let cvPath = null;
  try {
    const file = $("#cv").files[0];
    if (file) {
      if (file.type !== "application/pdf") throw new Error(t("job.cv_pdf_only"));
      if (file.size > 5 * 1024 * 1024) throw new Error(t("job.cv_too_big"));
      cvPath = `${profile.id}/${crypto.randomUUID()}.pdf`;
      const up = await sb.storage.from("cvs").upload(cvPath, file, { contentType: "application/pdf", upsert: false });
      if (up.error) throw new Error(t("common.error"));
    }
    const { error } = await sb.from("applications").insert({ job_id: id, message: $("#message").value.trim() || null, cv_path: cvPath });
    if (error) {
      if (cvPath) await sb.storage.from("cvs").remove([cvPath]);
      throw new Error(error.code === "23505" ? t("job.already_applied") : t("common.error"));
    }
    $("#apply-form").replaceChildren();
    showMsg("#apply-msg", t("job.applied_ok"), "ok");
  } catch (err) {
    showMsg("#apply-msg", err.message, "err");
    btn.disabled = false;
  }
}

// ---------- Report ----------
if (profile) {
  $("#report").classList.remove("hidden");
  fillOptions($("#reason"), REPORT_REASONS, "reason");
  $("#report-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.from("reports").insert({
      job_id: id, employer_id: job.employer_id, reason: $("#reason").value, details: $("#details").value.trim() || null,
    });
    if (error) showMsg("#report-msg", t("common.error"), "err");
    else { $("#report-form").replaceChildren(); showMsg("#report-msg", t("job.report_ok"), "ok"); }
  });
}
