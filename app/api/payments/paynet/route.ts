import { requestIdOf } from "@/lib/server/api";
import { withLogContext } from "@/lib/server/log";
import { handlePaynetPost, paynetNotPost } from "@/lib/server/paynet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Paynet (UZPAYNET) provider endpoint — JSON-RPC 2.0 (docs/payments/PAYNET.md). All logic lives in `lib/server/paynet.ts`;
 * answers are HTTP 200 + JSON except 401 (auth) and 403 (IP allow-list). Not wrapped in `handler()`: the request id is
 * attached here so the settle log lines carry it.
 */
export async function POST(req: Request): Promise<Response> {
  const reqId = requestIdOf(req);
  const res = await withLogContext({ reqId }, () => handlePaynetPost(req));
  res.headers.set("x-request-id", reqId);
  return res;
}

const notPost = (req: Request): Response => paynetNotPost(req.method);

export const GET = notPost;
export const PUT = notPost;
export const PATCH = notPost;
export const DELETE = notPost;
export const OPTIONS = notPost;
export const HEAD = notPost;
