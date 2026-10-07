import "./setup.ts";

/*
 * jsdom'da `window.matchMedia` YO'Q — `lib/store.ts` (`resolveOsTheme`,
 * `migrate`, `onRehydrateStorage`) uni chaqiradi, shuning uchun store
 * import qilinishidan OLDIN stub qo'yiladi. `mqMatches` o'zgaruvchisi
 * har testda "OS afzalligi"ni simulyatsiya qiladi.
 */
let mqMatches = false;
/** OS theme change listeners (`prefers-color-scheme`), fired by `osSwitch`. */
const mqListeners = new Set<() => void>();
(globalThis.window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = ((q: string) =>
  ({
    matches: mqMatches,
    media: q,
    addEventListener(_: string, l: () => void) {
      if (q.includes("prefers-color-scheme")) mqListeners.add(l);
    },
    removeEventListener(_: string, l: () => void) {
      mqListeners.delete(l);
    },
  }) as unknown as MediaQueryList) as unknown as (q: string) => MediaQueryList;

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, render, fireEvent, screen, cleanup } from "@testing-library/react";
import { THEME_OPTIONS } from "../../lib/ui.ts";
import { useAppStore, applyTheme, resolveOsTheme, migrateUiPrefs } from "../../lib/store.ts";
import { ThemeToggle } from "../../components/shell/ThemeToggle.tsx";
import { ProfileStep } from "../../components/profile/ProfileStep.tsx";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type * as api from "../../lib/api-client.ts";

/**
 * Redesign D4 (2026-10-07): Kun / Tun / **Avto** (Avto — OS ga jonli ergashadi).
 * WP5 dagi eski «Tizim» qiymati qaytmaydi: u (va yo'q qiymat) bir martalik OS
 * o'qishiga aylanadi; `auto` esa haqiqiy tanlov sifatida saqlanadi. TopBar
 * olib tashlandi — tugma endi `ThemeToggle` (Bosh sarlavhasi), to'liq tanlov
 * Profil → Ko'rinish qadami (`ProfileStep` «korinish»; avvalgi, hech qayerda
 * ishlatilmagan `ThemeChoice` o'chirildi).
 *
 * Mutatsiyalar: THEME_OPTIONS dan `auto` ni olib tashlash; `migrateUiPrefs`
 * `auto` ni OS ga aylantirsa; `applyTheme("auto")` OS ni o'qimasa yoki
 * o'zgarishga ergashmasa; ThemeToggle keyingi rejimni noto'g'ri hisoblasa.
 *
 * (WP5 matni:) mavzu faqat Kun/Tun, «Tizim» olib tashlandi.
 *
 * `resolveOsTheme`/`migrateUiPrefs` sof funksiyalar sifatida sinaladi
 * (harakat kutilmagan yon ta'sirsiz), TopBar esa haqiqiy DOM hodisasi
 * (bosish) orqali — ikonka/klass ekranda ko'rinadigani bilan
 * chindan mos kelishini tekshiradi.
 */

afterEach(() => {
  cleanup();
});

const THEME_USER = {
  id: "u1", telegramId: null, username: null, name: "Ali", photoUrl: null, language: "uz", points: 0, quota: 0, balance: 0,
  university: "", faculty: "", department: "", group: "", course: "", author: "", subject: "", teacher: "", city: "",
  position: "", organization: "", phone: null, isAdmin: false,
} as api.ServerUser;
const noRouter = { back() {}, forward() {}, refresh() {}, prefetch() {}, push() {}, replace() {} } as unknown as AppRouterInstance;
/** The Ko'rinish step needs a signed-in session (the steps show a sign-in card otherwise). */
function signInForTheme() {
  useAppStore.setState({ sessionChecked: true, loggedIn: true, user: THEME_USER });
}
const korinish = () => h(AppRouterContext.Provider, { value: noRouter }, h(ProfileStep, { step: "korinish", onNavigate: () => {} }));

// ═══════════════════════════════════════════ THEME_OPTIONS

