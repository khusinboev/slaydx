import { ApiError, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseBigintId } from "@/lib/server/admin-accounts";
import { idempotentJson, requireIdempotencyKey } from "@/lib/server/admin-idempotency";
import { adjustWallet, parseWalletAdjustBody } from "@/lib/server/admin-wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Wallet adjustment (plan §6.4): `Idempotency-Key` required; 201 with the
 * ledger row id and the user's wallets; a replay returns the original body.
 */
export const POST = adminHandler(
  "admin/users/wallet-adjust",
  { permission: "users.wallet", mutation: true },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseBigintId((await params).id);
    if (!id) throw new ApiError("Topilmadi", 404, { code: "not_found" });
    const key = requireIdempotencyKey(req);
    const input = parseWalletAdjustBody(await readJson(req, 8 * 1024));
    return idempotentJson(await adjustWallet(admin, id, input, key), 201);
  },
);
