import type { DownloadFormatId } from "../../downloads/formats";
import { RATING_LOW_MAX, RATING_REASONS } from "../../generation-rating";
import { adapterFor } from "../edit-adapters";
import { GenerationRatingError, rateGeneration, ratingTarget, setRatingReason, type RatingTarget } from "../generation-ratings";
import { callBot, isTransientBotFailure, TelegramTransientError } from "../telegram";
import { shareQuery } from "../telegram-files";
import { cb, type Callback } from "./codes";
import { t, type Lang } from "./i18n";
import { appUrl, inlineButton, rows, type InlineMarkup } from "./ui";
import type { ChatCtx } from "./router";

/**
 * The keyboard under the file message in the OWNER's bot chat and its «⭐ Baholash» flow
 * (owner request 2026-11-12, docs/ratings/GENERATION-RATING.md):
 *
 *   [ ✏️ Tahrirlash (web_app) | ⭐ Baholash (callback) ]
 *   [ 📤 Ulashish (switch_inline_query)                 ]
 *
 * Thin, like `domla.ts`: every rule (ownership, «only COMPLETED», re-rate, rate limit) lives in
 * `lib/server/generation-ratings.ts`; this file renders keyboards and calls it. The message is a
 * document, so only its keyboard changes (`editMessageReplyMarkup`); prompts go into the toast.
 *
 * «✏️ Tahrirlash» is an INLINE `web_app` button: it carries initData, so the Mini App logs in
 * silently and no personal `?bt=` link is put into the chat (the `screens.ts fileButton` rule).
 * web_app buttons work only in the private bot chat, which is why this keyboard is never used for
 * the copy other people receive (`telegram-files.ts backLinkMarkup`, inline results).
 */

/** The viewer opened straight in edit mode (URL contract with the viewer: `?edit=1`). */
export function editPath(generationId: string): string {
  return `/uz/files/${generationId}?edit=1`;
}

/**
 * The «✏️ Tahrirlash» URL, or `null`: only an editable kind (a tool with an edit adapter: slides
 * and text documents — never pictures, audio, video or games), only while its files exist, and
 * only on a public https deployment (`appUrl`).
 */
export function editUrlFor(generationId: string, toolId: string, purged = false): string | null {
  if (purged || !adapterFor(toolId)) return null;
  return appUrl(editPath(generationId));
}

export type WorkKeyboardInput = {
  generationId: string;
  format: DownloadFormatId;
  lang: Lang;
  /** `editUrlFor(...)`: `null` = no edit button. */
  editUrl: string | null;
  /** The owner's current stars (`null` = not rated: the button reads «⭐ Baholash»). */
  stars: number | null;
};

/**
 * The normal keyboard of the owner's copy. (`shareQuery` comes from `telegram-files.ts`, which in
 * turn builds its saved copy with this function: the import cycle is between functions only.)
 */
export function workKeyboard(o: WorkKeyboardInput): InlineMarkup {
  const edit = o.editUrl ? inlineButton(null, t(o.lang, "wr.edit"), { web_app: { url: o.editUrl } }) : null;
  const rate = inlineButton(null, o.stars ? t(o.lang, "wr.rated", { n: o.stars }) : t(o.lang, "wr.rate"), {
    callback_data: cb.workRate(o.generationId, o.format),
  });
  const share = inlineButton(null, t(o.lang, "wr.share"), { switch_inline_query: shareQuery(o.generationId, o.format) });
  return rows([edit, rate], [share]);
}

/** «⭐ Baholash» tapped: five stars and «‹ Orqaga». */
export function starsKeyboard(generationId: string, format: DownloadFormatId, lang: Lang): InlineMarkup {
  return rows(
    [1, 2, 3, 4, 5].map((n) => inlineButton(null, t(lang, "wr.star", { n }), { callback_data: cb.workStars(generationId, format, n) })),
    [inlineButton(null, t(lang, "wr.back"), { callback_data: cb.workBack(generationId, format) })],
  );
}

