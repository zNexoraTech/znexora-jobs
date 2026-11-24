import { BASE } from "./paths.js";
import { el, formatWage, prefectureName, formatDate } from "./ui.js";
import { t } from "./i18n.js";

/** Columns needed for a job card (employer columns limited to what anon may read) */
export const JOB_CARD_COLUMNS =
  "id, title, prefecture, city, job_type, wage_type, wage_min, wage_max, japanese_level_required, created_at, employers(company_name)";

export function jobCard(job) {
  const loc = [prefectureName(job.prefecture), job.city].filter(Boolean).join(" · ");
  return el("a", { class: "card job-card", href: `${BASE}job.html?id=${encodeURIComponent(job.id)}` },
    el("h3", {}, job.title),
    el("div", { class: "meta" }, job.employers?.company_name || ""),
    el("div", { class: "meta" }, loc),
    el("div", { class: "tags" },
      el("span", { class: "tag" }, t(`jobtype.${job.job_type}`)),
      el("span", { class: "tag" }, formatWage(job)),
      job.japanese_level_required ? el("span", { class: "tag" }, `${t("job.japanese")}: ${t(`jp.${job.japanese_level_required}`)}`) : null,
    ),
    el("div", { class: "meta" }, `${t("job.posted")} ${formatDate(job.created_at)}`),
  );
}
