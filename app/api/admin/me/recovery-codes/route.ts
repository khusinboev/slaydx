import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { regenerateRecoveryCodes, requireAdminCrypto } from "@/lib/server/admin-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A new set of 10 recovery codes (shown once; the old set stops working). Needs a fresh TOTP. */
export const POST = adminHandler(
  "admin/me/recovery-codes",
  { permission: "self", mutation: true, rate: [10, 60] },
  async (req, _ctx, admin) => {
    requireAdminCrypto();
    const body = await readJson(req, 2_000);
    return json(await regenerateRecoveryCodes(admin, body.code));
  },
);
