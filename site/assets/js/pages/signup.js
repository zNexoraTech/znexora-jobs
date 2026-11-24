import { initPage, $, showMsg, qs, mountTurnstile, resetTurnstile } from "../ui.js";
import { sb } from "../supabase.js";
import { t, currentLang } from "../i18n.js";

const profile = await initPage();
if (profile) location.href = "/dashboard.html";

if (qs("role") === "employer") document.querySelector('input[name=role][value=employer]').checked = true;
const getToken = mountTurnstile($("#turnstile"));

$("#signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true;
  const role = document.querySelector("input[name=role]:checked").value;
  const { error } = await sb.auth.signUp({
    email: $("#email").value.trim(),
    password: $("#password").value,
    options: {
      data: { role, display_name: $("#name").value.trim(), language: currentLang() },
      emailRedirectTo: `${location.origin}/login.html`,
      captchaToken: getToken(),
    },
  });
  if (error) {
    showMsg("#msg", error.message, "err");
    resetTurnstile();
    btn.disabled = false;
    return;
  }
  $("#signup-form").reset();
  showMsg("#msg", t("auth.signup_ok"), "ok");
});
