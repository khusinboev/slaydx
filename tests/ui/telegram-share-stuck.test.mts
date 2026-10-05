import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ResultActions } from "../../components/files/ResultActions.tsx";
import { useAppStore } from "../../lib/store.ts";
import { compareVersions, requestWriteAccess, shareMessageResult } from "../../lib/telegram-webapp.ts";
import { resetGesture } from "../../lib/downloads/deliver.ts";
import type { GenerationDetail, ServerUser } from "../../lib/api-client.ts";

/**
 * Production hotfix (owner report, real Android Telegram): «Ulashish» worked
 * once, then the button stayed loading forever; later taps did nothing.
 * Telegram dropped the share answer, so `shareMessageResult` never settled and
 * tg-web-app.js kept `WebAppShareMessageOpened` set — every later
 * `shareMessage` threw. The fake below reproduces tg-web-app.js's real flag
 * semantics (throw while opened; the flag is cleared only by an answer; the
 * answer runs the STORED callback, then dispatches the event).
 */

type Listener = (p?: unknown) => void;

function fakeTelegram(o: { version?: string; platform?: string } = {}) {
  const version = o.version ?? "8.0";
  const listeners: Record<string, Listener[]> = {};
  const receive = (type: string, data?: unknown) => (listeners[type] ?? []).slice().forEach((f) => f(data));
  let opened: { callback?: (sent: boolean) => void } | false = false;
  const posted: { type: string; data: unknown }[] = [];
  const WebView = { postEvent: (type: string, _cb: unknown, data: unknown) => void posted.push({ type, data }) };
  const WebApp = {
    initData: "user=1",
    version,
    platform: o.platform ?? "android",
    initDataUnsafe: { user: { id: 700 } },
    isVersionAtLeast: (v: string) => compareVersions(version, v) >= 0,
    onEvent: (e: string, f: Listener) => void (listeners[e] ??= []).push(f),
    offEvent: (e: string, f: Listener) => {
      listeners[e] = (listeners[e] ?? []).filter((x) => x !== f);
    },
    shareMessage(id: string, callback?: (sent: boolean) => void) {
      if (opened) throw Error("WebAppShareMessageOpened");
      opened = { callback };
      WebView.postEvent("web_app_send_prepared_message", false, { id });
    },
    requestWriteAccess() {
      // The client never answers (dropped).
    },
  };
  const w = window as unknown as Record<string, unknown>;
  w.TelegramWebviewProxy = { postEvent() {} };
  w.Telegram = { WebApp, WebView };
  return {
    posted,
    listeners,
    get opened() {
      return opened !== false;
    },
    /** The client's `prepared_message_sent` (tg-web-app.js `onPreparedMessageSent`). */
    clientSent() {
      if (!opened) return;
      const r = opened;
      opened = false;
      r.callback?.(true);
      receive("shareMessageSent");
    },
    emit: receive,
  };
}

const realFetch = globalThis.fetch;
beforeEach(() => resetGesture());
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  const w = window as unknown as Record<string, unknown>;
  delete w.TelegramWebviewProxy;
  delete w.Telegram;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function settled<T>(p: Promise<T>): () => { done: boolean; value?: T } {
  const s: { done: boolean; value?: T } = { done: false };
  void p.then((v) => {
    s.done = true;
    s.value = v;
  });
  return () => s;
}
const SHARE_EVENTS = ["shareMessageSent", "shareMessageFailed", "activated", "deactivated"];

/* ───────────────────────────── shareMessageResult ───────────────────────────── */

test("dropped answer + the user comes back (deactivated → activated) → `unknown` after the grace; all listeners removed", async () => {
  const tg = fakeTelegram();
  const r = settled(shareMessageResult("p1", { graceMs: 30, timeoutMs: 10_000 }));
  await sleep(10);
  assert.equal(r().done, false, "waits while the picker is open");
  tg.emit("activated"); // active without having left: not a return
  await sleep(60);
  assert.equal(r().done, false, "«activated» without a prior «deactivated» does not settle");
  tg.emit("deactivated");
  tg.emit("activated");
  await sleep(60);
  assert.deepEqual(r(), { done: true, value: "unknown" });
  for (const e of SHARE_EVENTS) assert.equal((tg.listeners[e] ?? []).length, 0, `${e} listener left`);
});

