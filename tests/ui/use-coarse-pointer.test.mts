import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, render } from "@testing-library/react";

/**
 * `useCoarsePointer` (docs/mobile/PLAN.md §4.6): `false` without `matchMedia`
 * (jsdom, SSR) so the desktop path stays the default; follows a stubbed media
 * query live and detaches on unmount.
 */

const { useCoarsePointer, isCoarsePointer, COARSE_POINTER_QUERY } = await import("../../lib/hooks/useCoarsePointer.ts");

type Listener = () => void;
const win = window as unknown as Record<string, unknown>;

function stubMatchMedia(initial: boolean, legacy = false) {
  const listeners = new Set<Listener>();
  const queries: string[] = [];
  const mql = {
    matches: initial,
    media: "",
    ...(legacy
      ? {}
      : {
          addEventListener: (_t: string, l: Listener) => listeners.add(l),
          removeEventListener: (_t: string, l: Listener) => listeners.delete(l),
        }),
    addListener: (l: Listener) => listeners.add(l),
    removeListener: (l: Listener) => listeners.delete(l),
  };
  win.matchMedia = (q: string) => {
    queries.push(q);
    return mql;
  };
  return {
    listeners,
    queries,
    set(v: boolean) {
      mql.matches = v;
      for (const l of [...listeners]) l();
    },
  };
}

function Probe() {
  return h("span", { "data-coarse": String(useCoarsePointer()) });
}
const value = (c: HTMLElement) => c.querySelector("[data-coarse]")!.getAttribute("data-coarse");

afterEach(() => {
  cleanup();
  delete win.matchMedia;
});

test("no matchMedia (jsdom default): false", () => {
  assert.equal(typeof win.matchMedia, "undefined");
  const { container } = render(h(Probe));
  assert.equal(value(container), "false");
  assert.equal(isCoarsePointer(), false);
});

test("server render is false even on a touch device", () => {
  stubMatchMedia(true);
  assert.match(renderToString(h(Probe)), /data-coarse="false"/);
});

test("uses the coarse-pointer-or-phone query and follows changes live", () => {
  const mm = stubMatchMedia(true);
  const { container, unmount } = render(h(Probe));
  assert.equal(value(container), "true");
  assert.ok(mm.queries.every((q) => q === COARSE_POINTER_QUERY));
  assert.equal(COARSE_POINTER_QUERY, "(pointer: coarse), (max-width: 767px)");
  act(() => mm.set(false));
  assert.equal(value(container), "false");
  act(() => mm.set(true));
  assert.equal(value(container), "true");
  assert.equal(mm.listeners.size, 1);
  unmount();
  assert.equal(mm.listeners.size, 0, "listener removed on unmount");
});

test("legacy addListener-only MediaQueryList still updates", () => {
  const mm = stubMatchMedia(false, true);
  const { container, unmount } = render(h(Probe));
  assert.equal(value(container), "false");
  act(() => mm.set(true));
  assert.equal(value(container), "true");
  unmount();
  assert.equal(mm.listeners.size, 0);
});

test("a throwing matchMedia falls back to false", () => {
  win.matchMedia = () => {
    throw new Error("blocked");
  };
  const { container } = render(h(Probe));
  assert.equal(value(container), "false");
});
