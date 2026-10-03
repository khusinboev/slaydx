"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { safeReturnTo } from "@/lib/safe-return";
import {
  TELEGRAM_WEB_APP_SCRIPT,
  isTelegramWebApp,
  shouldAutoLogin,
  telegramBackState,
  type LaunchEnv,
} from "@/lib/telegram-miniapp";
import { getNavSnapshot, getServerNavSnapshot, subscribeNav } from "@/lib/nav/history";
import { useNav } from "@/components/nav/NavProvider";

type TelegramBackButton = {
  show?: () => void;
  hide?: () => void;
  onClick?: (cb: () => void) => void;
  offClick?: (cb: () => void) => void;
};
type TelegramWebApp = {
  initData?: string;
  version?: string;
  ready?: () => void;
  expand?: () => void;
  isVersionAtLeast?: (version: string) => boolean;
  BackButton?: TelegramBackButton;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
};
type TelegramWindow = Window & { Telegram?: { WebApp?: TelegramWebApp } };

/**
 * Adds `telegram-web-app.js` once and resolves with `Telegram.WebApp` when it
 * has run (`null` if it failed to load). A tag left by an earlier mount (React
 * StrictMode, client navigation) is reused instead of loading the file twice.
 */
function loadTelegramWebApp(win: TelegramWindow): Promise<TelegramWebApp | null> {
  if (win.Telegram?.WebApp) return Promise.resolve(win.Telegram.WebApp);
  return new Promise((resolve) => {
    const doc = win.document;
    let script = doc.querySelector<HTMLScriptElement>(`script[src="${TELEGRAM_WEB_APP_SCRIPT}"]`);
    if (!script) {
      script = doc.createElement("script");
      script.src = TELEGRAM_WEB_APP_SCRIPT;
      script.async = true;
      doc.head.appendChild(script);
    }
    script.addEventListener("load", () => resolve(win.Telegram?.WebApp ?? null), { once: true });
    script.addEventListener("error", () => resolve(null), { once: true });
  });
}

/**
 * Telegram Mini App support, mounted once from `Providers` (consumer pages
 * only). In an ordinary browser it does nothing at all: no script, no
 * request. Inside a genuine Telegram webview (`isTelegramWebApp`, see the
 * security note in `lib/telegram-miniapp.ts`) it loads Telegram's script,
 * calls `ready()`/`expand()` and, when nobody is signed in, logs in once with
 * `Telegram.WebApp.initData` (verified server-side by `/api/auth/telegram`).
 *
 * A session that already exists — even for a different Telegram user — is
 * kept as is: switching accounts stays an explicit action (sign out, then
 * «Telegram orqali kirish»). `initData` is read at call time and never stored.
 */
export function MiniAppBridge() {
  // Detect first, without touching the router: outside a genuine Telegram webview
  // (every normal visitor, and any tree rendered without the app router) this
  // component stays inert and never calls `useRouter`.
  const [inTelegram, setInTelegram] = useState(false);
  useEffect(() => {
    setInTelegram(isTelegramWebApp(window as unknown as LaunchEnv));
  }, []);
  return inTelegram ? <MiniAppSession /> : null;
}

function MiniAppSession() {
  const router = useRouter();
  const nav = useNav();
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const setUser = useAppStore((s) => s.setUser);
  const refreshGenerations = useAppStore((s) => s.refreshGenerations);
  const [webAppReady, setWebAppReady] = useState(false);
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    // Defence in depth: the script is injected only after the same detection.
    if (!isTelegramWebApp(window as unknown as LaunchEnv)) return;
    let cancelled = false;
    void loadTelegramWebApp(window as TelegramWindow).then((wa) => {
      if (cancelled || !wa) return;
      try {
        wa.ready?.();
        wa.expand?.();
      } catch (e) {
        console.warn("[miniapp] ready/expand:", e instanceof Error ? e.message : e);
      }
      setWebApp(wa);
      setWebAppReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const initData = (window as TelegramWindow).Telegram?.WebApp?.initData ?? "";
    if (!shouldAutoLogin({ webAppReady, initData, sessionChecked, loggedIn, attempted: attempted.current })) return;
    attempted.current = true;
    api
      .loginWithTelegram({ initData })
      .then(({ user }) => {
        // Same follow-up as `LoginForm.finish` / `LoginModal.onDone`.
        setUser(user);
        void refreshGenerations();
        const ui = useUi.getState();
        const target = ui.overlay === "login" ? safeReturnTo(ui.returnTo) : null;
        if (ui.overlay === "login") ui.close();
        // The login modal's history entry is replaced by the target (back does not reopen it).
        if (target) nav.navigateFromOverlay(target);
        else router.refresh();
      })
      .catch((e) => console.warn("[miniapp] login:", e instanceof Error ? e.message : e));
  }, [webAppReady, sessionChecked, loggedIn, setUser, refreshGenerations, router, nav]);

  useTelegramBack(webApp);
  return null;
}

/**
 * Telegram BackButton + closing confirmation (docs/nav/R4-back-nav.md §4),
 * from the pure `telegramBackState`. Every member is gated by the client's
 * `isVersionAtLeast`; the click handler is removed with `offClick` on unmount
 * (StrictMode mounts twice: no stacked handlers).
 */
function useTelegramBack(wa: TelegramWebApp | null) {
  const nav = useNav();
  const pathname = usePathname() ?? "/uz";
  const snap = useSyncExternalStore(subscribeNav, getNavSnapshot, getServerNavSnapshot);
  const state = wa
    ? telegramBackState({
        overlays: snap.overlays,
        pathname,
        pending: snap.guardPending,
        isVersionAtLeast: (v) => wa.isVersionAtLeast?.(v) === true,
      })
    : null;
  const back = state?.backButton ?? null;
  const confirm = state?.closingConfirmation ?? null;
  const supportsBack = back !== null;

  useEffect(() => {
    const bb = wa?.BackButton;
    if (!supportsBack || !bb) return;
    const onBack = () => nav.systemBack();
    try {
      bb.onClick?.(onBack);
    } catch (e) {
      console.warn("[miniapp] BackButton.onClick:", e instanceof Error ? e.message : e);
    }
    return () => {
      try {
        bb.offClick?.(onBack);
      } catch {
        /* the webview is going away */
      }
    };
  }, [wa, supportsBack, nav]);

  useEffect(() => {
    const bb = wa?.BackButton;
    if (back === null || !bb) return;
    try {
      if (back) bb.show?.();
      else bb.hide?.();
    } catch (e) {
      console.warn("[miniapp] BackButton:", e instanceof Error ? e.message : e);
    }
  }, [wa, back]);

  useEffect(() => {
    if (!wa || confirm === null) return;
    try {
      if (confirm) wa.enableClosingConfirmation?.();
      else wa.disableClosingConfirmation?.();
    } catch (e) {
      console.warn("[miniapp] closing confirmation:", e instanceof Error ? e.message : e);
    }
  }, [wa, confirm]);
}
