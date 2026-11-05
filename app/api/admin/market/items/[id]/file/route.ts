import { adminHandler } from "@/lib/server/admin-handler";
import { parseItemId, readNeutralFileAudited } from "@/lib/server/admin-market";
import { bytesBody } from "@/lib/server/http-bytes";
import { contentDisposition } from "@/lib/server/pdf-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The neutral file as an attachment: `market.manage`, one `market.file_read` audit row, never cached (plan §3.1). */
export const GET = adminHandler(
  "admin/market/file",
  { permission: "market.manage", rate: [60, 60] },
  async (_req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const file = await readNeutralFileAudited(admin, parseItemId((await params).id));
    return new Response(bytesBody(file.bytes), {
      headers: {
        "Content-Type": file.mime,
        "Content-Length": String(file.bytes.byteLength),
        "Content-Disposition": contentDisposition(file.fileName, "attachment"),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
);
