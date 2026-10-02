import { ApiError, json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseBigintId } from "@/lib/server/admin-accounts";
import { messageUser, parseMessageBody } from "@/lib/server/admin-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Direct Telegram message (plan §6.4, T8): `{text}` → `{sent}`; 409 `no_telegram`. */
export const POST = adminHandler(
  "admin/users/message",
  { permission: "users.message", mutation: true, rate: [20, 60] },
  async (req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseBigintId((await params).id);
    if (!id) throw new ApiError("Topilmadi", 404, { code: "not_found" });
    const text = parseMessageBody(await readJson(req, 16 * 1024));
    return json(await messageUser(admin, id, text));
  },
);
