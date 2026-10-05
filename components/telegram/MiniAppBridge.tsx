"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { safeReturnTo } from "@/lib/safe-return";
import {
  SAFE_AREA_CSS_VARS,
  TELEGRAM_WEB_APP_SCRIPT,
  TG_SAFE_AREA_VERSION,
  TG_VERTICAL_SWIPES_VERSION,
  clientSupports,
  normalizeHexColor,
  safeAreaCssVars,
  setMiniAppShellState,
  accountLabel,
  initDataUserLabel,
  miniAppLoginAction,
  signedInitDataUserId,
  telegramBackState,
  telegramChromeColors,
  type SafeAreaInset,
} from "@/lib/telegram-miniapp";
import { isGenuineMiniApp, type MiniAppEnv } from "@/lib/telegram-webapp";
import { getNavSnapshot, getServerNavSnapshot, subscribeNav } from "@/lib/nav/history";
import { useNav } from "@/components/nav/NavProvider";
import { AccountSwitchDialog, type AccountSwitchPrompt } from "./AccountSwitchDialog";

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
  isExpanded?: boolean;
  isVersionAtLeast?: (version: string) => boolean;
  BackButton?: TelegramBackButton;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  safeAreaInset?: SafeAreaInset;
  contentSafeAreaInset?: SafeAreaInset;
  onEvent?: (type: string, handler: () => void) => void;
  offEvent?: (type: string, handler: () => void) => void;
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
 * A session of the same Telegram user, or of an account without Telegram
 * (phone login), is kept. A session of ANOTHER Telegram user is replaced
 * (`miniAppLoginAction` → `switch`): two Telegram accounts on one phone share
 * this webview's cookies, and account 2 must not see account 1's files. The
 * server revokes only this browser's old session. `initData` is read at call
 * time and never stored.
 *
 * Shell (docs/mobile/PLAN.md O6, O8): vertical swipes off, Telegram's header /
 * background / bottom bar in the app's page colour (follows light/dark),
 * safe-area CSS variables, and the shell state that hides the in-app «←»
 * (`useMiniAppShell.ts`).
 */
export function MiniAppBridge() {
  // Detect first, without touching the router: outside a genuine Telegram webview
  // (every normal visitor, and any tree rendered without the app router) this
  // component stays inert and never calls `useRouter`.
  const [inTelegram, setInTelegram] = useState(false);
  useEffect(() => {
    const genuine = isGenuineMiniApp(window as unknown as MiniAppEnv);
    setInTelegram(genuine);
    if (!genuine) return;
    // O6: the in-app «←» hides from the first client frame; the session then
    // confirms Telegram's BackButton or gives the «←» back.
    setMiniAppShellState({ active: true, backButton: "pending" });
    return () => setMiniAppShellState(null);
  }, []);
  return inTelegram ? <MiniAppSession /> : null;
}

/** `Telegram.WebApp.isVersionAtLeast`, called on its object; `false` when missing. */
function versionCheck(wa: TelegramWebApp): (v: string) => boolean {
  return (v) => wa.isVersionAtLeast?.(v) === true;
}

/** WebApp objects already set up (`disableVerticalSwipes` runs once per Mini App). */
const shellStarted = new WeakSet<object>();

/**
 * `ready()`, `expand()` unless already expanded, and — once per WebApp, Bot
 * API 7.7+ — `disableVerticalSwipes()` (O8: a downward drag on the price
 * slider, slide stage or a game must not minimise the app).
 */
function startWebApp(wa: TelegramWebApp) {
  try {
    wa.ready?.();
    if (wa.isExpanded !== true) wa.expand?.();
  } catch (e) {
    console.warn("[miniapp] ready/expand:", e instanceof Error ? e.message : e);
  }
  if (shellStarted.has(wa)) return;
  shellStarted.add(wa);
  try {
    if (clientSupports(versionCheck(wa), TG_VERTICAL_SWIPES_VERSION)) wa.disableVerticalSwipes?.();
  } catch (e) {
    console.warn("[miniapp] disableVerticalSwipes:", e instanceof Error ? e.message : e);
  }
}

