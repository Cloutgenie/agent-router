import { NextRequest } from "next/server";
import { runTaskPipeline } from "@/lib/pipeline";
import { QualityPreference, TaskConstraints } from "@/types";

export const dynamic = "force-dynamic";

const QUALITY_PREFERENCES: QualityPreference[] = ["standard", "high", "best"];

interface TaskRequestBody {
  raw_task?: unknown;
  budget?: unknown;
  deadline_minutes?: unknown;
  quality_preference?: unknown;
  max_agents?: unknown;
  allow_parallel?: unknown;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as TaskRequestBody | null;
  const rawTask = typeof body?.raw_task === "string" ? body.raw_task.trim() : "";

  if (!rawTask) {
    return Response.json({ error: "raw_task is required" }, { status: 400 });
  }

  const constraints: TaskConstraints = {
    budget: typeof body?.budget === "number" && body.budget > 0 ? body.budget : undefined,
    deadline_minutes:
      typeof body?.deadline_minutes === "number" && body.deadline_minutes > 0
        ? body.deadline_minutes
        : undefined,
    quality_preference: QUALITY_PREFERENCES.includes(body?.quality_preference as QualityPreference)
      ? (body!.quality_preference as QualityPreference)
      : "standard",
    max_agents:
      typeof body?.max_agents === "number" && body.max_agents > 0
        ? Math.floor(body.max_agents)
        : undefined,
    allow_parallel: typeof body?.allow_parallel === "boolean" ? body.allow_parallel : true,
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runTaskPipeline(rawTask, constraints)) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ type: "error", message })}\n`)
        );
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
