import { ApiError, json } from "@/lib/server/api";
import { adminHandler } from "@/lib/server/admin-handler";
import { parseDateRange } from "@/lib/server/admin-list";
import { toolTitle } from "@/lib/server/admin-metrics";
import { ratingSummary } from "@/lib/server/generation-ratings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORK_RATING_DAYS = [7, 30, 90] as const;

/**
 * «Ish baholari» (docs/ratings/GENERATION-RATING.md): work ratings per tool over the last `days`
 * Tashkent days (7 | 30 | 90, default 30) and the newest 20 low ratings with their generation ids.
 * Read-only, permission `bonus.view` — the same as the «Baholar» page and its app-rating API (every role holding it
 * also holds `jobs.view`, which the generation links need); no audit entry.
 */
export const GET = adminHandler("admin/ratings/works", { permission: "bonus.view" }, async (req) => {
  const raw = new URL(req.url).searchParams.get("days") ?? "30";
  const days = Number(raw);
  if (!(WORK_RATING_DAYS as readonly number[]).includes(days)) throw new ApiError("Noto'g'ri parametr: days", 400);
  const range = parseDateRange(null, null, { defaultDays: days, maxDays: 366 });
  const s = await ratingSummary({ from: range.fromTs, to: range.toTsExclusive, lowLimit: 20 });
  return json({
    ...s,
    days,
    tools: s.tools.map((t) => ({ ...t, title: toolTitle(t.toolId) })),
    recentLow: s.recentLow.map((r) => ({ ...r, toolTitle: toolTitle(r.toolId) })),
  });
});
