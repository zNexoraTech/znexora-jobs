import { BASE, p } from "./paths.js";
// Shared UI helpers: header, footer, safe DOM building, formatting.
// SECURITY: never use innerHTML with user data. Use el() / textContent.
import { CONFIG } from "./config.js";
import { sb, getProfile } from "./supabase.js";
import { LANGS, loadLang, setLang, currentLang, t } from "./i18n.js";

/** Build an element safely. Children: strings become text nodes. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "href" && typeof v === "string" && /^\s*javascript:/i.test(v)) continue; // block JS URLs
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function $(sel, root = document) { return root.querySelector(sel); }

export function showMsg(target, text, kind = "info") {
  const box = typeof target === "string" ? $(target) : target;
  if (!box) return;
  box.replaceChildren(el("div", { class: `msg ${kind}`, role: kind === "err" ? "alert" : "status" }, text));
}

export function clear(target) {
  const box = typeof target === "string" ? $(target) : target;
  if (box) box.replaceChildren();
}

/** Only allow http(s) links from user data */
export function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch (_) { return null; }
}

/** Remove characters that have meaning in PostgREST filter strings */
export function cleanSearch(q) {
  return String(q || "").replace(/[,()*%\\:."']/g, " ").trim().slice(0, 60);
}

export function qs(name) { return new URLSearchParams(location.search).get(name); }

export function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ""));
}

export function formatWage(job) {
  const yen = (n) => `¥${Number(n).toLocaleString("ja-JP")}`;
  const unit = t(`wage.${job.wage_type}`);
  if (job.wage_min && job.wage_max) return `${yen(job.wage_min)} – ${yen(job.wage_max)} / ${unit}`;
  if (job.wage_min) return `${yen(job.wage_min)}~ / ${unit}`;
  return t("wage.negotiable");
}

export function formatDate(iso) {
  const lang = currentLang() === "my" ? "en-GB" : currentLang();
  return new Date(iso).toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric" });
}

export function badge(status) {
  return el("span", { class: `badge ${status}` }, t(`status.${status}`));
}

export function prefectureName(en) {
  const pref = PREFECTURES.find((x) => x[0] === en);
  if (!pref) return en;
  return currentLang() === "ja" ? pref[1] : pref[0];
}

export function fillPrefectureSelect(select, { withAny = false } = {}) {
  if (withAny) select.append(el("option", { value: "" }, t("filter.any")));
  for (const [en] of PREFECTURES) select.append(el("option", { value: en }, prefectureName(en)));
}

export function fillOptions(select, values, prefix, { withAny = false } = {}) {
  if (withAny) select.append(el("option", { value: "" }, t("filter.any")));
  for (const v of values) select.append(el("option", { value: v }, t(`${prefix}.${v}`)));
}

export const JOB_TYPES = ["full_time", "part_time", "contract", "arubaito"];
export const JP_LEVELS = ["none", "N5", "N4", "N3", "N2", "N1"];
export const WAGE_TYPES = ["hourly", "monthly", "yearly"];
export const REPORT_REASONS = ["scam", "fee_requested", "illegal_work", "wrong_info", "discrimination", "other"];

