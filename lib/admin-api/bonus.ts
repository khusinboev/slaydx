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
  title: string;
  joinBonus: number;
  stayBonus: number;
  stayDays: number;
  active: boolean;
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
  existingId: string | null;
};

export type BonusChannelCreate = {
  input: string;
  title?: string;
  joinBonus: number;
  stayBonus: number;
  stayDays: number;
  reason?: string;
};

export type BonusChannelPatch = Partial<Pick<BonusChannel, "title" | "joinBonus" | "stayBonus" | "stayDays" | "active" | "sort">> & {
  reason?: string;
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
): Promise<{ item: BonusChannel; botAdmin: BotAdminStatus; warning: string | null }> {
  return adminSend("POST", BASE, body, opts);
}

export function updateBonusChannel(id: string, patch: BonusChannelPatch, opts: AdminCallOptions = {}): Promise<{ item: BonusChannel }> {
  return adminSend<{ item: BonusChannel }>("PATCH", pathOf(id), patch, opts);
}

export function deleteBonusChannel(id: string, reason: string, opts: AdminCallOptions = {}): Promise<{ id: string; deleted: true }> {
  return adminSend<{ id: string; deleted: true }>("DELETE", pathOf(id), reason ? { reason } : {}, opts);
}

/** Live re-check: is the bot still an admin of the channel? */
export function bonusChannelBotStatus(
  id: string,
  opts: AdminCallOptions = {},
): Promise<{ id: string; botAdmin: BotAdminStatus; warning: string | null }> {
  return adminGet(`${pathOf(id)}/bot-status`, undefined, opts);
}
