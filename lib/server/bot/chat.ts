import { ApiError } from "../api";
import { cancelProposal, confirmProposal, type ConfirmFailure } from "../chat/proposals";
import { botChatActive, chatStatus, sendChatMessage, startBotChat, stopBotChat } from "../chat/service";
import type { ChatCard, ChatStatus } from "../../chat/types";
import { formatPoints } from "../../referral";
import { callBot } from "../telegram";
import { log } from "../log";
import { rateLimit } from "../ratelimit";
import { t, toolTitle, type Lang } from "./i18n";
import { sendScreen, type ChatCtx } from "./router";
import { appUrl, esc, inlineButton, rows, type Screen } from "./ui";

/**
 * Bot side of the AI chat (owner request 8) -- thin by design (CLAUDE.md «Bot va web -- bitta servis qatlami»):
 * every rule (quota, price, history, validation, the single-use confirmation) lives in `lib/server/chat/*`, the same
 * service the web page uses. This file only turns its results into screens and taps back into service calls.
 *
 * Chat mode: `/chat` turns it on, `/stop` or 15 idle minutes turn it off. While it is on, a plain text message that no
 * other flow claimed (profile prompt, admin step, keyboard button, login nonce -- all dispatched BEFORE this in
 * `telegram.ts processUpdate`) goes to the assistant.
 *
 * Callback data: `chy:<token>:<hash12>` (confirm) and `chn:<token>` (cancel); both fit Telegram's 64 bytes.
 */

const CB = /^ch([yn]):([A-Za-z0-9_-]{43})(?::([0-9a-f]{8,16}))?$/;
const REPLY_MAX = 3500;

const som = (lang: Lang, n: number) => t(lang, "unit.som", { n: formatPoints(n) });

export function freeText(lang: Lang, s: Pick<ChatStatus, "freeLeft" | "freeLimit" | "pricePerMessage">): string {
  return s.freeLeft > 0
    ? t(lang, "chat.free", { left: s.freeLeft, limit: s.freeLimit })
    : `${t(lang, "chat.free", { left: 0, limit: s.freeLimit })} · ${t(lang, "chat.next", { price: som(lang, s.pricePerMessage) })}`;
}

function clipText(text: string): string {
  const chars = Array.from(text);
  return chars.length <= REPLY_MAX ? text : `${chars.slice(0, REPLY_MAX - 1).join("")}…`;
}

export function replyScreen(lang: Lang, content: string, status: ChatStatus): Screen {
  return { text: `${esc(clipText(content))}\n\n<i>${esc(freeText(lang, status))}</i>` };
}

export function cardScreen(lang: Lang, uzTitle: string, card: ChatCard): Screen {
  const title = toolTitle(lang, card.tool, uzTitle);
  if (card.kind === "adjust") {
    return { text: esc(t(lang, "chat.adjust", { tool: title, issues: card.issues.map((i) => `• ${i}`).join("\n") })) };
  }
  const lines = [`<b>${esc(title)}</b>`, ...card.params.map((p) => `• ${esc(p.label)}: ${esc(p.value)}`), "", `<b>${esc(t(lang, "chat.price", { price: som(lang, card.price) }))}</b>`, `<i>${esc(t(lang, "chat.expires"))}</i>`];
  return {
    text: lines.join("\n"),
    reply_markup: rows([
      inlineButton("check", t(lang, "chat.yes"), { callback_data: `chy:${card.token}:${card.hash.slice(0, 12)}` }, "success"),
      inlineButton("cancel", t(lang, "chat.no"), { callback_data: `chn:${card.token}` }),
    ]),
  };
}

function topUpRow(lang: Lang) {
  const url = appUrl("/uz/wallet");
  return url ? [inlineButton("wallet", t(lang, "chat.topup"), { web_app: { url } })] : [];
}

/** A service refusal as a bot screen, or `null` when it is not one we can explain. */
export function refusalScreen(lang: Lang, e: unknown): Screen | null {
  if (!(e instanceof ApiError)) return null;
  const code = String(e.extra.code ?? "");
  if (code === "disabled") return { text: t(lang, "chat.err.disabled") };
  if (code === "insufficient") {
    return {
      text: t(lang, "chat.err.insufficient", { price: som(lang, Number(e.extra.required) || 0), have: som(lang, Number(e.extra.available) || 0) }),
      reply_markup: rows(topUpRow(lang)),
    };
  }
  if (code === "free_exhausted") return { text: t(lang, "chat.err.freeExhausted") };
  if (code === "busy") return { text: t(lang, "chat.err.busy") };
  if (code === "no_answer") return { text: t(lang, "chat.err.noAnswer") };
  if (code === "global") return { text: t(lang, "chat.err.noAnswer") };
  if (e.status === 429) return { text: t(lang, "chat.err.rate") };
  if (e.status === 503) return { text: t(lang, "chat.err.noAnswer") };
  if (e.status === 400) return { text: t(lang, "chat.err.generic") };
  return null;
}

