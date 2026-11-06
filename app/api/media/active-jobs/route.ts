import { handler, json, requireUser } from "@/lib/server/api";
import { listActiveStudioJobs } from "@/lib/server/media/active-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/media/active-jobs` (docs/studio/P11-SPEC.md «C. Reliability»): the signed-in user's own unfinished Studio
 * jobs, newest first. The page follows each one again after a refresh.
 */
export const GET = handler("media/active-jobs", async (req) => {
  const { user } = await requireUser(req);
  return json({ items: await listActiveStudioJobs(String(user.id)) });
});
