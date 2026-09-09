import "./setup.ts";

/*
 * jsdom'da `window.matchMedia` YO'Q — `lib/store.ts` (`resolveOsTheme`,
 * `migrate`, `onRehydrateStorage`) uni chaqiradi, shuning uchun store
 * import qilinishidan OLDIN stub qo'yiladi. `mqMatches` o'zgaruvchisi
 * har testda "OS afzalligi"ni simulyatsiya qiladi.
 */
let mqMatches = false;
(globalThis.window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = ((q: string) =>
  ({
    matches: mqMatches,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }) as unknown as MediaQueryList) as unknown as (q: string) => MediaQueryList;

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { THEME_OPTIONS } from "../../lib/ui.ts";
import { useAppStore, applyTheme, resolveOsTheme, migrateUiPrefs } from "../../lib/store.ts";
import { TopBar } from "../../components/shell/TopBar.tsx";

/**
 * WP5 — mavzu faqat Kun/Tun, «Tizim» olib tashlandi.
 *
 * `resolveOsTheme`/`migrateUiPrefs` sof funksiyalar sifatida sinaladi
 * (harakat kutilmagan yon ta'sirsiz), TopBar esa haqiqiy DOM hodisasi
 * (bosish) orqali — ikonka/klass ekranda ko'rinadigani bilan
 * chindan mos kelishini tekshiradi.
 */

afterEach(() => {
  cleanup();
});

// ═══════════════════════════════════════════ THEME_OPTIONS

test("THEME_OPTIONS: aynan ikkita variant — Kun (light), Tun (dark), «Tizim» YO'Q", () => {
  assert.equal(THEME_OPTIONS.length, 2);
  const values: string[] = THEME_OPTIONS.map((t) => t.value);
  assert.deepEqual(values, ["light", "dark"]);
  assert.equal(
    values.includes("system"),
    false,
    "MUTATSIYA: agar 'system' qaytarilsa bu assertion qiziradi",
  );
});

// ═══════════════════════════════════════════ resolveOsTheme

test("resolveOsTheme: matchMedia.matches=true → 'dark'", () => {
  mqMatches = true;
  assert.equal(resolveOsTheme(), "dark");
});

test("resolveOsTheme: matchMedia.matches=false → 'light'", () => {
  mqMatches = false;
  assert.equal(resolveOsTheme(), "light");
});

// ═══════════════════════════════════════════ migrateUiPrefs

test("migrateUiPrefs: eski {theme:'system'} → hal qilingan OS qiymatiga o'tadi", () => {
  mqMatches = true;
  assert.equal(migrateUiPrefs({ theme: "system" }).theme, "dark");
  mqMatches = false;
  assert.equal(migrateUiPrefs({ theme: "system" }).theme, "light");
});

test("migrateUiPrefs: maydon umuman yo'q (undefined/bo'sh) — ham OS qiymatiga o'tadi", () => {
  mqMatches = true;
  assert.equal(migrateUiPrefs(undefined).theme, "dark");
  assert.equal(migrateUiPrefs({}).theme, "dark");
});

test("migrateUiPrefs: allaqachon 'light'/'dark' bo'lsa — o'zgarishsiz qoladi (OS chaqirilmaydi)", () => {
  mqMatches = true; // agar funksiya baribir resolveOsTheme chaqirsa, bu "dark" bilan aralashib ketishi kerak edi
  assert.equal(migrateUiPrefs({ theme: "light" }).theme, "light");
  mqMatches = false;
  assert.equal(migrateUiPrefs({ theme: "dark" }).theme, "dark");
});

test("migrateUiPrefs: locale/dir yaroqli bo'lsa saqlanadi, yaroqsiz bo'lsa maydon umuman qaytmaydi", () => {
  const out = migrateUiPrefs({ theme: "light", locale: "ru", dir: "rtl" });
  assert.equal(out.locale, "ru");
  assert.equal(out.dir, "rtl");
  const bad = migrateUiPrefs({ theme: "light", locale: 42, dir: "xx" });
  assert.equal("locale" in bad, false, "yaroqsiz locale — maydon qo'shilmasligi kerak (undefined bilan bosib yozmaslik uchun)");
  assert.equal("dir" in bad, false);
});

// ═══════════════════════════════════════════ TopBar — haqiqiy DOM hodisasi

test("TopBar: mavzu tugmasi bosilganda light↔dark almashadi, documentElement 'dark' klassi ergashadi", () => {
  useAppStore.setState({ theme: "light" });
  applyTheme("light");

  render(h(TopBar, { onMenu: () => {} }));

  const before = useAppStore.getState().theme;
  assert.equal(before, "light");
  assert.equal(document.documentElement.classList.contains("dark"), false);

  const btn1 = screen.getByLabelText(/Mavzu: Kun/);
  fireEvent.click(btn1);
  assert.equal(useAppStore.getState().theme, "dark");
  assert.equal(document.documentElement.classList.contains("dark"), true);

  const btn2 = screen.getByLabelText(/Mavzu: Tun/);
  fireEvent.click(btn2);
  assert.equal(useAppStore.getState().theme, "light");
  assert.equal(document.documentElement.classList.contains("dark"), false);
});
