import { BASE } from "../paths.js";
import { initPage, $, el, showMsg, requireRole, badge, formatDate, formatWage, prefectureName, safeUrl } from "../ui.js";
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

load("employers");
