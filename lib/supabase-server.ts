import { createClient } from "@supabase/supabase-js";
export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server environment variables are not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
