import { NextResponse } from "next/server";
import { ensureMigrated } from "@/lib/server/db";
import { telegramWebhookSecret } from "@/lib/server/env";
import { safeEqual } from "@/lib/server/session";
import { botConfigured, handleUpdate, type TelegramUpdate } from "@/lib/server/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram webhook (prod uchun).
 *
 * Lokal ishlab chiqishda ochiq HTTPS manzil bo'lmaydi — u yerda
 * `npm run bot` long-polling rejimida ishlaydi. Ikkalasi ham bir xil
 * `handleUpdate` ni chaqiradi.
 *
 * Himoya: `setWebhook` da o'rnatilgan maxfiy sarlavha tekshiriladi,
 * aks holda har kim soxta update yuborishi mumkin edi.
 */
export async function POST(req: Request) {
  if (!botConfigured()) return NextResponse.json({ ok: true });

  // Kalit majburiy: `TELEGRAM_WEBHOOK_SECRET`, bo'lmasa zaxira `CRON_SECRET` (EXT-14).
  //
  // Ilgari u yo'q bo'lsa `SESSION_SECRET` ga tushardi — ya'ni sessiya
  // imzo kaliti Telegram sozlamalariga ko'chirilardi va u yerdan sizib
  // chiqsa barcha sessiyalarni qalbakilashtirish mumkin bo'lardi.
  const secret = telegramWebhookSecret();
  if (!secret) {
    console.error("[telegram/webhook] TELEGRAM_WEBHOOK_SECRET sozlanmagan — webhook o'chirilgan");
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!got || !safeEqual(got, secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Buzuq tana — qayta yuborish foyda bermaydi, 200 bilan yopamiz.
  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    console.warn("[telegram/webhook] tana JSON emas — e'tiborsiz qoldirildi");
    return NextResponse.json({ ok: true });
  }
  if (!update || !Number.isSafeInteger(update.update_id)) {
    console.warn("[telegram/webhook] update_id yo'q — e'tiborsiz qoldirildi");
    return NextResponse.json({ ok: true });
  }

  try {
    await ensureMigrated();
    await handleUpdate(update);
  } catch (e) {
    /*
     * BEA-17: ilgari har xato yutilib 200 qaytardi — Telegram update'ni
     * qayta yubormas, kirish havolasi jimgina yo'qolardi. Endi 500:
     * Telegram cheklangan marta qayta yuboradi, `handleUpdate` esa
     * muvaffaqiyatsiz update'ni «ishlangan» deb belgilamagan.
     */
    console.error(`[telegram/webhook] update ${update.update_id}:`, e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
