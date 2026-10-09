import { ApiError } from "../api";
import { env } from "../env";
import { pool, queryOne } from "../db";
import { rateLimit } from "../ratelimit";
import { callBot } from "../telegram";
import { needsStepUp, type Permission } from "../admin-rbac";
import { writeDeniedAudit } from "../admin-audit";
import { botStepUp } from "../admin-accounts";
import {
  audienceCount,
  cancelBroadcast,
  createBroadcast,
  getBroadcast,
  pauseBroadcast,
  resumeBroadcast,
  setProgressMessage,
  sendBroadcast,
  sendTest,
  BROADCAST_TEXT_MAX,
  type Audience,
} from "../admin-broadcasts";
import {
  createBonusChannel,
  createInviteLink,
  listBonusChannels,
  parseChannelRef,
  resolveChannel,
  updateBonusChannel,
} from "../admin-bonus-channels";
import {
  CAPTION_MAX,
  cleanEntities,
  parseButtonText,
  parseButtonUrl,
  sendBroadcastContent,
  type BroadcastContent,
} from "../broadcast-content";
import { getPaymentBonusPercent, setPaymentBonusPercent } from "../payment-bonus";
import { isPaymentBonusPercent } from "../../payment-bonus";
import { cancelInput } from "./state";
import { editScreen, sendScreen } from "./router";
import { keyboardMessage, matchKeyboard } from "./keyboard";
import { at, ADMIN_TEXT_KEYS } from "./admin-i18n";
import { LANGS, langOf, type Lang } from "./i18n";
import { actorOf, allowed, lookupAdmin, type BotAdmin } from "./admin-access";
import { parseAdminCallback, typeFits, type AdminCallback, type AudienceCode, type ChannelType } from "./admin-codes";
import {
  CHANNEL_PRESETS,
  audienceScreen,
  broadcastAskScreen,
  broadcastDoneScreen,
  buttonAskScreen,
  channelAskScreen,
  channelConfirmScreen,
  channelKindScreen,
  channelProblemScreen,
  channelTypeScreen,
  channelsScreen,
  confirmScreen,
  draftScreen,
  inputProblemScreen,
  ADMIN_MENU,
  adminMenuKeyboard,
  adminMenuScreen,
  payBonusAskScreen,
  payBonusConfirmScreen,
  payBonusScreen,
  progressScreen,
  statsScreen,
  stepUpScreen,
  stopAskScreen,
  type AdminScreen,
  type InputProblem,
} from "./admin-screens";
import { botStats } from "./admin-stats";
import {
  claimStep,
  clearState,
  hasPendingStep,
  markBotReauth,
  matchScreenKey,
  readState,
  releaseStep,
  writeKeys,
  writeState,
  type AdminState,
  type BroadcastDraft,
  type ChannelDraft,
  type Draft,
} from "./admin-state";
import { esc, tgEmoji } from "./ui";

/**
 * In-bot admin panel (docs/bot-admin/PLAN.md): «📊 Statistika», «📣 Xabar
 * yuborish», «📢 Kanal ulash», «💳 To‘lov bonusi» (C-Q4: the web's
 * `payment_bonus_percent` setting via `payment-bonus.ts`). Every message and button re-reads the admin
 * account (`admin-access.ts lookupAdmin`) and checks the role's permission
 * for THAT action; every change goes through the web's admin services
 * (`admin-broadcasts.ts`, `admin-bonus-channels.ts`) with an audit actor, so
 * the audit rows, validation, delivery, rate limits and cancel are the web's.
 *
 * Step-up (web «S» permissions: broadcasts.send, bonus.edit):
 *   - simple mode (ADMIN_2FA_REQUIRED off — the web has no step-up at all):
 *     the Telegram identity of the linked admin (secret-header webhook, private
 *     chat whose id is the tapping user) + an explicit confirm button that
 *     names the effect («✅ Yuborish (N kishiga)», «✅ Ulash», «⛔ Ha, to‘xtatish»);
 *   - 2FA mode: the same confirm button AND a fresh TOTP code typed in the chat
 *     (`admin-accounts.ts botStepUp`: the web's lock / replay guard / audit),
 *     valid 10 minutes for this chat, never weaker than the web's reauth.
 */

/* ───────────────────────── Permissions ───────────────────────── */

const PERM: Record<Exclude<AdminCallback["kind"], "unknown">, Permission> = {
  panel: "dashboard.view",
  close: "dashboard.view",
  cancel: "dashboard.view",
  stats: "dashboard.view",
  bcStart: "broadcasts.send",
  bcButton: "broadcasts.send",
  bcButtonDrop: "broadcasts.send",
  bcAudience: "broadcasts.send",
  bcDraft: "broadcasts.send",
  bcPick: "broadcasts.send",
  bcTest: "broadcasts.send",
  bcSend: "broadcasts.send",
  bcProgress: "broadcasts.view",
  bcPause: "broadcasts.send",
  bcResume: "broadcasts.send",
  bcStopAsk: "broadcasts.send",
  bcStop: "broadcasts.send",
  channels: "bonus.view",
  chConnect: "bonus.edit",
  chKind: "bonus.edit",
  chKinds: "bonus.edit",
  chType: "bonus.edit",
  chTypes: "bonus.edit",
  chCreate: "bonus.edit",
  chToggle: "bonus.edit",
  payBonus: "settings.view",
  pbOther: "settings.edit",
  pbPick: "settings.edit",
  pbSet: "settings.edit",
};

