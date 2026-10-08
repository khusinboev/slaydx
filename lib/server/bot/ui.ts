import { env } from "../env";
import { EMOJI_IDS } from "./emoji-ids";

/**
 * Bot UI primitives (docs/bot/PLAN.md, B2): the icon table, HTML helpers and
 * button builders. Pure — no I/O — so every screen is a testable value.
 *
 * Premium emoji (owner decision Q2): with `BOT_PREMIUM_EMOJI=1` and an id in
 * `emoji-ids.ts`, a text icon becomes `<tg-emoji emoji-id="…">fallback</tg-emoji>`
 * and a button gets `icon_custom_emoji_id` with NO emoji in its label (Telegram
 * draws the custom emoji in front of the text; a second, plain one would
 * double it). Otherwise the fallback emoji is written into the text / prefixed
 * to the label — the screens look complete either way.
 */

/** Fallback-only icons the screens need beyond the fetched pack table. */
const EXTRA_ICONS = {
  error: { fallback: "❌" },
  stop: { fallback: "⛔" },
  name: { fallback: "🪪" },
  author: { fallback: "✍️" },
  share: { fallback: "📤" },
  pointDown: { fallback: "👇" },
  receipt: { fallback: "🧾" },
  flagUz: { fallback: "🇺🇿" },
  flagRu: { fallback: "🇷🇺" },
  flagEn: { fallback: "🇬🇧" },
  support: { fallback: "👨‍💻" },
  plus: { fallback: "➕" },
  refresh: { fallback: "🔄" },
  key: { fallback: "🔑" },
  web: { fallback: "🌐" },
  megaphone: { fallback: "📢" },
} as const satisfies Record<string, { fallback: string; id?: string }>;

export type IconKey = keyof typeof EMOJI_IDS | keyof typeof EXTRA_ICONS;

export const ICONS: Record<IconKey, { fallback: string; id?: string }> = { ...EMOJI_IDS, ...EXTRA_ICONS };

export function premiumOn(): boolean {
  return env.botPremiumEmoji;
}

/** HTML text escaping for `parse_mode: "HTML"` (attribute-safe too). */
export function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** The custom emoji id of an icon when premium emoji are on, else `undefined`. */
export function iconId(key: IconKey): string | undefined {
  const id = ICONS[key]?.id;
  return premiumOn() && id ? id : undefined;
}

/** An icon inside a message text. */
export function tgEmoji(key: IconKey): string {
  const icon = ICONS[key];
  const id = iconId(key);
  return id ? `<tg-emoji emoji-id="${id}">${icon.fallback}</tg-emoji>` : icon.fallback;
}

export type ButtonStyle = "primary" | "success" | "danger";

/** Label + optional `icon_custom_emoji_id`: the emoji goes to the icon OR into the label, never both. */
function labelled(icon: IconKey | null, text: string): { text: string; icon_custom_emoji_id?: string } {
  if (!icon) return { text };
  const id = iconId(icon);
  return id ? { text, icon_custom_emoji_id: id } : { text: `${ICONS[icon].fallback} ${text}` };
}

export type InlineAction =
  | { callback_data: string }
  | { web_app: { url: string } }
  | { url: string }
  | { copy_text: { text: string } };

export type InlineButton = { text: string; icon_custom_emoji_id?: string; style?: ButtonStyle } & InlineAction;

/** Telegram's limit for `callback_data` (bytes, not characters). */
export const CALLBACK_MAX_BYTES = 64;

export function inlineButton(icon: IconKey | null, text: string, action: InlineAction, style?: ButtonStyle): InlineButton {
  if ("callback_data" in action && Buffer.byteLength(action.callback_data, "utf8") > CALLBACK_MAX_BYTES) {
    throw new Error(`callback_data over ${CALLBACK_MAX_BYTES} bytes: ${action.callback_data}`);
  }
  return { ...labelled(icon, text), ...action, ...(style ? { style } : {}) };
}

export type KeyboardButton = { text: string; icon_custom_emoji_id?: string; style?: ButtonStyle; web_app?: { url: string } };

export function keyboardButton(icon: IconKey | null, text: string, opts: { webApp?: string | null; style?: ButtonStyle } = {}): KeyboardButton {
  return {
    ...labelled(icon, text),
    ...(opts.webApp ? { web_app: { url: opts.webApp } } : {}),
    ...(opts.style ? { style: opts.style } : {}),
  };
}

export type InlineMarkup = { inline_keyboard: InlineButton[][] };

/** One rendered screen: what `sendMessage` / `editMessageText` get. */
export type Screen = { text: string; reply_markup?: InlineMarkup | Record<string, unknown> };

/** Telegram accepts only public https URLs in `url` / `web_app` buttons («Wrong HTTP URL»). */
export function isPublicHttps(url: string): boolean {
  return /^https:\/\//.test(url) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url);
}

/**
 * A plain app URL for an INLINE `web_app` / `url` button (inline web_app
 * buttons carry initData, so the Mini App logs in silently — no link token
 * needed), or `null` on a non-public deployment.
 */
export function appUrl(path: string): string | null {
  const url = `${env.appUrl.replace(/\/$/, "")}${path}`;
  return isPublicHttps(url) ? url : null;
}

/** Drops empty rows (a button that had no public URL). */
export function rows(...r: (InlineButton | null | undefined | false)[][]): InlineMarkup {
  return { inline_keyboard: r.map((row) => row.filter((b): b is InlineButton => Boolean(b))).filter((row) => row.length > 0) };
}

/** Cuts a value for a button label / a list line (labels are short on phones). */
export function clip(s: string, max: number): string {
  const v = s.replace(/\s+/g, " ").trim();
  // By code points, never inside a surrogate pair (a split emoji makes Telegram reject the whole keyboard).
  const chars = Array.from(v);
  return chars.length <= max ? v : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}
