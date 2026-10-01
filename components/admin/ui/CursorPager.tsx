"use client";

import { useState } from "react";
import { fmtNumber } from "@/lib/admin-format";
import { Button } from "./Button";

/** "N ta natija", or "10 000+ natija" when the server capped the count. */
export function totalText(total: number | null, capped: boolean): string | null {
  if (total === null) return null;
  return capped ? `${fmtNumber(total)}+ natija` : `${fmtNumber(total)} ta natija`;
}

/**
 * Keyset pagination with a client-side cursor stack.
 *
 * The server only gives `nextCursor`, so going back is done by remembering
 * every cursor we left. The parent owns the current `cursor` (it drives the
 * fetch); this component owns the stack of previous ones. Change `resetKey`
 * when filters or sort change: the stack is dropped (the parent resets its own
 * cursor to `null`).
 */
export function CursorPager({
  cursor,
  nextCursor,
  onCursorChange,
  total = null,
  totalCapped = false,
  loading = false,
  resetKey,
}: {
  /** Cursor of the page being shown (`null` = first page). */
  cursor: string | null;
  nextCursor: string | null;
  onCursorChange: (cursor: string | null) => void;
  total?: number | null;
  totalCapped?: boolean;
  loading?: boolean;
  resetKey?: string;
}) {
  const [stack, setStack] = useState<Array<string | null>>([]);
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    // Adjusting state while rendering is React's recommended way to reset on a prop change.
    setSeenKey(resetKey);
    setStack([]);
  }

  const canPrev = stack.length > 0;
  const canNext = nextCursor !== null;
  const text = totalText(total, totalCapped);

  function prev() {
    if (!canPrev) return;
    onCursorChange(stack[stack.length - 1]);
    setStack(stack.slice(0, -1));
  }

  function next() {
    if (!canNext) return;
    setStack([...stack, cursor]);
    onCursorChange(nextCursor);
  }

  return (
    <nav aria-label="Sahifalash" className="text-muted-foreground flex flex-wrap items-center gap-2 px-1 pt-3 text-[12.5px]">
      <span className="flex-1 tabular-nums" aria-live="polite">
        {text ?? ""}
      </span>
      <Button size="sm" onClick={prev} disabled={!canPrev || loading}>
        Oldingi
      </Button>
      <Button size="sm" onClick={next} disabled={!canNext || loading}>
        Keyingi
      </Button>
    </nav>
  );
}