test("THEME_OPTIONS: aynan uchta variant — Kun (light), Tun (dark), Avto (auto), «Tizim» YO'Q", () => {
  assert.equal(THEME_OPTIONS.length, 3);
  const values: string[] = THEME_OPTIONS.map((t) => t.value);
  assert.deepEqual(values, ["light", "dark", "auto"]);
  assert.deepEqual(THEME_OPTIONS.map((t) => t.label), ["Kun", "Tun", "Avto"]);
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

test("migrateUiPrefs: «Avto» (auto) saqlanadi — OS ga aylantirilmaydi", () => {
  mqMatches = true;
  assert.equal(migrateUiPrefs({ theme: "auto" }).theme, "auto");
  mqMatches = false;
  assert.equal(migrateUiPrefs({ theme: "auto" }).theme, "auto");
});

test("applyTheme('auto'): hozirgi OS rejimini chizadi va OS o'zgarsa unga ergashadi; aniq rejim ergashmaydi", () => {
  mqMatches = true;
  useAppStore.getState().setTheme("auto");
  assert.equal(document.documentElement.classList.contains("dark"), true, "OS tun → tun");
  mqMatches = false;
  for (const l of mqListeners) l();
  assert.equal(document.documentElement.classList.contains("dark"), false, "OS kun ga o'tdi → kun");
  useAppStore.getState().setTheme("dark");
  mqMatches = false;
  for (const l of mqListeners) l();
  assert.equal(document.documentElement.classList.contains("dark"), true, "aniq Tun — OS o'zgarishi e'tiborsiz");
  useAppStore.getState().setTheme("light");
});

test("migrateUiPrefs: dir yaroqli bo'lsa saqlanadi, yaroqsiz bo'lsa maydon qaytmaydi; eski `locale` ko'chirilmaydi (C38)", () => {
  const out = migrateUiPrefs({ theme: "light", locale: "ru", dir: "rtl" });
  assert.equal(out.dir, "rtl");
  assert.equal("locale" in out, false, "til menyusi olib tashlangan — eski qiymat holatga qaytmaydi");
  const bad = migrateUiPrefs({ theme: "light", dir: "xx" });
  assert.equal("dir" in bad, false, "yaroqsiz dir — maydon qo'shilmasligi kerak (undefined bilan bosib yozmaslik uchun)");
});

// ═══════════════════════════════════════════ C38 — bezak til menyusi yo'q

test("C38 (UX-09/FE-21): mavzu boshqaruvlarida (ThemeToggle / Profil → Ko'rinish) interfeys tili menyusi YO'Q, store da `locale` holati yo'q", () => {
  signInForTheme();
  render(h("div", null, h(ThemeToggle), korinish()));
  assert.ok(document.querySelector("[data-theme-choice]"), "the Ko'rinish step rendered");
  assert.ok(!screen.queryByLabelText("Tilni o'zgartirish"), "til tugmasi olib tashlangan");
  for (const name of ["English", "Русский", "Qaraqalpaqsha", "Қазақша", "Кыргызча"]) {
    assert.ok(!screen.queryByText(name), `${name} yo'q`);
  }
  const st = useAppStore.getState() as unknown as Record<string, unknown>;
  assert.equal("setLocale" in st, false, "ishlatilmaydigan setLocale yo'q");
  assert.equal("locale" in st, false, "ishlatilmaydigan locale holati yo'q");
  assert.equal(document.documentElement.getAttribute("lang") === "en", false);
});

// ═══════════════════════════════════════════ ThemeToggle / Ko'rinish — haqiqiy DOM hodisasi

test("ThemeToggle: bosilganda light↔dark almashadi, documentElement 'dark' klassi ergashadi", () => {
  useAppStore.setState({ theme: "light" });
  applyTheme("light");

  render(h(ThemeToggle));

  assert.equal(useAppStore.getState().theme, "light");
  assert.equal(document.documentElement.classList.contains("dark"), false);

  const btn1 = screen.getByLabelText(/^Mavzu: Kun\. Almashtirish: Tun$/);
  assert.ok(btn1.className.includes("size-11"), "44 px");
  fireEvent.click(btn1);
  assert.equal(useAppStore.getState().theme, "dark");
  assert.equal(document.documentElement.classList.contains("dark"), true);

  const btn2 = screen.getByLabelText(/^Mavzu: Tun\. Almashtirish: Kun$/);
  fireEvent.click(btn2);
  assert.equal(useAppStore.getState().theme, "light");
  assert.equal(document.documentElement.classList.contains("dark"), false);
});

test("ThemeToggle on Avto: shows what is painted and flips it to the explicit opposite", () => {
  mqMatches = true;
  act(() => useAppStore.getState().setTheme("auto"));
  render(h(ThemeToggle));
  const btn = screen.getByLabelText(/^Mavzu: Avto \(Tun\)\. Almashtirish: Kun$/);
  fireEvent.click(btn);
  assert.equal(useAppStore.getState().theme, "light", "Avto + OS tun → aniq Kun");
  assert.equal(document.documentElement.classList.contains("dark"), false);
  mqMatches = false;
});

test("Profil → Ko'rinish (ProfileStep «korinish»): Kun / Tun / Avto radio guruhi, tanlangani checked, har biri ≥ 44 px", () => {
  act(() => useAppStore.getState().setTheme("light"));
  signInForTheme();
  render(korinish());
  const group = screen.getByRole("group", { name: "Mavzu" });
  const radios = [...group.querySelectorAll<HTMLInputElement>("input[type=radio]")];
  const labels = radios.map((r) => r.closest<HTMLElement>("label[data-theme-choice]")!);
  assert.deepEqual(radios.map((r) => r.value), ["light", "dark", "auto"]);
  assert.deepEqual(labels.map((l) => l.querySelector("span > span")?.textContent), ["Kun", "Tun", "Avto"]);
  assert.deepEqual(radios.map((r) => r.checked), [true, false, false]);
  assert.equal(new Set(radios.map((r) => r.name)).size, 1, "one radio group");
  for (const l of labels) assert.ok(l.className.includes("min-h-[64px]"), "≥ 44 px target (the whole row)");
  mqMatches = true;
  fireEvent.click(radios[2]!);
  assert.equal(useAppStore.getState().theme, "auto");
  assert.equal(document.documentElement.classList.contains("dark"), true, "Avto: OS tun");
  assert.equal(radios[2]!.checked, true);
  assert.equal(radios[0]!.checked, false);
  mqMatches = false;
  act(() => useAppStore.getState().setTheme("light"));
});
