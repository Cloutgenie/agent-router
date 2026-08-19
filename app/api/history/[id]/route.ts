import { NextRequest } from "next/server";
import { getHistoryTask } from "@/lib/history/store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/history/[id]">
) {
  const { id } = await ctx.params;
  const task = await getHistoryTask(id);

  if (!task) {
    return Response.json({ error: "Task not found" }, { status: 404 });
  }

  return Response.json({ task });
}
