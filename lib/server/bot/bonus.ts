import { formatPoints, telegramShareUrl } from "../../referral";
import { FIRST_TOPUP_MIN_SOUM, FIRST_TOPUP_PERCENT } from "../../topup-bonus";
import type { BonusTasks, ChannelTask } from "../bonus-channels";
import { cb } from "./codes";
import { t, type Lang } from "./i18n";
import { appUrl, clip, esc, inlineButton, isPublicHttps, rows, tgEmoji, type InlineButton, type Screen } from "./ui";

/**
 * «Sizning bonuslaringiz» (docs/bonus/PLAN.md, Bonus 2: B2-Q2..Q4) — pure
 * renderers: the bonuses message (edited in place from Hamyon), the
 * auto-pay notice of a channel join and the worker's stay-bonus notice.
 * Data comes from `bonus-channels.ts bonusTasks`.
 *
 * Every task is ONE button under a short summary: done → «✅ …» green
 * (`style: success`), not done → the action itself (the channel link, the
 * Telegram share sheet, the wallet web app). Bonus amounts are in so‘m
 * (B2-Q3): `som(lang, n)`.
 */

/** Channels listed on one message (the admin list is short; this only bounds the keyboard). */
export const BONUS_MAX_CHANNELS = 20;
/** Longest button label (without the leading icon); longer channel titles are cut to fit. */
export const BONUS_LABEL_MAX = 44;
/** A channel title keeps at least this many characters, however long the rest of its label is. */
const TITLE_MIN = 12;

const DAY_MS = 86_400_000;

/** A bonus amount: «2 000 so‘m» / «2 000 сум» / «2 000 UZS». */
export function som(lang: Lang, n: number): string {
  return t(lang, "unit.som", { n: formatPoints(n) });
}

export type ChannelState =
  | { kind: "new" }
  | { kind: "done" }
  | { kind: "wait"; daysLeft: number }
  | { kind: "due" };

/** Where a user stands on one channel task at `now`. */
export function channelState(c: Pick<ChannelTask, "stayBonus" | "stayDays" | "claim">, now: number): ChannelState {
  const claim = c.claim;
  if (!claim) return { kind: "new" };
  if (claim.stayPaid !== null || claim.leftAt || c.stayBonus <= 0) return { kind: "done" };
  const left = Math.ceil((Date.parse(claim.joinedAt) + c.stayDays * DAY_MS - now) / DAY_MS);
  return left > 0 ? { kind: "wait", daysLeft: left } : { kind: "due" };
}

/** The stay part of a joined channel's label: «⏳ 7 kun: 4 kun» while waiting, «✅ +2 000» once paid, else nothing. */
function staySuffix(lang: Lang, c: ChannelTask, now: number): string {
  if (c.stayBonus <= 0 || !c.claim) return "";
  if (c.claim.stayPaid !== null) return c.claim.stayPaid > 0 ? ` · ✅ +${formatPoints(c.claim.stayPaid)}` : "";
  if (c.claim.leftAt) return "";
  const s = channelState(c, now);
  const left = s.kind === "wait" ? s.daysLeft : 0;
  return ` · ${t(lang, "task.stayWait", { d: c.stayDays, n: left })}`;
}

/** `<title> · +1 000 so‘m[ · stay]` with the title cut so the label stays ≤ BONUS_LABEL_MAX. */
function channelLabel(lang: Lang, c: ChannelTask, now: number): string {
  const amount = c.claim ? c.claim.joinPaid : c.joinBonus;
  const rest = ` · +${som(lang, amount)}${staySuffix(lang, c, now)}`;
  return `${clip(c.title, Math.max(TITLE_MIN, BONUS_LABEL_MAX - rest.length))}${rest}`;
}

function channelButton(lang: Lang, c: ChannelTask, now: number): InlineButton {
  const label = channelLabel(lang, c, now);
  if (c.claim) return inlineButton("save", label, { callback_data: cb.bonusDone() }, "success");
  // No public link (a private channel without a stored invite link): the tap checks this one channel.
  return c.joinUrl
    ? inlineButton("megaphone", label, { url: c.joinUrl })
    : inlineButton("megaphone", label, { callback_data: cb.bonusCheck(c.id) });
}

