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

  /**
   * Birinchi seans tekshiruvi tarmoq/server xatosi bilan tugadi (FE-04) —
   * `AppShell` banner ko'rsatadi, store o'zi qayta urinadi. Muvaffaqiyatda `null`.
   */
  sessionError: string | null;

  generations: ServerGeneration[];
  generationsLoaded: boolean;
  /**
   * Birinchi sahifa javobidagi `nextCursor` (W2-B shartnomasi) — «Yana
   * ko'rsatish» shu yerdan davom etadi. `null` — boshqa sahifa yo'q.
   */
  generationsCursor: string | null;

  theme: ThemeMode;
  dir: "ltr" | "rtl";

  refreshSession: () => Promise<void>;
  /**
   * Telegram Mini App ichida `initData` imzosi bilan kirish (FE-10).
   * Bir vaqtda bitta so'rov; Mini App bo'lmasa hech narsa qilmaydi.
   * Xato bo'lsa tashlaydi (chaqiruvchi matnni ko'rsatadi).
   */
  miniAppLogin: () => Promise<void>;
  refreshGenerations: () => Promise<void>;
  setUser: (u: ServerUser | null) => void;
  upsertGeneration: (g: ServerGeneration) => void;
  dropGeneration: (id: string) => void;
  signOut: (all?: boolean) => Promise<void>;

  setTheme: (t: ThemeMode) => void;
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
    generationsCursor: null,
  });
});

/*
 * FE-04: birinchi seans tekshiruvi tarmoq/5xx bilan yiqilsa — o'sib
 * boruvchi oraliq bilan qayta so'raladi (2 s → 30 s). Bitta taymer.
 */
const SESSION_RETRY_START_MS = 2000;
const SESSION_RETRY_MAX_MS = 30_000;
let sessionRetryTimer: ReturnType<typeof setTimeout> | null = null;
let sessionRetryDelay = 0;

function clearSessionRetry() {
  if (sessionRetryTimer) clearTimeout(sessionRetryTimer);
  sessionRetryTimer = null;
  sessionRetryDelay = 0;
}

function scheduleSessionRetry() {
  if (sessionRetryTimer) return;
  sessionRetryDelay = Math.min(SESSION_RETRY_MAX_MS, sessionRetryDelay ? sessionRetryDelay * 2 : SESSION_RETRY_START_MS);
  sessionRetryTimer = setTimeout(() => {
    sessionRetryTimer = null;
    void useAppStore.getState().refreshSession();
  }, sessionRetryDelay);
}

