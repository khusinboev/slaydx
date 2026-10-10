import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseIncludeAdminsParam, parseTrendDays, pricingDetail, requireToolId, resetToolPricing, updateToolPricing } from "@/lib/server/admin-pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ toolId: string }> };

/** One tool: 90-day cost trend (`days` ≤ 90), change history and the price ladder (plan §17.5). `admins=1` adds admin accounts' jobs. */
export const GET = adminHandler("admin/pricing/detail", { permission: "pricing.view" }, async (req, { params }: Ctx) => {
  const toolId = requireToolId((await params).toolId);
  const query = new URL(req.url).searchParams;
  const days = parseTrendDays(query.get("days"));
  return json(await pricingDetail(toolId, days, parseIncludeAdminsParam(query.get("admins"))));
});

/** Sets the adjustment `{percent, roundTo, reason}`; row + history + audit in one transaction. */
export const PUT = adminHandler("admin/pricing/update", { permission: "pricing.edit", mutation: true }, async (req, { params }: Ctx, admin) => {
  const toolId = (await params).toolId;
  const body = await readJson(req, 8 * 1024);
  return json({ item: await updateToolPricing(admin, toolId, body) });
});

/** Back to 100 % `{reason}`; 409 `state` when the tool is already at the base price. */
export const DELETE = adminHandler("admin/pricing/reset", { permission: "pricing.edit", mutation: true }, async (req, { params }: Ctx, admin) => {
  const toolId = (await params).toolId;
  const body = await readJson(req, 8 * 1024);
  return json({ item: await resetToolPricing(admin, toolId, body) });
});
