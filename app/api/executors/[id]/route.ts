import { NextRequest } from "next/server";
import { getProviderById, toProviderSummary } from "@/lib/providers/registry";
import { getProviderOverride, resetProviderOverride, setProviderOverride } from "@/lib/providers/overrideStore";
import { ProviderOverride } from "@/types";

export const dynamic = "force-dynamic";

interface OverridePatchBody {
  enabled?: unknown;
  degraded?: unknown;
  maxCostPerTask?: unknown;
  timeoutMs?: unknown;
  maxRetries?: unknown;
  maxConcurrentRuns?: unknown;
  maxRunsPerTask?: unknown;
  reason?: unknown;
}

function optionalNumber(value: unknown, min: number, max: number): number | undefined | null {
  if (value === null) return null; // explicit clear
  if (value === undefined) return undefined; // untouched
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

/**
 * Parses and clamps every kill-switch field (spec #33) so a bad request
 * body can never persist a runaway concurrency limit or a zero-second
 * timeout - the caller gets sane defaults instead of a broken provider.
 */
function parsePatch(body: OverridePatchBody | null): Partial<Omit<ProviderOverride, "updatedAt" | "updatedBy">> {
  const patch: Partial<Omit<ProviderOverride, "updatedAt" | "updatedBy">> = {};
  if (typeof body?.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body?.degraded === "boolean") patch.degraded = body.degraded;

  const maxCost = optionalNumber(body?.maxCostPerTask, 0, 1000);
  if (maxCost !== undefined) patch.maxCostPerTask = maxCost ?? undefined;

  const timeoutMs = optionalNumber(body?.timeoutMs, 500, 120_000);
  if (timeoutMs !== undefined) patch.timeoutMs = timeoutMs ?? undefined;

  const maxRetries = optionalNumber(body?.maxRetries, 1, 5);
  if (maxRetries !== undefined) patch.maxRetries = maxRetries ?? undefined;

  const maxConcurrentRuns = optionalNumber(body?.maxConcurrentRuns, 1, 50);
  if (maxConcurrentRuns !== undefined) patch.maxConcurrentRuns = maxConcurrentRuns ?? undefined;

  const maxRunsPerTask = optionalNumber(body?.maxRunsPerTask, 1, 50);
  if (maxRunsPerTask !== undefined) patch.maxRunsPerTask = maxRunsPerTask ?? undefined;

  if (typeof body?.reason === "string") patch.reason = body.reason.slice(0, 300);

  return patch;
}

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/executors/[id]">) {
  const { id } = await ctx.params;
  const provider = getProviderById(id);
  if (!provider) return Response.json({ error: "Provider not found" }, { status: 404 });

  const override = await getProviderOverride(id);
  return Response.json({ provider: toProviderSummary(provider), override: override ?? null });
}

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/executors/[id]">) {
  const { id } = await ctx.params;
  const provider = getProviderById(id);
  if (!provider) return Response.json({ error: "Provider not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as OverridePatchBody | null;
  const patch = parsePatch(body);
  const override = await setProviderOverride(id, patch, "manual");
  return Response.json({ provider: toProviderSummary(provider), override });
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/executors/[id]">) {
  const { id } = await ctx.params;
  const provider = getProviderById(id);
  if (!provider) return Response.json({ error: "Provider not found" }, { status: 404 });

  await resetProviderOverride(id);
  return Response.json({ provider: toProviderSummary(provider), override: null });
}
