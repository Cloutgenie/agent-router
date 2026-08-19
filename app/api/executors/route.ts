import { getRuntimeConfig } from "@/lib/config";
import { getAllProviders, countConnectedLiveProviders, toProviderSummary } from "@/lib/providers/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getRuntimeConfig();
  const providers = getAllProviders(config).map(toProviderSummary);
  const demoProviders = providers.filter((p) => p.protocol === "mock").length;
  const liveConnected = countConnectedLiveProviders(config);

  return Response.json({
    mode: config.mode,
    providers,
    demo_providers_available: demoProviders,
    live_providers_connected: liveConnected,
  });
}
