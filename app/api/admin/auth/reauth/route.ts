import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { reauth, requireAdminCrypto } from "@/lib/server/admin-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Step-up: a fresh TOTP opens the 10-minute window for "S" permissions (§3.1). */
export const POST = adminHandler(
  "admin/auth/reauth",
  { permission: "self", mutation: true, rate: [30, 60] },
  async (req, _ctx, admin) => {
    requireAdminCrypto();
    const body = await readJson(req, 2_000);
    return json(await reauth(admin, body.code));
  },
);