/** The confirmed changes: in 2FA mode they need a fresh bot step-up. */
const CONFIRMS = new Set<AdminCallback["kind"]>(["bcSend", "bcStop", "chCreate", "chToggle", "pbSet"]);

const STEP_PERM = { bc_msg: "broadcasts.send", bc_btn: "broadcasts.send", ch_ref: "bonus.edit", pb_val: "settings.edit", totp: "self" } as const;

/** Admin actions per minute per account (reads and taps; the services keep their own limits). */
export const ADMIN_BOT_RATE = { limit: 60, windowSec: 60 };
/** Refused taps per admin per minute that still write an `auth.denied` row (the web's DENIED_RATE). */
const DENIED_LIMIT = 30;

const REASON = {
  send: "Telegram bot orqali yuborildi",
  stop: "Telegram bot orqali to'xtatildi",
  discard: "Telegram botda qoralama bekor qilindi",
  channel: "Telegram bot orqali ulandi",
  toggle: "Telegram bot orqali o'zgartirildi",
  payBonus: "Telegram bot orqali to'lov bonusi o'zgartirildi",
};

/** `toast` becomes the first line of the screen: a reply-keyboard tap has no toast popup (owner 2026-10-09). */
function withToast(screen: AdminScreen, toast?: string): AdminScreen {
  return toast ? { ...screen, text: `${esc(toast)}\n\n${screen.text}` } : screen;
}

/**
 * Sends an admin screen as a NEW message (a reply keyboard cannot be edited) and remembers the label -> code map
 * of its keyboard for the chat BEFORE the keyboard appears, so the first tap already finds it. `tapped` is the
 * message of an old inline `a:*` button that led here: its buttons are removed so they cannot be tapped twice.
 */
