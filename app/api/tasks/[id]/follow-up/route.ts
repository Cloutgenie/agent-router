import { NextRequest } from "next/server";
import { getHistoryTask } from "@/lib/history/store";
import { buildFollowUpPlan, runTaskPipeline } from "@/lib/pipeline";
import { FollowUpAction } from "@/types";

export const dynamic = "force-dynamic";

const FOLLOW_UP_ACTIONS: FollowUpAction[] = [
  "find-decision-makers",
  "enrich-contacts",
  "verify-emails",
  "deeper-research",
];

interface FollowUpBody {
  action?: unknown;
  companyIds?: unknown;
}

/**
 * Task continuation (V3 #12, V4 #24): spins up a new, linked task scoped to
 * the selected companies from a prior result. This is what makes the
 * product "an execution network" rather than one request - the follow-up
 * runs through the exact same Planner -> Router -> Providers -> Evaluator ->
 * Composer pipeline, just seeded with the parent's discovered companies.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/tasks/[id]/follow-up">) {
  const { id } = await ctx.params;
  const parent = await getHistoryTask(id);
  if (!parent) return Response.json({ error: "Parent task not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as FollowUpBody | null;
  const action = FOLLOW_UP_ACTIONS.includes(body?.action as FollowUpAction)
    ? (body!.action as FollowUpAction)
    : undefined;
  if (!action) return Response.json({ error: "A valid action is required" }, { status: 400 });

  const companyIds = Array.isArray(body?.companyIds) ? (body!.companyIds as string[]) : [];
  const selected = parent.buyer_results.filter((r) => companyIds.length === 0 || companyIds.includes(r.id));
  if (selected.length === 0) {
    return Response.json({ error: "No matching companies found on the parent task" }, { status: 400 });
  }

  const seededPlan = buildFollowUpPlan(selected, action);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runTaskPipeline({
          rawTask: seededPlan.goal,
          constraints: {
            allow_parallel: true,
            result_count: selected.length,
            quality_preference: parent.quality_preference,
          },
          parentTaskId: parent.id,
          rootTaskId: parent.rootTaskId,
          followUpAction: action,
          seededPlan,
          parentRecords: selected,
        })) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message })}\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
