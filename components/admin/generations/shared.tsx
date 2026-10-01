"use client";

import { Badge, StatusPill, type FilterOption, type Tone } from "@/components/admin/ui";
import { WALLET_LABEL } from "@/components/admin/money";
import { fmtNumber } from "@/lib/admin-format";
import type { ChargeSplit, GenerationSort, GenerationStatus } from "@/lib/admin-api/generations";

/** Uzbek status names and pill tones (S6/S7). */
export const STATUS_META: Record<GenerationStatus, { label: string; tone: Tone }> = {
  QUEUED: { label: "Navbatda", tone: "info" },
  IN_PROGRESS: { label: "Ishlanmoqda", tone: "warning" },
  COMPLETED: { label: "Tayyor", tone: "success" },
  FAILED: { label: "Xato", tone: "danger" },
  REVOKED: { label: "Bekor qilingan", tone: "neutral" },
};

export const STATUS_OPTIONS: ReadonlyArray<FilterOption> = (Object.keys(STATUS_META) as GenerationStatus[]).map((s) => ({
  value: s,
  label: STATUS_META[s].label,
}));

export const SORT_OPTIONS: ReadonlyArray<{ value: GenerationSort; label: string }> = [
  { value: "created_desc", label: "Avval yangilari" },
  { value: "created_asc", label: "Avval eskilari" },
  { value: "duration_desc", label: "Eng uzoq davom etgan" },
];

export function GenerationStatusPill({ status, stuck = false }: { status: GenerationStatus; stuck?: boolean }) {
  const meta = STATUS_META[status] ?? { label: status, tone: "neutral" as const };
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusPill tone={meta.tone} dot>
        {meta.label}
      </StatusPill>
      {stuck ? (
        <Badge tone="danger" title="Ish budjeti + 30 soniyadan oshib ketgan">
          Osilgan
        </Badge>
      ) : null}
    </span>
  );
}

/** First 8 hex digits of a job id: enough to tell rows apart, short enough for a table. */
export const shortId = (id: string): string => id.slice(0, 8);

/** `tools` option label for a tool id; unknown (retired) tools show their raw id. */
export function toolLabel(tools: ReadonlyArray<FilterOption>, toolId: string): string {
  return tools.find((t) => t.value === toolId)?.label ?? toolId;
}

export const isCharged = (c: ChargeSplit): boolean => c.points + c.quota + c.balance !== 0;

/** "800 balans · 200 bonus ball"; `—` when nothing was charged. */
export function chargeText(c: ChargeSplit): string {
  const parts = (["balance", "quota", "points"] as const)
    .filter((w) => c[w] !== 0)
    .map((w) => `${fmtNumber(c[w])} ${WALLET_LABEL[w].toLowerCase()}`);
  return parts.length ? parts.join(" · ") : "—";
}
