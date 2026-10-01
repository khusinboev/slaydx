import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { aiProviders } from "@/lib/server/admin-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Provider key presence (booleans only), per-process breakers and limiters, 24 h usage (plan §6.7). */
export const GET = adminHandler("admin/ai/providers", { permission: "ai.view" }, async () => {
  return json(await aiProviders());
});
