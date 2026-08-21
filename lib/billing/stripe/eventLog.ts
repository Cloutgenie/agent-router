import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * Processed Stripe event ids (spec #13) - webhook delivery is at-least-once,
 * so the same event can arrive twice. Backed by Postgres (`stripe_events`)
 * so dedup survives a serverless restart, unlike the local-JSON-file
 * version this replaced.
 */
export async function hasProcessedEvent(eventId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const { data, error } = await getSupabaseClient()
    .from("stripe_events")
    .select("event_id")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

export async function markEventProcessed(eventId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { error } = await getSupabaseClient()
    .from("stripe_events")
    .upsert({ event_id: eventId, processed_at: new Date().toISOString() });
  if (error) throw error;
}
