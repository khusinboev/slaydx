import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { marketItemBuyers, parseItemId } from "@/lib/server/admin-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Buyers of an item: masked name, date, downloads, refund and abuse marks (plan §3.1, §6). */
export const GET = adminHandler(
  "admin/market/buyers",
  { permission: "market.view" },
  async (_req, { params }: { params: Promise<{ id: string }> }) => json(await marketItemBuyers(parseItemId((await params).id))),
);
