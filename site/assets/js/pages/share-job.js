import { initPage, $, el, showMsg, requireRole, fillPrefectureSelect, fillOptions, PLATFORMS, safeUrl } from "../ui.js";
import { sb } from "../supabase.js";
import { t } from "../i18n.js";

const profile = await initPage();
if (!requireRole(profile)) throw new Error("auth");
fillOptions($("#platform"), PLATFORMS, "platform");
fillPrefectureSelect($("#prefecture"), { withAny: true });

$("#tip-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true;
  const url = $("#source_url").value.trim();
  const { error } = await sb.from("job_tips").insert({
    platform: $("#platform").value,
    source_url: url ? safeUrl(url) : null,
    company_name: $("#company").value.trim() || null,
    prefecture: $("#prefecture").value || null,
    details: $("#details").value.trim(),
    contact: $("#contact").value.trim() || null,
  });
  btn.disabled = false;
  if (error) { showMsg("#msg", t("common.error"), "err"); return; }
  $("#tip-form").reset();
  showMsg("#msg", t("tip.thanks"), "ok");
});
