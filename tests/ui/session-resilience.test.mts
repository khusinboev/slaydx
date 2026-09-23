import "./setup.ts";

/*
 * Mini App ishga tushirish URL i (FE-10): Telegram mijozi `initData` ni
 * `#tgWebAppData=…` da beradi. Store uni import paytida ushlaydi —
 * shuning uchun hash store yuklanishidan OLDIN qo'yiladi.
 */
const INIT_DATA = "query_id=AAH1&user=%7B%22id%22%3A42%2C%22first_name%22%3A%22Ali%22%7D&auth_date=1790000000&hash=abc123";
window.location.hash = `#tgWebAppData=${encodeURIComponent(INIT_DATA)}&tgWebAppVersion=7.0&tgWebAppPlatform=ios`;

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { CreateGrid } = await import("../../components/home/CreateGrid.tsx");
const { SessionBanner } = await import("../../components/shell/AppShell.tsx");
const { LoginForm } = await import("../../components/overlays/LoginModal.tsx");

/**
 * FE-04 — vaqtinchalik `/api/auth/session` xatosi foydalanuvchini chiqarmaydi;
 * FE-09 — `/uz/create` kirish oynasini seans tekshirilgandan KEYIN ochadi;
 * FE-10 — Mini App `initData` bilan avtomatik kirish haqiqatan ishlaydi.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  useUi.setState({ overlay: null, returnTo: null, payPlan: null });
});

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const user = {
  id: "u1", telegramId: "42", username: "ali", name: "Ali", photoUrl: null, language: "uz", points: 0, quota: 0,
  balance: 5000, plan: "free", planExpiresAt: null, premium: false, university: "", faculty: "", department: "",
  group: "", course: "", author: "", subject: "", teacher: "", city: "", position: "", organization: "", phone: null,
  isAdmin: false,
};
const features = (telegram = false) => ({
  llm: true, images: true, telegram, telegramBot: telegram ? "slaydx_bot" : null, devLogin: false, pdf: true,
  payments: { click: false, payme: false },
});

function stubSession(answers: Array<() => Response | Promise<Response>>) {
  const calls: string[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("/api/auth/session")) {
      const next = answers.shift();
      if (!next) throw new Error("kutilmagan session so'rovi");
      return next();
    }
    return json(200, { generations: [] });
  };
  return calls;
}

const reset = () =>
  useAppStore.setState({ sessionChecked: false, sessionError: null, loggedIn: false, user: null, features: null });

test("FE-04: seans davomida 500 / tarmoq uzilishi foydalanuvchini CHIQARMAYDI", async () => {
  reset();
  stubSession([
    () => json(200, { user, features: features() }),
    () => json(500, { error: "db pool" }),
    () => {
      throw new TypeError("Failed to fetch");
    },
    () => json(502, {}),
  ]);
  const s = useAppStore.getState();
  await s.refreshSession();
  assert.equal(useAppStore.getState().loggedIn, true);
  await s.refreshSession();
  assert.equal(useAppStore.getState().loggedIn, true, "500 — hali kirgan");
  assert.equal(useAppStore.getState().user?.id, "u1", "foydalanuvchi o'chmaydi");
  await s.refreshSession();
  assert.equal(useAppStore.getState().loggedIn, true, "tarmoq xatosi — hali kirgan");
  await s.refreshSession();
  assert.equal(useAppStore.getState().loggedIn, true, "502 (deploy) — hali kirgan");
});

test("FE-04: FAQAT aniq javob chiqaradi — 200 `user:null` va 401", async () => {
  reset();
  stubSession([
    () => json(200, { user, features: features() }),
    () => json(200, { user: null, features: features() }),
    () => json(200, { user, features: features() }),
    () => json(401, { error: "Sessiya tugagan" }),
  ]);
  const s = useAppStore.getState();
  await s.refreshSession();
  await s.refreshSession();
  assert.equal(useAppStore.getState().loggedIn, false, "server «seans yo'q» dedi");
  await s.refreshSession();
  assert.equal(useAppStore.getState().loggedIn, true);
  await s.refreshSession();
  assert.equal(useAppStore.getState().loggedIn, false, "401");
  assert.equal(useAppStore.getState().user, null);
});

test("FE-04: birinchi yuklanishda xato — «chiqdi» emas: sessionChecked yolg'on, banner, o'zi qayta urinadi", async (t) => {
  reset();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = stubSession([() => json(503, {}), () => json(200, { user, features: features() })]);
  await act(async () => {
    await useAppStore.getState().refreshSession();
  });
  assert.equal(useAppStore.getState().sessionChecked, false, "sahifalar «kirmagan» holatiga o'tmaydi");
  assert.equal(useAppStore.getState().loggedIn, false);
  render(h(SessionBanner));
  assert.ok(screen.getByRole("status").textContent?.includes("Server bilan aloqa yo‘q"));
  await act(async () => {
    t.mock.timers.tick(1999);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  assert.equal(calls.filter((c) => c.startsWith("/api/auth/session")).length, 1, "2 s gacha qayta so'ramaydi");
  await act(async () => {
    t.mock.timers.tick(1);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  // Qayta so'rov yo'lga chiqdi — qolganini haqiqiy taymerlar bilan kutamiz (`waitFor` o'zi setTimeout ishlatadi).
  t.mock.timers.reset();
  await waitFor(() => assert.equal(useAppStore.getState().sessionChecked, true));
  assert.equal(calls.filter((c) => c.startsWith("/api/auth/session")).length, 2, "2 s dan keyin qayta so'radi");
  assert.equal(useAppStore.getState().loggedIn, true);
  assert.ok(!screen.queryByRole("status"), "banner yo'qoladi");
});

test("FE-09: /uz/create — seans tekshirilmaguncha kirish oynasi OCHILMAYDI; kirgan bo'lsa umuman ochilmaydi", async () => {
  useAppStore.setState({ hydrated: true, sessionChecked: false, loggedIn: false, user: null, features: features() });
  render(h(CreateGrid));
  await act(async () => {});
  assert.equal(useUi.getState().overlay, null, "seans javobini kutadi");
  await act(async () => {
    useAppStore.setState({ sessionChecked: true, loggedIn: true, user });
  });
  assert.equal(useUi.getState().overlay, null, "kirgan foydalanuvchiga kirish oynasi yo'q");
  cleanup();
  useAppStore.setState({ hydrated: true, sessionChecked: true, loggedIn: false, user: null });
  render(h(CreateGrid));
  await act(async () => {});
  assert.equal(useUi.getState().overlay, "login", "haqiqatan kirmagan — oyna ochiladi");
});

test("FE-10: Mini App ichida seans yo'q → `initData` (URL #tgWebAppData) bilan avtomatik kiradi", async () => {
  reset();
  const posts: Array<{ url: string; body: string }> = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/auth/session")) return json(200, { user: null, features: features(true) });
    if (url === "/api/auth/telegram" && init?.method === "POST") {
      posts.push({ url, body: String(init.body) });
      return json(200, { user });
    }
    return json(200, { generations: [] });
  };
  await useAppStore.getState().refreshSession();
  await waitFor(() => assert.equal(useAppStore.getState().loggedIn, true));
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].body), { initData: INIT_DATA }, "imzolangan xom initData serverga ketadi");
});

test("FE-10: kirish oynasi Mini App ichida ochilsa ham `initData` bilan kiradi (bir so'rov)", async () => {
  reset();
  useAppStore.setState({ features: features(true) });
  const posts: string[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    if (String(input) === "/api/auth/telegram" && init?.method === "POST") {
      posts.push(String(init.body));
      return json(200, { user });
    }
    return json(200, { generations: [] });
  };
  let done = 0;
  const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
  render(h(AppRouterContext.Provider, { value: router }, h(LoginForm, { onDone: () => done++ })));
  await waitFor(() => assert.equal(done, 1));
  assert.equal(posts.length, 1);
  assert.equal(JSON.parse(posts[0]).initData, INIT_DATA);
});
