import { BASE } from "../paths.js";
import { initPage, $, el, showMsg, requireRole, badge, formatDate, formatWage, prefectureName, safeUrl, fillPrefectureSelect, fillOptions, visaCheckboxes, JOB_TYPES, JP_LEVELS, WAGE_TYPES, SSW_FIELDS } from "../ui.js";
import { sb } from "../supabase.js";
import { t } from "../i18n.js";

const profile = await initPage();
if (!requireRole(profile, ["admin"])) throw new Error("auth");

const panel = $("#panel");
const tabs = document.querySelectorAll(".tabs button");
tabs.forEach((b) => b.addEventListener("click", () => {
  tabs.forEach((x) => x.classList.toggle("active", x === b));
  load(b.dataset.tab);
}));

async function load(tab) {
  $("#msg").replaceChildren();
  panel.replaceChildren(el("p", { class: "meta" }, t("common.loading")));
  if (tab === "employers") return employers();
  if (tab === "jobs") return jobs();
  if (tab === "reports") return reports();
  if (tab === "tips") return tips();
  if (tab === "import") return importForm();
  if (tab === "trusted") return trusted();
}

const empty = () => panel.replaceChildren(el("p", { class: "meta" }, t("admin.empty")));
const fail = () => showMsg("#msg", t("common.error"), "err");

// ---------- Employers to verify ----------
async function employers() {
  const { data, error } = await sb.from("employers").select("*").eq("verified", false).order("created_at");
  if (error) return fail();
  if (!data.length) return empty();
  panel.replaceChildren(...data.map((e) => {
    const web = safeUrl(e.website || "");
    return el("div", { class: "card" },
      el("h3", {}, e.company_name),
      el("dl", { class: "facts" },
        el("dt", {}, t("dash.corporate_number")), el("dd", {}, e.corporate_number || "—",
          e.corporate_number ? [" ", el("a", { href: "https://www.houjin-bangou.nta.go.jp/", target: "_blank", rel: "noopener noreferrer" }, t("admin.check_nta"))] : null),
        el("dt", {}, t("dash.address")), el("dd", {}, e.address || "—"),
        el("dt", {}, t("dash.phone")), el("dd", {}, e.phone || "—"),
        el("dt", {}, t("dash.website")), el("dd", {}, web ? el("a", { href: web, target: "_blank", rel: "noopener noreferrer nofollow" }, web) : "—"),
        el("dt", {}, t("job.posted")), el("dd", {}, formatDate(e.created_at)),
      ),
      e.description ? el("p", { class: "description" }, e.description) : null,
      el("button", { onclick: async () => {
        const { error } = await sb.from("employers").update({ verified: true }).eq("id", e.id);
        if (error) return fail();
        employers();
      } }, t("admin.verify")),
    );
  }));
}

// ---------- Jobs to review ----------
async function jobs() {
  const { data, error } = await sb.from("jobs")
    .select("*, employers(company_name, verified)")
    .eq("status", "pending").order("updated_at");
  if (error) return fail();
  if (!data.length) return empty();
  panel.replaceChildren(...data.map((j) => {
    const reason = el("input", { type: "text", maxlength: 300, placeholder: t("admin.reject_reason") });
    return el("div", { class: "card" },
      el("div", { class: "row" }, el("h3", {}, j.title), el("span", { class: "spacer" }),
        el("span", { class: `badge ${j.employers?.verified ? "ok" : "bad"}` }, t(j.employers?.verified ? "dash.verified" : "dash.not_verified"))),
      el("div", { class: "meta" }, `${j.employers?.company_name || ""} · ${prefectureName(j.prefecture)} · ${t(`jobtype.${j.job_type}`)} · ${formatWage(j)}`),
      j.hours ? el("div", { class: "meta" }, j.hours) : null,
      el("p", { class: "description" }, j.description),
      el("div", { class: "row" },
        el("button", { onclick: async () => {
          const { error } = await sb.from("jobs").update({ status: "live", reject_reason: null }).eq("id", j.id);
          if (error) return fail();
          jobs();
        } }, t("admin.approve")),
        reason,
        el("button", { class: "danger", onclick: async () => {
          if (!reason.value.trim()) { reason.focus(); return; }
          const { error } = await sb.from("jobs").update({ status: "rejected", reject_reason: reason.value.trim() }).eq("id", j.id);
          if (error) return fail();
          jobs();
        } }, t("admin.reject")),
      ),
    );
  }));
}