/** After 1-3 stars: one set of reasons and «O‘tkazib yuborish». */
export function reasonsKeyboard(generationId: string, format: DownloadFormatId, lang: Lang): InlineMarkup {
  const b = (r: (typeof RATING_REASONS)[number]) => inlineButton(null, t(lang, `wr.reason.${r}`), { callback_data: cb.workReason(generationId, format, r) });
  const [design, images, text, errors, other] = RATING_REASONS;
  return rows(
    [b(design), b(images), b(text)],
    [b(errors), b(other)],
    [inlineButton(null, t(lang, "wr.skip"), { callback_data: cb.workReason(generationId, format, null) })],
  );
}

type WorkCallback = Extract<Callback, { kind: "workRate" | "workStars" | "workReason" | "workBack" }>;

const normal = (c: WorkCallback, lang: Lang, target: RatingTarget, stars: number | null): InlineMarkup =>
  workKeyboard({
    generationId: c.generationId,
    format: c.format,
    lang,
    editUrl: editUrlFor(c.generationId, target.toolId, target.purged),
    stars,
  });

/** Swaps the keyboard of the tapped message. «message is not modified» (a replay, a double tap) is success. */
async function setKeyboard(chatId: number, messageId: number, markup: InlineMarkup): Promise<void> {
  const r = await callBot("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: markup });
  if (r.ok || /message is not modified/i.test(r.description)) return;
  // The rating is already stored (idempotent): a redelivery only repeats the same write and edit.
  if (isTransientBotFailure(r)) throw new TelegramTransientError(`editMessageReplyMarkup: ${r.code} ${r.description}`.trim());
}

const REFUSAL: Partial<Record<GenerationRatingError["code"], Parameters<typeof t>[1]>> = {
  not_found: "wr.gone",
  not_owner: "wr.notYours",
  not_ready: "wr.notReady",
  rate_limited: "wr.rateLimit",
};

/**
 * The `gr:*` callbacks; returns the toast. The user is the callback's own sender: every id in the
 * data is looked up with that owner, so a forwarded message's button pressed by someone else
 * changes nothing and answers «Bu ish sizniki emas».
 */
export async function handleWorkRatingCallback(ctx: ChatCtx, messageId: number, c: WorkCallback): Promise<string | undefined> {
  const { lang, user } = ctx;
  try {
    const target = await ratingTarget(user.id, c.generationId);
    switch (c.kind) {
      case "workRate":
        if (target.status !== "COMPLETED") return t(lang, "wr.notReady");
        await setKeyboard(ctx.chatId, messageId, starsKeyboard(c.generationId, c.format, lang));
        return t(lang, "wr.pick");
      case "workBack":
        await setKeyboard(ctx.chatId, messageId, normal(c, lang, target, target.rating?.stars ?? null));
        return undefined;
      case "workStars": {
        const r = await rateGeneration({ userId: user.id, generationId: c.generationId, stars: c.stars, source: "bot" });
        if (r.stars <= RATING_LOW_MAX) {
          await setKeyboard(ctx.chatId, messageId, reasonsKeyboard(c.generationId, c.format, lang));
          return t(lang, "wr.askReason");
        }
        await setKeyboard(ctx.chatId, messageId, normal(c, lang, target, r.stars));
        return t(lang, "wr.thanks");
      }
      case "workReason": {
        // A reason button left over from an earlier 1-3 rating that was since changed to 4-5: nothing to store.
        if (target.rating && target.rating.stars > RATING_LOW_MAX) {
          await setKeyboard(ctx.chatId, messageId, normal(c, lang, target, target.rating.stars));
          return t(lang, "toast.old");
        }
        const r = await setRatingReason({ userId: user.id, generationId: c.generationId, reason: c.reason, source: "bot" });
        await setKeyboard(ctx.chatId, messageId, normal(c, lang, target, r.stars));
        return t(lang, "wr.thanks");
      }
    }
  } catch (e) {
    const key = e instanceof GenerationRatingError ? REFUSAL[e.code] : undefined;
    if (key) return t(lang, key);
    if (e instanceof GenerationRatingError && e.code === "not_rated") return t(lang, "toast.old");
    throw e;
  }
}