async function showScreen(a: BotAdmin, chatId: number, tapped: number | null, screen: AdminScreen, toast?: string): Promise<number | null> {
  await writeKeys(chatId, a.adminId, screen.keys);
  const id = await sendScreen(chatId, withToast(screen, toast));
  if (tapped !== null) await callBot("editMessageReplyMarkup", { chat_id: chatId, message_id: tapped, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
  return id;
}

/**
 * Back to the admin home (owner 2026-10-09): there is no inline panel card any more — an old inline message is
 * removed and the admin menu (the reply keyboard, `adminMenuScreen`) is sent again. A message Telegram no longer
 * lets the bot delete (older than 48 h) just loses its buttons.
 */
async function backToMenu(a: BotAdmin, chatId: number, tapped: number | null, toast?: string): Promise<void> {
  if (tapped !== null) {
    const del = await callBot("deleteMessage", { chat_id: chatId, message_id: tapped }).catch(() => null);
    if (!del?.ok) await editScreen(chatId, tapped, { text: at(a.lang, "panel.closed") });
  }
  await showScreen(a, chatId, null, adminMenuScreen(a), toast);
}

/** A typed percent: a whole number 0–50 («10», «10%», « 7 »), else `null`. The service validates again. */
export function percentFromText(raw: string | undefined): number | null {
  const m = /^\s*(\d{1,2})\s*%?\s*$/.exec(raw ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  return isPaymentBonusPercent(n) ? n : null;
}

async function denied(a: BotAdmin, perm: Permission, updateId: number): Promise<void> {
  const r = await rateLimit(`admin-denied:${a.adminId}`, DENIED_LIMIT, 60, { failClosed: true });
  if (r.ok) await writeDeniedAudit(actorOf(a, updateId), perm, "bot/admin");
}

function errorText(lang: Lang, e: unknown): string {
  if (e instanceof ApiError) return at(lang, "toast.error", { msg: e.message }).slice(0, 190);
  throw e;
}

/* ───────────────────────── Entry points ───────────────────────── */

const LEADING = /^[\s\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Emoji_Component}‍️]+/u;

/** Whether a text is the «🛠 Admin» keyboard button (any language, with or without the emoji). */
export function isAdminButtonText(text: string): boolean {
  const bare = text.replace(LEADING, "").trim().toLowerCase();
  return Boolean(bare) && LANGS.some((l) => at(l, "kb.admin").toLowerCase() === bare);
}

/**
 * `/admin` or the «🛠 Admin» button: the panel as a new message when the
 * Telegram user is a linked admin; `false` otherwise (the caller keeps its
 * old behaviour — the contact-sharing flow / an ordinary text).
 */
export async function openPanel(chatId: number, telegramId: number): Promise<boolean> {
  if (chatId !== telegramId) return false;
  const { admin } = await lookupAdmin(telegramId);
  if (!admin) return false;
  await cancelInput(chatId);
  await clearState(chatId);
  // Owner C-Q6: the admin menu is a reply keyboard at the bottom (not inline buttons under the message).
  await showScreen(admin, chatId, null, adminMenuScreen(admin));
  return true;
}

/** Which admin menu button a text is (any language, with or without the emoji): its callback code, `"main"`, or `null`. */
export function adminMenuAction(text: string): string | null {
  const bare = text.replace(LEADING, "").trim().toLowerCase();
  if (!bare) return null;
  for (const l of LANGS) {
    if (at(l, "kb.mainMenu").toLowerCase() === bare) return "main";
    for (const m of ADMIN_MENU) if (at(l, m.key).toLowerCase() === bare) return m.data;
  }
  return null;
}

/**
 * A tap on a screen button of the admin reply keyboard: the text is EXACTLY one of the labels of the screen last
 * sent to this chat (`bot_admin_state.keys`, written by `showScreen`). It runs the code of that button through
 * `handleAdminCallback` — the same permission, rate-limit, step-up and audit checks as the inline buttons. Only
 * linked admins are served and only for the account the screen was sent to (anyone else's text, even an identical
 * one, falls through to the ordinary bot: `false`).
 */
async function tapScreenKey(chatId: number, telegramId: number, text: string, updateId: number): Promise<boolean> {
  if (chatId !== telegramId) return false;
  const hit = await matchScreenKey(chatId, text);
  if (!hit) return false;
  const { admin } = await lookupAdmin(telegramId);
  if (!admin || admin.adminId !== hit.adminId) return false;
  const toast = await handleAdminCallback(telegramId, chatId, null, hit.code, updateId);
  if (toast) await sendScreen(chatId, { text: esc(toast) });
  return true;
}

/**
 * A text from a private chat that may be an admin reply-keyboard tap: a button of the last screen (exact label), or
 * one of the static admin menu buttons (any language, with or without the emoji). `false` = not ours.
 */
export async function handleAdminReplyText(chatId: number, telegramId: number, text: string, updateId: number): Promise<boolean> {
  if (await tapScreenKey(chatId, telegramId, text, updateId)) return true;
  const action = adminMenuAction(text);
  if (!action || chatId !== telegramId) return false;
  const { admin } = await lookupAdmin(telegramId);
  if (!admin) return false;
  if (action === "main") {
    await clearState(chatId);
    await writeKeys(chatId, admin.adminId, []);
    await sendScreen(chatId, keyboardMessage(admin.lang, telegramId, "note", undefined, { admin: true }));
    return true;
  }
  const toast = await handleAdminCallback(telegramId, chatId, null, action, updateId);
  if (toast) await sendScreen(chatId, { text: esc(toast) });
  return true;
}

/** `true` when an admin flow consumed the message. */
export type AdminMessage = {
  message_id?: number;
  chat: { id: number; type?: string };
  from?: { id: number; is_bot?: boolean };
  text?: string;
  caption?: string;
  entities?: unknown[];
  caption_entities?: unknown[];
  photo?: Array<{ file_id: string; width?: number; height?: number; file_size?: number }>;
  video?: { file_id: string };
  forward_origin?: unknown;
};

/* ───────────────────────── Callbacks ───────────────────────── */

/**
 * An `a:*` button. Returns the toast text. A tap of anyone who is not a linked
 * admin (never linked, revoked, disabled, blocked) gets «Ruxsat yo‘q» and
 * nothing else; a linked admin without the permission also gets an
 * `auth.denied` audit row (rate-limited, like the web).
 */
export async function handleAdminCallback(
  telegramId: number,
  chatId: number,
  messageId: number | null,
  data: string,
  updateId: number,
): Promise<string | undefined> {
  const { lang, admin } = await lookupAdmin(telegramId);
  if (!admin || chatId !== telegramId) return at(lang, "toast.denied");
  const c = parseAdminCallback(data);
  if (c.kind === "unknown") return at(lang, "toast.old");
  const perm = PERM[c.kind];
  if (!allowed(admin, perm)) {
    await denied(admin, perm, updateId);
    return at(lang, "toast.denied");
  }
  if (!(await rateLimit(`admin:${admin.adminId}:bot`, ADMIN_BOT_RATE.limit, ADMIN_BOT_RATE.windowSec, { failClosed: true })).ok) {
    return at(lang, "toast.rate");
  }
  const st = await readState(chatId, admin.adminId);
  if (env.admin2faRequired && CONFIRMS.has(c.kind) && needsStepUp(perm) && !st.reauthFresh) {
    const draft: Draft = { ...(st.draft ?? { t: "none" }), resume: data };
    const prompt = await showScreen(admin, chatId, messageId, stepUpScreen(lang));
    await writeState(chatId, admin.adminId, { step: "totp", draft, promptMessageId: prompt });
    return undefined;
  }
  try {
    return await run(admin, c, st, chatId, messageId, updateId);
  } catch (e) {
    return errorText(lang, e);
  }
}

const AUDIENCES: Record<AudienceCode, Audience> = {
  all: { kind: "all" },
  act: { kind: "active_days", days: 30 },
  new: { kind: "new_days", days: 7 },
};

async function counts(): Promise<Record<AudienceCode, number>> {
  const [all, act, nw] = await Promise.all([audienceCount(AUDIENCES.all), audienceCount(AUDIENCES.act), audienceCount(AUDIENCES.new)]);
  return { all: all.count, act: act.count, new: nw.count };
}

const isBc = (d: Draft | null): d is BroadcastDraft & Draft => d?.t === "bc";
const isCh = (d: Draft | null): d is ChannelDraft & Draft => d?.t === "ch";

/** The draft's broadcast row (created once, at the first test or at the send). */
async function ensureBroadcast(a: BotAdmin, chatId: number, d: BroadcastDraft, updateId: number): Promise<string> {
  if (d.broadcastId) return d.broadcastId;
  // Serialised per chat (security review MAJOR): a double tap on «Yuborish» arrives as two updates; without the
  // lock both saw no broadcastId, both created a row and every recipient got the message twice. Under the lock
  // the second tap re-reads the draft, finds the first one's row, and the send's draft-state guard answers 409.
  const client = await pool().connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [`bot-admin-bc:${chatId}`]);
    const fresh = (await readState(chatId, a.adminId)).draft;
    if (isBc(fresh) && fresh.broadcastId) {
      d.broadcastId = fresh.broadcastId;
      return fresh.broadcastId;
    }
    const content: BroadcastContent = { ...d.content, notify: { chatId: String(chatId), lang: a.lang } };
    const { broadcast } = await createBroadcast(actorOf(a, updateId), { text: d.text, audience: AUDIENCES[d.audience ?? "all"] }, { content, via: "bot" });
    d.broadcastId = broadcast.id;
    await writeState(chatId, a.adminId, { step: null, draft: d });
    return broadcast.id;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`bot-admin-bc:${chatId}`]).catch(() => undefined);
    client.release();
  }
}

