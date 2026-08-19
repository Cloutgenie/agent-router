import { computeRoutingAdvantage } from "@/lib/history/routingAdvantage";
import { listExperiments } from "@/lib/history/store";

export const dynamic = "force-dynamic";

/** Routing experiments (V4 #13) - every task run with "Compare routing strategy" on. */
export async function GET() {
  const experiments = await listExperiments();
  const routingAdvantage = computeRoutingAdvantage(experiments);
  return Response.json({ experiments, routing_advantage: routingAdvantage });
}
