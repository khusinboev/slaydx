import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { isChunkLoadError, reloadOnceForChunkError, CHUNK_RELOAD_KEY } from "../../lib/chunk-reload.ts";
import * as errorMod from "../../app/error.tsx";

// tsx CJS/ESM o'rami: `default` ba'zan ikki qavat bo'ladi.
const ErrorBoundary = ((errorMod as unknown as { default: { default?: unknown } }).default.default ?? errorMod.default) as typeof errorMod.default;

/**
 * W4-D R1: FE-11 dan keyin composer/ko'ruvchilar `React.lazy` bo'laklari.
 * Deploydan keyin ochiq qolgan yorliq yo'q bo'lak xeshini so'raydi →
 * `app/error.tsx`; `reset()` esa `lazy` keshlagan rad etilgan promise ni
 * qayta otadi — foydalanuvchi qo'lda yangilamaguncha qotib qoladi.
 * Endi bo'lak xatosi BIR MARTA to'liq qayta yuklaydi (sessionStorage
 * bayrog'i + vaqt — sikl bo'lmaydi); boshqa xatoda odatiy UI.
 */

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

class Mem {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

test("isChunkLoadError: Next/webpack, Chromium, Safari va Turbopack matnlari; oddiy xato emas", () => {
  const named = new Error("x");
  named.name = "ChunkLoadError";
  assert.equal(isChunkLoadError(named), true);
  assert.equal(isChunkLoadError(new Error("Loading chunk 123 failed.")), true);
  assert.equal(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/_next/static/chunks/a.js")), true);
  assert.equal(isChunkLoadError(new TypeError("Importing a module script failed.")), true);
  assert.equal(isChunkLoadError(new Error("Failed to load chunk /_next/static/chunks/a.js from module 1")), true);
  assert.equal(isChunkLoadError(new Error("Cannot read properties of undefined")), false);
  assert.equal(isChunkLoadError(null), false);
});

test("reloadOnceForChunkError: birinchi marta qayta yuklaydi, darhol ikkinchisida YO'Q (sikl yo'q), muddatdan keyin yana", () => {
  const s = new Mem();
  let reloads = 0;
  const reload = () => reloads++;
  const err = new TypeError("Failed to fetch dynamically imported module: /a.js");
  assert.equal(reloadOnceForChunkError(err, { storage: s, now: 1_000_000, reload }), true);
  assert.equal(reloads, 1);
  assert.equal(reloadOnceForChunkError(err, { storage: s, now: 1_005_000, reload }), false, "5 s ichida qayta — sikl bo'lmasin");
  assert.equal(reloads, 1);
  assert.equal(reloadOnceForChunkError(err, { storage: s, now: 1_000_000 + 10 * 60_000, reload }), true, "keyingi deploy (10 daq) — yana bir marta");
  assert.equal(reloads, 2);
  assert.equal(reloadOnceForChunkError(new Error("boshqa"), { storage: s, now: 9e9, reload }), false, "oddiy xatoda qayta yuklanmaydi");
});

test("reloadOnceForChunkError: sessionStorage yo'q/ishlamaydi — qayta yuklamaydi (sikl xavfi)", () => {
  let reloads = 0;
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  assert.equal(reloadOnceForChunkError(new Error("Loading chunk 1 failed"), { storage: broken, now: 1, reload: () => reloads++ }), false);
  assert.equal(reloads, 0);
});

test("app/error.tsx: bo'lak xatosida bayroq qo'yiladi; oddiy xatoda «Qayta urinish» reset() ni chaqiradi", async () => {
  let resets = 0;
  await act(async () => {
    render(h(ErrorBoundary, { error: new Error("Oddiy render xatosi"), reset: () => resets++ }));
  });
  assert.ok(!window.sessionStorage.getItem(CHUNK_RELOAD_KEY), "oddiy xatoda qayta yuklash bayrog'i yo'q");
  fireEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  assert.equal(resets, 1);
  cleanup();

  const chunk = new TypeError("Failed to fetch dynamically imported module: /_next/static/chunks/x.js");
  await act(async () => {
    render(h(ErrorBoundary, { error: chunk, reset: () => resets++ }));
  });
  // jsdom `location.reload` ni bajarmaydi — qaror bayroq orqali ko'rinadi.
  assert.ok(window.sessionStorage.getItem(CHUNK_RELOAD_KEY), "bo'lak xatosida bir martalik qayta yuklash boshlandi");
  assert.ok(screen.getByText(/yangi versiya/i), "foydalanuvchiga sabab aytiladi");
});