/** A draft row that no longer matches the draft (button / audience changed): cancelled, audited. */
async function discardBroadcast(a: BotAdmin, d: BroadcastDraft, updateId: number): Promise<void> {
  if (!d.broadcastId) return;
  const id = d.broadcastId;
  delete d.broadcastId;
  try {
    await cancelBroadcast(actorOf(a, updateId), id, { reason: REASON.discard }, { via: "bot" });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
  }
}

/**
 * Keeps the progress card the delivery loop edits (`content.notify.messageId`) pointing at the NEWEST card and
 * removes the superseded one: a reply keyboard cannot be edited, so every control tap sends a fresh card.
 */
async function moveProgressCard(id: string, chatId: number, messageId: number | null): Promise<void> {
  if (messageId === null) return;
  const prev = await queryOne<{ m: string | null }>("SELECT content #>> '{notify,messageId}' AS m FROM broadcasts WHERE id = $1", [id]);
  await setProgressMessage(id, messageId);
  const old = Number(prev?.m);
  if (Number.isSafeInteger(old) && old > 0 && old !== messageId) {
    await callBot("deleteMessage", { chat_id: chatId, message_id: old }).catch(() => undefined);
  }
}

/**
 * Runs one admin action. `messageId` is the inline message of an old `a:*` button that was tapped, or `null` when
 * the action comes from a reply-keyboard tap. Screens are always SENT as new messages (a reply keyboard cannot be
 * edited); a result toast that goes with a screen becomes the first line of that screen, any other toast is returned.
 */
