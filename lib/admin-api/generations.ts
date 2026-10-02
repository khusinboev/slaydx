"use client";

import {
  adminDownload,
  adminGet,
  type AdminCallOptions,
  type AdminParams,
  type ListResult,
} from "./core";

/**
 * Generations (jobs) API for the admin panel (docs/admin/02-plan.md §6.5 GET
 * rows). The cancel / fail / refund actions are in `money.ts`. Types are
 * declared here and mirror `lib/server/admin-generations.ts` (admin client
 * code never imports `lib/server/**`, tests/admin-boundary.test.mts).
 */

export const GENERATION_STATUSES = ["QUEUED", "IN_PROGRESS", "COMPLETED", "FAILED", "REVOKED"] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export const GENERATION_SORTS = ["created_desc", "created_asc", "duration_desc"] as const;
export type GenerationSort = (typeof GENERATION_SORTS)[number];

export type ChargeSplit = { points: number; quota: number; balance: number };

export type AdminGenerationListItem = {
  id: string;
  userId: string;
  userName: string;
  toolId: string;
  topic: string;
  status: GenerationStatus;
  price: number;
  progress: number;
  attempts: number;
  /** Truncated to 300 characters by the server. */
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationSec: number | null;
  charged: ChargeSplit;
  refunded: boolean;
  costUsd: number | null;
  filesPurged: boolean;
  stuck: boolean;
};

/** Query of `GET /api/admin/generations` (and the export). Empty values are dropped. */
export type GenerationListQuery = {
  status?: ReadonlyArray<GenerationStatus>;
  tool?: string;
  userId?: string;
  /** `YYYY-MM-DD`, Asia/Tashkent, inclusive. */
  from?: string;
  to?: string;
  hasError?: boolean;
  unrefunded?: boolean;
  stuck?: boolean;
  sort?: GenerationSort;
  cursor?: string | null;
  limit?: number;
};

function toParams(q: GenerationListQuery): AdminParams {
  return {
    status: q.status && q.status.length ? q.status : undefined,
    tool: q.tool || undefined,
    userId: q.userId || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
    // Flags are sent only when on: `0` would mean "no error" for hasError.
    hasError: q.hasError ? true : undefined,
    unrefunded: q.unrefunded ? true : undefined,
    stuck: q.stuck ? true : undefined,
    sort: q.sort && q.sort !== "created_desc" ? q.sort : undefined,
    cursor: q.cursor || undefined,
    limit: q.limit,
  };
}

export function listGenerations(q: GenerationListQuery, opts?: AdminCallOptions): Promise<ListResult<AdminGenerationListItem>> {
  return adminGet<ListResult<AdminGenerationListItem>>("/api/admin/generations", toParams(q), opts);
}

export type CostPartView = {
  kind: string;
  provider: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  units: number;
  usd: number;
  outcome: string;
};

export type LedgerRow = {
  id: string;
  kind: "charge" | "refund";
  points: number;
  quota: number;
  balance: number;
  note: string | null;
  createdAt: string;
};

export type AdminGenerationDetail = {
  id: string;
  userId: string;
  userName: string;
  userUsername: string | null;
  toolId: string;
  topic: string;
  status: GenerationStatus;
  price: number;
  format: string;
  progress: number;
  step: string;
  attempts: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationSec: number | null;
  runAfter: string;
  expiresAt: string | null;
  budgetMs: number;
  lockedBy: string | null;
  lockedAt: string | null;
  stuck: boolean;
  delivered: unknown;
  cost: { usd: number; parts: CostPartView[] } | null;
  docVersion: number;
  fileVersion: number;
  editedAt: string | null;
  filesPurgedAt: string | null;
  hasFile: boolean;
  fileName: string | null;
  fileMime: string | null;
  fileSize: number | null;
  downloads: number | null;
  charged: ChargeSplit;
  refunded: boolean;
  inputs: unknown;
  inputsRevealed: boolean;
};

export type AdminGenerationDetailResponse = {
  generation: AdminGenerationDetail;
  ledger: LedgerRow[];
  gameLinks: number;
};

/** `reveal: true` returns the raw inputs (needs `jobs.input`; audited on the server). */
export function getGeneration(id: string, opts: AdminCallOptions & { reveal?: boolean } = {}): Promise<AdminGenerationDetailResponse> {
  const { reveal, ...call } = opts;
  return adminGet<AdminGenerationDetailResponse>(`/api/admin/generations/${encodeURIComponent(id)}`, { reveal: reveal ? true : undefined }, call);
}

/** Link of the audited file download (`jobs.input`); a plain navigation, the browser saves the attachment. */
export function generationFileUrl(id: string): string {
  return `/api/admin/generations/${encodeURIComponent(id)}/file`;
}

/**
 * GET /api/admin/generations/export (jobs.export, step-up) through the shared
 * `adminDownload`: a 401 `reauth` opens the step-up dialog and retries once,
 * and an error response is never saved as the file.
 */
export async function downloadGenerationsCsv(q: GenerationListQuery, opts: AdminCallOptions = {}): Promise<void> {
  const { cursor: _cursor, limit: _limit, ...filters } = q;
  void _cursor;
  void _limit;
  await adminDownload("/api/admin/generations/export", toParams(filters), { ...opts, fallbackName: "generatsiyalar.csv" });
}
