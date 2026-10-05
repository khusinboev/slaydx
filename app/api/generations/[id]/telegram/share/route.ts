import { prepareDownload, produceDownload } from "@/lib/server/downloads/produce";
import { telegramActionHandler } from "../action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Same budget as `../save`: a share without a cached `file_id` uploads first (share implies save, O2). */
export const maxDuration = 120;

/**
 * «Ulashish»: a prepared inline message for `Telegram.WebApp.shareMessage`
 * (docs/mobile/PLAN.md §4.4; shapes in `../action.ts`).
 */
export const POST = telegramActionHandler("share", { produce: produceDownload, prepare: prepareDownload });
