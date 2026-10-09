import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReferralCard, type ReferralSummaryView } from "../../components/profile/ReferralCard.tsx";
import { GameSharePanel } from "../../components/files/GameSharePanel.tsx";
import { COPIED_CLOSE_MS, useLinkShare } from "../../components/share/ShareMenu.tsx";
import { copyText } from "../../components/admin/ui/CopyButton.tsx";
import { browserShareEnv } from "../../lib/share.ts";

/**
 * «Ulashish» works in EVERY environment (docs/share/AUDIT.md). One matrix per link entry point —
 * referral card (#4) and the teacher's game panel (#6) — driven through the real components, with
 * the page's `navigator`, `window.open`, `document.execCommand` and `Telegram.WebApp` stubbed:
 *
 *   phone browser (Web Share)         → navigator.share, no menu (behaviour unchanged);
 *   desktop without Web Share         → the fallback menu: copy the link, Telegram;
 *   Telegram phone / Telegram Desktop → Telegram's own sheet (openTelegramLink), no menu.
 *
 * The file entry points (#1–#3) are in `save-share-formats.test.mts`; the helper itself in
 * `tests/share.test.mts`.
 *
 * Mutations (each turned a test red, then restored):
 *   1. the fallback removed (`useLinkShare` ignores `fallback`) → every «desktop» test;
 *   2. AbortError treated as an error (`isShareAbort` always false) → «cancelling the native sheet…»;
 *   3. the menu without `useDialog` (no Escape / focus trap) → «keyboard».
 */

const win = window as unknown as Record<string, unknown>;
const nav = navigator as unknown as Record<string, unknown>;
const doc = document as unknown as { execCommand?: (c: string) => boolean };
const realFetch = globalThis.fetch;
const realOpen = window.open;
const realExec = doc.execCommand;

let opened: string[] = [];
let tgOpened: string[] = [];

beforeEach(() => {
  opened = [];
  tgOpened = [];
  window.open = ((u?: string | URL) => {
    opened.push(String(u));
    return null;
  }) as typeof window.open;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  window.open = realOpen;
  doc.execCommand = realExec;
  for (const k of ["share", "canShare", "clipboard"]) delete nav[k];
  delete win.Telegram;
  delete win.TelegramWebviewProxy;
  window.history.replaceState(null, "", "/");
});

const REF: ReferralSummaryView = {
  code: "k7m3p9qx",
  botLink: "https://t.me/slaydx_bot?start=ref_k7m3p9qx",
  webLink: "https://slaydx.uz/uz?ref=k7m3p9qx",
  rewardPoints: 2000,
  invitedCount: 0,
  earnedPoints: 0,
  recent: [],
};

const GAME_URL = "https://slaydx.uz/o/abcdefghijklmnopqrstuv";
const SESSION = { token: "abcdefghijklmnopqrstuv", url: GAME_URL, kind: "quiz" as const, createdAt: "2026-09-17T08:00:00.000Z", expiresAt: null };
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });

/* ───────────────────────────── environments ───────────────────────────── */

type Env = { share?: (d: ShareData) => Promise<void>; canShare?: (d: ShareData) => boolean; clipboard?: boolean | "denied"; exec?: boolean };
let written: string[] = [];
let shared: ShareData[] = [];
let execCalls: string[] = [];

/** Sets the page's `navigator` / clipboard / `execCommand` for one test. */
function environment(e: Env = {}) {
  written = [];
  shared = [];
  execCalls = [];
  if (e.share) {
    const impl = e.share;
    Object.defineProperty(navigator, "share", { value: (d: ShareData) => (shared.push(d), impl(d)), configurable: true });
  }
  if (e.canShare) Object.defineProperty(navigator, "canShare", { value: e.canShare, configurable: true });
  if (e.clipboard === true) {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => void written.push(t) }, configurable: true });
  } else if (e.clipboard === "denied") {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => Promise.reject(new DOMException("denied", "NotAllowedError")) }, configurable: true });
  }
  doc.execCommand = (c: string) => {
    execCalls.push(c);
    return e.exec ?? true;
  };
}

/** Telegram Mini App on `platform` (android/ios = phone, tdesktop/macos = Telegram Desktop). */
function telegram(platform: string, o: { openTelegramLink?: boolean } = {}) {
  win.TelegramWebviewProxy = { postEvent() {} };
  win.Telegram = {
    WebApp: {
      initData: "user=1",
      version: "8.0",
      platform,
      ...(o.openTelegramLink === false ? {} : { openTelegramLink: (u: string) => void tgOpened.push(u) }),
    },
  };
}

const nativeShare = async () => {};
const abort = () => new DOMException("Share canceled", "AbortError");

/* ───────────────────────────── mounting ───────────────────────────── */

