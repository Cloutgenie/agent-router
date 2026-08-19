import { NextRequest } from "next/server";
import { parseConstraints } from "@/app/api/tasks/route";
import { capabilityClassifier } from "@/lib/capabilities/classifier";
import { getRuntimeConfig } from "@/lib/config";
import { estimateExecutionPriceRange } from "@/lib/billing/pricing";
import { getBillingStatusSummary } from "@/lib/billing/status";
import { detectWorkflow, buildExecutionPlan } from "@/lib/planner/taskPlanner";
import { estimatePlanCostRange } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

/**
 * Pre-execution cost preview (spec #25) - runs the same planning steps
 * `runTaskPipeline` does (classify -> detect workflow -> build plan -> cost
 * range) and stops there. No provider ever runs, nothing is billed - this
 * is read-only, side-effect-free estimation, safe to call on every keystroke
 * debounce from the Execute form.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { raw_task?: unknown; budget?: unknown } | null;
  const rawTask = typeof body?.raw_task === "string" ? body.raw_task.trim() : "";
  if (!rawTask) {
    return Response.json({ error: "raw_task is required" }, { status: 400 });
  }

  const constraints = parseConstraints(body as Parameters<typeof parseConstraints>[0]);
  const config = getRuntimeConfig();
  const capabilities = capabilityClassifier.classify(rawTask);
  const workflow = detectWorkflow(rawTask, capabilities);
  const plan = buildExecutionPlan(rawTask, capabilities, workflow);

  if (config.mode !== "live") {
    return Response.json({
      mode: config.mode,
      capabilities,
      stepCount: plan.steps.length,
      billed: false,
      note: "Demo Mode is free - no billing account or execution price applies.",
    });
  }

  const costRange = estimatePlanCostRange(plan, config.mode, config);
  const priceEstimate = estimateExecutionPriceRange(costRange.lowDollars, costRange.highDollars);
  const status = await getBillingStatusSummary();

  return Response.json({
    mode: config.mode,
    capabilities,
    stepCount: plan.steps.length,
    billed: true,
    estimatedCustomerPriceCents: priceEstimate,
    taskBudget: constraints.budget,
    remainingExecutionCents: status.remainingExecutionCents,
  });
}
