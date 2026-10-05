import "server-only";
import { randomBytes } from "node:crypto";
import type { DownloadFormatId } from "../downloads/formats";
import { TOOL_BY_ID } from "../tools";
import type { ToolId } from "../types";
import { query, queryOne } from "./db";
import { adapterFor } from "./edit-adapters";
import { env } from "./env";
import { log } from "./log";
import type { SessionUser } from "./session";
import { PRODUCERS } from "./downloads/producers";
import { callBot, isTransientBotFailure, type BotResult } from "./telegram";

/**
 * «Saqlash» and «Ulashish» through the bot (docs/mobile/PLAN.md §4.4, R2 §3–§5).
 *
 * - «Saqlash» (`saveToBot`): the file lands in the user's OWN bot chat. The
 *   first time the bytes are uploaded (multipart); the returned `file_id` is
 *   cached in `telegram_files` per (generation, format, file_version), and
 *   every later save is a tiny JSON resend by `file_id`.
 * - «Ulashish» (`prepareShare`): owner decision O2 — the file is uploaded into
 *   the user's own bot chat when no valid `file_id` exists (share implies
 *   save, no storage channel), then `savePreparedInlineMessage` returns an id
 *   for `Telegram.WebApp.shareMessage` (users, groups and channels; no bots).
 *
 * The recipient is ALWAYS the session user's `telegram_id` — never a value
 * from the request (IDOR lesson of `messageUser`). Ownership is checked in
 * SQL (`generations.user_id`), and the `file_id` never reaches the client.
 *
 * Bytes come only from the download producer (`produceDownload`, package A,
 * `lib/server/downloads/produce.ts`), injected as `deps.produce`: this module
 * never converts or reads files itself.
 */

/* ───────────────────────────── types ───────────────────────────── */

/** Server-side bytes of one download format (`lib/server/downloads/produce.ts`). */
export type ProducedFile = { bytes: Buffer; fileName: string; mime: string; fileVersion: number };

export type ProduceDownload = (
  genId: string,
  userId: string,
  format: DownloadFormatId,
  opts?: { signal?: AbortSignal },
) => Promise<ProducedFile>;

export type TelegramFilesDeps = {
  /** The download producer (production: `produceDownload`). */
  produce: ProduceDownload;
  /** Bot API transport `fetch` (tests stub it; default: global `fetch`). */
  fetch?: typeof fetch;
  /** Clock (debounce window). */
  now?: () => Date;
};

export type TelegramUser = Pick<SessionUser, "id" | "telegramId">;

export type TelegramFileErrorCode =
  | "not_found"
  | "not_ready"
  | "no_telegram"
  | "bot_unreachable"
  | "telegram_unavailable"
  | "share_unavailable"
  | "too_large";

/** A failure the route maps to an HTTP status + `code` (PLAN §4.4). */
export class TelegramFileError extends Error {
  constructor(
    readonly code: TelegramFileErrorCode,
    message: string,
    /** Telegram's `error_code` when the failure came from the Bot API. */
    readonly tgCode?: number,
  ) {
    super(message);
    this.name = "TelegramFileError";
  }
}

export type SaveResult = {
  /** A save of the same file version happened within `SAVE_DEBOUNCE_MS` (or is running): nothing was sent again. */
  duplicate: boolean;
  /** The bytes were uploaded (first save, new version, or the cached `file_id` was rejected). */
  uploaded: boolean;
};

export type ShareResult = {
  /** `PreparedInlineMessage.id` for `Telegram.WebApp.shareMessage`. */
  preparedId: string;
  /** ISO time after which Telegram rejects the prepared message. */
  expiresAt: string;
  /** The bytes were uploaded into the user's bot chat on the way (share implies save). */
  uploaded: boolean;
};

/* ───────────────────────────── limits ───────────────────────────── */

/** Bot API multipart upload limit for documents and audio. */
export const TELEGRAM_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
/** A second «Saqlash» of the same file version within this window is a double tap. */
export const SAVE_DEBOUNCE_MS = 20_000;
/** Caption limit (characters after entity parsing). */
export const CAPTION_LIMIT = 1024;
/** Visible title characters in the caption; the rest is cut with «…». */
const CAPTION_TITLE_CHARS = 300;
/** Inline result `title` shown in the share picker preview. */
const RESULT_TITLE_CHARS = 64;