async function referral() {
  globalThis.fetch = (async () => json(REF)) as typeof fetch;
  render(h(ReferralCard));
  await waitFor(() => assert.ok(document.querySelector('[data-referral-card="ready"]')));
  return {
    button: () => document.querySelector("[data-referral-share]") as HTMLButtonElement,
    link: () => REF.botLink!,
  };
}

async function gamePanel() {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/share") && (init?.method ?? "GET") === "GET") return json({ sessions: [SESSION] });
    if (url.includes("/results")) return json({ results: [], total: 0 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  await act(async () => {
    render(h(GameSharePanel, { id: "11111111-1111-4111-8111-111111111111", kind: "quiz" }));
  });
  await waitFor(() => assert.ok(document.querySelector("[data-share-send]")));
  return { button: () => document.querySelector("[data-share-send]") as HTMLButtonElement };
}

const menu = () => document.querySelector("[data-share-menu]") as HTMLElement | null;
const status = () => document.querySelector("[data-share-menu-status]")!;
const tap = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 5))));

type Entry = { name: string; mount: () => Promise<{ button: () => HTMLElement }>; url: string };
const ENTRIES: Entry[] = [
  { name: "referral card «Ulashish»", mount: referral, url: REF.botLink! },
  { name: "game panel «Ulashish»", mount: gamePanel, url: GAME_URL },
];

/* ───────────────────────────── per entry point ───────────────────────────── */

