// =============================================================
// Site configuration — edit these values before deploying.
// The anon key is SAFE to be public (security comes from RLS).
// NEVER put the service_role key in this file or anywhere in /site.
// =============================================================
export const CONFIG = {
  SITE_NAME: "ZNexora Jobs",

  // Supabase -> Project Settings -> API
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY",

  // Cloudflare Turnstile site key. Leave "" until you enable CAPTCHA in
  // Supabase -> Authentication -> Attack Protection (with the secret key).
  TURNSTILE_SITE_KEY: "",

  CONTACT_EMAIL: "contact@example.com",

  // Fill these after the MHLW notification is accepted (shown in the footer/About).
  OPERATOR_NAME: "",
  MHLW_NUMBER: "",

  JOBS_PER_PAGE: 20,
};
