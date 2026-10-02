import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { resolveError } from "@/lib/server/admin-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Marks one error resolved (reason optional). Already resolved: no-op, still 200. */
export const POST = adminHandler(
  "admin/errors/resolve",
  { permission: "errors.resolve", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const body = await readJson(req, 8 * 1024);
    return json({ error: await resolveError(admin, (await params).id, body.reason) });
  },
);
