import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { libraryOverview } from "@/lib/server/admin-studio-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** «Studio kutubxonasi» (docs/studio/P2B-SPEC.md): every prompt and template (enabled or not), validity, models. */
export const GET = adminHandler("admin/studio-library", { permission: "settings.view" }, async () => json(await libraryOverview()));
