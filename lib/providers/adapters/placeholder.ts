import { AgentProvider, Capability, ProviderProtocol, ProviderResult, ProviderTask } from "@/types";

export class ProviderNotImplementedError extends Error {
  constructor(providerId: string, envVarHint: string) {
    super(
      `${providerId} is configured (credentials present) but has no real implementation yet. ` +
        `Wire up the actual API call in lib/providers/adapters/ - see the TODO there. ` +
        `Expected credential: ${envVarHint}.`
    );
    this.name = "ProviderNotImplementedError";
  }
}

interface PlaceholderOptions {
  id: string;
  name: string;
  description: string;
  capabilities: Capability[];
  protocol: ProviderProtocol;
  envVarHint: string;
  configured: boolean;
  quality_score: number;
  reliability_score: number;
  success_rate: number;
  price_per_task: number;
  average_latency_seconds: number;
}

/**
 * Shell for a real integration. It reports itself as `configured` once its
 * credentials are present, so the router will genuinely try to select it in
 * Live Mode - but `execute` deliberately throws until a real HTTP call
 * replaces the TODO below. That failure is not swallowed silently: the
 * execution engine's fallback chain catches it and retries the next-ranked
 * provider (normally a mock), so a half-wired integration degrades
 * gracefully instead of taking down the task.
 */
export function createPlaceholderAdapter(opts: PlaceholderOptions): AgentProvider {
  return {
    id: opts.id,
    name: opts.name,
    description: opts.description,
    capabilities: opts.capabilities,
    protocol: opts.protocol,
    quality_score: opts.quality_score,
    reliability_score: opts.reliability_score,
    success_rate: opts.success_rate,
    price_per_task: opts.price_per_task,
    average_latency_seconds: opts.average_latency_seconds,
    configured: opts.configured,

    async execute(_task: ProviderTask): Promise<ProviderResult> {
      // TODO(real integration): replace this block with the actual API call.
      //   1. Build the request from `_task` (capability, goal, context, resultCount).
      //   2. Call the provider's API using the credential named in envVarHint.
      //   3. Normalize the response into `ProviderResult.data` + `evidence[]`.
      //   4. Return { status: "completed", ... } - or { status: "failed", error }
      //      if the call fails; never throw for expected failures.
      throw new ProviderNotImplementedError(opts.id, opts.envVarHint);
    },

    async healthCheck(): Promise<boolean> {
      // TODO(real integration): ping the provider's health/status endpoint.
      return false;
    },
  };
}
