import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { setAdminProviderEnabled } from "@/lib/server/admin-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Switches a provider on or off: `{enabled, reason}`. Off means unavailable even when an env key exists. */
export const PUT = adminHandler(
  "admin/providers/enabled",
  { permission: "settings.edit", mutation: true },
  async (req, { params }: Ctx, admin) => {
    const { id } = await params;
    const body = await readJson(req, 8 * 1024);
    return json({ item: await setAdminProviderEnabled(admin, id, body) });
  },
);
