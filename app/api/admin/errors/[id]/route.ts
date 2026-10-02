import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { getError } from "@/lib/server/admin-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One error with its stack. */
export const GET = adminHandler(
  "admin/errors/detail",
  { permission: "errors.view" },
  async (_req, { params }: { params: Promise<{ id: string }> }) => {
    return json({ error: await getError((await params).id) });
  },
);
