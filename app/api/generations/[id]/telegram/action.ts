import "server-only";
import { ApiError, handler, json, limit, requireUser } from "@/lib/server/api";
import {
  defaultShareFormat,
  downloadSubject,
  formatById,
  isDownloadFormatId,
  type DownloadFormatId,
} from "@/lib/downloads/formats";
import { hasResults } from "@/lib/server/downloads/produce";
import { getGeneration } from "@/lib/server/jobs";
import { pdfAvailable } from "@/lib/server/pdf";
import { botConfigured } from "@/lib/server/telegram";
import {
  botChatUrl,
  prepareShare,
  saveToBot,
  TelegramFileError,
  type TelegramFileErrorCode,
  type TelegramFilesDeps,
} from "@/lib/server/telegram-files";

/**
 * Shared body of `POST /api/generations/{id}/telegram/save` and `…/share`
 * (docs/mobile/PLAN.md §4.4). The route files only bind the action and the
 * download producer; tests call this with an injected producer.
 *
 * Request: `{ format?: DownloadFormatId }` (optional; default = the stored
 * file, `defaultShareFormat`). The format must be one the download sheet
 * offers for this generation (`formatById`), so Telegram never gets a format
 * the user could not download.
 *
 * Responses:
 *   save  200 `{ ok: true, duplicate: boolean, format, botUrl: string | null }`
 *   share 200 `{ preparedId, expiresAt, format, botUrl: string | null }`
 *   400 `unknown_format` | `unsupported`; 404 not found / not the owner;
 *   409 `no_telegram` | `bot_unreachable` (+ `botUrl`) | `not_ready`;
 *   413 `too_large`; 429 (Retry-After); 501 `share_unavailable`;
 *   503 `telegram_unavailable`. Producer failures (PDF busy, …) keep their own
 *   status and `code` (`DownloadError`, package A).
 */

export type TelegramAction = "save" | "share";

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Per-user budgets (R2 §3): sending is cheap for us but each send is a chat message. */
export const TELEGRAM_LIMITS: Record<TelegramAction, { count: number; windowSec: number }> = {
  save: { count: 20, windowSec: 3600 },
  share: { count: 30, windowSec: 3600 },
};

const STATUS: Record<TelegramFileErrorCode, number> = {
  not_found: 404,
  not_ready: 409,
  no_telegram: 409,
  bot_unreachable: 409,
  too_large: 413,
  share_unavailable: 501,
  telegram_unavailable: 503,
};

/** The body is optional: an empty POST means the default format. */
async function readBody(req: Request): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 4_096) throw new ApiError("So'rov hajmi juda katta", 413);
  const text = (await req.text()).trim();
  if (!text) return {};
  if (text.length > 4_096) throw new ApiError("So'rov hajmi juda katta", 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError("Noto'g'ri JSON", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("So'rov tanasi obyekt bo'lishi kerak", 400);
  }
  return body as Record<string, unknown>;
}

function toApiError(e: TelegramFileError): ApiError {
  const extra: Record<string, unknown> = { code: e.code };
  if (e.code === "bot_unreachable") extra.botUrl = botChatUrl();
  if (e.code === "telegram_unavailable") extra.retryAfter = 30;
  return new ApiError(e.message, STATUS[e.code], extra);
}

export function telegramActionHandler(action: TelegramAction, deps: TelegramFilesDeps) {
  return handler(`generations/telegram-${action}`, async (req: Request, ctx: Ctx) => {
    const { user } = await requireUser(req);
    const { id } = await ctx.params;
    if (!UUID.test(id)) throw new ApiError("Noto'g'ri id", 400);
    const body = await readBody(req);

    // The recipient is always the session's own Telegram account; local/OTP
    // accounts have none (the client hides the buttons for them).
    if (!user.telegramId) throw new ApiError("Telegram akkaunti bog'lanmagan", 409, { code: "no_telegram" });

    const { count, windowSec } = TELEGRAM_LIMITS[action];
    await limit(`tg${action}:${user.id}`, count, windowSec);

    const gen = await getGeneration(id, user.id, { lean: true });
    if (!gen) throw new ApiError("Topilmadi", 404);
    if (gen.status !== "COMPLETED") throw new ApiError("Fayl hali tayyor emas", 409, { code: "not_ready" });

    let format: DownloadFormatId;
    if (body.format === undefined || body.format === null) {
      format = defaultShareFormat(downloadSubject(gen)).id;
    } else {
      if (!isDownloadFormatId(body.format)) {
        throw new ApiError("Noma'lum fayl formati", 400, { code: "unknown_format" });
      }
      const subject = downloadSubject(gen, {
        hasResults: body.format === "results-csv" ? await hasResults(id, user.id) : undefined,
      });
      const row = formatById(subject, { pdf: pdfAvailable() }, body.format);
      if (!row) throw new ApiError("Bu format ushbu natija uchun mavjud emas", 400, { code: "unsupported" });
      format = row.id;
    }

    if (!botConfigured()) {
      throw new ApiError("Telegram hozir javob bermayapti. Birozdan keyin qayta urinib ko'ring.", 503, { code: "telegram_unavailable", retryAfter: 30 });
    }

    const botUrl = botChatUrl();
    try {
      if (action === "save") {
        const r = await saveToBot(id, user, format, deps);
        return json({ ok: true, duplicate: r.duplicate, format, botUrl });
      }
      const r = await prepareShare(id, user, format, deps);
      return json({ preparedId: r.preparedId, expiresAt: r.expiresAt, format, botUrl });
    } catch (e) {
      if (e instanceof TelegramFileError) throw toApiError(e);
      throw e;
    }
  });
}
