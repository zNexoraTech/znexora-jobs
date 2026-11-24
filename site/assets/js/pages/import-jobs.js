import { initPage, $, el, showMsg, requireRole, formatDate, fillPrefectureSelect, fillOptions, fillCategorySelect, visaCheckboxes,
  JOB_TYPES, JP_LEVELS, WAGE_TYPES, SSW_FIELDS } from "../ui.js";
import { sb } from "../supabase.js";
import { t } from "../i18n.js";
import { CONFIG } from "../config.js";

const MAX_CARDS = 20;
const profile = await initPage();
if (!requireRole(profile, ["employer"])) throw new Error("auth");

const { data: company } = await sb.from("employers").select("id, verified, auto_publish").eq("owner_id", profile.id).maybeSingle();
if (!company) {
  showMsg("#msg", t("dash.create_company_first"), "err");
  document.querySelectorAll("section.card").forEach((s) => s.classList.add("hidden"));
  throw new Error("no company");
}
if (company.verified && company.auto_publish) $("#multi-note").textContent = t("post.instant_note");

// ---------- Several jobs in one form ----------
const cards = [];

function field(label, input, wide = false) {
  return el("div", { class: wide ? "wide" : "" }, el("label", {}, label, input));
}

/** One job card. prefill = values from another card ("Copy") */
function makeCard(prefill = {}) {
  const sel = (fill) => { const s = el("select", {}); fill(s); return s; };
  const f = {
    title: el("input", { type: "text", required: true, minlength: 3, maxlength: 120 }),
    category: sel((s) => fillCategorySelect(s)),
    description: el("textarea", { required: true, minlength: 20, maxlength: 8000 }),
    prefecture: sel((s) => fillPrefectureSelect(s)),
    city: el("input", { type: "text", maxlength: 80 }),
    job_type: sel((s) => fillOptions(s, JOB_TYPES, "jobtype")),
    japanese: sel((s) => fillOptions(s, JP_LEVELS, "jp")),
    wage_type: sel((s) => fillOptions(s, WAGE_TYPES, "wage")),
    wage_min: el("input", { type: "number", min: 0, step: 1 }),
    wage_max: el("input", { type: "number", min: 0, step: 1 }),
    hours: el("input", { type: "text", maxlength: 200 }),
    ssw: sel((s) => fillOptions(s, SSW_FIELDS, "ssw")),
  };
  f.prefecture.value = "Tokyo";
  for (const [k, v] of Object.entries(prefill.values || {})) if (f[k] && v !== undefined) f[k].value = v;

  const visaBox = el("div", { class: "visa-grid" });
  const readVisas = visaCheckboxes(visaBox, prefill.visas || []);
  const sswRow = el("div", { class: "wide hidden" }, el("label", {}, t("post.ssw_field"), f.ssw));
  const toggleSsw = () => sswRow.classList.toggle("hidden", !readVisas().some((v) => v.startsWith("ssw")));
  visaBox.addEventListener("change", toggleSsw);

  const number = el("h3", {});
  const msg = el("div", { class: "card-msg" });
  const card = { f, readVisas, msg, number };
  const node = el("fieldset", { class: "job-card-form" },
    el("div", { class: "head" }, number, el("span", { class: "spacer" }),
      el("button", { type: "button", class: "secondary small", onclick: () => addCard(snapshot(card)) }, t("multi.copy")),
      el("button", { type: "button", class: "secondary small", onclick: () => removeCard(card) }, t("alerts.delete"))),
    msg,
    el("div", { class: "fields" },
      field(t("post.job_title"), f.title, true),
      field(t("cat.label"), f.category),
      field(t("filter.prefecture"), f.prefecture),
      field(t("post.city"), f.city),
      field(t("filter.job_type"), f.job_type),
      field(t("post.japanese_required"), f.japanese),
      field(t("post.wage_type"), f.wage_type),
      field(t("post.wage_min"), f.wage_min),
      field(t("post.wage_max"), f.wage_max),
      field(t("post.hours"), f.hours, true),
      field(t("post.description"), f.description, true),
      el("div", { class: "wide" }, el("label", {}, t("post.visas")), visaBox),
      sswRow,
    ),
  );
  card.node = node;
  toggleSsw();
  return card;
}

function snapshot(card) {
  const values = {};
  for (const [k, input] of Object.entries(card.f)) values[k] = input.value;
  values.title = "";   // a copy is a new job: start with an empty title
  return { values, visas: card.readVisas() };
}

function renumber() {
  cards.forEach((c, i) => { c.number.textContent = t("multi.job_n", { n: i + 1 }); });
  $("#add-card").disabled = cards.length >= MAX_CARDS;
  $("#multi-submit").textContent = t("multi.submit_n", { n: cards.length });
}

function addCard(prefill) {
  if (cards.length >= MAX_CARDS) return;
  const card = makeCard(prefill);
  cards.push(card);
  $("#cards").append(card.node);
  renumber();
  card.f.title.focus();
}

