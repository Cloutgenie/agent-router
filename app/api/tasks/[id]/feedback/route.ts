import { NextRequest } from "next/server";
import { getHistoryTask, saveTaskToHistory } from "@/lib/history/store";
import { recordProviderFeedback } from "@/lib/history/performanceStore";
import { getAllProviders } from "@/lib/providers/registry";
import { ReviewState } from "@/types";

export const dynamic = "force-dynamic";

const REVIEW_STATES: ReviewState[] = ["unreviewed", "accepted", "rejected", "needs-review"];

interface FeedbackBody {
  companyId?: unknown;
  reviewState?: unknown;
}

/**
 * Manual review state + human feedback into routing (V4 #22-23). Marking a
 * result accepted/rejected updates that record's reviewState and nudges the
 * performance score of every provider that contributed evidence to it.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/tasks/[id]/feedback">) {
  const { id } = await ctx.params;
  const task = await getHistoryTask(id);
  if (!task) return Response.json({ error: "Task not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as FeedbackBody | null;
  const companyId = typeof body?.companyId === "string" ? body.companyId : undefined;
  const reviewState = REVIEW_STATES.includes(body?.reviewState as ReviewState)
    ? (body!.reviewState as ReviewState)
    : undefined;
  if (!companyId || !reviewState) {
    return Response.json({ error: "companyId and a valid reviewState are required" }, { status: 400 });
  }

  const record = task.buyer_results.find((r) => r.id === companyId);
  if (!record) return Response.json({ error: "Record not found on this task" }, { status: 404 });

  record.reviewState = reviewState;

  if (reviewState === "accepted" || reviewState === "rejected") {
    const providers = getAllProviders();
    const outcome = reviewState === "accepted" ? "accepted" : "rejected";
    for (const providerId of record.providersUsed) {
      const provider = providers.find((p) => p.id === providerId);
      if (!provider) continue;
      for (const capability of provider.capabilities) {
        await recordProviderFeedback(providerId, capability, outcome);
      }
    }
  }

  await saveTaskToHistory(task);
  return Response.json({ record });
}
