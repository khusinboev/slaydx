import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { mediaModelsOverview, updateMediaModel } from "@/lib/server/admin-media-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** «Narxlar» → «Media modellari»: per Studio model cost, price at the current markup, margin and the admin's overrides. */
export const GET = adminHandler("admin/pricing/media", { permission: "pricing.view" }, async () => json(await mediaModelsOverview()));

/**
 * `{modelId, enabled, markup, reason, expected?}` — the model's switch and markup override (`markup: null` = the global
 * `media.markup`). Same permission and step-up as every price write; override + audit in one transaction.
 */
export const PUT = adminHandler("admin/pricing/media/update", { permission: "pricing.edit", mutation: true }, async (req, _ctx, admin) => {
  const body = await readJson(req, 8 * 1024);
  return json(await updateMediaModel(admin, body));
});
