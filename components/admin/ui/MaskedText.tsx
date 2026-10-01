"use client";

import { useState } from "react";
import { adminErrorMessage, isAbortError } from "@/lib/admin-api/core";
import { Button } from "./Button";

/**
 * A masked value (e.g. "+998 ** *** ** 12") with an optional reveal button.
 * Revealing is the parent's job (it calls the audited endpoint and then passes
 * the plain value as `value`); the button only triggers `onReveal`.
 */
export function MaskedText({
  value,
  onReveal,
  revealLabel = "Ko'rsatish",
  mono = true,
}: {
  value: string | null | undefined;
  /** Omit when the viewer lacks permission or the value is already revealed. */
  onReveal?: () => Promise<void> | void;
  revealLabel?: string;
  mono?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    if (!onReveal || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onReveal();
    } catch (e) {
      if (!isAbortError(e)) setError(adminErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className={mono ? "font-mono text-[12.5px]" : undefined}>{value || "—"}</span>
      {onReveal && value ? (
        <Button size="sm" variant="ghost" onClick={reveal} loading={busy}>
          {revealLabel}
        </Button>
      ) : null}
      {error ? (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      ) : null}
    </span>
  );
}
