import { BASE } from "./paths.js";
// Simple i18n: English (en), Burmese (my), Japanese (ja)
// Text lives in /i18n/<lang>.json. Elements use:
//   data-i18n="key"              -> textContent
//   data-i18n-placeholder="key"  -> placeholder attribute
export const LANGS = { en: "English", my: "မြန်မာ", ja: "日本語" };

let dict = {};
let fallback = {};
let current = "en";

export function detectLang() {
  try {
    const saved = localStorage.getItem("lang");
    if (saved && LANGS[saved]) return saved;
  } catch (_) { /* storage blocked */ }
  const nav = (navigator.language || "en").toLowerCase();
  if (nav.startsWith("my")) return "my";
  if (nav.startsWith("ja")) return "ja";
  return "en";
}

export async function loadLang(lang = detectLang()) {
  if (!LANGS[lang]) lang = "en";
  current = lang;
  document.documentElement.lang = lang;
  const get = async (l) => {
    const r = await fetch(`${BASE}i18n/${l}.json`, { cache: "no-cache" });
    return r.ok ? r.json() : {};
  };
  fallback = await get("en");
  dict = lang === "en" ? fallback : await get(lang);
  applyI18n(document);
  return lang;
}

export function setLang(lang) {
  try { localStorage.setItem("lang", lang); } catch (_) { /* ignore */ }
  location.reload();
}

export function currentLang() { return current; }

/** Translate a key; {name} placeholders replaced from vars */
export function t(key, vars = {}) {
  let s = dict[key] ?? fallback[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function applyI18n(root) {
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
}
