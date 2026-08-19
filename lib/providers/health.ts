import { RuntimeConfig } from "@/lib/config";
import { AgentProvider, ProviderHealth, ProviderHealthState } from "@/types";
import { getAllProviders } from "./registry";

async function checkOne(provider: AgentProvider): Promise<ProviderHealth> {
  const checked_at = new Date().toISOString();

  if (provider.protocol !== "mock" && !provider.configured) {
    return {
      provider_id: provider.id,
      provider_name: provider.name,
      state: "missing_credentials",
      checked_at,
      detail: "No credentials configured for this provider.",
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
 * router itself never selects a provider currently reporting `unavailable`
 * or `missing_credentials` (see getEligibleProviders, which already
 * excludes unconfigured adapters); this endpoint is what surfaces that
 * state to the UI and to a pre-flight check if one is added later.
 */
export async function checkAllProviderHealth(config: RuntimeConfig): Promise<ProviderHealth[]> {
  const providers = getAllProviders(config);
  return Promise.all(providers.map(checkOne));
}
