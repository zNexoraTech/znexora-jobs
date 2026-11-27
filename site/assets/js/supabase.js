import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CONFIG } from "./config.js";

export const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Current session user or null */
export async function getUser() {
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

/** Current user's profile row (role, language...) or null */
/** Last problem reading the profile while logged in (shown instead of a silent redirect) */
export let profileProblem = null;

export async function getProfile(knownUser = null) {
  profileProblem = null;
  const user = knownUser || await getUser();
  if (!user) return null;
  const { data, error } = await sb.from("profiles").select("id, role, display_name, language, suspended").eq("id", user.id).maybeSingle();
  if (error) {
    profileProblem = `${error.code || ""} ${error.message || ""}`.trim();
    console.error("Profile could not be loaded:", error);
  } else if (!data) {
    profileProblem = "no profile row for this account";
    console.error("Logged in, but no profile row exists for user", user.id);
  }
  return data;
}
