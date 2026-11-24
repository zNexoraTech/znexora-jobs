import { BASE, p } from "../paths.js";
import { initPage, $, el, showMsg, requireRole, fillPrefectureSelect, fillOptions, badge, formatDate, prefectureName, JOB_TYPES, JP_LEVELS } from "../ui.js";
import { sb } from "../supabase.js";
import { t } from "../i18n.js";
import { CONFIG } from "../config.js";

const profile = await initPage();
if (!requireRole(profile)) throw new Error("auth");

$("#account").classList.remove("hidden");
if (profile.role === "seeker") await seeker();
if (profile.role === "employer") await employer();
if (profile.role === "admin") $("#admin").classList.remove("hidden");

// ================= JOB SEEKER =================
async function seeker() {
  $("#seeker").classList.remove("hidden");
  fillPrefectureSelect($("#s-pref"), { withAny: true });
  fillOptions($("#s-jp"), JP_LEVELS, "jp");
  const typesBox = $("#s-types");
  for (const jt of JOB_TYPES) {
    typesBox.append(el("label", { class: "inline" }, el("input", { type: "checkbox", value: jt, name: "s-type" }), t(`jobtype.${jt}`)));
  }

  const { data: sp } = await sb.from("seeker_profiles").select("*").eq("user_id", profile.id).maybeSingle();
  if (sp) {
    $("#s-pref").value = sp.prefecture || "";
    $("#s-jp").value = sp.japanese_level || "none";
    $("#s-skills").value = sp.skills || "";
    $("#s-visa").value = sp.visa_type || "";
    $("#s-visible").checked = sp.visible_to_employers;
    document.querySelectorAll("input[name=s-type]").forEach((c) => { c.checked = (sp.job_types || []).includes(c.value); });
  }

  $("#seeker-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const row = {
      user_id: profile.id,
      prefecture: $("#s-pref").value || null,
      japanese_level: $("#s-jp").value || null,
      skills: $("#s-skills").value.trim() || null,
      visa_type: $("#s-visa").value.trim() || null,
      visible_to_employers: $("#s-visible").checked,
      job_types: [...document.querySelectorAll("input[name=s-type]:checked")].map((c) => c.value),
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from("seeker_profiles").upsert(row);
    showMsg("#profile-msg", error ? t("common.error") : t("dash.saved"), error ? "err" : "ok");
  });

  await loadApplications();
  await loadAlerts();
}

async function loadAlerts() {
  const box = $("#alerts");
  const { data, error } = await sb.from("job_alerts").select("*").order("created_at");
  if (error) { showMsg(box, t("common.error"), "err"); return; }
  if (!data.length) { box.replaceChildren(el("p", { class: "meta" }, t("alerts.none"))); return; }
  box.replaceChildren(...data.map((a) => {
    const parts = [
      a.keyword && `"${a.keyword}"`,
      a.prefecture && prefectureName(a.prefecture),
      a.job_type && t(`jobtype.${a.job_type}`),
      a.jp_max && `${t("job.japanese")}: ${t(`jp.${a.jp_max}`)}`,
      a.visa && t(`visa.${a.visa}`),
    ].filter(Boolean);
    return el("div", { class: "alert-row" },
      el("div", { class: "tags" }, ...(parts.length ? parts : [t("alerts.all_jobs")]).map((x) => el("span", { class: "tag" }, x))),
      el("span", { class: "spacer" }),
      el("span", { class: `badge ${a.active ? "ok" : "closed"}` }, t(a.active ? "alerts.on" : "alerts.off")),
      el("button", { class: "secondary small", onclick: async () => {
        await sb.from("job_alerts").update({ active: !a.active }).eq("id", a.id); loadAlerts();
      } }, t(a.active ? "alerts.pause" : "alerts.resume")),
      el("button", { class: "secondary small", onclick: async () => {
        await sb.from("job_alerts").delete().eq("id", a.id); loadAlerts();
      } }, t("alerts.delete")),
    );
  }));
}

