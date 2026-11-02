import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { deletePrompt, updatePrompt } from "@/lib/server/admin-studio-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Partial `{category?, title?, prompt?, sort?, enabled?, previewId?, expectedUpdatedAt?, reason}`; unchanged → 409 `state`. */
export const PUT = adminHandler("admin/studio-library/prompts/update", { permission: "settings.edit", mutation: true, rate: [60, 60] }, async (req, { params }: Ctx, admin) => {
  const id = (await params).id;
  const body = await readJson(req, 16 * 1024);
  return json(await updatePrompt(admin, id, body));
});

/** `{reason, expectedUpdatedAt?}` — removes the prompt (the audit row keeps its last content). */
export const DELETE = adminHandler("admin/studio-library/prompts/delete", { permission: "settings.edit", mutation: true }, async (req, { params }: Ctx, admin) => {
  const id = (await params).id;
  const body = await readJson(req, 4 * 1024);
  return json(await deletePrompt(admin, id, body));
});
