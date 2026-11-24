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
export async function getProfile() {
  const user = await getUser();
  if (!user) return null;
  const { data } = await sb.from("profiles").select("id, role, display_name, language, suspended").eq("id", user.id).maybeSingle();
  return data;
}