function removeCard(card) {
  if (cards.length === 1) return;
  cards.splice(cards.indexOf(card), 1);
  card.node.remove();
  renumber();
}

function toRow(card) {
  const f = card.f;
  const num = (v) => (v === "" ? null : Math.max(0, parseInt(v, 10)));
  const visas = card.readVisas();
  return {
    employer_id: company.id,
    title: f.title.value.trim(),
    category: f.category.value || null,
    description: f.description.value.trim(),
    prefecture: f.prefecture.value,
    city: f.city.value.trim() || null,
    job_type: f.job_type.value,
    japanese_level_required: f.japanese.value,
    wage_type: f.wage_type.value,
    wage_min: num(f.wage_min.value),
    wage_max: num(f.wage_max.value),
    hours: f.hours.value.trim() || null,
    eligible_visas: visas,
    ssw_field: visas.some((v) => v.startsWith("ssw")) ? f.ssw.value : null,
    status: "pending",
  };
}

$("#add-card").addEventListener("click", () => addCard());

$("#multi-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#msg").replaceChildren();
  let ok = true;
  const rows = cards.map((c) => {
    c.msg.replaceChildren();
    const r = toRow(c);
    if (!r.eligible_visas.length) { showMsg(c.msg, t("post.visas_required"), "err"); ok = false; }
    if (r.wage_min !== null && r.wage_max !== null && r.wage_max < r.wage_min) { showMsg(c.msg, t("post.wage_error"), "err"); ok = false; }
    return r;
  });
  if (!ok) { cards.find((c) => c.msg.childNodes.length)?.node.scrollIntoView({ block: "center" }); return; }

  const btn = $("#multi-submit"); btn.disabled = true;
  const { data, error } = await sb.from("jobs").insert(rows).select("status, category");
  btn.disabled = false;
  if (error) { showMsg("#msg", t("common.error"), "err"); return; }
  const live = data.filter((r) => r.status === "live").length;
  showMsg("#msg", t("multi.done", { n: data.length, live, review: data.length - live }), "ok");
  cards.splice(0).forEach((c) => c.node.remove());
  $("#multi-confirm").checked = false;
  addCard();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

addCard();

// ---------- Feeds ----------
if (!company.verified) {
  $("#feed-form").classList.add("hidden");
  showMsg("#feeds-msg", t("imp.feeds_verified_only"), "info");
}

async function loadFeeds() {
  const { data, error } = await sb.from("job_feeds").select("*").eq("employer_id", company.id).order("created_at");
  if (error) { showMsg("#feeds-msg", t("common.error"), "err"); return; }
  if (!data.length) { $("#feeds").replaceChildren(el("p", { class: "meta" }, t("imp.no_feeds"))); return; }
  $("#feeds").replaceChildren(...data.map((f) => el("div", { class: "alert-row" },
    el("div", { class: "u-flex1" },
      el("div", {}, el("code", {}, f.url)),
      el("div", { class: "hint" }, f.last_run_at ? `${formatDate(f.last_run_at)}: ${f.last_status || ""}` : t("imp.not_run_yet")),
    ),
    el("button", { class: "secondary small", onclick: () => runFeed(f.id) }, t("imp.run_now")),
    el("button", { class: "secondary small", onclick: async () => {
      if (!confirm(t("imp.delete_feed_confirm"))) return;
      await sb.from("job_feeds").delete().eq("id", f.id); loadFeeds();
    } }, t("alerts.delete")),
  )));
}

async function runFeed(id) {
  showMsg("#feeds-msg", t("imp.running"), "info");
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/import-feeds`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: CONFIG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ feed_id: id }),
  }).catch(() => null);
  if (!res) { showMsg("#feeds-msg", t("imp.function_missing"), "err"); return; }
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) showMsg("#feeds-msg", t("imp.wait"), "info");
  else if (!res.ok) showMsg("#feeds-msg", t("imp.function_missing"), "err");
  else showMsg("#feeds-msg", body.results?.[id] || t("dash.saved"), String(body.results?.[id] || "").startsWith("ok") ? "ok" : "err");
  loadFeeds();
}

$("#feed-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("#feed-url").value.trim();
  if (!/^https:\/\//i.test(url)) { showMsg("#feeds-msg", t("imp.https_only"), "err"); return; }
  const { error } = await sb.from("job_feeds").insert({ employer_id: company.id, url, format: $("#feed-format").value });
  if (error) {
    const m = /maximum/.test(error.message) ? t("imp.max_feeds") : /duplicate/.test(error.message) ? t("imp.duplicate_feed") : t("common.error");
    showMsg("#feeds-msg", m, "err");
    return;
  }
  $("#feed-form").reset();
  showMsg("#feeds-msg", t("imp.feed_added"), "ok");
  loadFeeds();
});

loadFeeds();
