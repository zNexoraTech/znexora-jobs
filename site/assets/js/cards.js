import { BASE } from "./paths.js";
import { el, formatWage, prefectureName, formatDate } from "./ui.js";
import { t } from "./i18n.js";

/** Columns needed for a job row (employer columns limited to what visitors may read) */
export const JOB_CARD_COLUMNS =
  "id, title, category, prefecture, city, job_type, wage_type, wage_min, wage_max, japanese_level_required, created_at, employers(company_name)";

/** First visible letter of a company name, for the avatar */
export function initial(name) {
  const ch = [...String(name || "?").trim()][0] || "?";
  return ch.toUpperCase();
}

const isNew = (iso) => Date.now() - new Date(iso).getTime() < 3 * 864e5;

export function jobCard(job) {
  const company = job.employers?.company_name || "";
  const where = [prefectureName(job.prefecture), job.city].filter(Boolean).join(", ");
  return el("a", { class: "job-row", href: `${BASE}job.html?id=${encodeURIComponent(job.id)}` },
    el("div", { class: "avatar", "aria-hidden": "true" }, initial(company)),
    el("div", {},
      el("h3", {}, job.title),
      el("div", { class: "company" }, company),
      el("div", { class: "where" }, where),
      el("div", { class: "tags" },
        el("span", { class: "tag pay" }, formatWage(job)),
        job.category ? el("span", { class: "tag" }, t(`cat.${job.category}`)) : null,
        el("span", { class: "tag" }, t(`jobtype.${job.job_type}`)),
        job.japanese_level_required ? el("span", { class: "tag" }, `${t("job.japanese")}: ${t(`jp.${job.japanese_level_required}`)}`) : null,
      ),
    ),
    el("div", { class: "when" },
      isNew(job.created_at) ? el("div", {}, el("span", { class: "new" }, t("job.new"))) : null,
      formatDate(job.created_at),
    ),
  );
}

export function emptyRow(text) {
  return el("p", { class: "empty" }, text);
}