/* ─────────────────────────── pure builders ─────────────────────────── */

/**
 * How a file travels: Bot API send method, multipart field, inline result
 * type and its `*_file_id` field. MP3 goes as audio (playable in the chat);
 * everything else — including images, to keep the original quality (lead
 * decision on R2 Q3) — goes as a document.
 */
export type MediaKind = {
  media: "document" | "audio";
  method: "sendDocument" | "sendAudio";
  field: "document" | "audio";
  idField: "document_file_id" | "audio_file_id";
};

const DOCUMENT: MediaKind = { media: "document", method: "sendDocument", field: "document", idField: "document_file_id" };
const AUDIO: MediaKind = { media: "audio", method: "sendAudio", field: "audio", idField: "audio_file_id" };

export function mediaKindFor(mime: string): MediaKind {
  return mime.split(";")[0].trim().toLowerCase() === "audio/mpeg" ? AUDIO : DOCUMENT;
}

/** The kind a cached row was uploaded as; `null` for a media this code does not send (treated as a cache miss). */
function kindOfMedia(media: string): MediaKind | null {
  if (media === "document") return DOCUMENT;
  if (media === "audio") return AUDIO;
  return null;
}

/** Escapes plain text for `parse_mode: "HTML"`. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function clipChars(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}

/**
 * Caption (HTML): bold title, then «<tool> · SlaydX yordamida tayyorlandi»
 * (R2 §5 copy). The title is user text and is escaped; its visible length is
 * capped so the caption stays far below Telegram's 1024 characters.
 */
export function buildCaption(title: string, toolLabel: string): string {
  const t = clipChars(title.replace(/\s+/g, " ").trim() || "SlaydX", CAPTION_TITLE_CHARS);
  return `<b>${escapeHtml(t)}</b>\n${escapeHtml(toolLabel)} · SlaydX yordamida tayyorlandi`;
}

/** `https://t.me/<bot>` (R2 Q4: a plain bot link — no `?start=` payload), or `null` when no bot username is set. */
export function botChatUrl(username: string = env.telegramBotUsername): string | null {
  const name = username.replace(/^@/, "").trim();
  return /^[A-Za-z0-9_]{3,64}$/.test(name) ? `https://t.me/${name}` : null;
}

/**
 * Caption button. A `url` button only: `web_app` buttons work only in the
 * private bot chat, and the same message is shared into other chats.
 */
export function backLinkMarkup(url: string | null): { inline_keyboard: { text: string; url: string }[][] } | undefined {
  return url ? { inline_keyboard: [[{ text: "SlaydX'da ochish", url }]] } : undefined;
}

type Presentation = { caption: string; replyMarkup?: ReturnType<typeof backLinkMarkup> };

/** First upload: multipart form for `sendDocument` / `sendAudio`. */
export function buildUploadForm(chatId: string, file: ProducedFile, p: Presentation): { kind: MediaKind; form: FormData } {
  const kind = mediaKindFor(file.mime);
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set(kind.field, new Blob([new Uint8Array(file.bytes)], { type: file.mime }), file.fileName);
  form.set("caption", p.caption);
  form.set("parse_mode", "HTML");
  if (p.replyMarkup) form.set("reply_markup", JSON.stringify(p.replyMarkup));
  // DOCX/PPTX/ZIP stay documents even if Telegram would sniff them as something else.
  if (kind === DOCUMENT) form.set("disable_content_type_detection", "true");
  return { kind, form };
}

/** Resend by cached `file_id`: plain JSON, no bytes, no size limit. */
export function buildResendJson(chatId: string, kind: MediaKind, fileId: string, p: Presentation): Record<string, unknown> {
  const body: Record<string, unknown> = { chat_id: chatId, [kind.field]: fileId, caption: p.caption, parse_mode: "HTML" };
  if (p.replyMarkup) body.reply_markup = p.replyMarkup;
  return body;
}

