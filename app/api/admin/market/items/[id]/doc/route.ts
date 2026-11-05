import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { marketItemDoc, parseItemId } from "@/lib/server/admin-market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The sanitised document for the review drawer's real viewer. The whole body: `market.manage`, like the neutral file. */
export const GET = adminHandler(
  "admin/market/doc",
  { permission: "market.manage", rate: [120, 60] },
  async (_req, { params }: { params: Promise<{ id: string }> }) => json(await marketItemDoc(parseItemId((await params).id))),
);
