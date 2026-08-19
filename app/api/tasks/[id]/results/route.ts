import { NextRequest } from "next/server";
import { getHistoryTask } from "@/lib/history/store";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/tasks/[id]/results">) {
  const { id } = await ctx.params;
  const task = await getHistoryTask(id);
  if (!task) return Response.json({ error: "Task not found" }, { status: 404 });

  return Response.json({
    workflow: task.workflow,
    buyer_results: task.buyer_results,
    excluded_results: task.excluded_results,
    final_result: task.final_result,
    evaluation_summary: task.evaluation_summary,
  });
}
