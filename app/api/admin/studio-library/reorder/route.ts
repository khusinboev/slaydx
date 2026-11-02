import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { reorderLibrary } from "@/lib/server/admin-studio-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `{kind: "prompts" | "templates", ids, reason}` — the new order (sort 10, 20, …), one audit row. */
export const POST = adminHandler("admin/studio-library/reorder", { permission: "settings.edit", mutation: true, rate: [60, 60] }, async (req, _ctx, admin) => {
  const body = await readJson(req, 16 * 1024);
  return json(await reorderLibrary(admin, body));
});
