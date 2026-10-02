import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { createBroadcast, listBroadcasts, parseBroadcastsQuery } from "@/lib/server/admin-broadcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** S13 list: status filter, newest first, keyset paging (plan §6.9). */
export const GET = adminHandler("admin/broadcasts/list", { permission: "broadcasts.view" }, async (req) => {
  return json(await listBroadcasts(parseBroadcastsQuery(new URL(req.url))));
});

/**
 * Creates a draft; nothing is sent (plan §6.9). The body cap is 16 KB, not 8:
 * 3 500 characters of 4-byte emoji are 14 000 bytes and must still be accepted.
 */
export const POST = adminHandler("admin/broadcasts/create", { permission: "broadcasts.send", mutation: true }, async (req, _ctx, admin) => {
  const body = await readJson(req, 16 * 1024);
  return json(await createBroadcast(admin, body), { status: 201 });
});
