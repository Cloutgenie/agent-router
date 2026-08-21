import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Single-tenant, server-only Postgres access (Phase: persistence-layer
 * migration off local JSON files, which don't work on Vercel's read-only
 * serverless filesystem - see the EROFS errors that motivated this).
 * Always the service role key: every table has RLS enabled with zero
 * policies (default-deny), so the publishable/anon key - the only key ever
 * safe to expose client-side - cannot read or write any of this data. This
 * client must never be imported from client components.
 */
let client: SupabaseClient | null = null;

/** Lets a caller degrade gracefully (e.g. the kill-switch check every task run makes) instead of throwing before credentials exist. */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase is not configured - missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY.");
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
