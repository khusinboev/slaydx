import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { deleteAdminProviderKey, setAdminProviderKey } from "@/lib/server/admin-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Stores or replaces the API key: `{key, reason}`. Step-up applies; the key is sealed and never echoed. */
export const PUT = adminHandler(
  "admin/providers/key-set",
  { permission: "settings.edit", mutation: true },
  async (req, { params }: Ctx, admin) => {
    const { id } = await params;
    const body = await readJson(req, 4 * 1024);
    return json({ item: await setAdminProviderKey(admin, id, body) });
  },
);

/** Removes the stored key (the env var applies again): `{reason}`. 409 `state` when none is stored. */
export const DELETE = adminHandler(
  "admin/providers/key-delete",
  { permission: "settings.edit", mutation: true },
  async (req, { params }: Ctx, admin) => {
    const { id } = await params;
    const body = await readJson(req, 8 * 1024);
    return json({ item: await deleteAdminProviderKey(admin, id, body) });
  },
);