for (const entry of ENTRIES) {
  test(`${entry.name} · phone browser with Web Share: navigator.share({url,title,text}), no menu (unchanged)`, async () => {
    environment({ share: nativeShare, canShare: () => true });
    const { button } = await entry.mount();
    await tap(button());
    assert.equal(shared.length, 1);
    assert.equal(shared[0].url, entry.url);
    assert.ok(shared[0].title && shared[0].text, "the receiving app gets a title and a text");
    await settle();
    assert.ok(!menu(), "the native sheet is the whole flow");
    assert.deepEqual([opened.length, tgOpened.length], [0, 0]);
  });

  test(`${entry.name} · desktop without Web Share: the fallback menu, and «Havolani nusxalash» puts the right URL on the clipboard`, async () => {
    environment({ clipboard: true });
    const { button } = await entry.mount();
    await tap(button());
    await waitFor(() => assert.ok(menu()), { timeout: 2000 });
    const m = menu()!;
    assert.equal(m.getAttribute("role"), "dialog");
    assert.equal(m.getAttribute("aria-modal"), "true");
    assert.equal(m.getAttribute("data-share-reason"), "unsupported");
    assert.match(m.querySelector("[data-share-menu-hint]")!.textContent!, /ulashish oynasi yo‘q/);
    assert.equal((m.querySelector("[data-share-menu-url]") as HTMLInputElement).value, entry.url, "the link is shown");
    assert.deepEqual(written, [], "opening the menu copies nothing");
    await tap(screen.getByRole("button", { name: "Havolani nusxalash" }));
    assert.deepEqual(written, [entry.url], "MUTATION 1: exactly the shared link is copied");
    assert.equal(status().textContent, "Nusxalandi");
    await waitFor(() => assert.ok(!menu(), "the menu closes itself after the confirmation"), { timeout: COPIED_CLOSE_MS + 2000 });
  });

  test(`${entry.name} · desktop: without the Clipboard API the copy still works (hidden textarea / selected field + execCommand)`, async () => {
    environment({ exec: true });
    const { button } = await entry.mount();
    await tap(button());
    await waitFor(() => assert.ok(menu()));
    await tap(screen.getByRole("button", { name: "Havolani nusxalash" }));
    assert.deepEqual(execCalls, ["copy"]);
    assert.equal(status().textContent, "Nusxalandi");
  });

  test(`${entry.name} · desktop: every copy route failing says so and leaves the link selected for a manual copy`, async () => {
    environment({ clipboard: "denied", exec: false });
    const { button } = await entry.mount();
    await tap(button());
    await waitFor(() => assert.ok(menu()));
    await tap(screen.getByRole("button", { name: "Havolani nusxalash" }));
    assert.equal(status().getAttribute("role"), "alert");
    assert.match(status().textContent!, /qo‘lda nusxalang/);
    const field = document.querySelector("[data-share-menu-url]") as HTMLInputElement;
    assert.ok(document.activeElement === field, "the field has focus");
    assert.equal(field.selectionStart, 0);
    assert.equal(field.selectionEnd, entry.url.length, "and the whole link is selected");
    assert.ok(menu(), "the menu stays open");
  });

  test(`${entry.name} · desktop: «Telegramda ulashish» opens t.me/share/url?url=<link> in a new tab and closes the menu`, async () => {
    environment({});
    const { button } = await entry.mount();
    await tap(button());
    await waitFor(() => assert.ok(menu()));
    await tap(screen.getByRole("button", { name: "Telegramda ulashish" }));
    assert.equal(opened.length, 1);
    const u = new URL(opened[0]);
    assert.equal(u.origin + u.pathname, "https://t.me/share/url");
    assert.equal(u.searchParams.get("url"), entry.url);
    assert.ok(!menu());
  });

  test(`${entry.name} · cancelling the native sheet (AbortError) is not an error: no menu, no notice`, async () => {
    environment({ share: async () => Promise.reject(abort()), canShare: () => true });
    const { button } = await entry.mount();
    await tap(button());
    await settle();
    assert.equal(shared.length, 1);
    assert.ok(!menu(), "MUTATION 2: AbortError must not open the fallback");
    assert.ok(!document.querySelector('[role="alert"]'), "and no error text");
  });

  test(`${entry.name} · any other native share failure opens the menu (never silent)`, async () => {
    environment({ share: async () => Promise.reject(new DOMException("not allowed", "NotAllowedError")), canShare: () => true, clipboard: true });
    const { button } = await entry.mount();
    await tap(button());
    await waitFor(() => assert.ok(menu()));
    assert.equal(menu()!.getAttribute("data-share-reason"), "error");
    assert.match(menu()!.querySelector("[data-share-menu-hint]")!.textContent!, /Ulashib bo‘lmadi/);
  });

  test(`${entry.name} · Telegram phone and Telegram Desktop: Telegram's sheet, not the browser's`, async () => {
    for (const platform of ["android", "ios", "tdesktop", "macos"]) {
      cleanup();
      tgOpened = [];
      environment({ share: nativeShare, canShare: () => true });
      telegram(platform);
      const { button } = await entry.mount();
      await tap(button());
      await settle();
      assert.equal(tgOpened.length, 1, platform);
      assert.equal(new URL(tgOpened[0]).searchParams.get("url"), entry.url, platform);
      assert.equal(shared.length, 0, `${platform}: navigator.share is not used inside Telegram`);
      assert.ok(!menu(), platform);
      assert.equal(opened.length, 0, platform);
      assert.equal(browserShareEnv().telegramPlatform, platform);
      delete win.Telegram;
      delete win.TelegramWebviewProxy;
    }
  });

  test(`${entry.name} · Telegram shell whose script is not loaded: falls back to the menu, whose Telegram button opens a tab`, async () => {
    environment({});
    telegram("tdesktop", { openTelegramLink: false });
    const { button } = await entry.mount();
    await tap(button());
    await waitFor(() => assert.ok(menu()));
    await tap(screen.getByRole("button", { name: "Telegramda ulashish" }));
    assert.equal(tgOpened.length, 0);
    assert.equal(opened.length, 1);
  });

  test(`${entry.name} · keyboard: initial focus on the first action, Tab stays inside, Escape closes and focus returns to the button`, async () => {
    environment({});
    const { button } = await entry.mount();
    const trigger = button();
    trigger.focus();
    await tap(trigger);
    await waitFor(() => assert.ok(menu()));
    const copy = screen.getByRole("button", { name: "Havolani nusxalash" });
    await waitFor(() => assert.ok(document.activeElement === copy, "MUTATION 3: first action focused"));
    const m = menu()!;
    const focusables = [...m.querySelectorAll<HTMLElement>("button, input")];
    assert.ok(focusables.length >= 4, "copy, Telegram, link field, close");
    const last = focusables[focusables.length - 1];
    last.focus();
    await act(async () => void fireEvent.keyDown(window, { key: "Tab" }));
    assert.ok(document.activeElement === focusables[0], "Tab from the last control wraps to the first");
    focusables[0].focus();
    await act(async () => void fireEvent.keyDown(window, { key: "Tab", shiftKey: true }));
    assert.ok(document.activeElement === last, "Shift+Tab from the first wraps to the last");
    await act(async () => void fireEvent.keyDown(window, { key: "Escape" }));
    assert.ok(!menu(), "Escape closes");
    assert.ok(document.activeElement === trigger, "focus returns to the share button");
  });

  test(`${entry.name} · the backdrop and «Yopish» close the menu; targets are ≥ 44 px`, async () => {
    environment({});
    const { button } = await entry.mount();
    await tap(button());
    await waitFor(() => assert.ok(menu()));
    for (const name of ["Havolani nusxalash", "Telegramda ulashish"]) {
      assert.match(screen.getByRole("button", { name }).className, /\bmin-h-12\b/, `${name}: 48 px row`);
    }
    assert.match(document.querySelector("[data-share-menu-close]")!.className, /\bsize-11\b/, "close: 44 px");
    assert.match(document.querySelector("[data-share-menu-url]")!.className, /\bh-11\b/, "link field: 44 px");
    await tap(document.querySelector("[data-share-menu-close]")!);
    assert.ok(!menu());
    await tap(button());
    await waitFor(() => assert.ok(menu()));
    await tap(document.querySelector("[data-share-menu-backdrop]")!);
    assert.ok(!menu());
  });
}

