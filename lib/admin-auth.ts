import { createClient } from "@supabase/supabase-js";

export async function authorizeStaff(authorization: string | null) {
  const token = authorization?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase auth is not configured.");
  const auth = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await auth.auth.getUser(token);
  if (error || !user) return null;
  const { store_id, role } = user.app_metadata;
  if (typeof store_id !== "string" ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(store_id) ||
      !["staff", "admin"].includes(role)) return null;
  return { storeId: store_id, userId: user.id };
}
