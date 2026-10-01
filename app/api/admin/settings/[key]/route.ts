import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { requireSettingKey, resetAdminSetting, updateAdminSetting } from "@/lib/server/admin-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

/** Overrides a setting: `{value, reason}`; the catalog validates the value (plan §6.10). */
export const PUT = adminHandler(
  "admin/settings/update",
  { permission: "settings.edit", mutation: true },
  async (req, { params }: Ctx, admin) => {
    const key = requireSettingKey((await params).key);
    const body = await readJson(req, 8 * 1024);
    return json({ item: await updateAdminSetting(admin, key, body) });
  },
);

/** Removes the override (back to env/default): `{reason}`. 409 `state` when there is none. */
export const DELETE = adminHandler(
  "admin/settings/reset",
  { permission: "settings.edit", mutation: true },
  async (req, { params }: Ctx, admin) => {
    const key = requireSettingKey((await params).key);
    const body = await readJson(req, 8 * 1024);
    return json({ item: await resetAdminSetting(admin, key, body) });
  },
);
