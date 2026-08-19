import { NextRequest } from "next/server";
import { getPerformanceMetricsForProvider } from "@/lib/history/performanceStore";
import { getProviderById, toProviderSummary } from "@/lib/providers/registry";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/executors/[id]/performance">) {
  const { id } = await ctx.params;
  const provider = getProviderById(id);
  if (!provider) return Response.json({ error: "Provider not found" }, { status: 404 });

  const metrics = await getPerformanceMetricsForProvider(id);
  return Response.json({ provider: toProviderSummary(provider), metrics });
}
