import { url } from "../paths.js";
import { initPage, $, el, showMsg, qs, safeNext, mountTurnstile, resetTurnstile } from "../ui.js";
import { sb } from "../supabase.js";
import { t } from "../i18n.js";

// Text with an English fallback, so this page works even before new translations are uploaded
const tx = (key, fallback, vars) => { const s = t(key, vars); return s === key ? fallback.replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? "") : s; };

let getToken = () => undefined;
const form = $("#login-form");
const btn = form.querySelector("button[type=submit]");

/** Show a clear message for each kind of login failure, plus the technical detail */
function explain(error) {
  const code = error?.code || "";
  const status = error?.status || "";
  const raw = String(error?.message || error || "");
  let text;
  if (code === "invalid_credentials" || /invalid login credentials/i.test(raw)) {
    text = tx("auth.err_invalid", "Email or password is incorrect. Check for typing mistakes, or use \"Forgot password?\".");
  } else if (code === "email_not_confirmed" || /email not confirmed/i.test(raw)) {
    text = tx("auth.err_not_confirmed", "Your email address isn't confirmed yet. Click the link in the confirmation email first.");
  } else if (status === 429 || /rate limit|too many/i.test(raw)) {
    text = tx("auth.err_rate", "Too many attempts. Wait 5 minutes and try again.");
  } else if (code === "captcha_failed" || /captcha/i.test(raw)) {
    text = tx("auth.err_captcha", "The security check failed. Reload the page and try again.");
  } else if (/fetch|network|load failed/i.test(raw)) {
    text = tx("auth.err_network", "Couldn't reach the login service. Check your internet connection, turn off ad blockers for this site, and try again.");
  } else {
    text = tx("auth.login_failed", "Login failed.");
  }
  const box = $("#msg");
  box.replaceChildren(el("div", { class: "msg err", role: "alert" },
    el("div", {}, text),
    el("div", { class: "hint" }, `${tx("auth.err_detail", "Details")}: ${[status, code, raw].filter(Boolean).join(" · ")}`)));
}

// Attach the handler FIRST, so the button always works even if the rest of the page is slow
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  btn.disabled = true;
  showMsg("#msg", tx("auth.logging_in", "Logging in…"), "info");
  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email: $("#email").value.trim(),
      password: $("#password").value,
      options: { captchaToken: getToken() },
    });
    if (error) { explain(error); resetTurnstile(); return; }
    if (!data?.session) { explain({ message: "no session returned" }); return; }
    showMsg("#msg", tx("auth.logged_in", "Logged in. Opening your dashboard…"), "ok");
    location.href = safeNext(qs("next"));
  } catch (err) {
    explain(err);
  } finally {
    btn.disabled = false;
  }
});

$("#forgot").addEventListener("click", async () => {
  const email = $("#email").value.trim();
  if (!email) { showMsg("#msg", tx("auth.enter_email_first", "Enter your email above first."), "info"); return; }
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: url("update-password.html"), captchaToken: getToken() });
    if (error && (error.status === 429 || /rate limit/i.test(error.message))) { explain(error); return; }
  } catch (err) { explain(err); return; }
  // Same message whether or not the email exists (no account enumeration)
  showMsg("#msg", tx("auth.reset_sent", "If this email is registered, we sent a link to reset your password."), "ok");
});

// Then load the rest of the page (header, language, captcha)
try {
  const profile = await initPage();
  if (profile) location.href = safeNext(qs("next"));
  getToken = mountTurnstile($("#captcha-box"));
} catch (err) {
  explain(err);
}
