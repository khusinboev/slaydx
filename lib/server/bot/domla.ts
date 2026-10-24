import { formatPoints } from "../../referral";
import { ApiError } from "../api";
import { awaitingAnswer, domlaEnabled, domlaPrice, listDefendable, openSession, resumeSession, startDefence, submitAnswer, type AnswerInput, type SubmitResult } from "../domla";
import { geminiAudioMime } from "../domla-deps";
import { cb, type Callback } from "./codes";
import { t, type Lang, type TextKey } from "./i18n";
import { editScreen, isBlockedTelegram, sendScreen, userByTelegram, type ChatCtx } from "./router";
import { appUrl, clip, esc, inlineButton, rows, type Screen } from "./ui";

/**
 * Bot side of «Qattiqqo'l domla» (owner request 15). Thin, like `daily-quiz.ts`: every rule (price, charge,
 * idempotency, ownership, the answer queue) lives in `lib/server/domla.ts`; this file calls it and renders
 * screens. Nothing heavy runs here -- the webhook only writes rows; the worker (`domla-engine.ts`) speaks.
 */

const LIST_SIZE = 5;
const money = (lang: Lang, n: number): string => t(lang, "unit.som", { n: formatPoints(n) });

const appButton = (lang: Lang) => {
  const url = appUrl("/uz/domla");
  return url ? inlineButton(null, t(lang, "domla.appBtn"), { web_app: { url } }) : null;
};

const plain = (lang: Lang, key: TextKey, extra?: Screen["reply_markup"]): Screen => ({
  text: esc(t(lang, key)),
  ...(extra ? { reply_markup: extra } : {}),
});

/** The list screen: the open defence (resume) or the last works as start buttons. */
export async function listScreen(ctx: ChatCtx): Promise<Screen> {
  const { lang, user } = ctx;
  if (!(await domlaEnabled())) return plain(lang, "domla.disabled");
  const open = await openSession(user.id);
  if (open) {
    return {
      text: t(lang, "domla.open", { topic: esc(clip(open.topic || "—", 80)) }),
      reply_markup: rows([inlineButton(null, t(lang, "domla.resumeBtn"), { callback_data: cb.domlaResume(open.id) }, "primary")], [appButton(lang)]),
    };
  }
  const works = await listDefendable(user.id, LIST_SIZE);
  if (!works.length) return plain(lang, "domla.none", rows([appButton(lang)]));
  return {
    text: t(lang, "domla.intro", { price: `${money(lang, await domlaPrice())}` }),
    reply_markup: rows(
      ...works.map((w) => [inlineButton(null, clip(w.topic || "—", 38), { callback_data: cb.domlaStart(w.id) })]),
      [appButton(lang)],
    ),
  };
}

/** `/domla`: the list as a new message. */
export async function sendList(ctx: ChatCtx): Promise<void> {
  await sendScreen(ctx.chatId, await listScreen(ctx));
}

const REFUSAL: Record<string, TextKey> = { disabled: "domla.disabled", not_found: "domla.notFound", insufficient: "domla.insufficient", open_session: "domla.openFirst" };

/** The `dm:*` callbacks. Returns the toast. The user is the callback's own sender; ids in the data are only looked up with that owner. */
export async function handleDomlaCallback(
  ctx: ChatCtx,
  messageId: number,
  c: Extract<Callback, { kind: "domlaList" | "domlaStart" | "domlaResume" }>,
): Promise<string | undefined> {
  const { lang, user } = ctx;
  try {
    switch (c.kind) {
      case "domlaList":
        await editScreen(ctx.chatId, messageId, await listScreen(ctx));
        return undefined;
      case "domlaStart": {
        const r = await startDefence(user.id, c.generationId);
        const text = r.alreadyOpen ? t(lang, "domla.again") : t(lang, "domla.started", { price: money(lang, r.price) });
        await editScreen(ctx.chatId, messageId, { text: esc(text) });
        return undefined;
      }
      case "domlaResume": {
        const r = await resumeSession(user.id, c.sessionId);
        if (r.ok) return t(lang, "domla.resumed");
        return t(lang, r.reason === "expired" ? "domla.expired" : r.reason === "preparing" ? "domla.preparing" : r.reason === "finished" ? "domla.finished" : "domla.notFound");
      }
    }
  } catch (e) {
    const key = e instanceof ApiError ? REFUSAL[String(e.extra.code ?? "")] : undefined;
    if (!(e instanceof ApiError) || !key) throw e;
    const text = key === "domla.insufficient" ? t(lang, key, { price: money(lang, Number(e.extra.required) || 0) }) : t(lang, key);
    const markup =
      key === "domla.openFirst" && typeof e.extra.sessionId === "string"
        ? rows([inlineButton(null, t(lang, "domla.resumeBtn"), { callback_data: cb.domlaResume(e.extra.sessionId) }, "primary")])
        : key === "domla.insufficient"
          ? rows([topUpButton(lang)])
          : null;
    await editScreen(ctx.chatId, messageId, markup && markup.inline_keyboard.length ? { text: esc(text), reply_markup: markup } : { text: esc(text) });
    return undefined;
  }
}

function topUpButton(lang: Lang) {
  const url = appUrl("/uz/wallet");
  return url ? inlineButton(null, t(lang, "domla.topUpBtn"), { web_app: { url } }) : null;
}

const SUBMIT_TEXT: Record<Exclude<SubmitResult, { ok: true }>["reason"], TextKey | null> = {
  no_session: "domla.voiceHint",
  preparing: "domla.preparing",
  expired: "domla.expired",
  not_waiting: "domla.wait",
  busy: "domla.busy",
  too_big: "domla.tooBig",
  too_long: "domla.tooLong",
  empty: "domla.voiceBad",
};

async function answer(ctx: ChatCtx, input: AnswerInput): Promise<SubmitResult> {
  const r = await submitAnswer(ctx.user.id, input);
  if (!r.ok) {
    const key = SUBMIT_TEXT[r.reason];
    if (key) await sendScreen(ctx.chatId, plain(ctx.lang, key));
  }
  return r;
}

export type VoiceMessage = {
  voice?: { file_id: string; duration?: number; mime_type?: string; file_size?: number };
  audio?: { file_id: string; duration?: number; mime_type?: string; file_size?: number };
};

/**
 * A voice / audio message. The size and length Telegram reports are checked first (an oversize voice never
 * reaches the queue); the real download is capped again in the worker.
 */
export async function handleVoice(telegramId: number, chatId: number, msg: VoiceMessage): Promise<void> {
  const user = await userByTelegram(telegramId);
  if (!user || (await isBlockedTelegram(telegramId))) return;
  const lang = (["uz", "ru", "en"] as const).find((l) => l === user.language) ?? "uz";
  const ctx: ChatCtx = { chatId, telegramId, lang, user };
  const v = msg.voice ?? msg.audio;
  if (!v) return;
  const mime = geminiAudioMime(msg.voice ? (v.mime_type ?? "audio/ogg") : v.mime_type);
  if (!mime) {
    await sendScreen(chatId, plain(lang, "domla.voiceBad"));
    return;
  }
  await answer(ctx, { via: "voice", fileId: v.file_id, mime, size: v.file_size ?? 1, seconds: v.duration ?? 0 });
}

/**
 * A plain text message while a question waits: the text fallback of the voice answer. `false` = not ours (no
 * defence is waiting), the caller treats the text as usual.
 */
export async function handleText(ctx: ChatCtx, text: string): Promise<boolean> {
  if (!(await awaitingAnswer(ctx.user.id))) return false;
  await answer(ctx, { via: "text", text });
  return true;
}
