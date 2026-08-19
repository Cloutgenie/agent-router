import { NextRequest } from "next/server";
import { getHistoryTask } from "@/lib/history/store";

export const dynamic = "force-dynamic";

/** Routing transparency (V3 #13) - which providers were considered, why, and who won, per step. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/tasks/[id]/routing">) {
  const { id } = await ctx.params;
  const task = await getHistoryTask(id);
  if (!task) return Response.json({ error: "Task not found" }, { status: 404 });

  return Response.json({
    plan: task.plan,
    budget_outcome: task.budget_outcome,
    comparison: task.comparison,
    trace_id: task.traceId,
  });
}
