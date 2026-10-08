import { env } from "../env";
import { query } from "../db";
import { getUserById, type SessionUser } from "../session";
import { referralSummary } from "../referrals";
import { recentTransactions } from "../credits";
import { updateProfile } from "../profile";
import { callBot, botUsername, isTransientBotFailure, TelegramTransientError } from "../telegram";
import { FIELD_MAX, cleanFieldValue, fieldStep } from "../../profile/fields";
import { FILES_MAX_PAGE, FILES_PAGE_SIZE, parseCallback, type Origin } from "./codes";
import { t, langOf, type Lang } from "./i18n";
import { actionLabel, keyboardMessage, mainKeyboard, matchKeyboard, toolBlocked, type KeyboardAction } from "./keyboard";
import { profileCard, promptScreen, savedScreen, sectionScreen, type InputError } from "./profile";
import {
  filesScreen,
  helpScreen,
  languageSavedScreen,
  languageScreen,
  referralScreen,
  walletScreen,
  type FileItem,
} from "./screens";
import { cancelInput, claimInput, finishInput, keyboardStale, markKeyboard, repromptInput, startInput } from "./state";
import type { Screen } from "./ui";

/**
 * Bot chat routing for the new screens (docs/bot/PLAN.md, B2). Loaded lazily
 * by `telegram.ts processUpdate` (like `telegram-files.ts`), so the static
 * import of `../telegram` here is not a load-time cycle.
 *
 * Rules:
 *   - screens triggered by a button EDIT their message; a reply-keyboard tap
 *     or a typed answer gets a new message (~1 msg/s per chat);
 *   - every handler is safe to replay (Telegram redelivers after a transient
 *     failure): edits are idempotent («message is not modified» is success),
 *     the pending value is claimed per update id (`state.ts`);
 *   - a transient Bot API failure throws `TelegramTransientError` so the
 *     update is redelivered; a permanent one (blocked bot, deleted message)
 *     does not.
 */

export type ChatCtx = { chatId: number; telegramId: number; lang: Lang; user: SessionUser };

/* ───────────────────────── Transport ───────────────────────── */

function transient(method: string, r: { code: number; description: string }): TelegramTransientError {
  return new TelegramTransientError(`${method}: ${r.code ? `${r.code} ` : ""}${r.description}`.trim());
}

/** Sends a screen as a new message; its message id, or `null` on a permanent failure. */
export async function sendScreen(chatId: number, screen: Screen): Promise<number | null> {
  const r = await callBot<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text: screen.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(screen.reply_markup ? { reply_markup: screen.reply_markup } : {}),
  });
  if (r.ok) return Number(r.result?.message_id) || null;
  if (isTransientBotFailure(r)) throw transient("sendMessage", r);
  return null;
}

/**
 * Edits a screen in place. «message is not modified» (a replayed or double
 * tap) is success; a message that cannot be edited any more gets the screen
 * as a new message instead.
 */
export async function editScreen(chatId: number, messageId: number, screen: Screen): Promise<number | null> {
  const r = await callBot("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: screen.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: screen.reply_markup ?? { inline_keyboard: [] },
  });
  if (r.ok || /message is not modified/i.test(r.description)) return messageId;
  if (isTransientBotFailure(r)) throw transient("editMessageText", r);
  return sendScreen(chatId, screen);
}

