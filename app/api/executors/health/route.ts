import { getRuntimeConfig } from "@/lib/config";
import { checkAllProviderHealth } from "@/lib/providers/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getRuntimeConfig();
  const health = await checkAllProviderHealth(config);
  return Response.json({ mode: config.mode, health });
}
