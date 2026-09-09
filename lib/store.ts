"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import * as api from "./api-client";
import type { Features, ServerGeneration, ServerUser } from "./api-client";
import type { UserProfile } from "./types";

export type ThemeMode = "light" | "dark";

/**
 * Klient holati.
 *
 * Muhim o'zgarish: **pul va fayllar bu yerda emas.** Ilgari `charge`
 * va `refund` shu store da, balans esa `localStorage` da edi — ya'ni
 * foydalanuvchi DevTools orqali o'ziga cheksiz kredit yozib olardi.
 * Endi `user` va `generations` serverdan keladi, `localStorage` da esa
 * faqat interfeys sozlamalari (mavzu, til) saqlanadi.
 */

type AppState = {
  hydrated: boolean;
  /** Sessiya serverdan tekshirilganmi. */
  sessionChecked: boolean;
  loggedIn: boolean;
  user: ServerUser | null;
  features: Features | null;

  generations: ServerGeneration[];
  generationsLoaded: boolean;

  theme: ThemeMode;
  locale: string;
  dir: "ltr" | "rtl";

  refreshSession: () => Promise<void>;
  refreshGenerations: () => Promise<void>;
  setUser: (u: ServerUser | null) => void;
  upsertGeneration: (g: ServerGeneration) => void;
  dropGeneration: (id: string) => void;
  signOut: (all?: boolean) => Promise<void>;

  setTheme: (t: ThemeMode) => void;
  setLocale: (l: string) => void;
  setDir: (d: "ltr" | "rtl") => void;
  resetUiPrefs: () => void;
};

/**
 * Server 401 qaytarsa sessiyani darhol tozalaymiz.
 *
 * Ilgari cookie eskirganda interfeys foydalanuvchini «kirgan» deb
 * ko'rsatishda davom etardi va har amal tushunarsiz xato berardi.
 */
api.setUnauthorizedHandler(() => {
  const s = useAppStore.getState();
  if (!s.loggedIn) return;
  useAppStore.setState({
    user: null,
    loggedIn: false,
    generations: [],
    generationsLoaded: false,
  });
});

/**
 * OS afzalligini BIR MARTA o'qiydi (birinchi tashrifda standart qiymat
 * uchun). SSR xavfsiz — `window`/`matchMedia` yo'q bo'lsa "light".
 */
export function resolveOsTheme(): ThemeMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/**
 * `persist` `migrate`: eski `"system"` (yoki umuman noma'lum/yo'q)
 * qiymatni bir martalik OS o'qishga aylantiradi. FAQAT localStorage'da
 * eski (version < 2) yozuv bo'lsa chaqiriladi — yangi tashrifchi uchun
 * (hech narsa saqlanmagan) `persist` bu funksiyani chaqirMAYDI, o'sha
 * holat `onRehydrateStorage`da alohida qopqonlanadi (pastda).
 */
