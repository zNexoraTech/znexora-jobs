import { p, url } from "../paths.js";
import { initPage, $, showMsg, qs, mountTurnstile, resetTurnstile } from "../ui.js";
import { sb } from "../supabase.js";
import { t, currentLang } from "../i18n.js";

const profile = await initPage();
if (profile) location.href = p("dashboard.html");

if (qs("role") === "employer") document.querySelector('input[name=role][value=employer]').checked = true;
const getToken = mountTurnstile($("#captcha-box"));

$("#signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true;
  const role = document.querySelector("input[name=role]:checked").value;
  const { error } = await sb.auth.signUp({
    email: $("#email").value.trim(),
    password: $("#password").value,
    options: {
      data: { role, display_name: $("#name").value.trim(), language: currentLang() },
      emailRedirectTo: url("login.html"),
      captchaToken: getToken(),
    },
  });
  if (error) {
    btn.disabled = false;
    showMsg("#msg", `${error.message}${error.code ? ` (${error.code})` : ""}`, "err");
    resetTurnstile();
    return;
  }
  btn.disabled = false;
  $("#signup-form").reset();
  showMsg("#msg", t("auth.signup_ok"), "ok");
});
