import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { listLedger } from "@/lib/server/admin-finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** S10 "Hisob kitobi": the global ledger (plan §6.6). */
export const GET = adminHandler("admin/transactions/list", { permission: "finance.view" }, async (req) => {
  return json(await listLedger(new URL(req.url)));
});
