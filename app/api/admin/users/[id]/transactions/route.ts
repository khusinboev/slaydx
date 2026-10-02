import { ApiError, json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseBigintId } from "@/lib/server/admin-accounts";
import { listUserTransactions } from "@/lib/server/admin-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The user's ledger ("Hisob" tab, plan §6.4): `kind` filter, keyset paging; users.view (support lacks finance.view). */
export const GET = adminHandler(
  "admin/users/transactions",
  { permission: "users.view" },
  async (req, { params }: { params: Promise<{ id: string }> }) => {
    const id = parseBigintId((await params).id);
    if (!id) throw new ApiError("Topilmadi", 404, { code: "not_found" });
    return json(await listUserTransactions(id, new URL(req.url)));
  },
);
