import { handler } from "@/lib/server/api";
import { ensureMigrated } from "@/lib/server/db";
import { DownloadError, downloadErrorResponse, isDownloadError } from "@/lib/server/downloads/errors";
import { peekWith, produceWith, recordDownload } from "@/lib/server/downloads/produce";
import { verifyDownloadToken, type DownloadClaims } from "@/lib/server/downloads/token";
import { bytesBody } from "@/lib/server/http-bytes";
import { contentDisposition } from "@/lib/server/pdf-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Usually stored/cached bytes; a derived file evicted from the cache is converted again (≤ 50 s). */
export const maxDuration = 60;

type Ctx = { params: Promise<{ token: string }> };

/**
 * `GET|HEAD /api/dl/{token}` — the signed download URL (docs/mobile/PLAN.md §4.2).
 *
 * No cookie: the Telegram client (Android DownloadManager, iOS URLSession,
 * Telegram Web) downloads without our session, so the HMAC token is the
 * authorization (`lib/server/downloads/token.ts`). Ownership is still checked
 * in SQL with the token's user, and the bytes must be the token's
 * `file_version` — an edited document answers 410 («qayta yuklab oling»).
 *
 * HEAD is explicit (Next would otherwise run GET for it): iOS asks for the
 * size first, so HEAD answers from the stored size / derived cache, never
 * converts and never counts a download. Multi-use within the 15 min TTL.
 *
 * Headers that `next.config.ts` would otherwise overwrite (Referrer-Policy,
 * Cross-Origin-Resource-Policy, CSP) are set there for `/api/dl/:token`.
 */

/** Telegram Web fetches the file cross-origin (core.telegram.org/bots/webapps#downloadfile). */
const TELEGRAM_WEB_ORIGIN = "https://web.telegram.org";

const BASE_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": TELEGRAM_WEB_ORIGIN,
  "Access-Control-Expose-Headers": "Content-Disposition, Content-Length",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  Vary: "Origin",
};

function claimsOf(token: string): DownloadClaims {
  const v = verifyDownloadToken(token);
  if (v.ok) return v.claims;
  if (v.reason === "expired") throw new DownloadError("expired");
  // Malformed or forged: nothing to say about it.
  throw new DownloadError("not_found");
}

/** The generation is gone or no longer the token user's: the link is dead, not "never existed". */
function goneIfMissing(e: unknown): unknown {
  if (isDownloadError(e) && (e.code === "not_found" || e.code === "not_ready" || e.code === "unsupported")) {
    return new DownloadError("expired", { message: "Fayl o'chirilgan yoki endi mavjud emas" });
  }
  return e;
}

function fileHeaders(fileName: string, mime: string, size: number | null): Record<string, string> {
  return {
    ...BASE_HEADERS,
    "Content-Type": mime,
    "Content-Disposition": contentDisposition(fileName, "attachment"),
    ...(size !== null ? { "Content-Length": String(size) } : {}),
  };
}

async function serve(req: Request, ctx: Ctx, head: boolean): Promise<Response> {
  await ensureMigrated();
  const { token } = await ctx.params;
  try {
    const c = claimsOf(token);
    const mode = { ensureFresh: false, expectVersion: c.v };
    if (head) {
      const p = await peekWith(c.g, c.u, c.f, mode).catch((e: unknown) => {
        throw goneIfMissing(e);
      });
      return new Response(null, { status: 200, headers: fileHeaders(p.fileName, p.mime, p.size) });
    }
    const out = await produceWith(c.g, c.u, c.f, mode, undefined, req.signal).catch((e: unknown) => {
      throw goneIfMissing(e);
    });
    await recordDownload(c.g).catch(() => {});
    return new Response(bytesBody(out.bytes), { status: 200, headers: fileHeaders(out.fileName, out.mime, out.bytes.byteLength) });
  } catch (e) {
    // The client went away mid-wait: nobody reads the answer, and it is not a server error.
    if (req.signal.aborted && !isDownloadError(e)) return new Response(null, { status: 499, headers: BASE_HEADERS });
    const res = downloadErrorResponse(e, BASE_HEADERS);
    // HEAD carries no body.
    return head ? new Response(null, { status: res.status, headers: res.headers }) : res;
  }
}

export const GET = handler("dl", (req: Request, ctx: Ctx) => serve(req, ctx, false));
export const HEAD = handler("dl/head", (req: Request, ctx: Ctx) => serve(req, ctx, true));

/** CORS preflight (a plain GET from Telegram Web needs none, but a client adding a header would). */
export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      ...BASE_HEADERS,
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Max-Age": "600",
    },
  });
}