/** Mini App kirishi — bitta so'rov uchib turadi; avtomatik urinish sahifa yuklanishida BIR marta. */
let miniAppPending: Promise<void> | null = null;
let miniAppAutoTried = false;

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
export function migrateUiPrefs(persisted: unknown): { theme: ThemeMode; dir?: "ltr" | "rtl" } {
  const p = (persisted ?? {}) as { theme?: unknown; dir?: unknown };
  const theme: ThemeMode = p.theme === "light" || p.theme === "dark" ? p.theme : resolveOsTheme();
  // `undefined` KIRITILMAYDI (faqat haqiqiy qiymat bo'lsa maydon
  // qo'shiladi) — `persist`ning standart merge'i sayoz (`{...state,
  // ...persisted}`), aks holda `dir: undefined` joriy "ltr"ni bosib yozardi.
  // Eski `locale` (C38 da olib tashlangan til menyusi) ko'chirilmaydi.
  const out: { theme: ThemeMode; dir?: "ltr" | "rtl" } = { theme };
  if (p.dir === "rtl" || p.dir === "ltr") out.dir = p.dir;
  return out;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      sessionChecked: false,
      sessionError: null,
      loggedIn: false,
      user: null,
      features: null,
      generations: [],
      generationsLoaded: false,
      generationsCursor: null,
      // SSR uchun joy egallovchi — haqiqiy qiymat `onRehydrateStorage`da
      // (birinchi tashrif → OS afzalligi) yoki `migrate`da (eski "system"
      // → OS afzalligi) o'rnatiladi.
      theme: "light",
      dir: "ltr",

      /*
       * FE-04: foydalanuvchini FAQAT aniq javob chiqaradi — 200 `user: null`
       * (seans yo'q) yoki 401. Ilgari har qanday xato (tarmoq uzilishi, 5xx,
       * deploy paytidagi 502) seansni «chiqdi» deb belgilardi: kutilgan
       * hujjat o'rniga «Kirish talab qilinadi», forma ustida kirish oynasi.
       * Endi seans davomida xato joriy holatni o'zgartirmaydi; birinchi
       * yuklanishda esa `sessionChecked` yolg'on qoladi (sahifalar
       * «Yuklanmoqda»), `AppShell` banner ko'rsatadi va qayta urinadi.
       */
      refreshSession: async () => {
        let res: Awaited<ReturnType<typeof api.fetchSession>>;
        try {
          res = await api.fetchSession();
        } catch (e) {
          if (e instanceof api.ApiError && e.status === 401) {
            clearSessionRetry();
            set({
              sessionChecked: true,
              sessionError: null,
              loggedIn: false,
              user: null,
              generations: [],
              generationsLoaded: false,
              generationsCursor: null,
            });
            return;
          }
          if (get().sessionChecked) return;
          set({ sessionError: e instanceof Error ? e.message : "Server bilan aloqa yo'q" });
          scheduleSessionRetry();
          return;
        }
        clearSessionRetry();
        const { user, features } = res;
        set({ user, features, loggedIn: Boolean(user), sessionChecked: true, sessionError: null });
        // Mini App ichida seans yo'q — `initData` imzosi bilan o'zi kiradi (FE-10).
        if (!user && features?.telegram && !miniAppAutoTried && api.miniAppInitData()) {
          miniAppAutoTried = true;
          get()
            .miniAppLogin()
            .catch((e: unknown) => {
              // Oddiy kirish oynasi ishlayveradi — sabab konsolga (UI jim qolmaydi: «Kirish» tugmasi joyida).
              console.warn("[miniapp] avtomatik kirish bo'lmadi:", e instanceof Error ? e.message : e);
            });
        }
      },

      miniAppLogin: () => {
        const initData = api.miniAppInitData();
        if (!initData) return Promise.resolve();
        if (miniAppPending) return miniAppPending;
        miniAppPending = api
          .loginWithTelegram({ initData })
          .then(({ user }) => {
            set({ user, loggedIn: true, sessionChecked: true, sessionError: null });
          })
          .finally(() => {
            miniAppPending = null;
          });
        return miniAppPending;
      },

      refreshGenerations: async () => {
        if (!get().loggedIn) {
          set({ generations: [], generationsLoaded: true, generationsCursor: null });
          return;
        }
        try {
          const { generations, nextCursor } = await api.listGenerations();
          set({ generations, generationsLoaded: true, generationsCursor: nextCursor ?? null });
        } catch {
          // Ro'yxat eski holicha qoladi; keyingi yangilash (polling/fokus) yana so'raydi.
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
          set({ user: null, loggedIn: false, generations: [], generationsLoaded: false, generationsCursor: null });
        }
      },

      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      setDir: (dir) => {
        if (typeof document !== "undefined") document.documentElement.setAttribute("dir", dir);
        set({ dir });
      },
      resetUiPrefs: () => {
        const theme = resolveOsTheme();
        applyTheme(theme);
        if (typeof document !== "undefined") document.documentElement.setAttribute("dir", "ltr");
        set({ theme, dir: "ltr" });
      },
    }),
    {
      name: "slaydx-ui",
      // Faqat interfeys sozlamalari. Hujjat va balans hech qachon
      // localStorage ga yozilmaydi — u yerda kvota ~5 MB va ma'lumot
      // qurilmada qolib ketardi.
      partialize: (s) => ({ theme: s.theme, dir: s.dir }),
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

/*
 * Mini App `initData` si store yuklanishi bilan — Next yo'riqchisi URL
 * `#` qismini keyingi o'tishda tashlashidan OLDIN — ushlab qolinadi (FE-10).
 */
if (typeof window !== "undefined") api.miniAppInitData();

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
    position: user?.position ?? "",
    organization: user?.organization ?? "",
  };
}