type SentMessage = { [k: string]: unknown };

/** `file_id` + `file_unique_id` + size of the uploaded file in the returned Message. */
export function fileFromMessage(kind: MediaKind, msg: SentMessage | null | undefined): { fileId: string; uniqueId: string | null; size: number | null } | null {
  const f = msg?.[kind.field] as { file_id?: unknown; file_unique_id?: unknown; file_size?: unknown } | undefined;
  if (!f || typeof f.file_id !== "string" || !f.file_id) return null;
  return {
    fileId: f.file_id,
    uniqueId: typeof f.file_unique_id === "string" ? f.file_unique_id : null,
    size: typeof f.file_size === "number" ? f.file_size : null,
  };
}

/** `savePreparedInlineMessage` body (Bot API 8.0): users, groups and channels; never bot chats. */
export function buildPrepared(args: {
  telegramId: string;
  resultId: string;
  kind: MediaKind;
  fileId: string;
  title: string;
  description: string;
  presentation: Presentation;
}): Record<string, unknown> {
  const result: Record<string, unknown> = {
    type: args.kind.media,
    id: args.resultId,
    [args.kind.idField]: args.fileId,
    caption: args.presentation.caption,
    parse_mode: "HTML",
  };
  if (args.presentation.replyMarkup) result.reply_markup = args.presentation.replyMarkup;
  if (args.kind === DOCUMENT) {
    result.title = clipChars(args.title.trim() || "SlaydX", RESULT_TITLE_CHARS);
    result.description = args.description;
  }
  return {
    user_id: Number(args.telegramId),
    result,
    allow_user_chats: true,
    allow_bot_chats: false,
    allow_group_chats: true,
    allow_channel_chats: true,
  };
}

/** A cached `file_id` Telegram no longer accepts (token rotated, file gone): re-upload. */
export function isStaleFileId(r: { ok: false; code: number; description: string }): boolean {
  return r.code === 400 && /file identifier|file_id|file reference|wrong remote file|wrong file/i.test(r.description);
}

