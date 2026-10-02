"use client";

import { Badge, type FilterOption, type Tone } from "@/components/admin/ui";
import { BROADCAST_STATUSES, type Audience, type BroadcastStatus } from "@/lib/admin-api/broadcasts";

/** Uzbek names of the broadcast statuses (S13). */
export const STATUS_LABEL: Record<BroadcastStatus, string> = {
  draft: "Qoralama",
  queued: "Navbatda",
  sending: "Yuborilmoqda",
  done: "Yuborildi",
  cancelled: "Bekor qilingan",
};

const STATUS_TONE: Record<BroadcastStatus, Tone> = {
  draft: "neutral",
  queued: "info",
  sending: "info",
  done: "success",
  cancelled: "warning",
};

export const STATUS_OPTIONS: ReadonlyArray<FilterOption> = BROADCAST_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }));

export const isBroadcastStatus = (v: string): v is BroadcastStatus => (BROADCAST_STATUSES as readonly string[]).includes(v);

export function StatusPill({ status }: { status: BroadcastStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** A broadcast the worker is (or will be) delivering: the detail page polls only then. */
export const isInFlight = (status: BroadcastStatus): boolean => status === "queued" || status === "sending";

/** Only these states can still be cancelled (the API answers 409 otherwise). */
export const isCancellable = (status: BroadcastStatus): boolean => status === "draft" || status === "queued" || status === "sending";

export function audienceLabel(a: Audience): string {
  if (a.kind === "all") return "Barcha foydalanuvchilar";
  if (a.kind === "paid") return "To'lov qilganlar";
  return `Oxirgi ${a.days} kunda faol`;
}

/** Characters as the server counts them (code points, after trim). */
export const textLength = (text: string): number => Array.from(text.trim()).length;
