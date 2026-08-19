import { listHistory } from "@/lib/history/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const history = await listHistory();
  return Response.json({ history });
}