test("dropped answer + page hidden → visible → `unknown`; a touch on the page → `unknown`", async () => {
  fakeTelegram();
  let vis = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => vis });
  try {
    const r = settled(shareMessageResult("p1", { graceMs: 20, timeoutMs: 10_000 }));
    vis = "hidden";
    document.dispatchEvent(new window.Event("visibilitychange"));
    vis = "visible";
    document.dispatchEvent(new window.Event("visibilitychange"));
    await sleep(50);
    assert.deepEqual(r(), { done: true, value: "unknown" });
  } finally {
    delete (document as unknown as Record<string, unknown>).visibilityState;
  }
  cleanup();
  fakeTelegram();
  const r2 = settled(shareMessageResult("p2", { graceMs: 20, timeoutMs: 10_000 }));
  await sleep(5);
  fireEvent.pointerDown(document.body);
  await sleep(50);
  assert.deepEqual(r2(), { done: true, value: "unknown" });
});

test("no answer and no return → hard timeout → `unknown`", async () => {
  fakeTelegram();
  const r = settled(shareMessageResult("p1", { timeoutMs: 40 }));
  await sleep(20);
  assert.equal(r().done, false);
  await sleep(60);
  assert.deepEqual(r(), { done: true, value: "unknown" });
});

test("a late `sent` within the grace still wins", async () => {
  const tg = fakeTelegram();
  const r = settled(shareMessageResult("p1", { graceMs: 80, timeoutMs: 10_000 }));
  tg.emit("deactivated");
  tg.emit("activated");
  await sleep(20);
  tg.clientSent();
  await sleep(10);
  assert.deepEqual(r(), { done: true, value: "sent" });
});

test("busy (flag stuck after a dropped answer) → the request is re-sent through WebView.postEvent and its answer resolves `sent`", async () => {
  const tg = fakeTelegram();
  const first = settled(shareMessageResult("p1", { timeoutMs: 20 }));
  await sleep(40);
  assert.deepEqual(first(), { done: true, value: "unknown" });
  assert.equal(tg.opened, true, "tg-web-app.js still thinks a picker is open");
  const second = settled(shareMessageResult("p2", { timeoutMs: 10_000 }));
  await sleep(5);
  assert.deepEqual(
    tg.posted.map((p) => [p.type, p.data]),
    [
      ["web_app_send_prepared_message", { id: "p1" }],
      ["web_app_send_prepared_message", { id: "p2" }],
    ],
    "the second request reached the client despite the stuck flag",
  );
  tg.clientSent();
  await sleep(5);
  assert.deepEqual(second(), { done: true, value: "sent" });
  assert.equal(tg.opened, false);
});

test("requestWriteAccess: a dropped answer resolves `false` after the timeout", async () => {
  fakeTelegram({ version: "8.0" });
  const r = settled(requestWriteAccess({ timeoutMs: 30 }));
  await sleep(10);
  assert.equal(r().done, false);
  await sleep(50);
  assert.deepEqual(r(), { done: true, value: false });
});

/* ───────────────────────────── «Ulashish» button ───────────────────────────── */

const ID = "11111111-1111-4111-8111-111111111111";
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function mountResult() {
  useAppStore.setState({
    sessionChecked: true,
    loggedIn: true,
    features: { llm: true, images: true, telegram: true, telegramBot: "SlaydX_bot", devLogin: false, pdf: true, payments: { click: false, payme: false } },
    user: { id: "u1", telegramId: "700" } as unknown as ServerUser,
  });
  const gen = {
    id: ID, type: "slide", topic: "Fotosintez", status: "COMPLETED", createdAt: "2026-10-01T08:00:00.000Z", finishedAt: null,
    price: 3000, fileName: "deck.pptx", format: "pptx", progress: 100, step: "Tayyor", expiresAt: null, error: null,
    preview: null, html: null, doc: null, hasFile: true, docVersion: 1, fileVersion: 1,
  } as unknown as GenerationDetail;
  render(
    h(AppRouterContext.Provider, { value: router }, h(ResultActions, {
      gen, lead: h("span", null, "lead"), editActions: null, fileStale: false, expired: false, hasResults: false,
      del: { armed: false, trigger: () => {} }, deleting: false,
    })),
  );
}