export function migrateUiPrefs(persisted: unknown): { theme: ThemeMode; locale?: string; dir?: "ltr" | "rtl" } {
  const p = (persisted ?? {}) as { theme?: unknown; locale?: unknown; dir?: unknown };
  const theme: ThemeMode = p.theme === "light" || p.theme === "dark" ? p.theme : resolveOsTheme();
  // `undefined` KIRITILMAYDI (faqat haqiqiy qiymat bo'lsa maydon
  // qo'shiladi) — `persist`ning standart merge'i sayoz (`{...state,
  // ...persisted}`), aks holda noto'g'ri `locale: undefined` joriy
  // holatdagi "uz"ni bosib yozardi.
  const out: { theme: ThemeMode; locale?: string; dir?: "ltr" | "rtl" } = { theme };
  if (typeof p.locale === "string") out.locale = p.locale;
  if (p.dir === "rtl" || p.dir === "ltr") out.dir = p.dir;
  return out;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      sessionChecked: false,
      loggedIn: false,
      user: null,
      features: null,
      generations: [],
      generationsLoaded: false,
      // SSR uchun joy egallovchi — haqiqiy qiymat `onRehydrateStorage`da
      // (birinchi tashrif → OS afzalligi) yoki `migrate`da (eski "system"
      // → OS afzalligi) o'rnatiladi.
      theme: "light",
      locale: "uz",
      dir: "ltr",

      refreshSession: async () => {
        try {
          const { user, features } = await api.fetchSession();
          set({ user, features, loggedIn: Boolean(user), sessionChecked: true });
          if (user?.language) set({ locale: user.language });
        } catch {
          // Tarmoq yo'q — kirgan deb hisoblamaymiz, lekin qayta urinish mumkin.
          set({ sessionChecked: true, loggedIn: false, user: null });
        }
      },

      refreshGenerations: async () => {
        if (!get().loggedIn) {
          set({ generations: [], generationsLoaded: true });
          return;
        }
        try {
          const { generations } = await api.listGenerations();
          set({ generations, generationsLoaded: true });
        } catch {
          set({ generationsLoaded: true });
        }
      },

      setUser: (user) => set({ user, loggedIn: Boolean(user) }),

      upsertGeneration: (g) =>
        set((s) => {
          const idx = s.generations.findIndex((x) => x.id === g.id);
          if (idx < 0) return { generations: [g, ...s.generations] };
          const next = [...s.generations];
          next[idx] = { ...next[idx], ...g };
          return { generations: next };
        }),

      dropGeneration: (id) =>
        set((s) => ({ generations: s.generations.filter((g) => g.id !== id) })),

      signOut: async (all = false) => {
        try {
          await api.logout(all);
        } finally {
          set({ user: null, loggedIn: false, generations: [], generationsLoaded: false });
        }
      },

      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      setLocale: (locale) => {
        set({ locale });
        // Til profilga ham yoziladi — boshqa qurilmada ham saqlanadi.
        if (get().loggedIn) void api.updateProfile({ language: locale }).catch(() => {});
      },
      setDir: (dir) => {
        if (typeof document !== "undefined") document.documentElement.setAttribute("dir", dir);
        set({ dir });
      },
      resetUiPrefs: () => {
        const theme = resolveOsTheme();
        applyTheme(theme);
        if (typeof document !== "undefined") document.documentElement.setAttribute("dir", "ltr");
        set({ theme, locale: "uz", dir: "ltr" });
      },
    }),
    {
      name: "slaydx-ui",
      // Faqat interfeys sozlamalari. Hujjat va balans hech qachon
      // localStorage ga yozilmaydi — u yerda kvota ~5 MB va ma'lumot
      // qurilmada qolib ketardi.
      partialize: (s) => ({ theme: s.theme, locale: s.locale, dir: s.dir }),
      version: 2,
      // Eski (`version < 2`, `"system"` yoki maydon yo'q) yozuvlarni
      // bir martalik OS o'qishiga aylantiradi (`migrateUiPrefs`).
      migrate: (persisted) => migrateUiPrefs(persisted),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.hydrated = true;
        if (typeof window === "undefined" || typeof document === "undefined") return;
        // Birinchi tashrif — localStorage'da HECH NARSA yo'q (`migrate`
        // bu holatda umuman chaqirilmaydi, zustand'ning o'zi shunday
        // ishlaydi) — standart qiymatni OS afzalligidan olamiz.
        let raw: string | null = null;
        try {
          raw = window.localStorage.getItem("slaydx-ui");
        } catch {
          raw = null;
        }
        if (raw === null || (state.theme !== "light" && state.theme !== "dark")) {
          state.theme = resolveOsTheme();
        }
        applyTheme(state.theme);
        document.documentElement.setAttribute("dir", state.dir ?? "ltr");
      },
    },
  ),
);

export function creditTotal(user: Pick<ServerUser, "points" | "quota" | "balance"> | null) {
  if (!user) return 0;
  return user.points + user.quota + user.balance;
}

/**
 * Forma standart qiymatlari uchun profil ko'rinishi.
 * Kirmagan foydalanuvchi uchun bo'sh shablon qaytadi.
 */
export function writerProfile(user: ServerUser | null): UserProfile {
  return {
    name: user?.name ?? "",
    language: user?.language ?? "uz",
    points: user?.points ?? 0,
    quota: user?.quota ?? 0,
    balance: user?.balance ?? 0,
    premium: user?.premium ?? false,
    plan: user?.plan ?? "free",
    university: user?.university ?? "",
    faculty: user?.faculty ?? "",
    department: user?.department ?? "",
    group: user?.group ?? "",
    course: user?.course ?? "",
    author: user?.author ?? "",
    subject: user?.subject ?? "",
    teacher: user?.teacher ?? "",
    city: user?.city || "Toshkent",
  };
}
