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
  closedScreen,
  confirmScreen,
  draftScreen,
  inputProblemScreen,
  ADMIN_MENU,
  adminMenuScreen,
  panelScreen,
  payBonusAskScreen,
  payBonusConfirmScreen,
  payBonusScreen,
  progressScreen,
  statsScreen,
  stepUpScreen,
  stopAskScreen,
  type InputProblem,
} from "./admin-screens";
import { botStats } from "./admin-stats";
import {
  claimStep,
  clearState,
  hasPendingStep,
  markBotReauth,
  readState,
  releaseStep,
  writeState,
  type AdminState,
  type BroadcastDraft,
  type ChannelDraft,
  type Draft,
} from "./admin-state";
import { esc, tgEmoji, type Screen } from "./ui";

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

/** The panel with the current payment bonus on its «💳 To‘lov bonusi: N%» button. */
async function panel(a: BotAdmin): Promise<Screen> {
  return panelScreen(a, await getPaymentBonusPercent());
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
  await sendScreen(chatId, adminMenuScreen(admin));
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
 * A tap on the admin reply keyboard. Only linked admins are served (anyone else's text falls through, `false`).
 * The action runs through `handleAdminCallback` (same permission, rate-limit, step-up and audit checks as the
 * inline buttons) on a fresh message it then edits; «Asosiy menyu» brings the main keyboard back.
 */
export async function handleAdminMenuText(chatId: number, telegramId: number, text: string, updateId: number): Promise<boolean> {
  const action = adminMenuAction(text);
  if (!action || chatId !== telegramId) return false;
  const { admin } = await lookupAdmin(telegramId);
  if (!admin) return false;
  if (action === "main") {
    await clearState(chatId);
    await sendScreen(chatId, keyboardMessage(admin.lang, telegramId, "note", undefined, { admin: true }));
    return true;
  }
  const messageId = await sendScreen(chatId, { text: "⏳" });
  if (messageId === null) return true;
  const toast = await handleAdminCallback(telegramId, chatId, messageId, action, updateId);
  if (toast) await editScreen(chatId, messageId, { text: esc(toast) });
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
  messageId: number,
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
    await editScreen(chatId, messageId, stepUpScreen(lang));
    await writeState(chatId, admin.adminId, { step: "totp", draft, promptMessageId: messageId });
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

async function run(a: BotAdmin, c: Exclude<AdminCallback, { kind: "unknown" }>, st: AdminState, chatId: number, messageId: number, updateId: number): Promise<string | undefined> {
  const l = a.lang;
  const edit = (s: Screen) => editScreen(chatId, messageId, s);
  const d = st.draft;
  switch (c.kind) {
    case "panel":
      await clearState(chatId);
      await edit(await panel(a));
      return undefined;
    case "close":
      await clearState(chatId);
      await edit(closedScreen(l));
      return undefined;
    case "cancel":
      if (isBc(d)) await discardBroadcast(a, d, updateId);
      await clearState(chatId);
      await edit(await panel(a));
      return at(l, "toast.cancelled");
    case "stats":
      await edit(statsScreen(a, await botStats()));
      return undefined;

    /* ── broadcast ── */
    case "bcStart":
      if (isBc(d)) await discardBroadcast(a, d, updateId);
      await cancelInput(chatId);
      await edit(broadcastAskScreen(l));
      await writeState(chatId, a.adminId, { step: "bc_msg", draft: null, promptMessageId: messageId });
      return undefined;
    case "bcButton":
      if (!isBc(d)) return at(l, "toast.expired");
      await cancelInput(chatId);
      await edit(buttonAskScreen(l));
      await writeState(chatId, a.adminId, { step: "bc_btn", draft: d, promptMessageId: messageId });
      return undefined;
    case "bcButtonDrop":
      if (!isBc(d)) return at(l, "toast.expired");
      await discardBroadcast(a, d, updateId);
      delete d.content.button;
      await edit(draftScreen(l, d));
      await writeState(chatId, a.adminId, { step: null, draft: d });
      return undefined;
    case "bcDraft":
      if (!isBc(d)) return at(l, "toast.expired");
      await edit(draftScreen(l, d));
      await writeState(chatId, a.adminId, { step: null, draft: d });
      return undefined;
    case "bcAudience":
      if (!isBc(d)) return at(l, "toast.expired");
      await edit(audienceScreen(l, await counts()));
      await writeState(chatId, a.adminId, { step: null, draft: d });
      return undefined;
    case "bcPick": {
      if (!isBc(d)) return at(l, "toast.expired");
      if (d.audience !== c.audience) await discardBroadcast(a, d, updateId);
      d.audience = c.audience;
      const n = (await audienceCount(AUDIENCES[c.audience])).count;
      // The preview: the message exactly as recipients get it (copied back to the admin), then the confirm card under it.
      await callBot("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
      await sendBroadcastContent(String(chatId), d.text, d.content);
      await sendScreen(chatId, confirmScreen(l, c.audience, n));
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
          await edit(confirmScreen(l, d.audience, now));
          return at(l, "toast.countChanged", { n: now });
        }
        throw e;
      }
      await clearState(chatId);
      const b = await getBroadcast(id);
      // The engine keeps editing THIS message with the live numbers.
      await setProgressMessage(id, await edit(progressScreen(l, b.broadcast, b.stats, true)));
      return at(l, "toast.queued");
    }
    case "bcProgress": {
      const b = await getBroadcast(c.id);
      await setProgressMessage(c.id, await edit(progressScreen(l, b.broadcast, b.stats, allowed(a, "broadcasts.send"))));
      return at(l, "toast.refreshed");
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
      await setProgressMessage(c.id, await edit(progressScreen(l, b.broadcast, b.stats, true)));
      return at(l, c.kind === "bcPause" ? "toast.paused" : "toast.resumed");
    }
    case "bcStopAsk": {
      const b = await getBroadcast(c.id);
      await edit(stopAskScreen(l, c.id, b.stats.pending));
      return undefined;
    }
    case "bcStop": {
      await cancelBroadcast(actorOf(a, updateId), c.id, { reason: REASON.stop }, { via: "bot" });
      const b = await getBroadcast(c.id);
      await edit(progressScreen(l, b.broadcast, b.stats, true));
      return at(l, "toast.stopped");
    }

    /* ── channels ── */
    case "channels":
      await edit(channelsScreen(a, (await listBonusChannels()).items));
      return undefined;
    case "chConnect":
      await cancelInput(chatId);
      await edit(channelAskScreen(l));
      await writeState(chatId, a.adminId, { step: "ch_ref", draft: null, promptMessageId: messageId });
      return undefined;
    case "chKinds":
      if (!isCh(d)) return at(l, "toast.expired");
      await edit(channelKindScreen(l, d));
      return undefined;
    case "chKind":
      if (!isCh(d)) return at(l, "toast.expired");
      d.mandatory = c.mandatory;
      delete d.type;
      await edit(channelTypeScreen(l, d));
      await writeState(chatId, a.adminId, { step: null, draft: d });
      return undefined;
    case "chTypes":
      if (!isCh(d)) return at(l, "toast.expired");
      await edit(channelTypeScreen(l, d));
      return undefined;
    case "chType":
      // A preset of the other kind (an old button) never mixes «mandatory» with an optional preset.
      if (!isCh(d) || !typeFits(c.type, d.mandatory ?? false)) return at(l, "toast.expired");
      d.type = c.type;
      await edit(channelConfirmScreen(l, d, c.type));
      await writeState(chatId, a.adminId, { step: null, draft: d });
      return undefined;
    case "chCreate": {
      if (!isCh(d) || d.type !== c.type || !typeFits(c.type, d.mandatory ?? false)) return at(l, "toast.expired");
      return createChannel(a, d, c.type, chatId, messageId, updateId);
    }
    case "chToggle": {
      const cur = (await listBonusChannels()).items.find((x) => x.id === c.id);
      if (!cur) return at(l, "toast.old");
      await updateBonusChannel(actorOf(a, updateId), c.id, { active: !cur.active, reason: REASON.toggle });
      await edit(channelsScreen(a, (await listBonusChannels()).items));
      return at(l, cur.active ? "toast.chOff" : "toast.chOn");
    }

    /* ── payment bonus (C-Q4): the web's setting, through `payment-bonus.ts` ── */
    case "payBonus":
      await clearState(chatId);
      await edit(payBonusScreen(a, await getPaymentBonusPercent()));
      return undefined;
    case "pbOther":
      await cancelInput(chatId);
      await edit(payBonusAskScreen(l));
      await writeState(chatId, a.adminId, { step: "pb_val", draft: null, promptMessageId: messageId });
      return undefined;
    case "pbPick":
      await edit(payBonusConfirmScreen(l, await getPaymentBonusPercent(), c.percent));
      return undefined;
    case "pbSet": {
      const now = await setPaymentBonusPercent(actorOf(a, updateId), c.percent, REASON.payBonus, { via: "bot" });
      await clearState(chatId);
      await edit(payBonusScreen(a, now));
      return at(l, "toast.pbSaved", { p: now });
    }
  }
}

async function createChannel(a: BotAdmin, d: ChannelDraft, type: ChannelType, chatId: number, messageId: number, updateId: number): Promise<string> {
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
  await editScreen(chatId, messageId, channelsScreen(a, (await listBonusChannels()).items));
  return !d.username && !inviteLink ? `${at(a.lang, "toast.chCreated")}. ${at(a.lang, "ch.noInvite")}`.slice(0, 190) : at(a.lang, "toast.chCreated");
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
  const reprompt = async (screen: Screen) => {
    const id = await sendScreen(chatId, screen);
    await releaseStep(chatId, updateId, id);
  };
  const clearPrompt = () =>
    st.promptMessageId
      ? callBot("editMessageReplyMarkup", { chat_id: chatId, message_id: st.promptMessageId, reply_markup: { inline_keyboard: [] } }).catch(() => undefined)
      : Promise.resolve();

  switch (st.step) {
    case "bc_msg": {
      const r = draftFromMessage(m);
      if ("problem" in r) return reprompt(inputProblemScreen(l, r.problem, broadcastAskScreen(l))).then(() => true);
      await clearPrompt();
      await sendScreen(chatId, draftScreen(l, r.ok));
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
      await clearPrompt();
      await sendScreen(chatId, draftScreen(l, d));
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
      await clearPrompt();
      if (resolved.existingId) {
        await sendScreen(chatId, { text: `${tgEmoji("warn")} ${at(l, "ch.exists")}` });
        await sendScreen(chatId, channelsScreen(admin, (await listBonusChannels()).items));
        await clearState(chatId);
        return true;
      }
      const d: ChannelDraft = { t: "ch", chatId: resolved.chatId, title: resolved.title, username: resolved.username, botAdmin: resolved.botAdmin };
      await sendScreen(chatId, channelKindScreen(l, d));
      await writeState(chatId, admin.adminId, { step: null, draft: d });
      return true;
    }
    case "pb_val": {
      const p = percentFromText(text);
      if (p === null) return reprompt(payBonusAskScreen(l, at(l, "pb.bad"))).then(() => true);
      await clearPrompt();
      await sendScreen(chatId, payBonusConfirmScreen(l, await getPaymentBonusPercent(), p));
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
  reprompt: (s: Screen) => Promise<void>,
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
  if (resume && st.promptMessageId) {
    const toast = await handleAdminCallback(a.telegramId, chatId, st.promptMessageId, resume, updateId);
    if (toast) await sendScreen(chatId, { text: toast });
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
  if (r.status === "failed") {
    // The engine aborted it (every send was refused for good): the card names the reason.
    const b = await getBroadcast(id);
    await sendScreen(chatId, progressScreen(langOf(admin.lang), b.broadcast, b.stats, false));
    return;
  }
  await sendScreen(chatId, broadcastDoneScreen(langOf(admin.lang), id, { sent: Number(r.sent), failed: Number(r.failed), total: Number(r.total) }));
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
    reply_markup: screen.reply_markup ?? { inline_keyboard: [] },
  });
}

/** Every admin text key (tests check all three languages are filled). */
export { ADMIN_TEXT_KEYS };
