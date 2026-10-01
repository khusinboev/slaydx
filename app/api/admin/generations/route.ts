import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { listAdminGenerations, parseGenerationsQuery } from "@/lib/server/admin-generations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** S6 jobs list: filters, whitelisted sorts, keyset paging (plan §6.5). */
export const GET = adminHandler("admin/generations/list", { permission: "jobs.view" }, async (req) => {
  const params = parseGenerationsQuery(new URL(req.url));
  return json(await listAdminGenerations(params));
});