async function run(a: BotAdmin, c: Exclude<AdminCallback, { kind: "unknown" }>, st: AdminState, chatId: number, messageId: number | null, updateId: number): Promise<string | undefined> {
  const l = a.lang;
  const show = (s: AdminScreen, toast?: string) => showScreen(a, chatId, messageId, s, toast);
  const d = st.draft;
  switch (c.kind) {
    case "panel":
    case "close": // «Yopish» on an old inline panel card
      await clearState(chatId);
      await backToMenu(a, chatId, messageId);
      return undefined;
    case "cancel":
      if (isBc(d)) await discardBroadcast(a, d, updateId);
      await clearState(chatId);
      await backToMenu(a, chatId, messageId, at(l, "toast.cancelled"));
      return undefined;
    case "stats":
      await show(statsScreen(a, await botStats()));
      return undefined;

    /* ── broadcast ── */
    case "bcStart": {
      if (isBc(d)) await discardBroadcast(a, d, updateId);
      await cancelInput(chatId);
      const id = await show(broadcastAskScreen(l));
      await writeState(chatId, a.adminId, { step: "bc_msg", draft: null, promptMessageId: id });
      return undefined;
    }
    case "bcButton": {
      if (!isBc(d)) return at(l, "toast.expired");
      await cancelInput(chatId);
      const id = await show(buttonAskScreen(l));
      await writeState(chatId, a.adminId, { step: "bc_btn", draft: d, promptMessageId: id });
      return undefined;
    }
    case "bcButtonDrop":
      if (!isBc(d)) return at(l, "toast.expired");
      await discardBroadcast(a, d, updateId);
      delete d.content.button;
      await show(draftScreen(l, d));
      await writeState(chatId, a.adminId, { step: null, draft: d });
      return undefined;
    case "bcDraft":
      if (!isBc(d)) return at(l, "toast.expired");
      await show(draftScreen(l, d));
      await writeState(chatId, a.adminId, { step: null, draft: d });
      return undefined;
    case "bcAudience":
      if (!isBc(d)) return at(l, "toast.expired");
      await show(audienceScreen(l, await counts()));
      await writeState(chatId, a.adminId, { step: null, draft: d });
      return undefined;
    case "bcPick": {
      if (!isBc(d)) return at(l, "toast.expired");
      if (d.audience !== c.audience) await discardBroadcast(a, d, updateId);
      d.audience = c.audience;
      const n = (await audienceCount(AUDIENCES[c.audience])).count;
      // The preview: the message exactly as recipients get it (copied back to the admin, with its own inline URL
      // button — the one inline button left), then the confirm screen under it.
      await sendBroadcastContent(String(chatId), d.text, d.content);
      await show(confirmScreen(l, c.audience, n));
      await writeState(chatId, a.adminId, { step: null, draft: d });
      return undefined;
    }
    case "bcTest": {
      if (!isBc(d) || !d.audience) return at(l, "toast.expired");
      const id = await ensureBroadcast(a, chatId, d, updateId);
      const r = await sendTest(actorOf(a, updateId), id, { via: "bot" });
      return at(l, r.sent ? "toast.testSent" : "toast.testFailed");
    }
    case "bcSend": {
      if (!isBc(d) || !d.audience) return at(l, "toast.expired");
      const id = await ensureBroadcast(a, chatId, d, updateId);
      try {
        await sendBroadcast(actorOf(a, updateId), id, { reason: REASON.send, confirmCount: c.count }, { via: "bot" });
      } catch (e) {
        // The second tap of a double tap: the broadcast already left the draft state.
        if (e instanceof ApiError && e.status === 409 && e.extra.code !== "count_changed" && e.extra.code !== "empty_audience") return at(l, "toast.expired");
        if (e instanceof ApiError && (e.extra.code === "count_changed" || e.extra.code === "empty_audience")) {
          const now = Number(e.extra.count) || 0;
          await show(confirmScreen(l, d.audience, now), at(l, "toast.countChanged", { n: now }));
          return undefined;
        }
        throw e;
      }
      await clearState(chatId);
      const b = await getBroadcast(id);
      // The engine keeps editing THIS message (text only) with the live numbers; the controls are its reply keyboard.
      await moveProgressCard(id, chatId, await show(progressScreen(l, b.broadcast, b.stats, true), at(l, "toast.queued")));
      return undefined;
    }
    case "bcProgress": {
      const b = await getBroadcast(c.id);
      await moveProgressCard(c.id, chatId, await show(progressScreen(l, b.broadcast, b.stats, allowed(a, "broadcasts.send")), at(l, "toast.refreshed")));
      return undefined;
    }
    case "bcPause":
    case "bcResume": {
      const act = c.kind === "bcPause" ? pauseBroadcast : resumeBroadcast;
      try {
        await act(actorOf(a, updateId), c.id, {}, { via: "bot" });
      } catch (e) {
        // Already paused / resumed / finished meanwhile: show what is true now.
        if (!(e instanceof ApiError && e.status === 409)) throw e;
      }
      const b = await getBroadcast(c.id);
      await moveProgressCard(c.id, chatId, await show(progressScreen(l, b.broadcast, b.stats, true), at(l, c.kind === "bcPause" ? "toast.paused" : "toast.resumed")));
      return undefined;
    }
    case "bcStopAsk": {
      const b = await getBroadcast(c.id);
      await show(stopAskScreen(l, c.id, b.stats.pending));
      return undefined;
    }
    case "bcStop": {
      await cancelBroadcast(actorOf(a, updateId), c.id, { reason: REASON.stop }, { via: "bot" });
      const b = await getBroadcast(c.id);
      await moveProgressCard(c.id, chatId, await show(progressScreen(l, b.broadcast, b.stats, true), at(l, "toast.stopped")));
      return undefined;
    }

    /* ── channels ── */
    case "channels":
      await show(channelsScreen(a, (await listBonusChannels()).items));
      return undefined;
    case "chConnect": {
      await cancelInput(chatId);
      const id = await show(channelAskScreen(l));
      await writeState(chatId, a.adminId, { step: "ch_ref", draft: null, promptMessageId: id });
      return undefined;
    }
    case "chKinds":
      if (!isCh(d)) return at(l, "toast.expired");
      await show(channelKindScreen(l, d));
      return undefined;
    case "chKind":
      if (!isCh(d)) return at(l, "toast.expired");
      d.mandatory = c.mandatory;
      delete d.type;
      await show(channelTypeScreen(l, d));
      await writeState(chatId, a.adminId, { step: null, draft: d });
      return undefined;
    case "chTypes":
      if (!isCh(d)) return at(l, "toast.expired");
      await show(channelTypeScreen(l, d));
      return undefined;
    case "chType":
      // A preset of the other kind (an old button) never mixes «mandatory» with an optional preset.
      if (!isCh(d) || !typeFits(c.type, d.mandatory ?? false)) return at(l, "toast.expired");
      d.type = c.type;
      await show(channelConfirmScreen(l, d, c.type));
      await writeState(chatId, a.adminId, { step: null, draft: d });
      return undefined;
    case "chCreate": {
      if (!isCh(d) || d.type !== c.type || !typeFits(c.type, d.mandatory ?? false)) return at(l, "toast.expired");
      return createChannel(a, d, c.type, show, updateId, chatId);
    }
    case "chToggle": {
      const cur = (await listBonusChannels()).items.find((x) => x.id === c.id);
      if (!cur) return at(l, "toast.old");
      await updateBonusChannel(actorOf(a, updateId), c.id, { active: !cur.active, reason: REASON.toggle });
      await show(channelsScreen(a, (await listBonusChannels()).items), at(l, cur.active ? "toast.chOff" : "toast.chOn"));
      return undefined;
    }

    /* ── payment bonus (C-Q4): the web's setting, through `payment-bonus.ts` ── */
    case "payBonus":
      await clearState(chatId);
      await show(payBonusScreen(a, await getPaymentBonusPercent()));
      return undefined;
    case "pbOther": {
      await cancelInput(chatId);
      const id = await show(payBonusAskScreen(l));
      await writeState(chatId, a.adminId, { step: "pb_val", draft: null, promptMessageId: id });
      return undefined;
    }
    case "pbPick":
      await show(payBonusConfirmScreen(l, await getPaymentBonusPercent(), c.percent));
      return undefined;
    case "pbSet": {
      const now = await setPaymentBonusPercent(actorOf(a, updateId), c.percent, REASON.payBonus, { via: "bot" });
      await clearState(chatId);
      await show(payBonusScreen(a, now), at(l, "toast.pbSaved", { p: now }));
      return undefined;
    }
  }
}

