import { json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { testAdminProvider } from "@/lib/server/admin-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** «Tekshirish»: one cheap live call (10 s) with the key in use. Answers `{ok, message}`, the message never holds the key. */
export const POST = adminHandler(
  "admin/providers/test",
  { permission: "settings.edit", mutation: true, rate: [10, 60] },
  async (_req, { params }: Ctx, admin) => {
    const { id } = await params;
    return json(await testAdminProvider(admin, id));
  },
);
