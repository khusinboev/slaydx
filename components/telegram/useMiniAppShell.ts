"use client";

import { useSyncExternalStore } from "react";
import {
  getMiniAppShellState,
  getServerMiniAppShellState,
  shouldHideInAppBack,
  subscribeMiniAppShell,
} from "@/lib/telegram-miniapp";

/**
 * Mini App shell state for components (published by `MiniAppBridge`). Both
 * hooks are `false` on the server, during hydration and in every ordinary
 * browser, so markup never differs between server and first client render.
 */

/** The page runs as a genuine Telegram Mini App (`isGenuineMiniApp`, detected by the bridge). */
export function useInTelegramMiniApp(): boolean {
  return useSyncExternalStore(subscribeMiniAppShell, getMiniAppShellState, getServerMiniAppShellState).active;
}

/**
 * O6 (docs/mobile/PLAN.md): hide the in-app «←» because Telegram's BackButton
 * is shown (or is being set up). The single decision every in-app back
 * control uses — see `shouldHideInAppBack`.
 */
export function useHideInAppBack(): boolean {
  return shouldHideInAppBack(useSyncExternalStore(subscribeMiniAppShell, getMiniAppShellState, getServerMiniAppShellState));
}