async function createChannel(
  a: BotAdmin,
  d: ChannelDraft,
  type: ChannelType,
  show: (s: AdminScreen, toast?: string) => Promise<number | null>,
  updateId: number,
  chatId: number,
): Promise<undefined> {
  const p = CHANNEL_PRESETS[type];
  const actor = actorOf(a, updateId);
  // A private channel needs an invite link for the «Obuna bo‘lish» button: ask Telegram for one (audited) when possible.
  let inviteLink: string | null = null;
  if (!d.username && d.botAdmin === "admin") {
    inviteLink = await createInviteLink(actor, { input: d.chatId })
      .then((r) => r.inviteLink)
      .catch((e: unknown) => {
        if (e instanceof ApiError) return null;
        throw e;
      });
  }
  await createBonusChannel(actor, {
    input: d.chatId,
    joinBonus: p.joinBonus,
    stayBonus: p.stayBonus,
    stayDays: p.stayDays,
    mandatory: d.mandatory ?? false,
    ...(inviteLink ? { inviteLink } : {}),
    reason: REASON.channel,
  });
  await clearState(chatId);
  const toast = !d.username && !inviteLink ? `${at(a.lang, "toast.chCreated")}. ${at(a.lang, "ch.noInvite")}`.slice(0, 190) : at(a.lang, "toast.chCreated");
  await show(channelsScreen(a, (await listBonusChannels()).items), toast);
}

/* ───────────────────────── Typed answers ───────────────────────── */

type Parsed<T> = { ok: T } | { problem: InputProblem };

/** The admin's message → a broadcast draft (text / photo / video, formatting entities kept). */
export function draftFromMessage(m: AdminMessage): Parsed<BroadcastDraft> {
  if (m.photo?.length || m.video) {
    const fileId = m.video ? m.video.file_id : m.photo![m.photo!.length - 1]!.file_id;
    const text = m.caption ?? "";
    if (text.length > CAPTION_MAX) return { problem: { kind: "caption", n: text.length } };
    const entities = cleanEntities(m.caption_entities, text);
    return {
      ok: { t: "bc", text, content: { kind: m.video ? "video" : "photo", fileId, ...(entities.length ? { entities } : {}) } },
    };
  }
  if (typeof m.text === "string" && m.text.trim()) {
    const n = Array.from(m.text).length;
    if (n > BROADCAST_TEXT_MAX) return { problem: { kind: "long", n, max: BROADCAST_TEXT_MAX } };
    const entities = cleanEntities(m.entities, m.text);
    return { ok: { t: "bc", text: m.text, content: { kind: "text", ...(entities.length ? { entities } : {}) } } };
  }
  return { problem: { kind: "type" } };
}

