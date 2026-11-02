import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { uploadPreview } from "@/lib/server/admin-studio-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** `multipart/form-data`: `file` (PNG / JPEG ≤ 512 KB, ≤ 1600 px) + `reason` → `{id, url}` (audited). */
export const POST = adminHandler("admin/studio-library/previews", { permission: "settings.edit", mutation: true, rate: [30, 60] }, async (req, _ctx, admin) => json(await uploadPreview(admin, req)));
