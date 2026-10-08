import "server-only";
import { ApiError } from "./api";
import { callBot, isTransientBotFailure, TelegramTransientError } from "./telegram";

/**
 * Rich broadcast content (docs/bot-admin/PLAN.md A-Q2, migration 044
 * `broadcasts.content`): a broadcast composed in the bot keeps the admin's
 * message as Telegram gave it — text with its formatting entities, or a photo
 * / video `file_id` with its caption — plus an optional single link button.
 *
 * It is sent with entities (never `parse_mode`), so the recipients see exactly
 * what the admin wrote, and the media by `file_id` (valid for this bot), so
 * delivery does not depend on the admin's message still existing.
 *
 * Everything here is validated again when it is stored (`parseBroadcastContent`):
 * the bot builds it from a Telegram update, but nothing is written unchecked.
 */

export const CONTENT_KINDS = ["text", "photo", "video"] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

/** Telegram's caption cap for photo / video. */
export const CAPTION_MAX = 1024;
/** Telegram's message entity cap. */
export const ENTITIES_MAX = 100;
export const BUTTON_TEXT_MAX = 40;
export const BUTTON_URL_MAX = 512;

/** Formatting entities kept as is. Auto-detected ones (url, mention, hashtag…) are re-detected by Telegram. */
const ENTITY_TYPES = new Set([
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "spoiler",
  "code",
  "pre",
  "text_link",
  "blockquote",
  "expandable_blockquote",
  "custom_emoji",
]);

export type BroadcastEntity = {
  type: string;
  offset: number;
  length: number;
  url?: string;
  language?: string;
  custom_emoji_id?: string;
};

export type BroadcastButton = { text: string; url: string };

export type BroadcastContent = {
  kind: ContentKind;
  /** photo / video only. */
  fileId?: string;
  entities?: BroadcastEntity[];
  button?: BroadcastButton;
  /** Where to post the «finished» summary (the admin's bot chat) and in which bot language. */
  notify?: { chatId: string; lang: string };
};

const bad = (message: string): ApiError => new ApiError(message, 400, { code: "content" });

const FILE_ID = /^[A-Za-z0-9_-]{10,250}$/;
const CHAT_ID = /^-?[1-9]\d{0,18}$/;

/** UTF-16 length (Telegram counts entity offsets in UTF-16 code units, as JS strings do). */
const u16 = (s: string): number => s.length;

/** A public https URL for a button (Telegram refuses others: «Wrong HTTP URL»). `null` when it is not one. */
export function parseButtonUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > BUTTON_URL_MAX || /\s/.test(s)) return null;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[")) return null;
  return url.toString();
}

/** Button label: no control characters, inner whitespace collapsed, 1..40 characters. `null` when invalid. */
export function parseButtonText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!s || Array.from(s).length > BUTTON_TEXT_MAX) return null;
  return s;
}

