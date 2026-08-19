import fs from "node:fs/promises";
import path from "node:path";
import { ProviderOverride } from "@/types";

const OVERRIDES_PATH = path.join(process.cwd(), "data", "provider-overrides.json");

/**
 * Kill switches (spec #33) need to take effect immediately, with no
 * redeploy, for every request currently in flight - not just the next one.
 * That rules out a purely file-backed store (too slow to read on every
 * routing decision) and a purely in-memory one (lost on restart, and
 * useless across the two processes `next dev` sometimes runs). This does
 * both: an in-memory cache that every write updates synchronously (so it's
 * visible to the very next eligibility check in this process), backed by
 * the same JSON-file persistence pattern as history.json /
 * provider-performance.json (best-effort - a read-only filesystem never
 * breaks routing, it just means overrides don't survive a restart there).
 */
let cache: Record<string, ProviderOverride> | null = null;

async function loadFromDisk(): Promise<Record<string, ProviderOverride>> {
  try {
    const raw = await fs.readFile(OVERRIDES_PATH, "utf-8");
    return JSON.parse(raw) as Record<string, ProviderOverride>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function persist(all: Record<string, ProviderOverride>): Promise<void> {
  try {
    await fs.writeFile(OVERRIDES_PATH, JSON.stringify(all, null, 2), "utf-8");
  } catch (err) {
    console.warn("Could not persist provider overrides:", err);
  }
}

/** Warms the in-memory cache. Call this once at the top of any request path that will make a synchronous eligibility decision - see lib/pipeline.ts. */
export async function ensureOverridesLoaded(): Promise<Record<string, ProviderOverride>> {
  if (cache === null) cache = await loadFromDisk();
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
  cache = all; // update the in-memory copy before the disk write even resolves
  await persist(all);
  return updated;
}

/** Removes the override entirely, returning the provider to its seeded defaults. */
export async function resetProviderOverride(providerId: string): Promise<void> {
  const all = await ensureOverridesLoaded();
  delete all[providerId];
  cache = all;
  await persist(all);
}
