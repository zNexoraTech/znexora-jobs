import { initPage, $, el, VISAS, SSW_FIELDS } from "../ui.js";
import { t } from "../i18n.js";

await initPage();
// Visa types employers can tick, then statuses that can't take jobs from this site
const cards = [...VISAS, "intern", "no_work"];
$("#visa-list").replaceChildren(...cards.map((v) => el("section", { class: `visa-card${v === "no_work" ? " no-work" : ""}`, id: `visa-${v}` },
  el("h2", {}, t(`visa.${v}`)),
  el("p", { class: "jp" }, t(`visa.${v}_jp`)),
  el("p", {}, t(`visa.${v}_rule`)),
)));
$("#ssw-list").replaceChildren(...SSW_FIELDS.map((f) => el("li", {}, t(`ssw.${f}`))));
