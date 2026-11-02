import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { deletePreview } from "@/lib/server/admin-studio-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** `{reason}` — removes a preview picture no prompt / template uses (409 `in_use` otherwise); audited. */
export const DELETE = adminHandler("admin/studio-library/previews/delete", { permission: "settings.edit", mutation: true }, async (req, { params }: Ctx, admin) => {
  const id = (await params).id;
  const body = await readJson(req, 4 * 1024);
  return json(await deletePreview(admin, id, body));
});
