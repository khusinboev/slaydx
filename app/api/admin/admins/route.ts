import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { createAdmin, listAdmins } from "@/lib/server/admin-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminHandler("admin/admins/list", { permission: "admins.view" }, async () => {
  return json({ items: await listAdmins() });
});

/** Creates a pending admin account and a one-time enrollment link (shown once). */
export const POST = adminHandler(
  "admin/admins/create",
  { permission: "admins.manage", mutation: true },
  async (req, _ctx, admin) => {
    const body = await readJson(req, 8_000);
    const out = await createAdmin(admin, {
      userId: body.userId,
      telegramId: body.telegramId,
      role: body.role,
      reason: body.reason,
      sendViaTelegram: body.sendViaTelegram,
    });
    return json(out, { status: 201 });
  },
);
