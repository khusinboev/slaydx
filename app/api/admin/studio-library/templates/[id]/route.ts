import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { deleteTemplate, updateTemplate } from "@/lib/server/admin-studio-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Partial template fields + `expectedUpdatedAt?` + `reason`; the merged template is validated against the catalog. */
export const PUT = adminHandler("admin/studio-library/templates/update", { permission: "settings.edit", mutation: true, rate: [60, 60] }, async (req, { params }: Ctx, admin) => {
  const id = (await params).id;
  const body = await readJson(req, 32 * 1024);
  return json(await updateTemplate(admin, id, body));
});

/** `{reason, expectedUpdatedAt?}` — removes the template (the audit row keeps its last content). */
export const DELETE = adminHandler("admin/studio-library/templates/delete", { permission: "settings.edit", mutation: true }, async (req, { params }: Ctx, admin) => {
  const id = (await params).id;
  const body = await readJson(req, 4 * 1024);
  return json(await deleteTemplate(admin, id, body));
});
