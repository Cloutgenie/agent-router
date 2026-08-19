import { NextRequest } from "next/server";
import { runTaskPipeline } from "@/lib/pipeline";
import { QualityPreference, RoutingPreference, TaskConstraints } from "@/types";

export const dynamic = "force-dynamic";

const QUALITY_PREFERENCES: QualityPreference[] = ["standard", "high", "best"];
const ROUTING_PREFERENCES: RoutingPreference[] = ["balanced", "best-quality", "lowest-cost", "fastest"];

interface TaskRequestBody {
  raw_task?: unknown;
  budget?: unknown;
  deadline_minutes?: unknown;
  quality_preference?: unknown;
  routing_preference?: unknown;
  allow_parallel?: unknown;
  result_count?: unknown;
  compare_strategies?: unknown;
}

export function parseConstraints(body: TaskRequestBody | null): TaskConstraints {
  return {
    budget: typeof body?.budget === "number" && body.budget > 0 ? body.budget : undefined,
    deadline_minutes:
      typeof body?.deadline_minutes === "number" && body.deadline_minutes > 0 ? body.deadline_minutes : undefined,
    quality_preference: QUALITY_PREFERENCES.includes(body?.quality_preference as QualityPreference)
      ? (body!.quality_preference as QualityPreference)
      : "standard",
    routing_preference: ROUTING_PREFERENCES.includes(body?.routing_preference as RoutingPreference)
      ? (body!.routing_preference as RoutingPreference)
      : "balanced",
    allow_parallel: typeof body?.allow_parallel === "boolean" ? body.allow_parallel : true,
    result_count:
      typeof body?.result_count === "number" && body.result_count > 0
        ? Math.min(50, Math.floor(body.result_count))
        : 15,
    compare_strategies: typeof body?.compare_strategies === "boolean" ? body.compare_strategies : false,
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as TaskRequestBody | null;
  const rawTask = typeof body?.raw_task === "string" ? body.raw_task.trim() : "";

  if (!rawTask) {
    return Response.json({ error: "raw_task is required" }, { status: 400 });
  }

  const constraints = parseConstraints(body);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runTaskPipeline({ rawTask, constraints })) {
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
