"use client";

import type { PublicGameView } from "../game/public";
import { adminGet, adminSend, type AdminCallOptions, type AdminParams, type ListResult } from "./core";

/**
 * Moderation API for the admin panel (docs/admin/02-plan.md §6.8). Types mirror
 * `lib/server/admin-moderation.ts` (admin client code never imports
 * `lib/server/**`, tests/admin-boundary.test.mts); `PublicGameView` is the
 * isomorphic public shape, imported as a type only.
 */

export const GAME_KINDS = ["quiz", "crossword", "flashcards", "sorting", "listening"] as const;
export type GameLinkKind = (typeof GAME_KINDS)[number];

export type ModerationLink = {
  id: string;
  generationId: string;
  userId: string;
  userName: string;
  kind: GameLinkKind;
  topic: string;
  createdAt: string;
  /** `null` = never expires. */
  expiresAt: string | null;
  active: boolean;
  /** All results of the link, not only the shown ones. */
  results: number;
};

export type ModerationResult = {
  id: string;
  playerName: string;
  score: number;
  total: number;
  createdAt: string;
};

export type ModerationLinkDetail = {
  link: ModerationLink;
  /** What a player gets (answers stripped); `null` when the public route would answer 404. */
  preview: PublicGameView | null;
  /** The newest 200 results. */
  results: ModerationResult[];
};

/** Query of `GET /api/admin/moderation/game-links`. Empty values are dropped. */
export type LinkListQuery = {
  /** `true` = only live links, `false` = only dead ones, `undefined` = all. */
  active?: boolean;
  kind?: GameLinkKind;
  userId?: string;
  /** Topic prefix, case-insensitive, at most 100 characters. */
  q?: string;
  /** `YYYY-MM-DD`, Asia/Tashkent, inclusive. */
  from?: string;
  to?: string;
  cursor?: string | null;
  limit?: number;
};

function toParams(q: LinkListQuery): AdminParams {
  return {
    active: q.active,
    kind: q.kind || undefined,
    userId: q.userId || undefined,
    q: q.q || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
    cursor: q.cursor || undefined,
    limit: q.limit,
  };
}

export function listGameLinks(q: LinkListQuery, opts?: AdminCallOptions): Promise<ListResult<ModerationLink>> {
  return adminGet<ListResult<ModerationLink>>("/api/admin/moderation/game-links", toParams(q), opts);
}

export function getGameLink(id: string, opts?: AdminCallOptions): Promise<ModerationLinkDetail> {
  return adminGet<ModerationLinkDetail>(`/api/admin/moderation/game-links/${encodeURIComponent(id)}`, undefined, opts);
}

export function revokeGameLink(id: string, reason: string): Promise<{ link: ModerationLink }> {
  return adminSend<{ link: ModerationLink }>("POST", `/api/admin/moderation/game-links/${encodeURIComponent(id)}/revoke`, { reason });
}

export function deleteGameResult(id: string, reason: string): Promise<{ ok: true }> {
  return adminSend<{ ok: true }>("POST", `/api/admin/moderation/game-results/${encodeURIComponent(id)}/delete`, { reason });
}

/** At most 100 ids per request (plan §6.8). */
export const BULK_DELETE_MAX = 100;

export function deleteGameResults(ids: ReadonlyArray<string>, reason: string): Promise<{ ok: true; deleted: number }> {
  return adminSend<{ ok: true; deleted: number }>("POST", "/api/admin/moderation/game-results/delete", { ids, reason });
}
