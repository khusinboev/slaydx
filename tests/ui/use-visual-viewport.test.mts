import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, render } from "@testing-library/react";

/**
 * `useVisualViewport` (docs/mobile/PLAN.md §4.6, R3 «Contract»): pure
 * `computeViewport` rules, jsdom default (window size, keyboard closed), a
 * stubbed `visualViewport` (iOS-style keyboard), an Android-style window
 * resize, Telegram `viewportChanged`, and the `--vv-h` / `--kb-h` variables.
 */

const { useVisualViewport, computeViewport, KEYBOARD_MIN_PX, KEYBOARD_SHRINK_RATIO } = await import(
  "../../lib/hooks/useVisualViewport.ts"
);

const win = window as unknown as Record<string, unknown>;
const root = () => document.documentElement.style;

function setInner(height: number, width = 390) {
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true, writable: true });
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
}

/** A `visualViewport` stand-in with real event dispatch. */
function stubVisualViewport(height: number, offsetTop = 0, scale = 1) {
  const target = new EventTarget() as EventTarget & { height: number; offsetTop: number; scale: number };
  Object.assign(target, { height, offsetTop, scale });
  win.visualViewport = target;
  return {
    target,
    set(next: { height?: number; offsetTop?: number; scale?: number }, type: "resize" | "scroll" = "resize") {
      Object.assign(target, next);
      target.dispatchEvent(new Event(type));
    },
  };
}

function Probe() {
  const v = useVisualViewport();
  return h("span", {
    "data-h": v.height,
    "data-top": v.offsetTop,
    "data-kb": String(v.keyboardOpen),
    "data-kbh": v.keyboardHeight,
  });
}
const read = (c: HTMLElement) => {
  const el = c.querySelector("[data-h]")!;
  return {
    height: Number(el.getAttribute("data-h")),
    offsetTop: Number(el.getAttribute("data-top")),
    keyboardOpen: el.getAttribute("data-kb") === "true",
    keyboardHeight: Number(el.getAttribute("data-kbh")),
  };
};
const frame = () => new Promise((r) => setTimeout(r, 5));

afterEach(() => {
  cleanup();
  delete win.visualViewport;
  delete win.Telegram;
  delete win.TelegramWebviewProxy;
  setInner(768, 1024);
});

/* ------------------------------------------------------------------ pure */

test("computeViewport: no visualViewport → window height, keyboard closed", () => {
  const s = { innerHeight: 740, innerWidth: 360, layoutHeight: 0, vv: null };
  assert.deepEqual(computeViewport(s, 740), { height: 740, offsetTop: 0, keyboardOpen: false, keyboardHeight: 0 });
});

test("computeViewport: iOS keyboard shrinks only the visual viewport", () => {
  const s = { innerHeight: 844, innerWidth: 390, layoutHeight: 844, vv: { height: 480, offsetTop: 100, scale: 1 } };
  assert.deepEqual(computeViewport(s, 844), { height: 480, offsetTop: 100, keyboardOpen: true, keyboardHeight: 264 });
});

test("computeViewport: threshold is strictly more than KEYBOARD_MIN_PX", () => {
  assert.equal(KEYBOARD_MIN_PX, 120);
  const at = (vvh: number) =>
    computeViewport({ innerHeight: 800, innerWidth: 390, layoutHeight: 800, vv: { height: vvh, offsetTop: 0, scale: 1 } }, 800);
  assert.equal(at(680).keyboardOpen, false, "exactly 120 px shorter: browser toolbar, not a keyboard");
  assert.equal(at(679).keyboardOpen, true);
  assert.equal(at(680).keyboardHeight, 0, "no lift while the keyboard is considered closed");
});

test("computeViewport: pinch zoom is not a keyboard", () => {
  const s = { innerHeight: 800, innerWidth: 390, layoutHeight: 800, vv: { height: 400, offsetTop: 200, scale: 2 } };
  const v = computeViewport(s, 800);
  assert.equal(v.keyboardOpen, false);
  assert.equal(v.keyboardHeight, 0);
  assert.equal(v.height, 400);
});

test("computeViewport: Android resize (window shrinks) → keyboard open, no lift needed", () => {
  assert.equal(KEYBOARD_SHRINK_RATIO, 0.8);
  const s = { innerHeight: 420, innerWidth: 390, layoutHeight: 420, vv: { height: 420, offsetTop: 0, scale: 1 } };
  assert.deepEqual(computeViewport(s, 844), { height: 420, offsetTop: 0, keyboardOpen: true, keyboardHeight: 0 });
  // Just above 80 % of the tallest height: not a keyboard (e.g. a toolbar collapsing).
  const t = { ...s, innerHeight: 676, layoutHeight: 676, vv: { height: 676, offsetTop: 0, scale: 1 } };
  assert.equal(computeViewport(t, 844).keyboardOpen, false);
  // Unknown history (0) never claims a keyboard.
  assert.equal(computeViewport(s, 0).keyboardOpen, false);
});

test("computeViewport: layoutHeight 0 (jsdom) falls back to innerHeight; values are rounded", () => {
  const s = { innerHeight: 800, innerWidth: 390, layoutHeight: 0, vv: { height: 500.4, offsetTop: 10.6, scale: 1 } };
  assert.deepEqual(computeViewport(s, 800), { height: 500, offsetTop: 11, keyboardOpen: true, keyboardHeight: 289 });
});

/* ----------------------------------------------------------------- hook */