/** `Matn | https://…` or the text and the link on two lines. */
export function buttonFromText(raw: string | undefined): { text: string; url: string } | null {
  if (!raw) return null;
  const s = raw.trim();
  const bar = s.lastIndexOf("|");
  const nl = s.lastIndexOf("\n");
  const cut = bar >= 0 ? bar : nl;
  if (cut <= 0) return null;
  const text = parseButtonText(s.slice(0, cut));
  const url = parseButtonUrl(s.slice(cut + 1));
  return text && url ? { text, url } : null;
}

/** The channel a forwarded post comes from (`forward_origin.type = "channel"`), as a chat id. */
function forwardedChannel(m: AdminMessage): string | null {
  const o = m.forward_origin as { type?: string; chat?: { id?: unknown; type?: string } } | undefined;
  if (o?.type !== "channel" || !o.chat) return null;
  const id = o.chat.id;
  return typeof id === "number" && Number.isSafeInteger(id) ? String(id) : null;
}

/**
 * A message while an admin step waits for input. `false` = not ours: nothing
 * pending, a command / keyboard button (which drops the step), or the sender is
 * no longer an admin (the step is dropped too) — the caller handles it as usual.
 */
export async function handleAdminInput(m: AdminMessage, updateId: number): Promise<boolean> {
  const chatId = m.chat.id;
  if (!m.from || m.from.is_bot || m.chat.type !== "private" || m.from.id !== chatId) return false;
  if (!(await hasPendingStep(chatId))) return false;
  const text = m.text;
  // The step's own keyboard («Bekor qilish» / «Orqaga») is checked BEFORE the text is taken as content: typing the
  // label of a button is pressing it (its code runs through the ordinary callback path).
  if (text !== undefined && (await tapScreenKey(chatId, m.from.id, text, updateId))) return true;
  if (text !== undefined && (text.trim().startsWith("/") || matchKeyboard(text) || isAdminButtonText(text) || adminMenuAction(text))) {
    await clearState(chatId);
    return false;
  }
  const { admin } = await lookupAdmin(m.from.id);
  if (!admin) {
    await clearState(chatId);
    return false;
  }
  const st = await readState(chatId, admin.adminId);
  if (!st.step) return false;
  const l = admin.lang;
  // Each input may call the Bot API (getChat/getChatMember): same per-admin budget as the buttons (review MINOR).
  if (!(await rateLimit(`admin:${admin.adminId}:bot`, ADMIN_BOT_RATE.limit, ADMIN_BOT_RATE.windowSec, { failClosed: true })).ok) return true;
  if (!allowed(admin, STEP_PERM[st.step])) {
    await clearState(chatId);
    await denied(admin, STEP_PERM[st.step], updateId);
    await sendScreen(chatId, { text: `${tgEmoji("lock")} ${at(l, "toast.denied")}` });
    return true;
  }
  if (!(await claimStep(chatId, admin.adminId, updateId))) return true;
  const reprompt = async (screen: AdminScreen) => {
    const id = await showScreen(admin, chatId, null, screen);
    await releaseStep(chatId, updateId, id);
  };
  const show = (screen: AdminScreen) => showScreen(admin, chatId, null, screen);

  switch (st.step) {
    case "bc_msg": {
      const r = draftFromMessage(m);
      if ("problem" in r) return reprompt(inputProblemScreen(l, r.problem, broadcastAskScreen(l))).then(() => true);
      await show(draftScreen(l, r.ok));
      await writeState(chatId, admin.adminId, { step: null, draft: r.ok });
      return true;
    }
    case "bc_btn": {
      const d = st.draft;
      const b = buttonFromText(text);
      if (!isBc(d)) {
        await clearState(chatId);
        await sendScreen(chatId, { text: at(l, "toast.expired") });
        return true;
      }
      if (!b) return reprompt(inputProblemScreen(l, { kind: "button" }, buttonAskScreen(l))).then(() => true);
      await discardBroadcast(admin, d, updateId);
      d.content.button = b;
      await show(draftScreen(l, d));
      await writeState(chatId, admin.adminId, { step: null, draft: d });
      return true;
    }
    case "ch_ref": {
      const input = forwardedChannel(m) ?? (m.forward_origin ? null : text?.trim() || null);
      if (!input) return reprompt(channelProblemScreen(l, at(l, "ch.notChannel"))).then(() => true);
      let resolved;
      try {
        resolved = await resolveChannel(parseChannelRef(input));
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        return reprompt(channelProblemScreen(l, at(l, "ch.bad", { why: e.message }))).then(() => true);
      }
      if (resolved.existingId) {
        await sendScreen(chatId, { text: `${tgEmoji("warn")} ${at(l, "ch.exists")}` });
        await show(channelsScreen(admin, (await listBonusChannels()).items));
        await clearState(chatId);
        return true;
      }
      const d: ChannelDraft = { t: "ch", chatId: resolved.chatId, title: resolved.title, username: resolved.username, botAdmin: resolved.botAdmin };
      await show(channelKindScreen(l, d));
      await writeState(chatId, admin.adminId, { step: null, draft: d });
      return true;
    }
    case "pb_val": {
      const p = percentFromText(text);
      if (p === null) return reprompt(payBonusAskScreen(l, at(l, "pb.bad"))).then(() => true);
      await show(payBonusConfirmScreen(l, await getPaymentBonusPercent(), p));
      await writeState(chatId, admin.adminId, { step: null, draft: null });
      return true;
    }
    case "totp":
      return stepUpInput(admin, st, chatId, m, updateId, reprompt);
  }
}

