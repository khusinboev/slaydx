"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
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
  botChatUrl,
  botLinkFromSearch,
  botLinkOutcome,
  botLinkTelegramId,
  hasBotLinkParam,
  initDataUserLabel,
  isTelegramShellLaunch,
  miniAppLoginAction,
  signedInitDataUserId,
  telegramBackState,
  telegramChromeColors,
  withoutBotLink,
  type SafeAreaInset,
} from "@/lib/telegram-miniapp";
import { isGenuineMiniApp, type MiniAppEnv } from "@/lib/telegram-webapp";
import { getNavSnapshot, getServerNavSnapshot, subscribeNav } from "@/lib/nav/history";
import { useNav } from "@/components/nav/NavProvider";
import { useDialog } from "@/components/overlays/useDialog";
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
  openTelegramLink?: (url: string) => void;
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
 * (`useMiniAppShell.ts`). A reply-keyboard launch (Telegram's launch
 * parameters without launch data, `isTelegramShellLaunch`) gets the shell too.
 *
 * Bot keyboard links (docs/bot/PLAN.md Q1): a `?bt=` token in the URL is
 * exchanged for a session by `BotLinkLogin` — in Telegram (empty initData) and
 * in any browser — and removed from the URL. With signed launch data the
 * initData login runs instead and the token is only removed.
 */
export function MiniAppBridge() {
  // Detect first, without touching the router: outside a genuine Telegram webview
  // (every normal visitor, and any tree rendered without the app router) this
  // component stays inert and never calls `useRouter`.
  const [inTelegram, setInTelegram] = useState(false);
  const [botLink, setBotLink] = useState<{ token: string | null } | null>(null);
  useLayoutEffect(() => {
    // A usable link holds the pages' own login sheet back (`useUi.linkLogin`)
    // from the first client commit: layout effects run before any page's
    // passive effect, so no gate can open the sheet under the link's prompt.
    // `BotLinkLogin` owns the flag from its mount on.
    if (!hasBotLinkParam(window.location.search) || isGenuineMiniApp(window as unknown as MiniAppEnv)) return;
    if (botLinkFromSearch(window.location.search)) useUi.getState().setLinkLogin(true);
  }, []);
  useEffect(() => {
    const env = window as unknown as MiniAppEnv;
    const genuine = isGenuineMiniApp(env);
    if (hasBotLinkParam(window.location.search)) {
      // Captured once (StrictMode re-runs this effect after `BotLinkLogin` removed it).
      const token = genuine ? null : botLinkFromSearch(window.location.search);
      setBotLink((prev) => prev ?? { token });
    }
    const shell = genuine || isTelegramShellLaunch(env);
    setInTelegram(shell);
    if (!shell) return;
    // O6: the in-app «←» hides from the first client frame; the session then
    // confirms Telegram's BackButton or gives the «←» back.
    setMiniAppShellState({ active: true, backButton: "pending" });
    return () => setMiniAppShellState(null);
  }, []);
  return (
    <>
      {inTelegram ? <MiniAppSession /> : null}
      {botLink ? <BotLinkLogin token={botLink.token} /> : null}
    </>
  );
}

/**
 * Removes `bt` from the address bar without a new history entry. `null` state
 * on purpose: Next's history patch (installed by the app router after the
 * first commit, hence this runs from `BotLinkLogin`'s own mount) then adopts
 * the clean URL as its canonical URL, so a later `router.refresh()` cannot
 * write the token back; the nav engine carries its index stamp over.
 */
function removeBotLinkFromUrl() {
  try {
    const clean = withoutBotLink(window.location.href);
    if (clean !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, "", clean);
    }
  } catch (e) {
    console.warn("[bot-link] url:", e instanceof Error ? e.message : e);
  }
}

type BotLinkView =
  | { s: "idle" }
  | { s: "busy" }
  | { s: "notice"; title: string; text: string };

const LINK_EXPIRED_TEXT = "Botga qayting va /start bosing — bot yangi havola yuboradi.";

/**
 * Bot keyboard link → session (`POST /api/auth/bot-link`), once per page load,
 * after the session check: a session of the link's owner (or a phone-login
 * session, never replaced) skips the request. Without a session the server
 * answers 409 `login_confirm` and the user is asked «… sifatida kirasizmi?»
 * first; another Telegram account's session is switched only after «O'tish»
 * (409 `switch_confirm`). While the
 * request runs a small «Kirish…» status shows; an expired / revoked link shows
 * «botga qayting» with a button to the bot chat.
 *
 * Until the exchange is settled and every one of its dialogs is closed,
 * `useUi.linkLogin` keeps pages from opening their own login sheet: after
 * «Kirish» the user is signed in with nothing else open, after «Yo'q» the page
 * is in its normal signed-out state (its own «Kirish» works again).
 */