// ---------- Reports ----------
async function reports() {
  const { data, error } = await sb.from("reports")
    .select("*, jobs(id, title, status), employers(company_name)")
    .eq("status", "open").order("created_at");
  if (error) return fail();
  if (!data.length) return empty();
  panel.replaceChildren(...data.map((r) => el("div", { class: "card" },
    el("div", { class: "row" }, el("h3", {}, t(`reason.${r.reason}`)), el("span", { class: "spacer" }), el("span", { class: "meta" }, formatDate(r.created_at))),
    el("div", { class: "meta" }, r.employers?.company_name || ""),
    r.jobs ? el("p", {}, el("a", { href: `${BASE}job.html?id=${encodeURIComponent(r.jobs.id)}` }, r.jobs.title), " ", badge(r.jobs.status)) : null,
    r.details ? el("p", { class: "description" }, r.details) : null,
    el("div", { class: "row" },
      r.jobs && r.jobs.status === "live" ? el("button", { class: "danger", onclick: async () => {
        await sb.from("jobs").update({ status: "closed" }).eq("id", r.jobs.id);
        await sb.from("reports").update({ status: "actioned" }).eq("id", r.id);
        reports();
      } }, t("admin.close_job")) : null,
      el("button", { class: "secondary", onclick: async () => {
        await sb.from("reports").update({ status: "reviewed" }).eq("id", r.id);
        reports();
      } }, t("admin.mark_reviewed")),
    ),
  )));
}

// ---------- Jobs people shared from social media ----------
async function tips() {
  const { data, error } = await sb.from("job_tips").select("*").eq("status", "new").order("created_at");
  if (error) return fail();
  if (!data.length) return empty();
  panel.replaceChildren(...data.map((tip) => {
    const src = safeUrl(tip.source_url || "");
    return el("div", { class: "card" },
      el("div", { class: "row" }, el("h3", {}, tip.company_name || t(`platform.${tip.platform}`)), el("span", { class: "spacer" }),
        el("span", { class: "meta" }, `${t(`platform.${tip.platform}`)}, ${formatDate(tip.created_at)}`)),
      tip.prefecture ? el("div", { class: "meta" }, prefectureName(tip.prefecture)) : null,
      el("p", { class: "description" }, tip.details),
      tip.contact ? el("p", {}, el("strong", {}, `${t("tip.contact")}: `), tip.contact) : null,
      src ? el("p", {}, el("a", { href: src, target: "_blank", rel: "noopener noreferrer nofollow" }, src)) : null,
      el("p", { class: "hint" }, t("admin.tip_consent")),
      el("div", { class: "row" },
        el("button", { onclick: () => { activate("import"); importForm(tip); } }, t("admin.import_this")),
        el("button", { class: "secondary", onclick: async () => {
          await sb.from("job_tips").update({ status: "rejected" }).eq("id", tip.id); tips();
        } }, t("admin.reject")),
      ),
    );
  }));
}

function activate(tab) {
  tabs.forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
}

