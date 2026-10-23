import { ApiError, handler, json, limit, requireUser } from "@/lib/server/api";
import { CONVERT_MAX_BYTES, isConvertTarget, type ConvertTarget } from "@/lib/convert/matrix";
import { convertAlifbo, convertFile, convertStatus } from "@/lib/server/convert";
import { isScript } from "@/lib/translit/script";
import { IP_LIMITS } from "@/lib/server/ip-limits";
import { bytesBody, NO_STORE } from "@/lib/server/http-bytes";
import { contentDisposition } from "@/lib/server/pdf-serve";
import { callBot } from "@/lib/server/telegram";
import { buildCaption, buildUploadForm, failureOf, TELEGRAM_UPLOAD_MAX_BYTES } from "@/lib/server/telegram-files";
import { readUploadForm } from "@/lib/server/upload-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** `GET /api/convert` — «Bugun qoldi: N / 20» (charges nothing). */
export const GET = handler("convert/status", async (req) => {
  const { user } = await requireUser(req);
  return json(await convertStatus(user.id), { headers: { "Cache-Control": NO_STORE } });
});

/**
 * `POST /api/convert` (multipart: `file`, `target`) — free converter.
 * `mode=alifbo` (+ `from`, `to`: cyr | lat | new) converts the SCRIPT of a DOCX / PPTX / TXT file instead
 * (Kirill / Lotin / Yangi lotin, no LibreOffice); same login, daily limit, size caps and delivery.
 * Returns the converted file as an attachment; with `?deliver=bot` the file is
 * sent to the user's own bot chat (sendDocument) and `{ ok, delivered: "bot" }`
 * is returned instead (Telegram Mini App: a browser download does not work well there).
 * Nothing is stored.
 */
export const POST = handler("convert", async (req) => {
  const { user, ip } = await requireUser(req);
  await limit(`convert-ip:${ip}`, IP_LIMITS.convertPerIp.count, IP_LIMITS.convertPerIp.windowSec);
  const bot = new URL(req.url).searchParams.get("deliver") === "bot";
  if (bot && !user.telegramId) throw new ApiError("Telegram akkaunti bog'lanmagan", 409, { code: "no_telegram" });

  const form = await readUploadForm(req, CONVERT_MAX_BYTES + 64 * 1024, `Fayl ${CONVERT_MAX_BYTES / 1024 / 1024} MB dan katta bo'lmasligi kerak`);
  const file = form?.get("file");
  const target = form?.get("target");
  const alifbo = form?.get("mode") === "alifbo";
  if (!(file instanceof File)) throw new ApiError("Fayl yuborilmadi", 400);
  const from = form?.get("from");
  const to = form?.get("to");
  if (alifbo ? !isScript(from) || !isScript(to) : !isConvertTarget(target)) {
    throw alifbo ? new ApiError("Alifbo tanlanmadi", 400, { code: "bad_script" }) : new ApiError("Noto'g'ri format tanlandi", 400, { code: "bad_target" });
  }

  const input = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
  const out =
    isScript(from) && isScript(to) && alifbo
      ? await convertAlifbo(user.id, input, { from, to })
      : await convertFile(user.id, input, target as ConvertTarget);

  if (bot) {
    if (out.bytes.byteLength > TELEGRAM_UPLOAD_MAX_BYTES) {
      throw new ApiError("Fayl Telegram uchun juda katta — brauzerdan yuklab oling", 413, { code: "too_large" });
    }
    const { kind, form: upload } = buildUploadForm(
      user.telegramId!,
      { bytes: out.bytes, fileName: out.fileName, mime: out.mime, fileVersion: 0 },
      { caption: buildCaption(out.fileName, alifbo ? "Alifbo o'giruvchi" : "Fayl konvertatsiya") },
    );
    const r = await callBot(kind.method, upload, { multipart: true });
    if (!r.ok) {
      const e = failureOf(r);
      throw new ApiError(e.message, e.code === "bot_unreachable" ? 409 : e.code === "too_large" ? 413 : 503, { code: e.code });
    }
    return json({ ok: true, delivered: "bot", fileName: out.fileName });
  }

  return new Response(bytesBody(out.bytes), {
    headers: {
      "Content-Type": out.mime,
      "Content-Length": String(out.bytes.byteLength),
      "Content-Disposition": contentDisposition(out.fileName),
      "Cache-Control": NO_STORE,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
