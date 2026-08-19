import { RuntimeConfig } from "@/lib/config";
import { ensureOverridesLoaded } from "@/lib/providers/overrideStore";
import { AgentProvider, ProviderHealth, ProviderHealthState, ProviderOverride } from "@/types";
import { getAllProviders } from "./registry";

async function checkOne(provider: AgentProvider, override: ProviderOverride | undefined): Promise<ProviderHealth> {
  const checked_at = new Date().toISOString();

  if (override?.enabled === false) {
    return {
      provider_id: provider.id,
      provider_name: provider.name,
      state: "disabled",
      checked_at,
      detail: override.reason ?? `Disabled ${override.updatedBy === "auto" ? "automatically" : "by an operator"}.`,
    };
  }

  if (provider.protocol !== "mock" && !provider.configured) {
    return {
      provider_id: provider.id,
      provider_name: provider.name,
      state: "missing_credentials",
      checked_at,
      detail: "No credentials configured for this provider.",
    };
  }

  if (override?.degraded) {
    return {
      provider_id: provider.id,
      provider_name: provider.name,
      state: "degraded",
      checked_at,
      detail: override.reason ?? `Degraded ${override.updatedBy === "auto" ? "automatically" : "by an operator"}.`,
    };
  }

  try {
    const healthy = await provider.healthCheck();
    const state: ProviderHealthState = healthy ? "healthy" : provider.protocol === "mock" ? "degraded" : "unavailable";
    return {
      provider_id: provider.id,
      provider_name: provider.name,
      state,
      checked_at,
      detail: healthy ? undefined : "Health check reported not-ready.",
    };
  } catch (err) {
    return {
      provider_id: provider.id,
      provider_name: provider.name,
      state: "unavailable",
      checked_at,
      detail: err instanceof Error ? err.message : "Health check failed.",
    };
  }
}

/**
 * Provider health (V4 #3) - checked before routing any live work. The
 * router itself never selects a provider currently reporting `unavailable`,
 * `disabled`, or `missing_credentials` (see getEligibleProviders, which
 * already excludes them); this endpoint is what surfaces that state to the
 * UI. A manual or automatic kill switch (spec #33-34) always wins over
 * whatever the provider's own healthCheck() would have reported.
 */
export async function checkAllProviderHealth(config: RuntimeConfig): Promise<ProviderHealth[]> {
  const providers = getAllProviders(config);
  const overrides = await ensureOverridesLoaded();
  return Promise.all(providers.map((p) => checkOne(p, overrides[p.id])));
}