function parseEntity(raw: unknown, textLength: number): BroadcastEntity | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.type !== "string" || !ENTITY_TYPES.has(e.type)) return null;
  const offset = e.offset;
  const length = e.length;
  if (typeof offset !== "number" || typeof length !== "number" || !Number.isInteger(offset) || !Number.isInteger(length)) return null;
  if (offset < 0 || length < 1 || offset + length > textLength) return null;
  const out: BroadcastEntity = { type: e.type, offset, length };
  if (e.type === "text_link") {
    if (typeof e.url !== "string" || !/^(https?|tg):\/\/\S{1,2000}$/i.test(e.url)) return null;
    out.url = e.url;
  }
  if (e.type === "pre" && typeof e.language === "string" && /^[\w+#.-]{1,32}$/.test(e.language)) out.language = e.language;
  if (e.type === "custom_emoji") {
    if (typeof e.custom_emoji_id !== "string" || !/^\d{1,30}$/.test(e.custom_emoji_id)) return null;
    out.custom_emoji_id = e.custom_emoji_id;
  }
  return out;
}

/**
 * Telegram entities of `text` → the formatting ones that fit the text (others
 * dropped, at most 100). Never throws: a dropped entity only loses a style.
 */
export function cleanEntities(raw: unknown, text: string): BroadcastEntity[] {
  if (!Array.isArray(raw)) return [];
  const n = u16(text);
  const out: BroadcastEntity[] = [];
  for (const e of raw.slice(0, ENTITIES_MAX)) {
    const v = parseEntity(e, n);
    if (v) out.push(v);
  }
  return out;
}

/**
 * The stored content + its text, validated (the text rules depend on the kind:
 * a text message 1..`textMax` characters, a caption 0..1024). Throws 400 `content`.
 */
export function parseBroadcastContent(raw: unknown, rawText: unknown, textMax: number): { content: BroadcastContent; text: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw bad("Xabar tarkibi noto'g'ri");
  const c = raw as Record<string, unknown>;
  for (const k of Object.keys(c)) if (!["kind", "fileId", "entities", "button", "notify"].includes(k)) throw bad("Xabar tarkibi noto'g'ri");
  if (typeof c.kind !== "string" || !(CONTENT_KINDS as readonly string[]).includes(c.kind)) throw bad("Xabar turi noto'g'ri");
  const kind = c.kind as ContentKind;
  if (typeof rawText !== "string" || rawText.includes("\0")) throw bad("Matn noto'g'ri");
  const text = rawText;
  const chars = Array.from(text).length;
  if (kind === "text") {
    if (!text.trim()) throw bad("Matn bo'sh bo'lmasligi kerak");
    if (chars > textMax) throw bad(`Matn ${textMax} belgidan oshmasligi kerak`);
  } else if (u16(text) > CAPTION_MAX) {
    throw bad(`Izoh ${CAPTION_MAX} belgidan oshmasligi kerak`);
  }
  const content: BroadcastContent = { kind };
  if (kind !== "text") {
    if (typeof c.fileId !== "string" || !FILE_ID.test(c.fileId)) throw bad("Fayl identifikatori noto'g'ri");
    content.fileId = c.fileId;
  } else if (c.fileId !== undefined) {
    throw bad("Matnli xabarda fayl bo'lmaydi");
  }
  const entities = cleanEntities(c.entities, text);
  if (entities.length) content.entities = entities;
  if (c.button !== undefined && c.button !== null) {
    const b = c.button as Record<string, unknown>;
    const btext = parseButtonText(b?.text);
    const url = parseButtonUrl(b?.url);
    if (!btext || !url) throw bad("Tugma matni yoki havolasi noto'g'ri");
    content.button = { text: btext, url };
  }
  if (c.notify !== undefined && c.notify !== null) {
    const n = c.notify as Record<string, unknown>;
    if (typeof n?.chatId !== "string" || !CHAT_ID.test(n.chatId) || typeof n.lang !== "string" || !/^(uz|ru|en)$/.test(n.lang)) {
      throw bad("Xabar tarkibi noto'g'ri");
    }
    content.notify = { chatId: n.chatId, lang: n.lang };
  }
  return { content, text };
}

/** The stored column → content, or `null` (plain-text broadcast, or a row this code cannot read). */
export function contentOf(raw: unknown, text: string): BroadcastContent | null {
  if (raw === null || raw === undefined) return null;
  try {
    return parseBroadcastContent(raw, text, Number.MAX_SAFE_INTEGER).content;
  } catch {
    return null;
  }
}

/** The Bot API call that sends `content` to `chatId`. Pure, for tests and for the sender. */
export function contentPayload(chatId: string, text: string, c: BroadcastContent): { method: string; body: Record<string, unknown> } {
  const markup = c.button ? { reply_markup: { inline_keyboard: [[{ text: c.button.text, url: c.button.url }]] } } : {};
  if (c.kind === "text") {
    return {
      method: "sendMessage",
      body: { chat_id: chatId, text, ...(c.entities?.length ? { entities: c.entities } : {}), ...markup },
    };
  }
  const caption = text ? { caption: text, ...(c.entities?.length ? { caption_entities: c.entities } : {}) } : {};
  if (c.kind === "photo") return { method: "sendPhoto", body: { chat_id: chatId, photo: c.fileId, ...caption, ...markup } };
  return { method: "sendVideo", body: { chat_id: chatId, video: c.fileId, supports_streaming: true, ...caption, ...markup } };
}

/**
 * Sends rich content. Same contract as `sendMessage`: `true` sent, `false` a
 * permanent refusal (bot blocked, chat gone, a bad file id), a transient
 * failure (network, 429, 5xx) throws `TelegramTransientError`.
 */
export async function sendBroadcastContent(chatId: string, text: string, c: BroadcastContent): Promise<boolean> {
  const { method, body } = contentPayload(chatId, text, c);
  const r = await callBot(method, body);
  if (r.ok) return true;
  if (isTransientBotFailure(r)) throw new TelegramTransientError(`${method}: ${r.code ? `${r.code} ` : ""}${r.description}`.trim());
  return false;
}
