import { cache } from "react";
import { supabaseServer } from "./supabase-server";

export const defaultStoreName = cache(async () => {
  try {
    const { data, error } = await supabaseServer().from("stores").select("name")
      .eq("id", process.env.NEXT_PUBLIC_DEFAULT_STORE_ID!).single();
    if (error || !data) throw new Error("Store unavailable");
    return data.name as string;
  } catch { return "予約受付"; }
});
