import { log } from "../log";
import { ApiError } from "../api";
import { acceptOffer, offerStatus, ofertaConfig } from "../oferta";
import { currentOfertaPdf, type OfertaPdf } from "../oferta-pdf";
import { callBot, isTransientBotFailure, TelegramTransientError } from "../telegram";
import { cb } from "./codes";
import { t, type Lang } from "./i18n";
import { appUrl, inlineButton, rows, type Screen } from "./ui";
import type { SessionUser } from "../session";

/**
 * Public offer in the bot (D6). On a plain `/start` of a user who has not accepted the current version (and
 * only while `oferta.gate_enabled` is on) the offer PDF is sent with a caption and «Qabul qilaman»; the tap
 * (`o:a`) records the acceptance via the SAME service the web uses (`lib/server/oferta.ts`) and then the normal
 * welcome follows. If the PDF cannot be produced (LibreOffice busy / missing) the message is plain text with a
 * link to `/oferta`. Login-nonce and referral `/start` payloads never reach this code.
 */

export type OfferChat = { chatId: number; lang: Lang; user: Pick<SessionUser, "id"> };

/** Telegram `file_id` of the uploaded PDF per digest (text + requisites): later /start resend by id. */
const g = globalThis as typeof globalThis & { __slaydxOfertaFileIds?: Map<string, string> };
function fileIds(): Map<string, string> {
  return (g.__slaydxOfertaFileIds ??= new Map());
}

function acceptRow(lang: Lang, version: number) {
  return [inlineButton("save", t(lang, "oferta.accept"), { callback_data: cb.offerAccept(version) }, "success")];
}

/** Keyboard under the offer message. `withLink`: also the «Ofertani o'qish» URL button (when the site URL is public). */
export function offerMarkup(lang: Lang, version: number, withLink: boolean) {
  const link = withLink ? appUrl("/oferta") : null;
  return rows(link ? [inlineButton(null, t(lang, "oferta.read"), { url: link })] : [], acceptRow(lang, version));
}

export function offerLinkScreen(lang: Lang, version: number): Screen {
  return { text: t(lang, "oferta.captionLink"), reply_markup: offerMarkup(lang, version, true) };
}

async function sendPdf(chatId: number, lang: Lang, pdf: OfertaPdf): Promise<boolean> {
  const caption = t(lang, "oferta.caption");
  const reply_markup = offerMarkup(lang, pdf.version, true);
  const known = fileIds().get(pdf.digest);
  if (known) {
    const r = await callBot("sendDocument", { chat_id: chatId, document: known, caption, parse_mode: "HTML", reply_markup });
    if (r.ok) return true;
    if (isTransientBotFailure(r)) throw new TelegramTransientError(`sendDocument: ${r.description}`);
    fileIds().delete(pdf.digest); // stale id: upload again below
  }
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("caption", caption);
  form.set("parse_mode", "HTML");
  form.set("reply_markup", JSON.stringify(reply_markup));
  form.set("document", new Blob([new Uint8Array(pdf.bytes)], { type: "application/pdf" }), `SlaydX-oferta-v${pdf.version}.pdf`);
  const r = await callBot<{ document?: { file_id?: string } }>("sendDocument", form, { multipart: true });
  if (r.ok) {
    const id = r.result?.document?.file_id;
    if (id) fileIds().set(pdf.digest, id);
    return true;
  }
  if (isTransientBotFailure(r)) throw new TelegramTransientError(`sendDocument: ${r.description}`);
  return false;
}

/**
 * Plain `/start`: when the offer must be accepted, sends it and returns `true` (the caller then does NOT
 * send the welcome -- the accept callback does). Returns `false` when nothing is required (gate off,
 * already accepted, admin) or on an internal error, so /start is never broken by this step. A transient Bot
 * API failure rethrows so Telegram redelivers the update.
 */
export async function sendOfferIfRequired(ctx: OfferChat): Promise<boolean> {
  try {
    const cfg = await ofertaConfig();
    if (!cfg.enabled) return false;
    const status = await offerStatus(ctx.user.id, cfg);
    if (!status.required) return false;
    let pdf: OfertaPdf | null = null;
    try {
      pdf = await currentOfertaPdf();
    } catch (e) {
      log("warn", "[oferta] PDF unavailable, sending the web link", { err: e });
    }
    if (pdf && (await sendPdf(ctx.chatId, ctx.lang, pdf))) return true;
    const screen = offerLinkScreen(ctx.lang, cfg.version);
    const r = await callBot("sendMessage", {
      chat_id: ctx.chatId,
      text: screen.text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: screen.reply_markup,
    });
    if (!r.ok && isTransientBotFailure(r)) throw new TelegramTransientError(`sendMessage: ${r.description}`);
    return r.ok;
  } catch (e) {
    if (e instanceof TelegramTransientError) throw e;
    log("error", "[oferta] /start step failed", { err: e });
    return false;
  }
}

export type OfferAcceptResult = "accepted" | "already" | "outdated";

/**
 * Callback `o:a:<v>`: records the acceptance of the version that was shown. "accepted" -- a real change (the
 * caller sends the welcome), "already" -- a double tap (nothing to do), "outdated" -- the version moved on:
 * nothing recorded and the CURRENT offer is sent again.
 */
export async function handleOfferAccept(chat: OfferChat & { messageId: number }, shown: number): Promise<OfferAcceptResult> {
  let changed: boolean;
  try {
    ({ changed } = await acceptOffer(chat.user.id, shown));
  } catch (e) {
    if (e instanceof ApiError && e.extra.code === "offer_outdated") {
      await callBot("editMessageReplyMarkup", { chat_id: chat.chatId, message_id: chat.messageId, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
      await sendOfferIfRequired(chat);
      return "outdated";
    }
    throw e;
  }
  await callBot("editMessageReplyMarkup", { chat_id: chat.chatId, message_id: chat.messageId, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
  return changed ? "accepted" : "already";
}
