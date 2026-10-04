import { produceDownload } from "@/lib/server/downloads/produce";
import { telegramActionHandler } from "../action";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Worst case: the producer converts (PDF, up to ~50 s in the soffice gate)
 * and the first upload of up to 25 MB runs (`UPLOAD_TIMEOUT_MS`, 60 s).
 * Later saves are a JSON resend by `file_id`.
 */
export const maxDuration = 120;

/** «Saqlash»: the file into the user's own bot chat (docs/mobile/PLAN.md §4.4; shapes in `../action.ts`). */
export const POST = telegramActionHandler("save", { produce: produceDownload });
