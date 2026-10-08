import { formatPoints, telegramShareUrl } from "../../referral";
import type { BonusTasks, ChannelTask } from "../bonus-channels";
import { cb } from "./codes";
import { t, type Lang } from "./i18n";
import { clip, esc, inlineButton, isPublicHttps, rows, tgEmoji, type InlineButton, type Screen } from "./ui";

/**
 * «🎁 Bonus olish» (docs/bonus/PLAN.md, K1) — pure renderers: the tasks
 * screen (edited in place from Hamyon), its success card, and the worker's
 * stay-bonus notice. Data comes from `bonus-channels.ts bonusTasks`.
 */

/** Channels listed on one screen (the admin list is short; this only bounds the message). */
export const BONUS_MAX_CHANNELS = 20;

const DAY_MS = 86_400_000;

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

function rewardText(lang: Lang, c: Pick<ChannelTask, "joinBonus" | "stayBonus" | "stayDays">): string {
  return c.stayBonus > 0
    ? t(lang, "bonus.rewardJoinStay", { n: formatPoints(c.joinBonus), d: c.stayDays, s: formatPoints(c.stayBonus) })
    : t(lang, "bonus.rewardJoin", { n: formatPoints(c.joinBonus) });
}

function stateLine(lang: Lang, c: ChannelTask, now: number): string {
  const s = channelState(c, now);
  switch (s.kind) {
    case "new":
      return `${tgEmoji("sparkles")} ${t(lang, "bonus.stateNew")}`;
    case "done":
      return `${tgEmoji("save")} ${t(lang, "bonus.stateDone")}`;
    case "wait":
      return `${tgEmoji("clock")} ${t(lang, "bonus.stateWait", { d: c.stayDays, n: s.daysLeft })}`;
    case "due":
      return `${tgEmoji("clock")} ${t(lang, "bonus.stateDue", { d: c.stayDays })}`;
  }
}

/** The success banner after a paid «Tekshirish». */
export type Celebrate = { points: number; title: string; stayBonus: number; stayDays: number };

function celebrateLines(lang: Lang, c: Celebrate): string[] {
  const title = esc(clip(c.title, 60));
  if (c.points <= 0) return [`${tgEmoji("save")} <b>${t(lang, "bonus.confirmed")}</b>`, ""];
  const lines = [
    `${tgEmoji("party")} <b>${t(lang, "bonus.celebrateTitle", { n: formatPoints(c.points) })}</b>`,
    t(lang, "bonus.celebrateJoin", { c: title }),
  ];
  if (c.stayBonus > 0) lines.push(t(lang, "bonus.celebrateStay", { d: c.stayDays, s: formatPoints(c.stayBonus) }));
  return [`<blockquote>${lines.join("\n")}</blockquote>`, ""];
}

/**
 * The tasks screen: earned total, «invite a friend», each active channel
 * (title, reward, state) with «Obuna bo‘lish» (t.me/<username>, or the
 * admin-set invite link of a private channel; none without either) and «Tekshirish» for the ones not claimed yet.
 */
export function bonusScreen(lang: Lang, tasks: BonusTasks, now: number, celebrate?: Celebrate | null): Screen {
  const channels = tasks.channels.slice(0, BONUS_MAX_CHANNELS);
  const lines: string[] = [];
  if (celebrate) lines.push(...celebrateLines(lang, celebrate));
  lines.push(
    `${tgEmoji("gift")} <b>${t(lang, "bonus.title")}</b>`,
    t(lang, "bonus.lead"),
    "",
    `<blockquote>${tgEmoji("star")} ${t(lang, "bonus.earned", { n: t(lang, "unit.ball", { n: formatPoints(tasks.earnedTotal) }) })}</blockquote>`,
    "",
    `${tgEmoji("group")} <b>${t(lang, "bonus.invite", { n: formatPoints(tasks.referral.rewardPoints) })}</b>`,
    t(lang, "bonus.inviteCounts", {
      a: formatPoints(tasks.referral.invitedCount),
      b: t(lang, "unit.ball", { n: formatPoints(tasks.referral.earnedPoints) }),
    }),
  );
  channels.forEach((c, i) => {
    lines.push(
      "",
      `${tgEmoji("megaphone")} <b>${i + 1}. ${esc(clip(c.title, 60))}</b> · ${rewardText(lang, c)}`,
      stateLine(lang, c, now),
    );
  });
  if (!channels.length) lines.push("", `<i>${t(lang, "bonus.none")}</i>`);
  else if (channels.some((c) => !c.claim)) lines.push("", `<i>${t(lang, "bonus.hint")}</i>`);

  const link = tasks.referral.link;
  const share = isPublicHttps(link) ? inlineButton("share", t(lang, "btn.shareFriends"), { url: telegramShareUrl(link) }, "primary") : null;
  const channelRows: (InlineButton | null)[][] = channels.map((c, i) => {
    if (c.claim) return [];
    const n = i + 1;
    return [
      c.joinUrl ? inlineButton("megaphone", t(lang, "btn.subscribe", { i: n }), { url: c.joinUrl }) : null,
      inlineButton("save", t(lang, "btn.check", { i: n }), { callback_data: cb.bonusCheck(c.id) }, "success"),
    ];
  });
  return {
    text: lines.join("\n"),
    reply_markup: rows(
      [share, inlineButton("link", t(lang, "btn.copyLink"), { copy_text: { text: link.slice(0, 256) } })],
      ...channelRows,
      [inlineButton("back", t(lang, "btn.backWallet"), { callback_data: cb.wallet() })],
    ),
  };
}

/** The worker's message after a paid stay bonus (a new message: it is not an answer to a tap). */
export function stayPaidNotice(lang: Lang, p: { points: number; title: string; stayDays: number }): Screen {
  return {
    text: [
      `${tgEmoji("party")} <b>${t(lang, "bonus.celebrateTitle", { n: formatPoints(p.points) })}</b>`,
      t(lang, "bonus.stayText", { c: esc(clip(p.title, 60)), d: p.stayDays }),
    ].join("\n"),
    reply_markup: rows([inlineButton("gift", t(lang, "btn.moreTasks"), { callback_data: cb.bonus() }, "success")]),
  };
}