export const PREFECTURES = [
  ["Hokkaido","北海道"],["Aomori","青森県"],["Iwate","岩手県"],["Miyagi","宮城県"],["Akita","秋田県"],["Yamagata","山形県"],
  ["Fukushima","福島県"],["Ibaraki","茨城県"],["Tochigi","栃木県"],["Gunma","群馬県"],["Saitama","埼玉県"],["Chiba","千葉県"],
  ["Tokyo","東京都"],["Kanagawa","神奈川県"],["Niigata","新潟県"],["Toyama","富山県"],["Ishikawa","石川県"],["Fukui","福井県"],
  ["Yamanashi","山梨県"],["Nagano","長野県"],["Gifu","岐阜県"],["Shizuoka","静岡県"],["Aichi","愛知県"],["Mie","三重県"],
  ["Shiga","滋賀県"],["Kyoto","京都府"],["Osaka","大阪府"],["Hyogo","兵庫県"],["Nara","奈良県"],["Wakayama","和歌山県"],
  ["Tottori","鳥取県"],["Shimane","島根県"],["Okayama","岡山県"],["Hiroshima","広島県"],["Yamaguchi","山口県"],["Tokushima","徳島県"],
  ["Kagawa","香川県"],["Ehime","愛媛県"],["Kochi","高知県"],["Fukuoka","福岡県"],["Saga","佐賀県"],["Nagasaki","長崎県"],
  ["Kumamoto","熊本県"],["Oita","大分県"],["Miyazaki","宮崎県"],["Kagoshima","鹿児島県"],["Okinawa","沖縄県"],
];

/** Load language, draw header + footer. Returns the profile (or null). */
export async function initPage() {
  await loadLang();
  const profile = await getProfile();
  renderHeader(profile);
  renderFooter();
  return profile;
}

function renderHeader(profile) {
  const host = $("#site-header");
  if (!host) return;

  // Safety strip above the header: the one message every visitor must see
  if (!document.querySelector(".safety-strip")) {
    host.before(el("div", { class: "safety-strip" }, el("div", { class: "wrap" },
      el("strong", {}, t("safety.title")), " ", t("safety.text"))));
  }

  const langs = el("div", { class: "lang-switch", role: "group", "aria-label": "Language" });
  for (const [code, name] of Object.entries(LANGS)) {
    langs.append(el("button", { type: "button", lang: code, "aria-pressed": String(code === currentLang()), onclick: () => setLang(code) }, name));
  }

  const nav = el("nav", { class: "nav", "aria-label": "Main" }, el("a", { href: p("jobs.html") }, t("nav.jobs")));
  if (profile) {
    nav.append(el("a", { href: p("dashboard.html") }, t("nav.dashboard")));
    if (profile.role === "admin") nav.append(el("a", { href: p("admin.html") }, t("nav.admin")));
    nav.append(el("button", { class: "linklike", onclick: async () => { await sb.auth.signOut(); location.href = p(""); } }, t("nav.logout")));
    if (profile.role === "employer") nav.append(el("a", { class: "btn gold small", href: p("post-job.html") }, t("nav.post_job")));
  } else {
    nav.append(
      el("a", { href: p("login.html") }, t("nav.login")),
      el("a", { class: "btn small", href: p("signup.html") }, t("nav.signup")),
    );
  }
  nav.append(langs);

  host.className = "site-header";
  host.replaceChildren(el("div", { class: "wrap bar" },
    el("a", { class: "brand", href: p("") },
      el("span", { class: "brand-mark", "aria-hidden": "true" }),
      el("span", { class: "brand-name" }, CONFIG.SITE_NAME, el("small", {}, t("brand.tagline")))),
    nav));
}

function renderFooter() {
  const host = $("#site-footer");
  if (!host) return;
  host.className = "site-footer";
  const col = (title, ...links) => el("div", {}, el("h4", {}, title), ...links);
  const legal = [t("footer.notice")];
  if (CONFIG.OPERATOR_NAME) legal.push(` ${t("footer.operator")}: ${CONFIG.OPERATOR_NAME}.`);
  if (CONFIG.MHLW_NUMBER) legal.push(` ${t("footer.mhlw")}: ${CONFIG.MHLW_NUMBER}.`);
  host.replaceChildren(
    el("div", { class: "acheik", "aria-hidden": "true" }),
    el("div", { class: "wrap" },
      el("div", {}, el("h4", {}, CONFIG.SITE_NAME), el("p", {}, t("footer.about_text"))),
      col(t("footer.seekers"),
        el("a", { href: p("jobs.html") }, t("nav.jobs")),
        el("a", { href: p("legal/visa-guide.html") }, t("nav.visa_guide")),
        el("a", { href: p("legal/seeker-guide.html") }, t("footer.guide")),
        el("a", { href: p("share-job.html") }, t("nav.share_job")),
        el("a", { href: p("signup.html?role=seeker") }, t("home.cta_seeker"))),
      col(t("footer.company"),
        el("a", { href: p("signup.html?role=employer") }, t("home.cta_employer")),
        el("a", { href: p("legal/posting-rules.html") }, t("footer.rules")),
        el("a", { href: p("about.html") }, t("footer.about")),
        el("a", { href: p("legal/terms.html") }, t("footer.terms")),
        el("a", { href: p("legal/privacy.html") }, t("footer.privacy")),
        el("a", { href: `mailto:${CONFIG.CONTACT_EMAIL}` }, t("footer.contact"))),
      el("div", { class: "legal-line" }, ...legal, ` © ${new Date().getFullYear()} ${CONFIG.SITE_NAME}`),
    ),
  );
}

