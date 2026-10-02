import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { listErrors } from "@/lib/server/admin-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** S16: persisted error log (keyset by last seen; `stack` is not part of the list). */
export const GET = adminHandler("admin/errors/list", { permission: "errors.view" }, async (req) => {
  return json(await listErrors(new URL(req.url)));
});
