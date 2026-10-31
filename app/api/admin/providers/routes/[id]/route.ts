import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { resetAdminRoute, setAdminRoute } from "@/lib/server/admin-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Stores the admin's choice for a routing slot (`{entries, reason}`): which provider and model serve a purpose, in priority order. */
export const PUT = adminHandler(
  "admin/providers/routes/set",
  { permission: "settings.edit", mutation: true },
  async (req, { params }: Ctx, admin) => {
    const { id } = await params;
    const body = await readJson(req, 16 * 1024);
    return json({ route: await setAdminRoute(admin, id, body) });
  },
);

/** Removes the admin's choice (`{reason}`): the slot goes back to the server's environment value or the built-in default. */
export const DELETE = adminHandler(
  "admin/providers/routes/reset",
  { permission: "settings.edit", mutation: true },
  async (req, { params }: Ctx, admin) => {
    const { id } = await params;
    const body = await readJson(req, 8 * 1024);
    return json({ route: await resetAdminRoute(admin, id, body) });
  },
);