function BotLinkLogin({ token }: { token: string | null }) {
  const router = useRouter();
  const nav = useNav();
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const sessionTelegramId = useAppStore((s) => s.user?.telegramId ?? null);
  const bot = useAppStore((s) => s.features?.telegramBot ?? null);
  const setUser = useAppStore((s) => s.setUser);
  const refreshGenerations = useAppStore((s) => s.refreshGenerations);
  const [view, setView] = useState<BotLinkView>({ s: "idle" });
  const [prompt, setPrompt] = useState<AccountSwitchPrompt | null>(null);
  const [loginAsk, setLoginAsk] = useState<LoginPrompt | null>(null);
  /** The first exchange answered, or was not needed (the session is kept). */
  const [settled, setSettled] = useState(false);
  const started = useRef(false);

  useEffect(() => removeBotLinkFromUrl(), []);

  const pending = token !== null && (!settled || view.s !== "idle" || loginAsk !== null || prompt !== null);
  useEffect(() => {
    useUi.getState().setLinkLogin(pending);
    return () => useUi.getState().setLinkLogin(false);
  }, [pending]);

  /** `first` — the initial request; `login` — after «Kirish»; `switch` — after «O'tish». */
  const exchange = useCallback(
    async (mode: "first" | "login" | "switch") => {
      if (!token) return;
      const confirm = mode !== "first";
      if (mode === "first") setView({ s: "busy" });
      else if (mode === "login") setLoginAsk((p) => (p ? { ...p, status: "busy" } : p));
      else setPrompt((p) => (p ? { ...p, status: "busy" } : p));
      try {
        const { user } = await api.request<{ user: api.ServerUser }>("/api/auth/bot-link", {
          method: "POST",
          body: JSON.stringify(confirm ? { token, confirm: true } : { token }),
        });
        setSettled(true);
        setView({ s: "idle" });
        setLoginAsk(null);
        if (mode === "switch") {
          // Same as the Mini App switch: nothing of the previous account survives.
          setPrompt(null);
          useAppStore.setState({ user, loggedIn: true, generations: [], generationsLoaded: false, generationsCursor: null });
          void refreshGenerations();
          useUi.getState().close();
          router.refresh();
          return;
        }
        // Same follow-up as the Mini App login (`LoginForm.finish` / `LoginModal.onDone`).
        setUser(user);
        void refreshGenerations();
        const ui = useUi.getState();
        const target = ui.overlay === "login" ? safeReturnTo(ui.returnTo) : null;
        if (ui.overlay === "login") ui.close();
        // The page opened its login sheet while the link was being exchanged, with
        // a returnTo of this very page: stay (keeps the link's query) and re-render.
        const elsewhere = target !== null && new URL(target, window.location.href).pathname !== window.location.pathname;
        if (target && elsewhere) nav.navigateFromOverlay(target);
        else router.refresh();
      } catch (e) {
        const err = e instanceof api.ApiError ? e : null;
        const outcome = botLinkOutcome(err?.status ?? 0, err ? { ...err.data, error: err.message } : null);
        setSettled(true);
        setView({ s: "idle" });
        if (mode === "first" && outcome.kind === "login") {
          // No session: a link alone never signs in — the user says «Kirish» (security review of B1).
          setLoginAsk({ to: outcome.to ?? "Telegram akkauntingiz", status: "ask" });
          return;
        }
        if (mode === "first" && outcome.kind === "confirm") {
          const from = accountLabel(useAppStore.getState().user) ?? "boshqa akkaunt";
          setPrompt({ from, to: outcome.to ?? "boshqa Telegram akkaunti", status: "ask" });
          return;
        }
        if (mode === "login") {
          setLoginAsk((p) => (p ? { ...p, status: "refused", message: err?.message ?? "Kirib bo'lmadi." } : p));
          return;
        }
        if (mode === "switch") {
          setPrompt((p) => (p ? { ...p, status: "refused", message: err?.message ?? "Akkaunt almashtirilmadi." } : p));
          return;
        }
        if (outcome.kind === "kept") return;
        if (outcome.kind === "expired") {
          setView({ s: "notice", title: "Kirish havolasi eskirgan", text: outcome.message ?? LINK_EXPIRED_TEXT });
          return;
        }
        const text = outcome.kind === "error" ? outcome.message : null;
        setView({ s: "notice", title: "Kirib bo'lmadi", text: text ?? "Birozdan keyin qayta urinib ko'ring." });
      }
    },
    [token, refreshGenerations, setUser, router, nav],
  );

  useEffect(() => {
    if (!token || !sessionChecked || started.current) return;
    started.current = true;
    if (loggedIn) {
      // A phone-login session is never replaced; the link's own account is already here.
      if (sessionTelegramId == null || String(sessionTelegramId) === botLinkTelegramId(token)) {
        setSettled(true);
        return;
      }
    }
    void exchange("first");
  }, [token, sessionChecked, loggedIn, sessionTelegramId, exchange]);

  return (
    <>
      {view.s === "busy" ? (
        <div
          role="status"
          aria-live="polite"
          data-bot-link-busy
          className="bg-card fixed top-[calc(var(--tg-safe-top,0px)+var(--tg-content-safe-top,0px)+12px)] left-1/2 z-[70] -translate-x-1/2 rounded-full border px-4 py-2 text-[14px] font-medium shadow-lg"
        >
          Kirish…
        </div>
      ) : null}
      <BotLinkNotice
        notice={view.s === "notice" ? view : null}
        botUrl={botChatUrl(bot ?? process.env.NEXT_PUBLIC_TELEGRAM_BOT)}
        onClose={() => setView({ s: "idle" })}
      />
      <AccountSwitchDialog prompt={prompt} onConfirm={() => void exchange("switch")} onCancel={() => setPrompt(null)} />
      <BotLinkLoginDialog prompt={loginAsk} onConfirm={() => void exchange("login")} onCancel={() => setLoginAsk(null)} />
    </>
  );
}

