"use client";

import { adminGet, adminSend, type AdminCallOptions, type AdminParams, type ListResult } from "./core";

/**
 * Broadcasts API for the admin panel (docs/admin/02-plan.md §6.9). Types mirror
 * `lib/server/admin-broadcasts.ts` (admin client code never imports
 * `lib/server/**`, tests/admin-boundary.test.mts).
 */

export const BROADCAST_STATUSES = ["draft", "queued", "sending", "paused", "done", "cancelled", "failed"] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

export type Audience = { kind: "all" } | { kind: "paid" } | { kind: "active_days"; days: number } | { kind: "new_days"; days: number };
export type AudienceKind = Audience["kind"];

/** Message cap in characters (code points), after trim. */
export const BROADCAST_TEXT_MAX = 3500;
export const AUDIENCE_DAYS_MAX = 365;
/** The detail page polls at this period while a broadcast is queued or sending (plan §9). */
export const BROADCAST_POLL_MS = 5_000;

export type AdminBroadcast = {
  id: string;
  status: BroadcastStatus;
  text: string;
  audience: Audience;
  total: number;
  sent: number;
  failed: number;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  queuedAt: string | null;
  finishedAt: string | null;
  startedAt: string | null;
  /** Last result the delivery loop recorded (liveness). */
  heartbeatAt: string | null;
  /** Why the engine ended the broadcast as `failed` (early abort). */
  failReason: string | null;
};

export type BroadcastListItem = Omit<AdminBroadcast, "text"> & {
  /** First 160 characters of the text. */
  preview: string;
  textLength: number;
};

export type BroadcastStats = {
  total: number;
  sent: number;
  failed: number;
  /** Not yet handled; after a cancel they stay pending and are never sent. */
  pending: number;
  /** Of `pending`: claimed by a sender right now. */
  inFlight: number;
  /** Of `pending`: waiting out a retry after a transient error. */
  retrying: number;
  /** Delivered + failed per second over the last 30 s. */
  speed: number;
  /** Seconds left at the current speed; null when unknown. */
  etaSeconds: number | null;
  failedReasons: Array<{ error: string; kind: string | null; count: number }>;
};

export type BroadcastDetail = { broadcast: AdminBroadcast; stats: BroadcastStats };

/** Query of `GET /api/admin/broadcasts`. Empty values are dropped. */
export type BroadcastListQuery = {
  status?: ReadonlyArray<BroadcastStatus>;
  cursor?: string | null;
  limit?: number;
};

function listParams(q: BroadcastListQuery): AdminParams {
  return { status: q.status && q.status.length ? [...q.status] : undefined, cursor: q.cursor || undefined, limit: q.limit };
}

export function listBroadcasts(q: BroadcastListQuery, opts?: AdminCallOptions): Promise<ListResult<BroadcastListItem>> {
  return adminGet<ListResult<BroadcastListItem>>("/api/admin/broadcasts", listParams(q), opts);
}

/** Live recipient count: users with a Telegram chat who are not blocked and match the audience. */
export function getAudienceCount(a: Audience, opts?: AdminCallOptions): Promise<{ count: number }> {
  return adminGet<{ count: number }>("/api/admin/broadcasts/audience", { kind: a.kind, days: "days" in a ? a.days : undefined }, opts);
}

export function getBroadcast(id: string, opts?: AdminCallOptions): Promise<BroadcastDetail> {
  return adminGet<BroadcastDetail>(`/api/admin/broadcasts/${encodeURIComponent(id)}`, undefined, opts);
}

/** Creates a draft. Nothing is sent. */
export function createBroadcast(input: { text: string; audience: Audience }): Promise<{ broadcast: AdminBroadcast }> {
  return adminSend<{ broadcast: AdminBroadcast }>("POST", "/api/admin/broadcasts", input);
}

/** Sends the text to the acting admin's own Telegram chat only. */
export function sendBroadcastTest(id: string): Promise<{ sent: boolean }> {
  return adminSend<{ sent: boolean }>("POST", `/api/admin/broadcasts/${encodeURIComponent(id)}/test`, {});
}

/** Snapshots the recipients and queues the broadcast; `confirmCount` must equal the current audience count. */
export function sendBroadcast(id: string, input: { reason: string; confirmCount: number }): Promise<{ broadcast: AdminBroadcast }> {
  return adminSend<{ broadcast: AdminBroadcast }>("POST", `/api/admin/broadcasts/${encodeURIComponent(id)}/send`, input);
}

export function cancelBroadcast(id: string, reason: string): Promise<{ broadcast: AdminBroadcast }> {
  return adminSend<{ broadcast: AdminBroadcast }>("POST", `/api/admin/broadcasts/${encodeURIComponent(id)}/cancel`, { reason });
}
