import { NextResponse } from "next/server";
import { queryOne } from "@/lib/server/db";
import { queueDepth } from "@/lib/server/jobs";
import { assertRuntimeConfig, env, llmConfigured, paymentsConfigured } from "@/lib/server/env";
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

  // Ommaviy javob — minimal.
  if (!isInternal(req)) {
    return NextResponse.json(
      { status: healthy ? "ok" : "degraded" },
      { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const problems = assertRuntimeConfig();
  if (dbError) problems.push(`DB: ${dbError}`);

  let queue: { queued: number; running: number } | null = null;
  if (healthy) {
    queue = await queueDepth().catch(() => null);
  }

  return NextResponse.json(
    {
      status: healthy && problems.length === 0 ? "ok" : healthy ? "degraded" : "down",
      version: process.env.npm_package_version ?? "0.0.0",
      uptimeSec: Math.round(process.uptime()),
      latencyMs: Date.now() - started,
      db,
      queue,
      features: {
        llm: llmConfigured(),
        images: Boolean(env.fal.key),
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
