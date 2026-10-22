"use client";

import { adminGet, adminSend, type AdminCallOptions } from "./core";

/**
 * Bonus channels API (docs/bonus/PLAN.md K2; `bonus.view` / `bonus.edit`, the latter with
 * step-up). Thin typed wrappers over `core.ts` (AbortSignal, 401 `reauth` step-up + one
 * retry, 403/404 classes).
 *
 * Types are declared here, not imported from `lib/server/**` (admin client code must not
 * reach server modules, tests/admin-boundary.test.mts).
 */

export type BotAdminStatus = "admin" | "not_admin" | "unknown";

export type BonusChannelStats = {
  joined: number;
  joinPaidCount: number;
  joinPaidSum: number;
  stayPaidCount: number;
  stayPaidSum: number;
  left: number;
  stayPending: number;
};

export type BonusChannel = {
  id: string;
  chatId: string;
  username: string | null;
  /** Normalized `https://t.me/+…`; the bot's subscribe link for channels without a username. */
  inviteLink: string | null;
  title: string;
  joinBonus: number;
  stayBonus: number;
  stayDays: number;
  active: boolean;
  /** Must be joined before creating new work (docs/bonus/BONUS3.md C-Q2). */
  mandatory: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
  stats: BonusChannelStats;
};

export type ResolvedChannel = {
  chatId: string;
  title: string;
  username: string | null;
  type: "channel" | "supergroup";
  botAdmin: BotAdminStatus;
  warning: string | null;
  /** A LIVE channel with this chat id (saving is a 409 duplicate). */
  existingId: string | null;
  existingTitle: string | null;
  /** A soft-deleted channel with this chat id: saving restores it (same row, same claims). */
  deletedId: string | null;
  /** Users who already claimed it — they are not paid again after the restore. */
  deletedClaims: number;
};

export type BonusChannelCreate = {
  input: string;
  title?: string;
  inviteLink?: string;
  joinBonus: number;
  stayBonus: number;
  stayDays: number;
  mandatory?: boolean;
  reason?: string;
};

/** `username`: the channel's new `@name` (verified by the server to be the same chat), `null` = a private channel. */
export type BonusChannelPatch = Partial<
  Pick<BonusChannel, "title" | "username" | "inviteLink" | "joinBonus" | "stayBonus" | "stayDays" | "active" | "mandatory" | "sort">
> & {
  reason?: string;
};

export type BonusChannelRefresh = {
  item: BonusChannel;
  /** The stored username changed (and was audited). */
  changed: boolean;
  /** Telegram's current title (shown only; the admin's title is kept). */
  telegramTitle: string;
  /** The channel is private now and has no invite link. */
  warning: string | null;
};

const BASE = "/api/admin/bonus-channels";
const pathOf = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export function listBonusChannels(opts: AdminCallOptions = {}): Promise<{ items: BonusChannel[] }> {
  return adminGet<{ items: BonusChannel[] }>(BASE, undefined, opts);
}

/** Preview of `@name` / `t.me/name` / `-100…` through the Bot API; stores nothing. */
export function resolveBonusChannel(q: string, opts: AdminCallOptions = {}): Promise<ResolvedChannel> {
  return adminGet<ResolvedChannel>(`${BASE}/resolve`, { q }, opts);
}

export function createBonusChannel(
  body: BonusChannelCreate,
  opts: AdminCallOptions = {},
): Promise<{ item: BonusChannel; botAdmin: BotAdminStatus; warning: string | null; restored: boolean }> {
  return adminSend("POST", BASE, body, opts);
}

export function updateBonusChannel(id: string, patch: BonusChannelPatch, opts: AdminCallOptions = {}): Promise<{ item: BonusChannel }> {
  return adminSend<{ item: BonusChannel }>("PATCH", pathOf(id), patch, opts);
}

export function deleteBonusChannel(id: string, reason: string, opts: AdminCallOptions = {}): Promise<{ id: string; deleted: true }> {
  return adminSend<{ id: string; deleted: true }>("DELETE", pathOf(id), reason ? { reason } : {}, opts);
}

/** «Telegramdan yangilash»: the stored username follows Telegram's current one (audited only when it changed). */
export function refreshBonusChannel(id: string, opts: AdminCallOptions = {}): Promise<BonusChannelRefresh> {
  return adminSend<BonusChannelRefresh>("POST", `${pathOf(id)}/refresh`, {}, opts);
}

/** «Havola yaratish»: a new Telegram invite link for `input` (`@name` / `-100…`); stores nothing. */
export function createInviteLink(input: string, opts: AdminCallOptions = {}): Promise<{ inviteLink: string }> {
  return adminSend<{ inviteLink: string }>("POST", `${BASE}/invite-link`, { input }, opts);
}

/** Live re-check: is the bot still an admin of the channel? */
export function bonusChannelBotStatus(
  id: string,
  opts: AdminCallOptions = {},
): Promise<{ id: string; botAdmin: BotAdminStatus; warning: string | null }> {
  return adminGet(`${pathOf(id)}/bot-status`, undefined, opts);
}