async function stepUpInput(
  a: BotAdmin,
  st: AdminState,
  chatId: number,
  m: AdminMessage,
  updateId: number,
  reprompt: (s: AdminScreen) => Promise<void>,
): Promise<boolean> {
  const l = a.lang;
  // The code is a secret: removed from the chat whatever the outcome (best effort).
  if (m.message_id) await callBot("deleteMessage", { chat_id: chatId, message_id: m.message_id }).catch(() => undefined);
  try {
    await botStepUp(
      { adminId: a.adminId, userId: a.userId, role: a.role, telegramId: String(a.telegramId), requestId: `tg-update:${updateId}` },
      m.text ?? "",
      (client) => markBotReauth(client, chatId, a.adminId),
    );
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status === 400 || e.status === 401) {
      await reprompt(stepUpScreen(l, e.message));
      return true;
    }
    await clearState(chatId);
    await sendScreen(chatId, { text: `${tgEmoji("warn")} ${esc(e.message)}` });
    return true;
  }
  const resume = st.draft?.resume;
  const draft: Draft | null = st.draft && st.draft.t !== "none" ? { ...st.draft } : null;
  if (draft) delete draft.resume;
  await writeState(chatId, a.adminId, { step: null, draft, promptMessageId: st.promptMessageId });
  if (resume) {
    // The code was typed in the chat: no inline message is involved, the confirmed action answers with a new screen.
    const toast = await handleAdminCallback(a.telegramId, chatId, null, resume, updateId);
    if (toast) await sendScreen(chatId, { text: esc(toast) });
  }
  return true;
}

/* ───────────────────────── Delivery notice ───────────────────────── */

/** Called by delivery when a bot broadcast is done: the summary to the admin who composed it (still an admin). */
export async function notifyBroadcastDone(id: string, notify: { chatId: string; lang: string }): Promise<void> {
  const chatId = Number(notify.chatId);
  const { admin } = await lookupAdmin(chatId);
  if (!admin) return;
  const r = await queryOne<{ sent: number; failed: number; total: number; status: string }>("SELECT sent, failed, total, status FROM broadcasts WHERE id = $1", [id]);
  if (!r) return;
  // The summary comes with the admin menu reply keyboard (the progress controls are over).
  const withMenu = (text: string): AdminScreen => ({ text, reply_markup: adminMenuKeyboard(admin), keys: [] });
  if (r.status === "failed") {
    // The engine aborted it (every send was refused for good): the card names the reason.
    const b = await getBroadcast(id);
    await showScreen(admin, chatId, null, withMenu(progressScreen(langOf(admin.lang), b.broadcast, b.stats, false).text));
    return;
  }
  const done = broadcastDoneScreen(langOf(admin.lang), id, { sent: Number(r.sent), failed: Number(r.failed), total: Number(r.total) });
  await showScreen(admin, chatId, null, withMenu(done.text));
}

/**
 * Called by the delivery engine about every 10 s while a bot broadcast sends: edits the admin's progress
 * message in place (never sends a new one — a deleted message just stops updating). Best effort.
 */
export async function editBroadcastProgress(id: string, notify: { chatId: string; lang: string; messageId?: number }): Promise<void> {
  if (!notify.messageId) return;
  const chatId = Number(notify.chatId);
  const { admin } = await lookupAdmin(chatId);
  if (!admin) return;
  const b = await getBroadcast(id);
  const screen = progressScreen(langOf(admin.lang), b.broadcast, b.stats, allowed(admin, "broadcasts.send"));
  await callBot("editMessageText", {
    chat_id: chatId,
    message_id: notify.messageId,
    text: screen.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    // Text only: the controls live in the reply keyboard of the card's sending (`progressScreen`).
    reply_markup: { inline_keyboard: [] },
  });
}

/** Every admin text key (tests check all three languages are filled). */
export { ADMIN_TEXT_KEYS };
