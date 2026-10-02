import { adminHandler } from "@/lib/server/admin-handler";
import { parseGenerationId, readGenerationFileAudited } from "@/lib/server/admin-generations";
import { bytesBody } from "@/lib/server/http-bytes";
import { contentDisposition } from "@/lib/server/pdf-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The job's stored file as an attachment (plan §6.5, §8 audited reads):
 * `jobs.input`, one `jobs.file.download` audit row, never cached.
 */
export const GET = adminHandler(
  "admin/generations/file",
  { permission: "jobs.input", rate: [60, 60] },
  async (_req, { params }: { params: Promise<{ id: string }> }, admin) => {
    const id = parseGenerationId((await params).id);
    const file = await readGenerationFileAudited(admin, id);
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
