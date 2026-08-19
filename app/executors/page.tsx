import { ExecutionPolicyCard } from "@/components/ExecutionPolicyCard";
import { ModeBadge } from "@/components/ModeBadge";
import { ProvidersTable } from "@/components/ProvidersTable";
import { getRuntimeConfig } from "@/lib/config";
import { getAllPerformanceMetrics } from "@/lib/history/performanceStore";
import { allExecutionPolicies } from "@/lib/policy/executionPolicy";
import { checkAllProviderHealth } from "@/lib/providers/health";
import { listProviderOverrides } from "@/lib/providers/overrideStore";
import { getAllProviders, toProviderSummary } from "@/lib/providers/registry";
import { ProviderPerformanceMetrics } from "@/types";

export const dynamic = "force-dynamic";

export default async function ProvidersPage() {
  const config = getRuntimeConfig();
  const providers = getAllProviders(config).map(toProviderSummary);
  const [health, allMetrics, overrides] = await Promise.all([
    checkAllProviderHealth(config),
    getAllPerformanceMetrics(),
    listProviderOverrides(),
  ]);

  const metricsByProvider: Record<string, ProviderPerformanceMetrics[]> = {};
  for (const m of allMetrics) {
    metricsByProvider[m.provider_id] = [...(metricsByProvider[m.provider_id] ?? []), m];
  }

  const demoCount = providers.filter((p) => p.protocol === "mock").length;
  const liveCount = providers.filter((p) => p.protocol !== "mock" && p.configured).length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-6">
        <ModeBadge />
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Provider market</h1>
        <p className="mt-1 text-sm text-muted">
          {demoCount} demo provider{demoCount === 1 ? "" : "s"} always available, {liveCount} live provider
          {liveCount === 1 ? "" : "s"} connected. Health is checked before every routing decision - the router never
          selects a provider currently reporting unavailable or missing credentials.
        </p>
      </div>

      <div className="card mb-6 p-4 sm:p-5">
        <ProvidersTable providers={providers} health={health} metricsByProvider={metricsByProvider} overridesByProvider={overrides} />
      </div>

      <ExecutionPolicyCard policies={allExecutionPolicies()} />
    </div>
  );
}