/** Redirect to login if not signed in, or home if wrong role. */
export function requireRole(profile, roles) {
  if (!profile) { location.href = `${BASE}login.html?next=${encodeURIComponent(location.pathname + location.search)}`; return false; }
  if (profile.suspended) { document.body.textContent = t("common.suspended"); return false; }
  if (roles && !roles.includes(profile.role)) { location.href = p("dashboard.html"); return false; }
  return true;
}

/** Only allow redirects to our own paths */
export function safeNext(next) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : p("dashboard.html");
}

/** Cloudflare Turnstile (optional). Returns a function that gives the current token. */
export function mountTurnstile(container) {
  if (!CONFIG.TURNSTILE_SITE_KEY || !container) return () => undefined;
  let token;
  const render = () => window.turnstile.render(container, {
    sitekey: CONFIG.TURNSTILE_SITE_KEY,
    callback: (tk) => { token = tk; },
    "expired-callback": () => { token = undefined; },
  });
  if (window.turnstile) render();
  else {
    window.__tsOnload = render;
    document.head.append(el("script", { src: "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__tsOnload&render=explicit", async: true, defer: true }));
  }
  return () => token;
}

export function resetTurnstile() {
  if (window.turnstile) window.turnstile.reset();
}

// ---------- Visa (status of residence) helpers ----------
export const VISAS = ["unrestricted", "student", "dependent", "designated", "engineer", "ssw1", "ssw2", "skilled", "nursing", "highly_skilled"];
export const SSW_FIELDS = ["nursing_care", "building_cleaning", "manufacturing", "construction", "shipbuilding", "auto_repair", "aviation",
  "accommodation", "auto_transport", "railway", "agriculture", "fishery", "food_manufacturing", "food_service", "forestry", "wood_industry"];
export const PLATFORMS = ["facebook", "telegram", "line", "tiktok", "viber", "website", "other"];

/** Checkbox list of visa types; returns a function that reads the checked codes */
export function visaCheckboxes(container, selected = []) {
  for (const v of VISAS) {
    const box = el("input", { type: "checkbox", name: "visa", value: v });
    box.checked = selected.includes(v);
    container.append(el("label", { class: "inline visa-option" }, box, t(`visa.${v}`)));
  }
  return () => [...container.querySelectorAll("input[name=visa]:checked")].map((c) => c.value);
}

// ---------- Industry categories (sorted automatically when left empty) ----------
export const CATEGORIES = ["restaurant", "care", "factory", "construction", "logistics", "retail", "hotel", "cleaning",
  "agriculture", "it", "office", "education", "other"];

/** <select> of categories; first option = "detect automatically" (empty) unless anyLabel given */
export function fillCategorySelect(select, { any = false } = {}) {
  select.append(el("option", { value: "" }, any ? t("filter.any") : t("cat.auto")));
  for (const c of CATEGORIES) select.append(el("option", { value: c }, t(`cat.${c}`)));
}
