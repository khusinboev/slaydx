"use client";

import { useEffect, useId, useState } from "react";
import { adminErrorMessage, isAbortError } from "@/lib/admin-api/core";
import { AUDIENCE_DAYS_MAX, getAudienceCount, type Audience, type AudienceKind } from "@/lib/admin-api/broadcasts";
import { fmtNumber } from "@/lib/admin-format";
import { Segmented, Skeleton, type FilterOption } from "@/components/admin/ui";

const KIND_OPTIONS: ReadonlyArray<FilterOption> = [
  { value: "all", label: "Barchasi" },
  { value: "paid", label: "To'lov qilganlar" },
  { value: "active_days", label: "Faol foydalanuvchilar" },
];

/** `kind` + the text of the days field → a valid audience, or `null` while the days are not 1..365. */
export function audienceFrom(kind: AudienceKind, daysText: string): Audience | null {
  if (kind !== "active_days") return { kind };
  if (!/^\d{1,3}$/.test(daysText)) return null;
  const days = Number(daysText);
  return days >= 1 && days <= AUDIENCE_DAYS_MAX ? { kind, days } : null;
}

export type CountState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; count: number }
  | { kind: "error"; message: string };

const DEBOUNCE_MS = 300;

/**
 * Live recipient count of an audience. Typing in the days field is debounced,
 * and a stale request is aborted when the audience changes, so the number on
 * screen always belongs to the audience on screen.
 */
export function useAudienceCount(audience: Audience | null): CountState {
  const key = audience ? JSON.stringify(audience) : "";
  const [done, setDone] = useState<{ key: string; state: CountState } | null>(null);

  useEffect(() => {
    if (!audience) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      getAudienceCount(audience, { signal: ctl.signal })
        .then((r) => setDone({ key, state: { kind: "ok", count: r.count } }))
        .catch((e: unknown) => {
          if (!isAbortError(e)) setDone({ key, state: { kind: "error", message: adminErrorMessage(e) } });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
    // `key` is the audience's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!audience) return { kind: "idle" };
  if (done && done.key === key) return done.state;
  return { kind: "loading" };
}

/** Recipient count line: "Qabul qiluvchilar: 1 840 ta". */
export function AudienceCount({ state }: { state: CountState }) {
  return (
    <p className="text-[13px]" aria-live="polite">
      <span className="text-muted-foreground">Qabul qiluvchilar: </span>
      {state.kind === "ok" ? (
        <b className="font-semibold tabular-nums">{fmtNumber(state.count)} ta</b>
      ) : state.kind === "loading" ? (
        <Skeleton className="inline-block h-4 w-16 align-middle" />
      ) : state.kind === "error" ? (
        <span className="text-destructive">{state.message}</span>
      ) : (
        <span className="text-muted-foreground">kunlar sonini kiriting</span>
      )}
    </p>
  );
}

/** Audience picker: kind switch plus the days field for "faol foydalanuvchilar". */
export function AudiencePicker({
  kind,
  daysText,
  onKindChange,
  onDaysChange,
  disabled = false,
}: {
  kind: AudienceKind;
  daysText: string;
  onKindChange: (kind: AudienceKind) => void;
  onDaysChange: (days: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12.5px] font-semibold">Auditoriya</span>
      <div className={disabled ? "pointer-events-none opacity-60" : undefined}>
        <Segmented ariaLabel="Auditoriya turi" options={KIND_OPTIONS} value={kind} onChange={(v) => onKindChange(v as AudienceKind)} />
      </div>
      {kind === "active_days" ? (
        <div className="flex items-center gap-2 text-[13px]">
          <label htmlFor={`${id}-days`} className="text-muted-foreground">
            Oxirgi
          </label>
          <input
            id={`${id}-days`}
            inputMode="numeric"
            value={daysText}
            disabled={disabled}
            onChange={(e) => onDaysChange(e.target.value.replace(/\D/g, "").slice(0, 3))}
            aria-invalid={audienceFrom(kind, daysText) === null}
            className="border-input bg-card focus:ring-ring h-9 w-20 rounded-lg border px-2.5 text-center tabular-nums outline-none focus:ring-2 disabled:opacity-60"
          />
          <span className="text-muted-foreground">kun ichida faol (1–{AUDIENCE_DAYS_MAX})</span>
        </div>
      ) : null}
    </div>
  );
}