/** `/chat`: chat mode on, a fresh conversation. */
export async function startChat(ctx: ChatCtx): Promise<void> {
  const status = await chatStatus(ctx.user.id, {}, ctx.user);
  if (!status.enabled) {
    await sendScreen(ctx.chatId, { text: t(ctx.lang, "chat.err.disabled") });
    return;
  }
  await startBotChat(ctx.user.id);
  await sendScreen(ctx.chatId, { text: esc(t(ctx.lang, "chat.on", { free: freeText(ctx.lang, status) })) });
}

/** `/stop`. */
export async function stopChat(ctx: ChatCtx): Promise<void> {
  const was = await stopBotChat(ctx.user.id);
  await sendScreen(ctx.chatId, { text: t(ctx.lang, was ? "chat.off" : "chat.offAlready") });
}

/**
 * A plain text message in chat mode. `false` when chat mode is not on (the caller keeps its normal fallback). The client id
 * is the Telegram update id, so a redelivered update returns the same answer and never charges twice.
 */
export async function handleChatText(ctx: ChatCtx, text: string, updateId: number): Promise<boolean> {
  if (!(await botChatActive(ctx.user.id))) return false;
  if (!(await rateLimit(`chat:burst:${ctx.user.id}`, 12, 60)).ok) {
    await sendScreen(ctx.chatId, { text: t(ctx.lang, "chat.err.rate") });
    return true;
  }
  await callBot("sendChatAction", { chat_id: ctx.chatId, action: "typing" }).catch(() => undefined);
  try {
    const r = await sendChatMessage({ userId: ctx.user.id, channel: "bot", text, clientId: `tg${updateId}` });
    await sendScreen(ctx.chatId, replyScreen(ctx.lang, r.reply.content, r.status));
    if (r.reply.card) {
      const card = r.reply.card;
      await sendScreen(ctx.chatId, cardScreen(ctx.lang, card.toolTitle, card));
    }
  } catch (e) {
    const screen = refusalScreen(ctx.lang, e);
    if (!screen) log("error", "[bot-chat] message failed", { err: e });
    await sendScreen(ctx.chatId, screen ?? { text: t(ctx.lang, "chat.err.generic") });
  }
  return true;
}

function failureToast(lang: Lang, f: ConfirmFailure): { toast: string; screen?: Screen } {
  switch (f.reason) {
    case "used":
      return { toast: t(lang, "chat.err.used") };
    case "expired":
      return { toast: t(lang, "chat.err.expired") };
    case "price_changed":
      return { toast: t(lang, "chat.err.priceChanged", { price: som(lang, f.price) }) };
    case "insufficient":
      return {
        toast: t(lang, "chat.err.insufficient", { price: som(lang, f.required), have: som(lang, f.available) }).slice(0, 190),
        screen: {
          text: t(lang, "chat.err.confirmInsufficient", { price: som(lang, f.required), have: som(lang, f.available) }),
          reply_markup: rows(topUpRow(lang)),
        },
      };
    case "adjust":
      return { toast: t(lang, "chat.err.generic"), screen: { text: esc(f.issues.map((i) => `• ${i}`).join("\n")) } };
    case "refused":
      return { toast: t(lang, "chat.err.refused", { reason: f.message }).slice(0, 190) };
    case "rate":
      return { toast: t(lang, "chat.err.rate") };
    case "admission":
      return { toast: f.message.slice(0, 190) };
    default:
      return { toast: t(lang, "chat.err.invalid") };
  }
}

async function dropButtons(ctx: ChatCtx, messageId: number): Promise<void> {
  await callBot("editMessageReplyMarkup", { chat_id: ctx.chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
}

/**
 * The card buttons. The tap's own sender is the user (the router checked that this is the private chat's owner); the token is
 * the server's single-use one. Returns the toast.
 */
export async function handleChatCallback(ctx: ChatCtx, messageId: number, data: string): Promise<string | undefined> {
  const m = CB.exec(data);
  if (!m) return t(ctx.lang, "chat.err.invalid");
  const [, action, token, hash] = m;
  if (action === "n") {
    const ok = await cancelProposal({ userId: ctx.user.id, token });
    await dropButtons(ctx, messageId);
    return ok ? t(ctx.lang, "chat.cancelled") : t(ctx.lang, "chat.err.used");
  }
  const r = await confirmProposal({ userId: ctx.user.id, token, hash: hash ?? "" });
  if (r.ok) {
    await dropButtons(ctx, messageId);
    const files = appUrl("/uz/files");
    await sendScreen(ctx.chatId, {
      text: t(ctx.lang, "chat.started"),
      ...(files ? { reply_markup: rows([inlineButton("files", t(ctx.lang, "chat.openFiles"), { web_app: { url: files } })]) } : {}),
    });
    return t(ctx.lang, "chat.started");
  }
  const { toast, screen } = failureToast(ctx.lang, r);
  if (r.reason === "used" || r.reason === "expired" || r.reason === "invalid" || r.reason === "tampered") await dropButtons(ctx, messageId);
  if (screen) await sendScreen(ctx.chatId, screen);
  return toast;
}

