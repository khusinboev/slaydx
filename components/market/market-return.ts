"use client";

import { safeMarketReturn } from "./market-model";

/**
 * The way back to a purchase after a top-up (docs/market/PLAN.md §2.4). `?return=` lives on the wallet page, but Click and
 * Payme bring the user back to `/uz/purchase?order=…` without it, so the target is also kept in `localStorage` for a while.
 * Storage is only a convenience here: it can be empty or throw, then the URL alone works.
 */

const KEY = "slaydx.market.return";
const TTL_MS = 2 * 60 * 60 * 1000;

export function rememberMarketReturn(path: string): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // Private window or blocked storage: the `?return=` link still works.
  }
}

export function forgetMarketReturn(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

export function storedMarketReturn(): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof v.at !== "number" || Date.now() - v.at > TTL_MS) return null;
    return safeMarketReturn(v.path);
  } catch {
    return null;
  }
}
