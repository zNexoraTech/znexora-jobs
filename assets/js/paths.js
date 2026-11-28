// Works both at a domain root (https://example.com/) and in a sub-folder
// (https://username.github.io/znexora-jobs/). BASE always ends with "/".
export const BASE = new URL("../../", import.meta.url).pathname;

/** Site-relative path -> full path, e.g. p("jobs.html") */
export const p = (path = "") => BASE + String(path).replace(/^\/+/, "");

/** Absolute URL for email links, e.g. url("login.html") */
export const url = (path = "") => location.origin + p(path);