async function loadApplications() {
  const box = $("#apps");
  const { data, error } = await sb.from("applications")
    .select("id, status, created_at, job_id, jobs(title, employers(company_name))")
    .eq("seeker_id", profile.id).order("created_at", { ascending: false });
  if (error) { showMsg(box, t("common.error"), "err"); return; }
  if (!data.length) { box.replaceChildren(el("p", { class: "meta" }, t("dash.no_apps"))); return; }
  box.replaceChildren(el("table", {},
    el("thead", {}, el("tr", {}, el("th", {}, t("post.job_title")), el("th", {}, t("job.company")), el("th", {}, t("app.status")), el("th", {}, t("job.posted")), el("th", {}))),
    el("tbody", {}, ...data.map((a) => el("tr", {},
      el("td", {}, el("a", { href: `${BASE}job.html?id=${encodeURIComponent(a.job_id)}` }, a.jobs?.title || "—")),
      el("td", {}, a.jobs?.employers?.company_name || ""),
      el("td", {}, badge(a.status)),
      el("td", {}, formatDate(a.created_at)),
      el("td", {}, el("button", { class: "secondary small", onclick: async () => {
        if (!confirm(t("dash.withdraw_confirm"))) return;
        await sb.from("applications").delete().eq("id", a.id);
        loadApplications();
      } }, t("dash.withdraw"))),
    ))),
  ));
}

// ================= EMPLOYER =================
async function employer() {
  $("#employer").classList.remove("hidden");
  let { data: company } = await sb.from("employers").select("*").eq("owner_id", profile.id).maybeSingle();

  const fill = (c) => {
    $("#c-name").value = c?.company_name || "";
    $("#c-num").value = c?.corporate_number || "";
    $("#c-addr").value = c?.address || "";
    $("#c-phone").value = c?.phone || "";
    $("#c-web").value = c?.website || "";
    $("#c-desc").value = c?.description || "";
    $("#verified").replaceChildren(...(c ? [
      el("span", { class: `badge ${c.verified ? "ok" : "pending"}` }, t(c.verified ? "dash.verified" : "dash.not_verified")),
      c.verified && c.auto_publish ? el("span", { class: "badge ok" }, t("dash.instant_on")) : null,
    ].filter(Boolean) : []));
    const post = $("#post-btn");
    post.classList.toggle("hidden", !c);
  };
  fill(company);
  if (!company) showMsg("#company-msg", t("dash.create_company_first"), "info");

  $("#company-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const row = {
      company_name: $("#c-name").value.trim(),
      corporate_number: $("#c-num").value.trim() || null,
      address: $("#c-addr").value.trim() || null,
      phone: $("#c-phone").value.trim() || null,
      website: $("#c-web").value.trim() || null,
      description: $("#c-desc").value.trim() || null,
    };
    const res = company
      ? await sb.from("employers").update(row).eq("id", company.id).select().single()
      : await sb.from("employers").insert({ ...row, owner_id: profile.id }).select().single();
    if (res.error) { showMsg("#company-msg", t("common.error"), "err"); return; }
    company = res.data; fill(company);
    showMsg("#company-msg", t("dash.saved"), "ok");
    loadJobs(company);
  });

  if (company) await loadJobs(company);
}

async function loadJobs(company) {
  const box = $("#jobs");
  const { data, error } = await sb.from("jobs").select("id, title, status, reject_reason, created_at, expires_at, applications(count)")
    .eq("employer_id", company.id).order("created_at", { ascending: false });
  if (error) { showMsg(box, t("common.error"), "err"); return; }
  if (!data.length) { box.replaceChildren(el("p", { class: "meta" }, t("dash.no_jobs"))); return; }
  box.replaceChildren(el("table", {},
    el("thead", {}, el("tr", {}, el("th", {}, t("post.job_title")), el("th", {}, t("app.status")), el("th", {}, t("dash.applicants")), el("th", {}))),
    el("tbody", {}, ...data.map((j) => el("tr", {},
      el("td", {}, el("a", { href: `${BASE}job.html?id=${encodeURIComponent(j.id)}` }, j.title),
        j.status === "rejected" && j.reject_reason ? el("div", { class: "hint" }, j.reject_reason) : null),
      el("td", {}, badge(j.status)),
      el("td", {}, el("a", { href: `${BASE}applicants.html?job=${encodeURIComponent(j.id)}` }, String(j.applications?.[0]?.count ?? 0))),
      el("td", { class: "row" },
        el("a", { class: "btn secondary small", href: `${BASE}post-job.html?id=${encodeURIComponent(j.id)}` }, t("dash.edit")),
        j.status !== "closed" ? el("button", { class: "secondary small", onclick: async () => {
          await sb.from("jobs").update({ status: "closed" }).eq("id", j.id);
          loadJobs(company);
        } }, t("dash.close")) : null,
      ),
    ))),
  ));
}

// ================= ACCOUNT =================
$("#delete-account").addEventListener("click", async () => {
  if (!confirm(t("dash.delete_confirm"))) return;
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/delete-account`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: CONFIG.SUPABASE_ANON_KEY },
  });
  if (!res.ok) { showMsg("#account-msg", t("common.error"), "err"); return; }
  await sb.auth.signOut();
  location.href = p("");
});
