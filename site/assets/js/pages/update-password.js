import { initPage, $, showMsg } from "../ui.js";
import { sb } from "../supabase.js";
import { t } from "../i18n.js";

await initPage();
$("#pw-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.updateUser({ password: $("#password").value });
  if (error) showMsg("#msg", error.message, "err");
  else { $("#pw-form").replaceChildren(); showMsg("#msg", t("auth.password_updated"), "ok"); }
});
