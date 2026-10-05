import { prepareDownload, produceDownload } from "@/lib/server/downloads/produce";
import { telegramActionHandler } from "../action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * A conversion never runs inside this request: an unconverted PDF / slide
 * images / JPG answers `202 preparing` within the prepare budget (~7 s) and
 * the client repeats. Worst case left: that budget plus the first upload of
 * up to 50 MB (`UPLOAD_TIMEOUT_MS`, 60 s). Later saves are a JSON resend by `file_id`.
 */
export const maxDuration = 120;

/** «Saqlash»: the file into the user's own bot chat (docs/mobile/PLAN.md §4.4; shapes in `../action.ts`). */
export const POST = telegramActionHandler("save", { produce: produceDownload, prepare: prepareDownload });
