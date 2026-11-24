import { initPage, $, showMsg, qs, safeNext, mountTurnstile, resetTurnstile } from "../ui.js";
import { sb } from "../supabase.js";
import { t } from "../i18n.js";

const profile = await initPage();
if (profile) location.href = safeNext(qs("next"));
const getToken = mountTurnstile($("#turnstile"));

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({
    email: $("#email").value.trim(), password: $("#password").value, options: { captchaToken: getToken() },
  });
  if (error) {
    showMsg("#msg", t("auth.login_failed"), "err");
    resetTurnstile();
    btn.disabled = false;
    return;
  }
  location.href = safeNext(qs("next"));
});

$("#forgot").addEventListener("click", async () => {
  const email = $("#email").value.trim();
  if (!email) { showMsg("#msg", t("auth.enter_email_first"), "info"); return; }
  await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/update-password.html`, captchaToken: getToken() });
  // Same message whether or not the email exists (no account enumeration)
  showMsg("#msg", t("auth.reset_sent"), "ok");
});
