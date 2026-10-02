"use client";

import { useEffect } from "react";

/**
 * Tells the finance page that a tab's load answered 403. Every finance tab
 * needs the same permission (`finance.view`), so the page then drops its tabs
 * and shows only the forbidden state (plan §7.0: 403 renders "Ruxsat yo'q").
 */
export function useReportForbidden(forbidden: boolean, onForbidden: (() => void) | undefined): void {
  useEffect(() => {
    if (forbidden) onForbidden?.();
  }, [forbidden, onForbidden]);
}
