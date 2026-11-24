import { initPage, $, el, showMsg, requireRole, qs, isUuid, badge, formatDate, prefectureName } from "../ui.js";
import { sb } from "../supabase.js";
import { t } from "../i18n.js";

const profile = await initPage();
if (!requireRole(profile, ["employer", "admin"])) throw new Error("auth");

const jobId = qs("job");
if (!isUuid(jobId)) { showMsg("#msg", t("job.not_found"), "err"); throw new Error("bad id"); }

const { data: job } = await sb.from("jobs").select("id, title").eq("id", jobId).maybeSingle();
if (!job) { showMsg("#msg", t("job.not_found"), "err"); throw new Error("not found"); }
$("#heading").textContent = `${t("dash.applicants")}: ${job.title}`;

const STATUSES = ["sent", "viewed", "interview", "rejected", "hired"];

const { data, error } = await sb.from("applications")
  .select("id, status, message, cv_path, created_at, seeker_id, profiles(display_name, seeker_profiles(prefecture, japanese_level, skills, job_types, visa_type))")
  .eq("job_id", jobId).order("created_at", { ascending: false });

if (error) { showMsg("#msg", t("common.error"), "err"); throw error; }
if (!data.length) $("#list").replaceChildren(el("p", { class: "meta" }, t("app.none")));

// Mark new applications as viewed
const unseen = data.filter((a) => a.status === "sent").map((a) => a.id);
if (unseen.length) await sb.from("applications").update({ status: "viewed" }).in("id", unseen);

$("#list").replaceChildren(...data.map((a) => {
  const sp = a.profiles?.seeker_profiles;
  const p = Array.isArray(sp) ? sp[0] : sp;
  const status = el("select", { "aria-label": t("app.status"), onchange: async (e) => {
    const { error } = await sb.from("applications").update({ status: e.target.value }).eq("id", a.id);
    if (error) alert(t("common.error"));
  } });
  for (const s of STATUSES) {
    const o = el("option", { value: s }, t(`status.${s}`));
    if (s === (a.status === "sent" ? "viewed" : a.status)) o.selected = true;
    status.append(o);
  }
  return el("div", { class: "card" },
    el("div", { class: "row" }, el("h3", {}, a.profiles?.display_name || t("app.applicant")), el("span", { class: "spacer" }), status),
    el("div", { class: "meta" }, formatDate(a.created_at)),
    p ? el("div", { class: "tags" },
      p.prefecture ? el("span", { class: "tag" }, prefectureName(p.prefecture)) : null,
      p.japanese_level ? el("span", { class: "tag" }, `${t("job.japanese")}: ${t(`jp.${p.japanese_level}`)}`) : null,
      p.visa_type ? el("span", { class: "tag" }, p.visa_type) : null,
      ...(p.job_types || []).map((j) => el("span", { class: "tag" }, t(`jobtype.${j}`))),
    ) : null,
    p?.skills ? el("p", { class: "description" }, p.skills) : null,
    a.message ? el("div", {}, el("strong", {}, t("app.message")), el("p", { class: "description" }, a.message)) : null,
    a.cv_path ? el("button", { class: "secondary small", onclick: async () => {
      const { data: signed, error } = await sb.storage.from("cvs").createSignedUrl(a.cv_path, 60);
      if (error) { alert(t("common.error")); return; }
      window.open(signed.signedUrl, "_blank", "noopener");
    } }, t("app.download")) : null,
  );
}));