type LoginPrompt = { to: string; status: "ask" | "busy" | "refused"; message?: string };

/**
 * «… sifatida kirasizmi?» — a bot link signs in only after this tap (the
 * `AccountSwitchDialog` pattern): someone else's bot or chat link must never
 * log a visitor into the sender's account silently. Back / Escape = «Yo'q».
 */
function BotLinkLoginDialog({
  prompt,
  onConfirm,
  onCancel,
}: {
  prompt: LoginPrompt | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const onConfirmRef = useRef(onConfirm);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onConfirmRef.current = onConfirm;
    onCancelRef.current = onCancel;
  });
  const close = useCallback(() => onCancelRef.current(), []);
  const panelRef = useDialog(prompt !== null, close);
  if (!prompt) return null;
  const busy = prompt.status === "busy";
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center">
      <button type="button" tabIndex={-1} aria-label="Yopish" className="absolute inset-0 bg-black/45" onClick={close} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-bot-login-confirm
        className="bg-card relative z-10 flex w-full max-w-sm flex-col rounded-2xl border shadow-xl"
      >
        <div className="px-5 pt-4 pb-1">
          <h2 id={titleId} className="text-base font-semibold">
            {prompt.status === "refused" ? "Kirib bo'lmadi" : "Kirish"}
          </h2>
          <p className="text-muted-foreground mt-1 text-[14px] leading-snug" data-bot-login-text>
            {prompt.status === "refused" ? prompt.message : `${prompt.to} sifatida kirasizmi?`}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2 px-5 pt-2 pb-4">
          {prompt.status === "refused" ? (
            <button type="button" onClick={close} className="bg-card h-11 rounded-lg border px-4 text-[15px] font-medium" data-bot-login-ok>
              Tushunarli
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="bg-card h-11 rounded-lg border px-4 text-[15px] font-medium disabled:opacity-60"
                data-bot-login-no
              >
                Yo&apos;q
              </button>
              <button
                type="button"
                onClick={() => onConfirmRef.current()}
                disabled={busy}
                className="bg-primary text-primary-foreground h-11 rounded-lg px-4 text-[15px] font-medium disabled:opacity-60"
                data-bot-login-go
              >
                {busy ? "Kirilmoqda…" : "Kirish"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** «Kirish havolasi eskirgan» — the way back is the bot chat (/start sends fresh links). */
function BotLinkNotice({
  notice,
  botUrl,
  onClose,
}: {
  notice: { title: string; text: string } | null;
  botUrl: string | null;
  onClose: () => void;
}) {
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const close = useCallback(() => onCloseRef.current(), []);
  const panelRef = useDialog(notice !== null, close);
  if (!notice) return null;
  const openBot = (e: { preventDefault(): void }) => {
    // Inside Telegram the chat opens in place; elsewhere the link opens normally.
    const wa = (window as TelegramWindow).Telegram?.WebApp;
    if (!botUrl || typeof wa?.openTelegramLink !== "function") return;
    try {
      wa.openTelegramLink(botUrl);
      e.preventDefault();
    } catch {
      /* the plain link still works */
    }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center">
      <button type="button" tabIndex={-1} aria-label="Yopish" className="absolute inset-0 bg-black/45" onClick={close} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-bot-link-notice
        className="bg-card relative z-10 flex w-full max-w-sm flex-col rounded-2xl border shadow-xl"
      >
        <div className="px-5 pt-4 pb-1">
          <h2 id={titleId} className="text-base font-semibold">
            {notice.title}
          </h2>
          <p className="text-muted-foreground mt-1 text-[14px] leading-snug">{notice.text}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2 px-5 pt-2 pb-4">
          <button type="button" onClick={close} className="bg-card h-11 rounded-lg border px-4 text-[15px] font-medium" data-bot-link-close>
            Yopish
          </button>
          {botUrl ? (
            <a
              href={botUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={openBot}
              className="bg-primary text-primary-foreground inline-flex h-11 items-center rounded-lg px-4 text-[15px] font-medium"
              data-bot-link-bot
            >
              Botga qaytish
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
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
    if (!isGenuineMiniApp(window as unknown as MiniAppEnv) && !isTelegramShellLaunch(window as unknown as MiniAppEnv)) return;
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
