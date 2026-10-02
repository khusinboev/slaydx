import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { listAdminUsers } from "@/lib/server/admin-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** S4 users list (plan §6.4): classified `q`, filters, whitelisted sorts, keyset paging; phone always masked. */
export const GET = adminHandler("admin/users/list", { permission: "users.view" }, async (req) => {
  return json(await listAdminUsers(new URL(req.url)));
});
