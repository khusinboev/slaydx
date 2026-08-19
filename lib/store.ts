"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import * as api from "./api-client";
import type { Features, ServerGeneration, ServerUser } from "./api-client";
import type { UserProfile } from "./types";

export type ThemeMode = "light" | "dark" | "system";

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

export function applyTheme(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
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
      theme: "system",
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
        applyTheme("system");
        if (typeof document !== "undefined") document.documentElement.setAttribute("dir", "ltr");
        set({ theme: "system", locale: "uz", dir: "ltr" });
      },
    }),
    {
      name: "sodda-web-ui",
      // Faqat interfeys sozlamalari. Hujjat va balans hech qachon
      // localStorage ga yozilmaydi — u yerda kvota ~5 MB va ma'lumot
      // qurilmada qolib ketardi.
      partialize: (s) => ({ theme: s.theme, locale: s.locale, dir: s.dir }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.hydrated = true;
        if (typeof document !== "undefined") {
          applyTheme(state.theme);
          document.documentElement.setAttribute("dir", state.dir ?? "ltr");
        }
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
