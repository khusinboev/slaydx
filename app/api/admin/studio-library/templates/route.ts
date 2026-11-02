import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { createTemplate } from "@/lib/server/admin-studio-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `{category, title, modelId, params, skeleton, slots, sort?, enabled?, previewId?, reason}` — validated against the
 * model's catalog ParamSchema (400 `template_invalid` when not), audited.
 */
export const POST = adminHandler("admin/studio-library/templates/create", { permission: "settings.edit", mutation: true, rate: [60, 60] }, async (req, _ctx, admin) => {
  const body = await readJson(req, 32 * 1024);
  return json(await createTemplate(admin, body));
});
