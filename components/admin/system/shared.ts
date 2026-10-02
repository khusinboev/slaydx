"use client";

import { useEffect, useState } from "react";

/* ───────────────────────────── clock ───────────────────────────── */

/** Re-renders every `intervalMs` so relative times ("3 daqiqa oldin") stay honest on a page left open. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