function stubShare(opts: { delayMs?: number } = {}) {
  let n = 0;
  const shares: number[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/telegram/share") && init?.method === "POST") {
      n++;
      shares.push(n);
      if (opts.delayMs) await sleep(opts.delayMs);
      return json(200, { preparedId: `prep-${n}`, expiresAt: new Date(Date.now() + 3600e3).toISOString(), format: "native", botUrl: null });
    }
    return json(404, {});
  }) as typeof fetch;
  return shares;
}

const btn = () => document.querySelector("[data-share-button]") as HTMLButtonElement;
const toast = () => document.querySelector("[data-result-toast]");
async function tap(el: Element) {
  await act(async () => {
    fireEvent.pointerDown(el);
    fireEvent.click(el);
  });
}

test("«Ulashish»: a dropped answer never leaves the button loading; the user is back → usable, no success claimed; the second tap prepares a NEW id and the picker opens", async () => {
  const tg = fakeTelegram();
  const shares = stubShare();
  mountResult();
  await tap(btn());
  await waitFor(() => assert.equal(tg.posted.length, 1));
  assert.equal(btn().disabled, true, "loading while the picker is open");
  // Telegram drops the answer; the user comes back to the Mini App.
  tg.emit("deactivated");
  tg.emit("activated");
  await act(async () => sleep(1_700));
  assert.equal(btn().disabled, false, "re-enabled after the grace");
  assert.ok(!btn().hasAttribute("aria-busy"));
  assert.ok(!/Ulashildi/.test(toast()?.textContent ?? ""), "no success claimed for an unknown outcome");
  assert.ok(!toast() || toast()!.getAttribute("role") !== "alert", "and no error either");
  // Second tap: new preparation, the picker opens again (re-sent past the stuck flag).
  await tap(btn());
  await waitFor(() => assert.equal(tg.posted.length, 2));
  assert.deepEqual(shares, [1, 2], "a new prepared message per tap");
  assert.deepEqual(tg.posted[1], { type: "web_app_send_prepared_message", data: { id: "prep-2" } });
  await act(async () => tg.clientSent());
  await waitFor(() => assert.match(toast()?.textContent ?? "", /Ulashildi/));
  assert.equal(btn().disabled, false);
});

test("«Ulashish» on Android after a slow preparation (tap > 8 s old): no silent drop — «Tayyor» and the next tap opens the picker with the same unused id", async () => {
  const tg = fakeTelegram({ platform: "android" });
  const shares = stubShare();
  mountResult();
  // A click with no pointerdown: the last tap is stale, as after a long upload.
  await act(async () => {
    fireEvent.click(btn());
  });
  await waitFor(() => assert.equal(btn().getAttribute("data-share-ready"), "1"));
  assert.equal(tg.posted.length, 0, "the request is not sent outside Android's 10 s window");
  assert.match(toast()?.textContent ?? "", /Tayyor — «Ulashish»ni yana bir bor bosing/);
  await tap(btn());
  await waitFor(() => assert.equal(tg.posted.length, 1));
  assert.deepEqual(tg.posted[0].data, { id: "prep-1" });
  assert.deepEqual(shares, [1], "no second preparation for the unused id");
  await act(async () => tg.clientSent());
  await waitFor(() => assert.match(toast()?.textContent ?? "", /Ulashildi/));
  assert.ok(!btn().hasAttribute("data-share-ready"));
});

test("iOS: no tap rule for the picker (opens right after a slow preparation)", async () => {
  const tg = fakeTelegram({ platform: "ios" });
  stubShare();
  mountResult();
  await act(async () => {
    fireEvent.click(btn());
  });
  await waitFor(() => assert.equal(tg.posted.length, 1));
  await act(async () => tg.clientSent());
  await waitFor(() => assert.match(toast()?.textContent ?? "", /Ulashildi/));
});
