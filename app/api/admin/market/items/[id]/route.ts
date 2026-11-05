import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { idempotentJson, requireIdempotencyKey } from "@/lib/server/admin-idempotency";
import { editMarketItem, marketItemDetail, parseItemId } from "@/lib/server/admin-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** One item with its PII flags, reports and file info; the author only with `users.pii` (plan §1.3, §6). */
export const GET = adminHandler("admin/market/detail", { permission: "market.view" }, async (_req, { params }: Ctx, admin) => {
  return json(await marketItemDetail(parseItemId((await params).id), admin));
});

/** Edits the listing (title, summary, subject, level, max copies); raising a sold-out cap reopens the item (plan §9). */
export const PATCH = adminHandler("admin/market/edit", { permission: "market.manage", mutation: true }, async (req, { params }: Ctx, admin) => {
  const id = parseItemId((await params).id);
  const key = requireIdempotencyKey(req);
  return idempotentJson(await editMarketItem(admin, id, await readJson(req, 16 * 1024), key), 200);
});
