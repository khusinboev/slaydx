import { json, readJson } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { createPrompt } from "@/lib/server/admin-studio-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `{category, title, prompt, sort?, enabled?, previewId?, reason}` — a new library prompt (audited). */
export const POST = adminHandler("admin/studio-library/prompts/create", { permission: "settings.edit", mutation: true, rate: [60, 60] }, async (req, _ctx, admin) => {
  const body = await readJson(req, 16 * 1024);
  return json(await createPrompt(admin, body));
});