// ---------- Import a job (from a tip or by hand) as an external listing ----------
async function importForm(tip = null) {
  $("#msg").replaceChildren();
  const { data: listings } = await sb.from("employers").select("id, company_name").is("owner_id", null).order("company_name");
  const f = (id, label, input) => el("div", {}, el("label", { for: id }, label), input);
  const sel = (id, opts) => { const s = el("select", { id }); opts(s); return s; };

  const employerSel = el("select", { id: "imp-emp" }, el("option", { value: "" }, t("admin.new_listing")),
    ...(listings || []).map((l) => el("option", { value: l.id }, l.company_name)));
  const newName = el("input", { type: "text", id: "imp-company", maxlength: 120, value: tip?.company_name || "" });
  const title = el("input", { type: "text", id: "imp-title", required: true, minlength: 3, maxlength: 120 });
  const desc = el("textarea", { id: "imp-desc", required: true, minlength: 20, maxlength: 8000, class: "u-tall" });
  desc.value = tip?.details || "";
  const pref = sel("imp-pref", (s) => fillPrefectureSelect(s));
  pref.value = tip?.prefecture || "Tokyo";
  const type = sel("imp-type", (s) => fillOptions(s, JOB_TYPES, "jobtype"));
  const jp = sel("imp-jp", (s) => fillOptions(s, JP_LEVELS, "jp"));
  const wageType = sel("imp-wt", (s) => fillOptions(s, WAGE_TYPES, "wage"));
  const wmin = el("input", { type: "number", id: "imp-wmin", min: 0 });
  const wmax = el("input", { type: "number", id: "imp-wmax", min: 0 });
  const contact = el("input", { type: "text", id: "imp-contact", required: true, maxlength: 300, value: tip?.contact || "" });
  const source = el("input", { type: "url", id: "imp-src", maxlength: 500, value: tip?.source_url || "" });
  const visaBox = el("div", { class: "visa-grid" });
  const readVisas = visaCheckboxes(visaBox);
  const ssw = sel("imp-ssw", (s) => { s.append(el("option", { value: "" }, "—")); fillOptions(s, SSW_FIELDS, "ssw"); });
  const consent = el("input", { type: "checkbox", id: "imp-consent", required: true });

  const form = el("form", { class: "card grid grid-2" },
    el("p", { class: "msg info u-full" }, t("admin.import_note")),
    f("imp-emp", t("admin.listing"), employerSel),
    f("imp-company", t("dash.company_name"), newName),
    el("div", { class: "u-full" }, el("label", { for: "imp-title" }, t("post.job_title")), title),
    el("div", { class: "u-full" }, el("label", { for: "imp-desc" }, t("post.description")), desc),
    f("imp-pref", t("filter.prefecture"), pref),
    f("imp-type", t("filter.job_type"), type),
    f("imp-jp", t("post.japanese_required"), jp),
    f("imp-wt", t("post.wage_type"), wageType),
    f("imp-wmin", t("post.wage_min"), wmin),
    f("imp-wmax", t("post.wage_max"), wmax),
    el("div", { class: "u-full" }, el("label", {}, t("post.visas")), visaBox),
    f("imp-ssw", t("post.ssw_field"), ssw),
    f("imp-contact", t("admin.apply_contact"), contact),
    el("div", { class: "u-full" }, el("label", { for: "imp-src" }, t("tip.link")), source),
    el("label", { class: "inline u-full" }, consent, t("admin.consent_confirm")),
    el("div", {}, el("button", { type: "submit" }, t("admin.publish_import"))),
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    let employerId = employerSel.value;
    if (!employerId) {
      if (!newName.value.trim()) { newName.focus(); return; }
      const { data: emp, error } = await sb.from("employers").insert({ company_name: newName.value.trim(), verified: true, owner_id: null }).select("id").single();
      if (error) return fail();
      employerId = emp.id;
    }
    const num = (v) => (v === "" ? null : Math.max(0, parseInt(v, 10)));
    const visas = readVisas();
    const { error } = await sb.from("jobs").insert({
      employer_id: employerId, title: title.value.trim(), description: desc.value.trim(),
      prefecture: pref.value, job_type: type.value, japanese_level_required: jp.value,
      wage_type: wageType.value, wage_min: num(wmin.value), wage_max: num(wmax.value),
      eligible_visas: visas, ssw_field: visas.some((v) => v.startsWith("ssw")) && ssw.value ? ssw.value : null,
      external: true, apply_contact: contact.value.trim(), source_url: safeUrl(source.value.trim()) || null, status: "live",
    });
    if (error) return fail();
    if (tip) await sb.from("job_tips").update({ status: "imported" }).eq("id", tip.id);
    showMsg("#msg", t("admin.imported"), "ok");
    form.reset();
  });
  panel.replaceChildren(form);
}

// ---------- Instant publishing switch per verified employer ----------
async function trusted() {
  const { data, error } = await sb.from("employers").select("id, company_name, auto_publish, owner_id").eq("verified", true).order("company_name");
  if (error) return fail();
  const owned = (data || []).filter((e) => e.owner_id);
  if (!owned.length) return empty();
  panel.replaceChildren(el("p", { class: "hint" }, t("admin.trusted_hint")), ...owned.map((e) => el("div", { class: "card row" },
    el("strong", {}, e.company_name), el("span", { class: "spacer" }),
    el("span", { class: `badge ${e.auto_publish ? "ok" : "pending"}` }, t(e.auto_publish ? "dash.instant_on" : "admin.review_first")),
    el("button", { class: "secondary small", onclick: async () => {
      const { error } = await sb.from("employers").update({ auto_publish: !e.auto_publish }).eq("id", e.id);
      if (error) return fail();
      trusted();
    } }, t(e.auto_publish ? "admin.turn_off" : "admin.turn_on")),
  )));
}

load("employers");
