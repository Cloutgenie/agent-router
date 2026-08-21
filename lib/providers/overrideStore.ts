import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { ProviderOverride } from "@/types";

/**
 * Kill switches (spec #33) need to take effect immediately, with no
 * redeploy, for every request currently in flight - not just the next one.
 * That rules out a purely file-backed store (too slow to read on every
 * routing decision) and a purely in-memory one (lost on restart, and
 * useless across the two processes `next dev` sometimes runs, or across
 * separate serverless invocations). This does both: an in-memory cache that
 * every write updates synchronously (so it's visible to the very next
 * eligibility check in this process), backed by Postgres (`provider_overrides`)
 * so it survives restarts and is shared across every serverless instance -
 * unlike the local-JSON-file version this replaced, which never actually
 * persisted on Vercel (EROFS: read-only filesystem).
 */
let cache: Record<string, ProviderOverride> | null = null;

async function loadFromDb(): Promise<Record<string, ProviderOverride>> {
  // No persistence configured yet (e.g. local dev before Supabase credentials are set) means
  // no overrides exist - {} is the correct answer, not a crash. Every task run calls this
  // unconditionally (it's the kill-switch check), so this must never throw over missing config.
  if (!isSupabaseConfigured()) return {};
  const { data, error } = await getSupabaseClient().from("provider_overrides").select("provider_id, data");
  if (error) throw error;
  const all: Record<string, ProviderOverride> = {};
  for (const row of data ?? []) {
    all[row.provider_id] = row.data as ProviderOverride;
  }
  return all;
}

async function persist(providerId: string, override: ProviderOverride): Promise<void> {
  try {
    const { error } = await getSupabaseClient()
      .from("provider_overrides")
      .upsert({ provider_id: providerId, data: override, updated_at: new Date().toISOString() });
    if (error) throw error;
  } catch (err) {
    console.warn("Could not persist provider override:", err);
  }
}

async function removeFromDb(providerId: string): Promise<void> {
  try {
    const { error } = await getSupabaseClient().from("provider_overrides").delete().eq("provider_id", providerId);
    if (error) throw error;
  } catch (err) {
    console.warn("Could not persist provider override removal:", err);
  }
}

/** Warms the in-memory cache. Call this once at the top of any request path that will make a synchronous eligibility decision - see lib/pipeline.ts. */
export async function ensureOverridesLoaded(): Promise<Record<string, ProviderOverride>> {
  if (cache === null) cache = await loadFromDb();
  return cache;
}

/** Synchronous read of whatever's currently cached - safe once ensureOverridesLoaded() has run at least once this process. */
export function getCachedOverrides(): Record<string, ProviderOverride> {
  return cache ?? {};
}

export async function listProviderOverrides(): Promise<Record<string, ProviderOverride>> {
  return ensureOverridesLoaded();
}

export async function getProviderOverride(providerId: string): Promise<ProviderOverride | undefined> {
  const all = await ensureOverridesLoaded();
  return all[providerId];
}

const DEFAULT_OVERRIDE: Omit<ProviderOverride, "updatedAt" | "updatedBy"> = {
  enabled: true,
  degraded: false,
};

export async function setProviderOverride(
  providerId: string,
  patch: Partial<Omit<ProviderOverride, "updatedAt">>,
  updatedBy: "manual" | "auto" = "manual"
): Promise<ProviderOverride> {
  const all = await ensureOverridesLoaded();
  const existing = all[providerId] ?? { ...DEFAULT_OVERRIDE, updatedAt: new Date().toISOString(), updatedBy: "manual" as const };
  const updated: ProviderOverride = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  all[providerId] = updated;
  cache = all; // update the in-memory copy before the DB write even resolves
  await persist(providerId, updated);
  return updated;
}

/** Removes the override entirely, returning the provider to its seeded defaults. */
export async function resetProviderOverride(providerId: string): Promise<void> {
  const all = await ensureOverridesLoaded();
  delete all[providerId];
  cache = all;
  await removeFromDb(providerId);
}
