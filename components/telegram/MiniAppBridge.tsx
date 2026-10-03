"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { safeReturnTo } from "@/lib/safe-return";
import { TELEGRAM_WEB_APP_SCRIPT, isTelegramWebApp, shouldAutoLogin, type LaunchEnv } from "@/lib/telegram-miniapp";

type TelegramWebApp = { initData?: string; ready?: () => void; expand?: () => void };
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
  const router = useRouter();
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const setUser = useAppStore((s) => s.setUser);
  const refreshGenerations = useAppStore((s) => s.refreshGenerations);
  const [webAppReady, setWebAppReady] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
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
        if (target) router.push(target);
        else router.refresh();
      })
      .catch((e) => console.warn("[miniapp] login:", e instanceof Error ? e.message : e));
  }, [webAppReady, sessionChecked, loggedIn, setUser, refreshGenerations, router]);

  return null;
}