/* ───────────────────────────── referral card specifics ───────────────────────────── */

test("referral card: «Sayt» link is what the menu copies when that kind is selected", async () => {
  environment({ clipboard: true });
  const { button } = await referral();
  await tap(document.querySelector('[data-referral-kind="web"]')!);
  await tap(button());
  await waitFor(() => assert.ok(menu()));
  await tap(screen.getByRole("button", { name: "Havolani nusxalash" }));
  assert.deepEqual(written, [REF.webLink]);
});

test("referral card: the direct «Nusxalash» button still works without the menu", async () => {
  environment({ clipboard: true });
  await referral();
  await tap(screen.getByRole("button", { name: "Nusxalash" }));
  await waitFor(() => assert.deepEqual(written, [REF.botLink]));
  assert.equal(document.querySelector("[data-referral-notice]")!.textContent, "Havola nusxalandi");
  assert.ok(!menu());
});

/* ───────────────────────────── game panel specifics ───────────────────────────── */

test("game panel: «Nusxalash» works without navigator.clipboard (it used to throw inside the click handler and do nothing)", async () => {
  environment({ exec: true });
  await gamePanel();
  await tap(document.querySelector("[data-share-copy]")!);
  assert.deepEqual(execCalls, ["copy"]);
  await waitFor(() => assert.match(document.querySelector("[data-share-copy]")!.textContent ?? "", /Nusxalandi/));
  assert.ok(!document.querySelector("[data-share-error]"), "no error");
});

test("game panel: when no copy route works the teacher is told, not left with a dead button", async () => {
  environment({ clipboard: "denied", exec: false });
  await gamePanel();
  await tap(document.querySelector("[data-share-copy]")!);
  await waitFor(() => assert.match(document.querySelector("[data-share-error]")?.textContent ?? "", /qo‘lda belgilang/));
});

test("game panel: the share and copy controls are 44 px on touch-sized containers", async () => {
  environment({});
  await gamePanel();
  for (const sel of ["[data-share-send]", "[data-share-copy]", "[data-share-url]"]) {
    assert.match(document.querySelector(sel)!.className, /\bh-11\b/, sel);
  }
});

/* ───────────────────────────── private links ───────────────────────────── */

function Harness({ url, onOutcome }: { url: string; onOutcome: (status: string) => void }) {
  const { share, menu: m } = useLinkShare({ onOutcome: (o) => onOutcome(o.status) });
  return h("div", null, h("button", { type: "button", onClick: () => share({ url }), "data-go": "" }, "go"), m);
}

test("a personal ?bt= sign-in link and a signed download URL are never shared: nothing is called, no menu", async () => {
  environment({ share: nativeShare, canShare: () => true, clipboard: true });
  telegram("android");
  const seen: string[] = [];
  for (const url of ["https://slaydx.uz/uz?bt=personal-ticket", "https://slaydx.uz/api/dl/signed-token", "https://slaydx.uz/uz#tgWebAppData=user%3D1"]) {
    cleanup();
    render(h(Harness, { url, onOutcome: (s) => seen.push(s) }));
    await tap(document.querySelector("[data-go]")!);
    await settle();
  }
  assert.deepEqual(seen, ["blocked", "blocked", "blocked"]);
  assert.deepEqual([shared.length, tgOpened.length, opened.length, written.length], [0, 0, 0, 0]);
  assert.ok(!menu());
});

test("a relative path is resolved against the page origin before sharing", async () => {
  environment({ share: nativeShare, canShare: () => true });
  render(h(Harness, { url: "/o/abc", onOutcome: () => {} }));
  await tap(document.querySelector("[data-go]")!);
  assert.equal(shared[0].url, `${window.location.origin}/o/abc`);
});

test("a second tap while the native sheet is open is ignored (one share at a time)", async () => {
  let release: () => void = () => {};
  environment({ share: () => new Promise<void>((r) => (release = r)), canShare: () => true });
  render(h(Harness, { url: GAME_URL, onOutcome: () => {} }));
  await tap(document.querySelector("[data-go]")!);
  await tap(document.querySelector("[data-go]")!);
  assert.equal(shared.length, 1);
  await act(async () => release());
  await tap(document.querySelector("[data-go]")!);
  assert.equal(shared.length, 2, "usable again once the sheet closed");
});

/* ───────────────────────────── admin copy (de-duplicated) ───────────────────────────── */

test("admin copyText is the shared helper: Clipboard API, then execCommand", async () => {
  environment({ clipboard: true });
  assert.equal(await copyText("req-123"), true);
  assert.deepEqual(written, ["req-123"]);
  delete nav.clipboard;
  assert.equal(await copyText("req-456"), true);
  assert.deepEqual(execCalls, ["copy"]);
});
