import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { getAdminGeneration, parseGenerationId, parseReveal } from "@/lib/server/admin-generations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * S7 job detail (plan §6.5). Inputs are masked unless `reveal=1`, which needs
 * `jobs.input` and writes one `jobs.input.view` audit row.
 */
export const GET = adminHandler(
  "admin/generations/detail",
  { permission: "jobs.view" },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseGenerationId((await params).id);
    const reveal = parseReveal(new URL(req.url));
    return json(await getAdminGeneration(admin, id, reveal));
  },
);
