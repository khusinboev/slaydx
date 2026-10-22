import { handler, limit } from "@/lib/server/api";
import { IP_LIMITS } from "@/lib/server/ip-limits";
import { clientIp } from "@/lib/server/ratelimit";
import { contentDisposition } from "@/lib/server/pdf-serve";
import { bytesBody, NO_STORE, noStoreOnError } from "@/lib/server/http-bytes";
import { currentOfertaPdf } from "@/lib/server/oferta-pdf";
import { busyResponse, SofficeBusyError } from "@/lib/server/soffice-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `GET /api/oferta/pdf` -- the public offer as a PDF (same data as the `/oferta` page). Public: no session.
 * Cached on disk by (text, requisites); gate busy -> 503 + Retry-After, no LibreOffice or a failed
 * conversion -> 503 `pdf_unavailable` (the bot then sends the web link instead).
 */
export const GET = noStoreOnError(
  handler("oferta/pdf", async (req) => {
    await limit(`oferta-pdf:${clientIp(req)}`, IP_LIMITS.ofertaPdfPerIp.count, IP_LIMITS.ofertaPdfPerIp.windowSec);
    let pdf;
    try {
      pdf = await currentOfertaPdf();
    } catch (e) {
      if (e instanceof SofficeBusyError) return busyResponse(e);
      throw e;
    }
    if (!pdf) {
      return Response.json(
        { error: "PDF hozir tayyor emas — saytdagi /oferta sahifasidan o'qing", code: "pdf_unavailable" },
        { status: 503, headers: { "Cache-Control": NO_STORE } },
      );
    }
    return new Response(bytesBody(pdf.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.bytes.byteLength),
        "Content-Disposition": contentDisposition(`SlaydX-oferta-v${pdf.version}.pdf`, "inline"),
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }),
);
