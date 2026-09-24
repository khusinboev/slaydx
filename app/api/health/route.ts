import { NextResponse } from "next/server";
import { queryOne } from "@/lib/server/db";
import { assertRuntimeConfig, env, llmConfigured, paymentsConfigured, runtimeWarnings } from "@/lib/server/env";
import { safeEqual } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sog'liq tekshiruvi — load balancer, Docker healthcheck va deploy uchun.
 *
 * Baza yiqilsa 503 qaytaradi, shunda konteyner qayta ko'tariladi va
 * trafik unga yo'naltirilmaydi.
 *
 * Batafsil ma'lumot (navbat chuqurligi, konfiguratsiya muammolari)
 * faqat `Authorization: Bearer <CRON_SECRET>` bilan beriladi: ilgari
 * u ochiq edi va tashqaridan «TELEGRAM_BOT_TOKEN yo'q» kabi ichki
 * holatni o'qib olish mumkin edi.
 */
function isInternal(req: Request): boolean {
  if (!env.cronSecret) return false;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return Boolean(token) && safeEqual(token, env.cronSecret);
}

/**
 * Navbat/worker chuqur holati — o'z-o'zicha o'qiydigan, faqat SELECT SQL.
 *
 * `lib/server/jobs.ts`ga TEGMAYDI (W2-D2 shu faylni navbat TTL/adolat
 * o'zgarishlari uchun egallagan — shartnoma `audit/designs/w2-contracts.md`).
 * `oldestQueuedAgeSec`/`newestLockedAt` OBS-12'ni yopadi: sof `queued`/`running`
 * soni "sog'lom burst" bilan "worker o'lgan, navbat yig'ilib qolgan"ni farqlay
 * olmaydi — eng eski QUEUED yoshi va IN_PROGRESS'dagi eng yangi `locked_at`
 * (worker heartbeat'i) shuni ko'rsatadi.
 */
async function queueDeepStats(): Promise<{
  queued: number;
  running: number;
  oldestQueuedAgeSec: number | null;
  newestLockedAt: string | null;
} | null> {
  const row = await queryOne<{
    queued: string;
    running: string;
    oldest_queued_age_sec: string | null;
    newest_locked_at: string | null;
  }>(
    `SELECT
       count(*) FILTER (WHERE status = 'QUEUED')::text      AS queued,
       count(*) FILTER (WHERE status = 'IN_PROGRESS')::text AS running,
       EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status = 'QUEUED')))::text AS oldest_queued_age_sec,
       MAX(locked_at) FILTER (WHERE status = 'IN_PROGRESS')::text AS newest_locked_at
     FROM generations`,
  ).catch(() => null);
  if (!row) return null;
  return {
    queued: Number(row.queued ?? 0),
    running: Number(row.running ?? 0),
    oldestQueuedAgeSec: row.oldest_queued_age_sec == null ? null : Math.round(Number(row.oldest_queued_age_sec)),
    newestLockedAt: row.newest_locked_at,
  };
}

export async function GET(req: Request) {
  const started = Date.now();

  let db: "up" | "down" = "down";
  let dbError = "";
  try {
    await queryOne("SELECT 1");
    db = "up";
  } catch (e) {
    dbError = e instanceof Error ? e.message : "ulanmadi";
  }

  const healthy = db === "up";

  // Ommaviy javob — minimal (navbat chuqurligi, konfiguratsiya muammolari
  // ichkariga tegishli — CRON_SECRET bo'lmasa hech narsa oshkor bo'lmaydi).
  if (!isInternal(req)) {
    return NextResponse.json(
      { status: healthy ? "ok" : "degraded" },
      { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const problems = assertRuntimeConfig();
  if (dbError) problems.push(`DB: ${dbError}`);

  const queue = healthy ? await queueDeepStats() : null;

  return NextResponse.json(
    {
      status: healthy && problems.length === 0 ? "ok" : healthy ? "degraded" : "down",
      warnings: runtimeWarnings(),
      version: process.env.npm_package_version ?? "0.0.0",
      uptimeSec: Math.round(process.uptime()),
      latencyMs: Date.now() - started,
      db,
      queue,
      features: {
        llm: llmConfigured(),
        images: Boolean(env.gemini.key),
        telegram: Boolean(env.telegramBotToken),
        payments: paymentsConfigured(),
        worker: env.worker.inline ? "inline" : "external",
        sameSite: env.sessionSameSite,
        trustProxy: env.trustProxy,
      },
      problems,
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
