import { ApiError, json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseReason } from "@/lib/server/admin-accounts";
import { forceFailJob } from "@/lib/server/admin-job-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** IN_PROGRESS → FAILED, lease cleared, refund; the late worker is fenced out (plan §6.5). */
export const POST = adminHandler(
  "admin/generations/fail",
  { permission: "jobs.cancel", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = (await params).id;
    if (!UUID.test(id)) throw new ApiError("Topilmadi", 404, { code: "not_found" });
    const body = await readJson(req, 8 * 1024);
    return json(await forceFailJob(admin, id.toLowerCase(), parseReason(body.reason)!));
  },
);