/** Invite friends: the Telegram share sheet (green once at least one friend joined). */
function inviteButton(lang: Lang, r: BonusTasks["referral"]): InlineButton {
  const action = isPublicHttps(r.link) ? { url: telegramShareUrl(r.link) } : { copy_text: { text: r.link.slice(0, 256) } };
  return r.invitedCount > 0
    ? inlineButton("save", t(lang, "task.invited", { a: formatPoints(r.invitedCount), n: som(lang, r.earnedPoints) }), action, "success")
    : inlineButton("group", t(lang, "task.invite", { n: som(lang, r.rewardPoints) }), action, "primary");
}

function topupButton(lang: Lang, f: BonusTasks["firstTopup"]): InlineButton | null {
  if (f.paid) return inlineButton("save", t(lang, "task.topupPaid", { n: som(lang, f.points) }), { callback_data: cb.bonusDone() }, "success");
  // An INLINE web_app button carries initData: the plain URL logs in silently (no personal `?bt=` link in chat history).
  const wallet = appUrl("/uz/wallet");
  return wallet
    ? inlineButton("card", t(lang, "task.topup", { p: FIRST_TOPUP_PERCENT, m: som(lang, FIRST_TOPUP_MIN_SOUM) }), { web_app: { url: wallet } })
    : null;
}

/**
 * «Sizning bonuslaringiz»: the summary (earned · still available), a short
 * explanation, then one button per task — sign-up, invite friends, each active
 * channel, the first top-up — and [«🔄 Yangilash»][«⬅️ Hamyon»].
 */
export function bonusScreen(lang: Lang, tasks: BonusTasks, now: number): Screen {
  const channels = tasks.channels.slice(0, BONUS_MAX_CHANNELS);
  const text = [
    `${tgEmoji("gift")} <b>${t(lang, "bonus.title")}</b>`,
    "",
    `<blockquote>${tgEmoji("star")} ${t(lang, "bonus.summary", { e: som(lang, tasks.earnedTotal), a: som(lang, tasks.availableTotal) })}</blockquote>`,
    "",
    t(lang, "bonus.lead"),
    `<i>${t(lang, "bonus.refreshHint")}</i>`,
  ].join("\n");
  // Always done; the amount is the booked ledger row (an account from before the sign-up bonus has none).
  const signup = `${t(lang, "task.signup")}${tasks.signupPoints > 0 ? ` · +${som(lang, tasks.signupPoints)}` : ""}`;
  return {
    text,
    reply_markup: rows(
      [inlineButton("save", signup, { callback_data: cb.bonusDone() }, "success")],
      [inviteButton(lang, tasks.referral)],
      ...channels.map((c) => [channelButton(lang, c, now)]),
      [topupButton(lang, tasks.firstTopup)],
      [
        inlineButton("refresh", t(lang, "btn.refresh"), { callback_data: cb.bonusRefresh() }),
        inlineButton("back", t(lang, "btn.wallet"), { callback_data: cb.wallet() }),
      ],
    ),
  };
}

/** Taps on a green task and every notice lead back to «Sizning bonuslaringiz». */
function bonusesButton(lang: Lang): InlineButton {
  return inlineButton("gift", t(lang, "btn.bonus"), { callback_data: cb.bonus() }, "success");
}

/** B2-Q2: the message after a channel join paid automatically (`bonus-channels.ts recordChannelJoin`). */
export function joinPaidNotice(lang: Lang, p: { points: number; title: string; stayBonus: number; stayDays: number }): Screen {
  const lines = [
    `${tgEmoji("party")} <b>${t(lang, "bonus.paidTitle", { n: som(lang, p.points) })}</b>`,
    t(lang, "bonus.joinText", { c: esc(clip(p.title, 60)) }),
  ];
  if (p.stayBonus > 0) lines.push(t(lang, "bonus.joinStay", { d: p.stayDays, s: som(lang, p.stayBonus) }));
  return { text: lines.join("\n"), reply_markup: rows([bonusesButton(lang)]) };
}

/** The worker's message after a paid stay bonus (a new message: it is not an answer to a tap). */
export function stayPaidNotice(lang: Lang, p: { points: number; title: string; stayDays: number }): Screen {
  return {
    text: [
      `${tgEmoji("party")} <b>${t(lang, "bonus.paidTitle", { n: som(lang, p.points) })}</b>`,
      t(lang, "bonus.stayText", { c: esc(clip(p.title, 60)), d: p.stayDays }),
    ].join("\n"),
    reply_markup: rows([bonusesButton(lang)]),
  };
}