test("server render: zeros, keyboard closed", () => {
  setInner(844);
  stubVisualViewport(400);
  const html = renderToString(h(Probe));
  assert.match(html, /data-h="0"/);
  assert.match(html, /data-kb="false"/);
});

test("jsdom default (no visualViewport): window height, keyboard closed, CSS variables set and removed", () => {
  setInner(740, 360);
  const { container, unmount } = render(h(Probe));
  assert.deepEqual(read(container), { height: 740, offsetTop: 0, keyboardOpen: false, keyboardHeight: 0 });
  assert.equal(root().getPropertyValue("--vv-h"), "740px");
  assert.equal(root().getPropertyValue("--kb-h"), "0px");
  unmount();
  assert.equal(root().getPropertyValue("--vv-h"), "", "removed with the last user");
  assert.equal(root().getPropertyValue("--kb-h"), "");
});

test("iOS-style keyboard: visualViewport resize/scroll update the state and --kb-h", async () => {
  setInner(844);
  const vv = stubVisualViewport(844);
  const { container } = render(h(Probe));
  assert.equal(read(container).keyboardOpen, false);

  act(() => vv.set({ height: 500 }));
  assert.deepEqual(read(container), { height: 500, offsetTop: 0, keyboardOpen: true, keyboardHeight: 344 });
  assert.equal(root().getPropertyValue("--vv-h"), "500px");
  assert.equal(root().getPropertyValue("--kb-h"), "344px");

  act(() => vv.set({ offsetTop: 120 }, "scroll"));
  assert.equal(read(container).offsetTop, 120);
  assert.equal(root().getPropertyValue("--kb-h"), "224px");

  act(() => vv.set({ height: 844, offsetTop: 0 }));
  assert.deepEqual(read(container), { height: 844, offsetTop: 0, keyboardOpen: false, keyboardHeight: 0 });
  assert.equal(root().getPropertyValue("--kb-h"), "0px");
  await act(frame);
});

test("Android-style keyboard: the window resizes; rotation resets the tallest height", async () => {
  setInner(844, 390);
  const { container } = render(h(Probe));
  act(() => {
    setInner(420, 390);
    window.dispatchEvent(new window.Event("resize"));
  });
  assert.equal(read(container).keyboardOpen, true);
  assert.equal(read(container).height, 420);
  assert.equal(root().getPropertyValue("--kb-h"), "0px", "bottom: 0 is already above the keyboard");

  // Landscape: shorter window at a new width is not a keyboard.
  act(() => {
    setInner(390, 844);
    window.dispatchEvent(new window.Event("resize"));
  });
  assert.equal(read(container).keyboardOpen, false);
  await act(frame);
});

test("listeners: shared between users and detached when the last one unmounts", async () => {
  setInner(844);
  const vv = stubVisualViewport(844);
  const added: string[] = [];
  const removed: string[] = [];
  const add = vv.target.addEventListener.bind(vv.target);
  const rem = vv.target.removeEventListener.bind(vv.target);
  vv.target.addEventListener = ((t: string, l: EventListener) => (added.push(t), add(t, l))) as typeof add;
  vv.target.removeEventListener = ((t: string, l: EventListener) => (removed.push(t), rem(t, l))) as typeof rem;

  const a = render(h(Probe));
  const b = render(h(Probe));
  assert.deepEqual(added.sort(), ["resize", "scroll"], "one listener set for two users");
  act(() => vv.set({ height: 600 }));
  assert.equal(read(a.container).height, 600);
  assert.equal(read(b.container).height, 600);
  a.unmount();
  assert.deepEqual(removed, []);
  assert.equal(root().getPropertyValue("--vv-h"), "600px");
  b.unmount();
  assert.deepEqual(removed.sort(), ["resize", "scroll"]);
  assert.equal(root().getPropertyValue("--vv-h"), "");
  await act(frame);
});

test("Telegram viewportChanged triggers a re-read inside the Mini App", async () => {
  setInner(844);
  const vv = stubVisualViewport(844);
  const handlers = new Map<string, Set<() => void>>();
  win.TelegramWebviewProxy = { postEvent() {} };
  win.Telegram = {
    WebApp: {
      initData: "user=%7B%22id%22%3A42%7D&hash=abc",
      onEvent: (t: string, cb: () => void) => {
        if (!handlers.has(t)) handlers.set(t, new Set());
        handlers.get(t)!.add(cb);
      },
      offEvent: (t: string, cb: () => void) => handlers.get(t)?.delete(cb),
    },
  };
  const { container, unmount } = render(h(Probe));
  assert.equal(handlers.get("viewportChanged")?.size, 1);
  // The size changed without a DOM event (Telegram reports it first).
  Object.assign(vv.target, { height: 450 });
  act(() => {
    for (const cb of handlers.get("viewportChanged")!) cb();
  });
  assert.equal(read(container).height, 450);
  assert.equal(read(container).keyboardOpen, true);
  unmount();
  assert.equal(handlers.get("viewportChanged")!.size, 0, "unsubscribed with the last user");
  await act(frame);
});

test("outside Telegram no Telegram subscription is attempted", () => {
  setInner(844);
  let subscribed = 0;
  // A planted object in a plain tab (no webview signal) is ignored.
  win.Telegram = { WebApp: { initData: "x", onEvent: () => subscribed++, offEvent: () => {} } };
  const { unmount } = render(h(Probe));
  assert.equal(subscribed, 0);
  unmount();
});
