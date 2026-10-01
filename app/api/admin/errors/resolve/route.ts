import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { resolveErrors } from "@/lib/server/admin-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bulk resolve (at most 100 ids, one audit row). */
export const POST = adminHandler(
  "admin/errors/resolve-bulk",
  { permission: "errors.resolve", mutation: true },
  async (req, _ctx, admin) => {
    const body = await readJson(req, 8 * 1024);
    return json(await resolveErrors(admin, body.ids, body.reason));
  },
);