/** Maps a Bot API failure to the route-level error. */
export function failureOf(r: { ok: false; code: number; description: string }): TelegramFileError {
  if (r.code === 403 || (r.code === 400 && /chat not found|user not found|bot can't initiate/i.test(r.description))) {
    return new TelegramFileError("bot_unreachable", "Bot sizga yoza olmadi. Botni ochib /start bosing, so'ng qayta urinib ko'ring.", r.code);
  }
  if (r.code === 413 || /too big|too large/i.test(r.description)) {
    return new TelegramFileError("too_large", "Fayl Telegram uchun juda katta — «Yuklab olish» dan foydalaning.", r.code);
  }
  if (!isTransientBotFailure(r)) {
    log("warn", "tg.files: unexpected Bot API error", { tgCode: r.code, description: r.description });
  }
  return new TelegramFileError("telegram_unavailable", "Telegram hozir javob bermayapti. Birozdan keyin qayta urinib ko'ring.", r.code);
}

/* ───────────────────────────── storage ───────────────────────────── */

type GenRow = {
  status: string;
  topic: string;
  tool_id: string;
  file_name: string;
  file_version: number;
  doc_version: number;
  tf_version: number | null;
  media: string | null;
  file_id: string | null;
  saved_at: Date | null;
};

/** The generation (owner only) and its cached Telegram file for `format`. */
async function loadRow(genId: string, userId: string, format: DownloadFormatId): Promise<GenRow> {
  const row = await queryOne<GenRow>(
    `SELECT g.status, g.topic, g.tool_id, g.file_name, g.file_version, g.doc_version,
            tf.file_version AS tf_version, tf.media, tf.file_id, tf.saved_at
       FROM generations g
       LEFT JOIN telegram_files tf ON tf.generation_id = g.id AND tf.format = $3
      WHERE g.id = $1 AND g.user_id = $2`,
    [genId, userId, format],
  );
  if (!row) throw new TelegramFileError("not_found", "Topilmadi");
  if (row.status !== "COMPLETED") throw new TelegramFileError("not_ready", "Fayl hali tayyor emas");
  return row;
}

/**
 * Whether a cached `file_id` may stand for the current bytes of `format` (M1).
 *
 * Stored and derived formats (native, pdf, slides-png, jpg) are built from the
 * stored file, whose bytes change only together with `file_version` — the
 * cache key. Instant serializations (results CSV, transcript, glossary CSV) are
 * rebuilt per request from data that changes WITHOUT a version bump (every new
 * game result, a `doc_json` change), so a cached `file_id` could carry an old
 * table: they are always produced and uploaded again. They are a few KB, so an
 * upload costs the same as a resend; no content hash column is needed.
 */
export function reusesFileId(format: DownloadFormatId): boolean {
  return PRODUCERS[format].kind !== "instant";
}

/** The stored file is behind an edit waiting for a re-render (only editable tools re-render). */
function behindEdit(row: GenRow): boolean {
  return row.file_version < row.doc_version && adapterFor(row.tool_id) !== null;
}

/**
 * The cached file is the current one: a format whose bytes follow
 * `file_version`, the same `file_version`, and that version is not behind an
 * edit waiting for a re-render (the same staleness rule as `fresh-file.ts`:
 * only editable tools re-render).
 */
function cacheValid(row: GenRow, format: DownloadFormatId): MediaKind | null {
  if (!reusesFileId(format)) return null;
  if (!row.file_id || row.tf_version === null || row.media === null) return null;
  if (row.tf_version !== row.file_version) return null;
  if (behindEdit(row)) return null;
  return kindOfMedia(row.media);
}

function presentationOf(row: GenRow): Presentation & { title: string; toolLabel: string } {
  const toolLabel = TOOL_BY_ID[row.tool_id as ToolId]?.title ?? "SlaydX";
  const title = row.topic.trim() || row.file_name.replace(/\.[^.]+$/, "") || "SlaydX";
  return { caption: buildCaption(title, toolLabel), replyMarkup: backLinkMarkup(botChatUrl()), title, toolLabel };
}

function chatOf(user: TelegramUser): string {
  const id = user.telegramId?.trim();
  if (!id || !/^\d{1,20}$/.test(id)) throw new TelegramFileError("no_telegram", "Telegram akkaunti bog'lanmagan");
  return id;
}

/**
 * Produces the bytes, uploads them into the user's bot chat and stores the
 * `file_id` (one more save: the user received the file).
 */
async function uploadInto(
  chatId: string,
  genId: string,
  user: TelegramUser,
  format: DownloadFormatId,
  row: GenRow,
  deps: TelegramFilesDeps,
): Promise<{ kind: MediaKind; fileId: string }> {
  const file = await deps.produce(genId, user.id, format);
  if (file.bytes.byteLength > TELEGRAM_UPLOAD_MAX_BYTES) {
    throw new TelegramFileError("too_large", "Fayl Telegram uchun juda katta — «Yuklab olish» dan foydalaning.");
  }
  const { kind, form } = buildUploadForm(chatId, file, presentationOf(row));
  const r = await callBot<SentMessage>(kind.method, form, { multipart: true, fetch: deps.fetch });
  if (!r.ok) throw failureOf(r);
  const sent = fileFromMessage(kind, r.result);
  if (!sent) {
    log("warn", "tg.files: upload answer without a file", { genId, format, method: kind.method });
    throw new TelegramFileError("telegram_unavailable", "Telegram hozir javob bermayapti. Birozdan keyin qayta urinib ko'ring.");
  }
  const now = (deps.now ?? (() => new Date()))();
  await query(
    `INSERT INTO telegram_files (generation_id, format, file_version, media, file_id, file_unique_id, size_bytes, saved_at, saves)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
     ON CONFLICT (generation_id, format) DO UPDATE
        SET file_version = EXCLUDED.file_version, media = EXCLUDED.media, file_id = EXCLUDED.file_id,
            file_unique_id = EXCLUDED.file_unique_id, size_bytes = EXCLUDED.size_bytes,
            saved_at = EXCLUDED.saved_at, saves = telegram_files.saves + 1`,
    [genId, format, file.fileVersion, kind.media, sent.fileId, sent.uniqueId, sent.size ?? file.bytes.byteLength, now],
  );
  return { kind, fileId: sent.fileId };
}

/* ─────────────────────────── single-flight ─────────────────────────── */

type Globals = typeof globalThis & { __slaydxTgFilesInflight?: Map<string, Promise<unknown>> };
const g = globalThis as Globals;

/**
 * Parallel identical requests (a double tap) share one run; the joiner gets
 * the same outcome and `joined: true`. Same pattern as `fresh-file.ts`.
 */
async function singleFlight<T>(key: string, run: () => Promise<T>): Promise<{ value: T; joined: boolean }> {
  g.__slaydxTgFilesInflight ??= new Map();
  const map = g.__slaydxTgFilesInflight;
  const running = map.get(key) as Promise<T> | undefined;
  if (running) return { value: await running, joined: true };
  const job = run().finally(() => map.delete(key));
  map.set(key, job);
  return { value: await job, joined: false };
}

/* ───────────────────────────── API ───────────────────────────── */

/**
 * A valid `file_id` for (generation, format), uploading into the user's bot
 * chat when there is none (or `forceUpload`). `uploaded` tells whether the
 * user just received the file.
 */
export async function ensureTelegramFile(
  genId: string,
  user: TelegramUser,
  format: DownloadFormatId,
  deps: TelegramFilesDeps,
  opts: { forceUpload?: boolean } = {},
): Promise<{ kind: MediaKind; fileId: string; uploaded: boolean; row: GenRow }> {
  const chatId = chatOf(user);
  const row = await loadRow(genId, user.id, format);
  const kind = opts.forceUpload ? null : cacheValid(row, format);
  if (kind && row.file_id) return { kind, fileId: row.file_id, uploaded: false, row };
  const up = await uploadInto(chatId, genId, user, format, row, deps);
  return { ...up, uploaded: true, row };
}

/**
 * «Saqlash»: the file in the user's own bot chat. Resend by `file_id` when the
 * cache is valid, upload otherwise. A second tap within `SAVE_DEBOUNCE_MS` (or
 * while the first is running) sends nothing and returns `duplicate: true`.
 */
export async function saveToBot(
  genId: string,
  user: TelegramUser,
  format: DownloadFormatId,
  deps: TelegramFilesDeps,
): Promise<SaveResult> {
  const chatId = chatOf(user);
  const { value, joined } = await singleFlight(`save:${user.id}:${genId}:${format}`, () =>
    saveOnce(chatId, genId, user, format, deps),
  );
  const out = joined ? { duplicate: true, uploaded: false } : value;
  log("info", "tg.save", { genId, format, result: out.duplicate ? "duplicate" : out.uploaded ? "uploaded" : "resent" });
  return out;
}

async function saveOnce(
  chatId: string,
  genId: string,
  user: TelegramUser,
  format: DownloadFormatId,
  deps: TelegramFilesDeps,
): Promise<SaveResult> {
  const now = (deps.now ?? (() => new Date()))();
  const row = await loadRow(genId, user.id, format);
  const kind = cacheValid(row, format);

  /*
   * Double-tap debounce (n5). When a row for this file version exists (a
   * resend by `file_id`, or an instant format that is always uploaded again)
   * the slot is claimed atomically in the DB: a request in another process, or
   * a tap right after the previous save, finds `saved_at` fresh and stops. The
   * very first upload of a (generation, format, file_version) has no row yet;
   * it is guarded by the in-process single-flight only — enough with the one
   * `web` container this service runs (a second container could send one extra
   * copy on a double tap, never a wrong file).
   */
  const sameVersionRow = row.tf_version !== null && row.tf_version === row.file_version && !behindEdit(row);
  if (sameVersionRow) {
    const claimed = await query(
      `UPDATE telegram_files SET saved_at = $4
        WHERE generation_id = $1 AND format = $2 AND file_version = $3
          AND (saved_at IS NULL OR saved_at <= $4::timestamptz - make_interval(secs => $5))
        RETURNING 1`,
      [genId, format, row.tf_version, now, SAVE_DEBOUNCE_MS / 1000],
    );
    if (!claimed.length) return { duplicate: true, uploaded: false };
  }
  // Nothing was delivered: give the slot back so the user can retry at once.
  const release = async () => {
    if (!sameVersionRow) return;
    await query(
      "UPDATE telegram_files SET saved_at = $3 WHERE generation_id = $1 AND format = $2 AND saved_at = $4",
      [genId, format, row.saved_at, now],
    );
  };

  if (!kind || !row.file_id) {
    try {
      await uploadInto(chatId, genId, user, format, row, deps);
    } catch (e) {
      await release();
      throw e;
    }
    return { duplicate: false, uploaded: true };
  }

  const r: BotResult<SentMessage> = await callBot<SentMessage>(
    kind.method,
    buildResendJson(chatId, kind, row.file_id, presentationOf(row)),
    { fetch: deps.fetch },
  );
  if (r.ok) {
    await query("UPDATE telegram_files SET saves = saves + 1 WHERE generation_id = $1 AND format = $2", [genId, format]);
    return { duplicate: false, uploaded: false };
  }
  if (isStaleFileId(r)) {
    // The cached id is dead (bot token changed): upload again and overwrite the row.
    try {
      await uploadInto(chatId, genId, user, format, row, deps);
    } catch (e) {
      await release();
      throw e;
    }
    return { duplicate: false, uploaded: true };
  }
  await release();
  throw failureOf(r);
}

/**
 * «Ulashish»: a prepared inline message carrying the file, for
 * `Telegram.WebApp.shareMessage(id)`. Uploads into the user's bot chat first
 * when no valid `file_id` exists. A fresh prepared id per call (they may be
 * single-use); a parallel double tap shares one.
 */
export async function prepareShare(
  genId: string,
  user: TelegramUser,
  format: DownloadFormatId,
  deps: TelegramFilesDeps,
): Promise<ShareResult> {
  const telegramId = chatOf(user);
  const { value } = await singleFlight(`share:${user.id}:${genId}:${format}`, () =>
    shareOnce(telegramId, genId, user, format, deps),
  );
  log("info", "tg.share", { genId, format, result: value.uploaded ? "uploaded" : "cached" });
  return value;
}

async function shareOnce(
  telegramId: string,
  genId: string,
  user: TelegramUser,
  format: DownloadFormatId,
  deps: TelegramFilesDeps,
): Promise<ShareResult> {
  let file = await ensureTelegramFile(genId, user, format, deps);
  const prepare = () => {
    const p = presentationOf(file.row);
    return callBot<{ id?: unknown; expiration_date?: unknown }>(
      "savePreparedInlineMessage",
      buildPrepared({
        telegramId,
        resultId: randomBytes(16).toString("hex"),
        kind: file.kind,
        fileId: file.fileId,
        title: p.title,
        description: p.toolLabel,
        presentation: p,
      }),
      { fetch: deps.fetch },
    );
  };
  let r = await prepare();
  if (!r.ok && isStaleFileId(r) && !file.uploaded) {
    file = await ensureTelegramFile(genId, user, format, deps, { forceUpload: true });
    r = await prepare();
  }
  if (!r.ok) {
    if (r.code === 403 || isTransientBotFailure(r)) throw failureOf(r);
    // 400 for anything else (inline mode off, an old client's bot settings, …):
    // the client falls back to «Saqlash» + forward.
    log("warn", "tg.share: prepare refused", { genId, format, tgCode: r.code, description: r.description });
    throw new TelegramFileError("share_unavailable", "To'g'ridan-to'g'ri ulashib bo'lmadi", r.code);
  }
  const id = r.result?.id;
  const exp = Number(r.result?.expiration_date);
  if (typeof id !== "string" || !id || !Number.isFinite(exp)) {
    throw new TelegramFileError("share_unavailable", "To'g'ridan-to'g'ri ulashib bo'lmadi");
  }
  await query("UPDATE telegram_files SET shares = shares + 1 WHERE generation_id = $1 AND format = $2", [genId, format]);
  return { preparedId: id, expiresAt: new Date(exp * 1000).toISOString(), uploaded: file.uploaded };
}