/** Never throws: a callback answer is best-effort (it expires within seconds anyway). */
async function answerCallback(id: string, text?: string): Promise<void> {
  await callBot("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) }).catch(() => undefined);
}

/* ───────────────────────── Data ───────────────────────── */

/** The account of a Telegram user, or `null` (never creates one). */
export async function userByTelegram(telegramId: number): Promise<SessionUser | null> {
  const rows = await query<{ id: string }>("SELECT id::text AS id FROM users WHERE telegram_id = $1", [String(telegramId)]);
  return rows[0] ? getUserById(rows[0].id) : null;
}

/** For `telegram.ts`: the keyboard went out with another message (contact replies). */
export const markKeyboardSent = markKeyboard;
/** For `telegram.ts`: a command drops a pending prompt. */
export const cancelPending = cancelInput;

async function referral(userId: string) {
  const s = await referralSummary(userId, { botUsername: await botUsername(), appUrl: env.appUrl });
  return { link: s.botLink ?? s.webLink, rewardPoints: s.rewardPoints, invitedCount: s.invitedCount, earnedPoints: s.earnedPoints };
}

async function profileScreen(ctx: Pick<ChatCtx, "user" | "lang">): Promise<Screen> {
  return profileCard(ctx.user, ctx.lang, (await referral(ctx.user.id)).link);
}

async function filesPage(ctx: Pick<ChatCtx, "user" | "lang" | "telegramId">, page: number): Promise<Screen> {
  // Lazy: `jobs.ts` pulls in the generation engine, which the other bot paths never need.
  const { listGenerations } = await import("../jobs");
  const p = Math.max(0, Math.min(FILES_MAX_PAGE, page));
  // The web listing (owner-scoped `WHERE user_id = $1`), read up to the requested page.
  const { items, nextCursor } = await listGenerations(ctx.user.id, { limit: (p + 1) * FILES_PAGE_SIZE });
  const slice: FileItem[] = items.slice(p * FILES_PAGE_SIZE).map((g) => ({
    id: g.id,
    type: g.type,
    topic: g.topic ?? "",
    status: g.status,
    progress: Number(g.progress) || 0,
    createdAt: g.createdAt,
  }));
  const hasNext = nextCursor !== null && p < FILES_MAX_PAGE;
  return filesScreen(ctx.lang, ctx.telegramId, p, slice, hasNext);
}

async function walletCard(ctx: Pick<ChatCtx, "user" | "lang">): Promise<Screen> {
  return walletScreen(ctx.lang, ctx.user, await recentTransactions(ctx.user.id, 5));
}

/* ───────────────────────── Keyboard + texts ───────────────────────── */

/** Sends the main keyboard (its own message) and records it. */
export async function sendMainKeyboard(ctx: ChatCtx, kind: "note" | "refreshed"): Promise<void> {
  await sendScreen(ctx.chatId, keyboardMessage(ctx.lang, ctx.telegramId, kind));
  await markKeyboard(ctx.chatId, ctx.user.id);
}

/** A text that is a reply-keyboard button. */
export async function handleKeyboard(ctx: ChatCtx, action: KeyboardAction): Promise<void> {
  await cancelInput(ctx.chatId);
  switch (action) {
    case "slide":
    case "image":
    case "pro": {
      // A web_app button never sends text; a text one is a blocked tool or a deployment without a public URL.
      const blocked = toolBlocked(action);
      const tool = actionLabel(ctx.lang, action);
      await sendScreen(ctx.chatId, {
        text: t(ctx.lang, blocked ? "tool.blocked" : "tool.noApp", { tool }),
        reply_markup: mainKeyboard(ctx.lang, ctx.telegramId),
      });
      return;
    }
    case "profile":
      await sendScreen(ctx.chatId, await profileScreen(ctx));
      // Owner decision Q1: «Profilim» refreshes the personal links when they are getting old.
      if (await keyboardStale(ctx.chatId)) await sendMainKeyboard(ctx, "refreshed");
      return;
    case "files":
      await sendScreen(ctx.chatId, await filesPage(ctx, 0));
      return;
    case "wallet":
      await sendScreen(ctx.chatId, await walletCard(ctx));
      return;
    case "help":
      await sendScreen(ctx.chatId, helpScreen(ctx.lang));
      return;
  }
}

export { matchKeyboard };

/**
 * The answer to a pending prompt. `false`: nothing was pending (or it
 * expired) — the caller treats the text normally.
 */
export async function handlePendingInput(ctx: ChatCtx, text: string, updateId: number): Promise<boolean> {
  const pending = await claimInput(ctx.chatId, ctx.user.id, updateId);
  if (!pending) return false;
  const value = cleanFieldValue(text);
  const error: InputError | null = !value ? { kind: "empty" } : value.length > FIELD_MAX ? { kind: "long", length: value.length } : null;
  if (error) {
    const id = await sendScreen(ctx.chatId, promptScreen(ctx.user, pending.field, ctx.lang, error));
    await repromptInput(ctx.chatId, updateId, id);
    return true;
  }
  await updateProfile(ctx.user.id, { [pending.field]: value }, "bot");
  await sendScreen(ctx.chatId, savedScreen(pending.field, value, ctx.lang));
  // The old prompt keeps no live «Bekor qilish» (cosmetic; never fails the update).
  if (pending.promptMessageId) {
    await callBot("editMessageReplyMarkup", {
      chat_id: ctx.chatId,
      message_id: pending.promptMessageId,
      reply_markup: { inline_keyboard: [] },
    }).catch(() => undefined);
  }
  await finishInput(ctx.chatId, updateId);
  return true;
}

/** `/til` — the language menu as a new message. */
export async function sendLanguageMenu(ctx: ChatCtx): Promise<void> {
  await cancelInput(ctx.chatId);
  await sendScreen(ctx.chatId, languageScreen(ctx.lang, "n"));
}

/** `/taklif` and the welcome «Taklif» — the referral screen as a new message. */
export async function sendReferral(chatId: number, user: SessionUser, lang: Lang): Promise<void> {
  await sendScreen(chatId, referralScreen(lang, await referral(user.id), null));
}

/* ───────────────────────── Callbacks ───────────────────────── */

export type CallbackQuery = {
  id: string;
  from: { id: number; is_bot?: boolean };
  message?: { message_id: number; chat: { id: number; type?: string } };
  data?: string;
};

async function originScreen(ctx: ChatCtx, origin: Origin): Promise<Screen> {
  if (origin === "p") return profileScreen(ctx);
  if (origin === "y") return helpScreen(ctx.lang);
  return languageSavedScreen(ctx.lang);
}

/**
 * Inline button taps. Always answered (`answerCallbackQuery`, never throws).
 * Only the chat's own user may use its buttons: `from.id` must be the
 * private chat's id — the profile owner — and the profile is loaded by that
 * Telegram id, never from the callback data.
 */
export async function handleCallback(q: CallbackQuery, updateId: number): Promise<void> {
  void updateId;
  let toast: string | undefined;
  try {
    const msg = q.message;
    if (!msg || !Number.isSafeInteger(q.from?.id) || !Number.isSafeInteger(msg.chat?.id)) return;
    if (msg.chat.type !== "private" || q.from.id !== msg.chat.id || q.from.is_bot) {
      toast = t("uz", "toast.notYours");
      return;
    }
    const user = await userByTelegram(q.from.id);
    if (!user) {
      toast = t("uz", "toast.start");
      return;
    }
    const ctx: ChatCtx = { chatId: msg.chat.id, telegramId: q.from.id, lang: langOf(user.language), user };
    const c = parseCallback(q.data);
    const edit = (screen: Screen) => editScreen(ctx.chatId, msg.message_id, screen);

    switch (c.kind) {
      case "profile":
        await cancelInput(ctx.chatId);
        await edit(await profileScreen(ctx));
        return;
      case "section":
        await cancelInput(ctx.chatId);
        await edit(sectionScreen(user, c.step, ctx.lang));
        return;
      case "edit":
        await startInput(ctx.chatId, user.id, c.field, msg.message_id);
        await edit(promptScreen(user, c.field, ctx.lang));
        return;
      case "cancel": {
        const was = await cancelInput(ctx.chatId);
        const step = was ? fieldStep(was.field) : null;
        toast = t(ctx.lang, "toast.cancelled");
        await edit(step ? sectionScreen(user, step, ctx.lang) : await profileScreen(ctx));
        return;
      }
      case "files":
        await cancelInput(ctx.chatId);
        await edit(await filesPage(ctx, c.page));
        return;
      case "wallet":
        await cancelInput(ctx.chatId);
        await edit(await walletCard(ctx));
        return;
      case "walletInvite":
        await edit(referralScreen(ctx.lang, await referral(user.id), "wallet"));
        return;
      case "invite":
        await sendReferral(ctx.chatId, user, ctx.lang);
        return;
      case "help":
        await cancelInput(ctx.chatId);
        await edit(helpScreen(ctx.lang));
        return;
      case "langMenu":
        await cancelInput(ctx.chatId);
        await edit(languageScreen(ctx.lang, c.origin));
        return;
      case "langSet": {
        await cancelInput(ctx.chatId);
        const next: ChatCtx = { ...ctx, lang: c.lang, user: { ...user, language: c.lang } };
        toast = t(c.lang, "lang.saved");
        await edit(await originScreen(next, c.origin));
        // The keyboard labels follow the language (a new message — reply keyboards cannot be edited).
        // The language is stored LAST: a redelivery after a failed send still sees the old one and re-sends.
        if (c.lang !== ctx.lang) {
          await sendMainKeyboard(next, "refreshed");
          await updateProfile(user.id, { language: c.lang }, "bot");
        }
        return;
      }
      case "noop":
        return;
      case "unknown":
        toast = t(ctx.lang, "toast.old");
        return;
    }
  } finally {
    await answerCallback(q.id, toast);
  }
}
