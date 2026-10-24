import { handler, json, requireUser } from "@/lib/server/api";
import { overview } from "@/lib/server/paid-tests";
import { NO_STORE } from "@/lib/server/http-bytes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/tests` -- everything the «Test ishlash» page shows before an attempt: the kill switch, the price (the
 * server's only price), the subjects, the open attempt and the history. Charges nothing, reveals no answers.
 */
export const GET = handler("tests/get", async (req) => {
  const { user } = await requireUser(req);
  return json(await overview(user.id), { headers: { "Cache-Control": NO_STORE } });
});