function MiniAppSession() {
  const router = useRouter();
  const nav = useNav();
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const setUser = useAppStore((s) => s.setUser);
  const refreshGenerations = useAppStore((s) => s.refreshGenerations);
  const signOut = useAppStore((s) => s.signOut);
  const sessionTelegramId = useAppStore((s) => s.user?.telegramId ?? null);
  const [webAppReady, setWebAppReady] = useState(false);
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null);
  /** The Mini App user id already tried in this page load (one attempt per id). */
  const attemptedFor = useRef<string | null>(null);
  const [prompt, setPrompt] = useState<AccountSwitchPrompt | null>(null);

  useEffect(() => {
    // Defence in depth: the script is injected only after the same detection.
    if (!isGenuineMiniApp(window as unknown as MiniAppEnv)) return;
    let cancelled = false;
    void loadTelegramWebApp(window as TelegramWindow).then((wa) => {
      if (cancelled) return;
      if (!wa) {
        // No Telegram BackButton without the script: give the in-app «←» back.
        setMiniAppShellState({ backButton: false });
        return;
      }
      startWebApp(wa);
      setWebApp(wa);
      setWebAppReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const initData = (window as TelegramWindow).Telegram?.WebApp?.initData ?? "";
    const action = miniAppLoginAction({
      webAppReady,
      initData,
      sessionChecked,
      loggedIn,
      sessionTelegramId,
      attemptedFor: attemptedFor.current,
    });
    if (action === "none") return;
    attemptedFor.current = signedInitDataUserId(initData);
    if (action === "login") {
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
      return;
    }
    // Switch: this webview's session is another Telegram account. ASK first
    // (never silent, security review B1). Until «O'tish» succeeds the old
    // user stays in the store, so «Saqlash» / «Ulashish» keep refusing via
    // `isMiniAppUserMismatch`; «Yo'q» is not asked again for this id.
    const from = accountLabel(useAppStore.getState().user) ?? "boshqa akkaunt";
    const to = initDataUserLabel(initData) ?? "boshqa Telegram akkaunti";
    setPrompt({ from, to, status: "ask" });
  }, [webAppReady, sessionChecked, loggedIn, sessionTelegramId, setUser, refreshGenerations, router, nav]);

  const confirmSwitch = useCallback(() => {
    const initData = (window as TelegramWindow).Telegram?.WebApp?.initData ?? "";
    setPrompt((p) => (p ? { ...p, status: "busy" } : p));
    api
      .loginWithTelegram({ initData })
      .then(({ user }) => {
        // Nothing of the previous account survives: its user, file list and
        // any open overlay go; the home page is rendered again for the new one.
        setPrompt(null);
        useAppStore.setState({ user, loggedIn: true, generations: [], generationsLoaded: false, generationsCursor: null });
        void refreshGenerations();
        useUi.getState().close();
        router.replace("/uz");
        router.refresh();
      })
      .catch(async (e) => {
        console.warn("[miniapp] account switch:", e instanceof Error ? e.message : e);
        if (e instanceof api.ApiError && e.status === 409) {
          // The server kept this session (stale launch data / phone login): say so calmly.
          setPrompt((p) => (p ? { ...p, status: "refused", message: e.message } : p));
          return;
        }
        // The user asked to leave this account: never keep showing it — sign out, ask to log in.
        setPrompt(null);
        await signOut().catch(() => {});
        router.replace("/uz/login");
        router.refresh();
      });
  }, [refreshGenerations, signOut, router]);

  useTelegramBack(webApp);
  useTelegramChrome(webApp);
  useTelegramSafeArea(webApp);
  return <AccountSwitchDialog prompt={prompt} onConfirm={confirmSwitch} onCancel={() => setPrompt(null)} />;
}

/** The app's page colour (`--page-bg`, else the body background) as `#rrggbb`, or `null`. */
function readPageColor(): string | null {
  try {
    const fromToken = normalizeHexColor(window.getComputedStyle(document.documentElement).getPropertyValue("--page-bg"));
    return fromToken ?? normalizeHexColor(window.getComputedStyle(document.body).backgroundColor);
  } catch {
    return null;
  }
}

/**
 * Telegram's header, background and bottom bar in the app's page colour, so
 * the Telegram chrome and the page read as one surface. Re-applied when the
 * app theme changes (`applyTheme` toggles `.dark` on `<html>`); an unchanged
 * colour is not re-sent. Each member is version-gated (`telegramChromeColors`).
 */
function useTelegramChrome(wa: TelegramWebApp | null) {
  useEffect(() => {
    if (!wa) return;
    let last: string | null = null;
    const set = (name: string, fn: ((color: string) => void) | undefined, value: string | null) => {
      if (value === null || typeof fn !== "function") return;
      try {
        fn.call(wa, value);
      } catch (e) {
        console.warn(`[miniapp] ${name}:`, e instanceof Error ? e.message : e);
      }
    };
    const apply = () => {
      const color = readPageColor();
      if (color === null || color === last) return;
      last = color;
      const c = telegramChromeColors(color, versionCheck(wa));
      set("setHeaderColor", wa.setHeaderColor, c.header);
      set("setBackgroundColor", wa.setBackgroundColor, c.background);
      set("setBottomBarColor", wa.setBottomBarColor, c.bottomBar);
    };
    apply();
    const Observer = window.MutationObserver;
    if (typeof Observer !== "function") return;
    const observer = new Observer(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [wa]);
}

/**
 * `--tg-safe-*` / `--tg-content-safe-*` on `<html>` (contract:
 * `SAFE_AREA_CSS_VARS` in `lib/telegram-miniapp.ts`): Telegram's insets on
 * 8.0+, updated on `safeAreaChanged` / `contentSafeAreaChanged`; `env()`
 * fallbacks on older clients. Removed on unmount.
 */
function useTelegramSafeArea(wa: TelegramWebApp | null) {
  useEffect(() => {
    if (!wa) return;
    const root = document.documentElement;
    const supported = clientSupports(versionCheck(wa), TG_SAFE_AREA_VERSION);
    const write = () => {
      let vars = safeAreaCssVars(null, null);
      try {
        if (supported) vars = safeAreaCssVars(wa.safeAreaInset, wa.contentSafeAreaInset);
      } catch {
        /* foreign object: keep the fallbacks */
      }
      for (const k of SAFE_AREA_CSS_VARS) root.style.setProperty(k, vars[k]);
    };
    write();
    const events = supported ? ["safeAreaChanged", "contentSafeAreaChanged"] : [];
    for (const ev of events) {
      try {
        wa.onEvent?.(ev, write);
      } catch (e) {
        console.warn(`[miniapp] onEvent ${ev}:`, e instanceof Error ? e.message : e);
      }
    }
    return () => {
      for (const ev of events) {
        try {
          wa.offEvent?.(ev, write);
        } catch {
          /* the webview is going away */
        }
      }
      for (const k of SAFE_AREA_CSS_VARS) root.style.removeProperty(k);
    };
  }, [wa]);
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
  /** `BackButton.onClick` was registered: a shown button really navigates. */
  const clickWired = useRef(false);

  useEffect(() => {
    const bb = wa?.BackButton;
    if (!supportsBack || !bb) return;
    const onBack = () => nav.systemBack();
    try {
      bb.onClick?.(onBack);
      clickWired.current = typeof bb.onClick === "function";
    } catch (e) {
      clickWired.current = false;
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
    if (!wa) return;
    const bb = wa.BackButton;
    // O6: the in-app «←» hides only while this button works (supported, wired,
    // show() did not throw). It is shown on every non-root page — exactly where
    // a «←» exists — so the «←» does not flash on a root → page navigation.
    if (back === null || !bb) {
      setMiniAppShellState({ backButton: false });
      return;
    }
    try {
      if (back) bb.show?.();
      else bb.hide?.();
      setMiniAppShellState({ backButton: typeof bb.show === "function" && clickWired.current });
    } catch (e) {
      setMiniAppShellState({ backButton: false });
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
