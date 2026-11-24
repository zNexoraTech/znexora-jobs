// Supabase Edge Function: delete-account
// Deletes the calling user's CV files and auth account.
// All rows in public.* are removed automatically by ON DELETE CASCADE.
//
// Deploy:  supabase functions deploy delete-account
// The SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
// environment variables are provided automatically by Supabase.

import { createClient } from "npm:@supabase/supabase-js@2";

// Change this to your production domain(s).
const ALLOWED_ORIGINS = [
  "http://localhost:8788",
  "https://znexora-jobs.pages.dev",
];

function cors(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const headers = cors(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response("Unauthorized", { status: 401, headers });

  // Identify the caller from their own JWT (never trust a user id in the body)
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return new Response("Unauthorized", { status: 401, headers });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Delete CV files in the user's folder
  const { data: files } = await admin.storage.from("cvs").list(user.id, { limit: 1000 });
  if (files && files.length > 0) {
    await admin.storage.from("cvs").remove(files.map((f) => `${user.id}/${f.name}`));
  }

  // 2. Delete the auth user (cascades to profiles, applications, employers, jobs ...)
  const { error: delError } = await admin.auth.admin.deleteUser(user.id);
  if (delError) {
    return new Response(JSON.stringify({ error: "delete_failed" }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...headers, "Content-Type": "application/json" },
  });
});
