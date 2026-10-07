import "./setup.ts";

// jsdom has no matchMedia; the store and the theme adapter read it. `osDark` simulates the OS preference.
let osDark = false;
const mqListeners = new Set<() => void>();
(globalThis.window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = ((q: string) =>
  ({
    get matches() {
      return osDark;
    },
    media: q,
    addEventListener: (_: string, cb: () => void) => mqListeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => mqListeners.delete(cb),
  }) as unknown as MediaQueryList) as unknown as (q: string) => MediaQueryList;

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { ProfileHome } from "../../components/profile/ProfileHome.tsx";
import { ProfileStep, AUTOSAVE_MS } from "../../components/profile/ProfileStep.tsx";
import { ProfilePage } from "../../components/profile/ProfilePage.tsx";
import { THEME_AUTO_KEY } from "../../components/profile/theme.ts";
import type { ProfileStepId, ProfileTarget } from "../../components/profile/profile-model.ts";
import { useAppStore } from "../../lib/store.ts";
import { useUi } from "../../lib/ui.ts";
import type * as api from "../../lib/api-client.ts";

/**
 * Profil (redesign W4): index rows + hints, admin gating, signed-out card,
 * step fields bound to the user, autosave (debounce, allowlisted PATCH,
 * «Saqlandi», error + retry, save on leave), «Saqlash va keyingisi», theme
 * Kun/Tun/Avto, two-tap logout.
 *
 * Mutations (each turned a test red, then restored):
 *   1. admin row rendered for everyone → «admin gating»;
 *   2. debounce removed (PATCH on every keystroke) → «debounce»;
 *   3. PATCH sends the whole user (`{...user, ...draft}`) → «only edited keys»;
 *   4. «Saqlash va keyingisi» navigates without awaiting the save → «next waits for the save»;
 *   5. first logout tap signs out directly (no confirm) → «two-tap logout»;
 *   6. «Avto» stores the flag but does not follow the OS → «Avto follows the OS»;
 *   7. unmount does not flush the pending edit → «save on leave».
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  useUi.setState({ overlay: null, returnTo: null });
  try {
    window.localStorage.removeItem(THEME_AUTO_KEY);
  } catch {
    /* ignore */
  }
  osDark = false;
});

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const tick = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

const BASE: api.ServerUser = {
  id: "u1",
  telegramId: "777",
  username: "ali_dev",
  name: "Ali",
  photoUrl: null,
  language: "uz",
  points: 2000,
  quota: 0,
  balance: 10_500,
  university: "Toshkent davlat pedagogika universiteti",
  faculty: "",
  department: "",
  group: "",
  course: "",
  author: "Aliyev Ali",
  subject: "",
  teacher: "",
  city: "",
  position: "",
  organization: "",
  phone: "998901234567",
  isAdmin: false,
};

function signIn(over: Partial<api.ServerUser> = {}) {
  useAppStore.setState({ loggedIn: true, sessionChecked: true, user: { ...BASE, ...over }, theme: "light" });
}

type Call = { url: string; method: string; body: Record<string, unknown> | null };
/** Stubs fetch: GET /api/users/me answers the store user; PATCH merges; `patchStatus` forces errors. */
function stub(opts: { patchStatus?: () => number } = {}): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const c: Call = {
      url: String(input),
      method: (init.method ?? "GET").toUpperCase(),
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(c);
    const user = useAppStore.getState().user ?? BASE;
    if (c.url === "/api/users/me" && c.method === "GET") return json(200, { user, transactions: [] });
    if (c.url === "/api/users/me" && c.method === "PATCH") {
      const status = opts.patchStatus?.() ?? 200;
      if (status !== 200) return json(status, { error: "Server band" });
      return json(200, { user: { ...user, ...c.body } });
    }
    if (c.url.startsWith("/api/auth/session") && c.method === "DELETE") return json(200, { ok: true });
    return json(404, {});
  }) as typeof fetch;
  return calls;
}
const patches = (calls: Call[]) => calls.filter((c) => c.method === "PATCH");

const router = { back() {}, forward() {}, refresh() {}, prefetch() {}, push() {}, replace() {} } as unknown as AppRouterInstance;
const wrap = (node: ReturnType<typeof h>) =>
  h(
    AppRouterContext.Provider,
    { value: router },
    h(PathnameContext.Provider, { value: "/uz/profile" }, h(SearchParamsContext.Provider, { value: new URLSearchParams("") }, node)),
  );

function mountHome(onNavigate?: (to: ProfileTarget) => void) {
  return render(wrap(h(ProfileHome, { onNavigate })));
}
function mountStep(step: ProfileStepId, onNavigate: (to: ProfileTarget) => void = () => {}) {
  return render(wrap(h(ProfileStep, { step, onNavigate })));
}
const row = (id: string) => document.querySelector<HTMLAnchorElement>(`[data-profile-row="${id}"]`);
const hint = (id: string) => row(id)?.querySelector("[data-row-hint]")?.textContent ?? "";
const field = (key: string) => document.querySelector<HTMLInputElement>(`[data-profile-field="${key}"]`)!;

// ───────────────────────────────────────────── index

test("index: name, identity, avatar initial, every row with its hint and target", async () => {
  stub();
  signIn({ city: "", name: "Ali" });
  mountHome();
  await tick();
  assert.equal(document.querySelector("[data-profile-name]")?.textContent, "Ali");
  assert.equal(document.querySelector("[data-profile-identity]")?.textContent, "@ali_dev · +998 90 123 45 67");
  assert.equal(document.querySelector("[data-profile-avatar]")?.textContent, "A");

  const ids = [...document.querySelectorAll("[data-profile-row]")].map((a) => a.getAttribute("data-profile-row"));
  assert.deepEqual(ids, ["shaxsiy", "oqish", "ish", "korinish", "hamyon", "taklif", "xavfsizlik"]);
  assert.equal(hint("shaxsiy"), "2/3");
  assert.equal(hint("oqish"), "TDPU");
  assert.equal(hint("ish"), "Kiritilmagan");
  assert.equal(hint("korinish"), "Kun");
  assert.match(hint("hamyon"), /^12[\s .,]?500 tanga$/);
  assert.equal(row("shaxsiy")!.getAttribute("href"), "/uz/profile/shaxsiy");
  assert.equal(row("xavfsizlik")!.getAttribute("href"), "/uz/profile/xavfsizlik");
  assert.equal(row("hamyon")!.getAttribute("href"), "/uz/wallet");
  assert.equal(row("taklif")!.getAttribute("href"), "/uz/wallet");
  // The ledger and the top-up link moved to Hamyon.
  assert.ok(!/Hisob harakati|Balansni to.ldirish/.test(document.body.textContent ?? ""));
});

test("index: admin row only for admins, linking to /admin", async () => {
  stub();
  signIn({ isAdmin: false });
  mountHome();
  await tick();
  assert.ok(!row("admin"));
  assert.ok(!document.querySelector('a[href="/admin"]'));
  cleanup();
  signIn({ isAdmin: true });
  mountHome();
  await tick();
  assert.ok(row("admin"));
  assert.equal(row("admin")!.getAttribute("href"), "/admin");
  assert.match(row("admin")!.textContent ?? "", /Admin panel/);
});

test("index: a step row calls onNavigate with its step (no page load); the photo falls back to the initial", async () => {
  stub();
  signIn({ photoUrl: "https://t.me/i/userpic/320/x.jpg" });
  const went: ProfileTarget[] = [];
  mountHome((to) => went.push(to));
  await tick();
  const img = document.querySelector<HTMLImageElement>("[data-profile-avatar] img");
  assert.ok(img, "photo shown when present");
  fireEvent.error(img);
  assert.ok(!document.querySelector("[data-profile-avatar] img"));
  assert.equal(document.querySelector("[data-profile-avatar]")?.textContent, "A");

  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  act(() => void row("oqish")!.dispatchEvent(ev));
  assert.deepEqual(went, ["oqish"]);
  assert.ok(ev.defaultPrevented, "the router-backed callback owns the navigation");
  fireEvent.click(row("xavfsizlik")!);
  assert.deepEqual(went, ["oqish", "xavfsizlik"]);
});

test("signed out: friendly card, «Kirish» opens login returning to the page (index and step)", async () => {
  stub();
  useAppStore.setState({ loggedIn: false, sessionChecked: true, user: null });
  mountHome();
  assert.ok(document.querySelector("[data-profile-signed-out]"));
  assert.ok(!document.querySelector("[data-profile-row]"));
  assert.equal(useUi.getState().overlay, null, "no popup on its own");
  fireEvent.click(screen.getByRole("button", { name: "Kirish" }));
  assert.equal(useUi.getState().overlay, "login");
  assert.equal(useUi.getState().returnTo, "/uz/profile");
  cleanup();
  useUi.setState({ overlay: null, returnTo: null });
  mountStep("oqish");
  assert.ok(!document.querySelector("[data-profile-field]"));
  fireEvent.click(screen.getByRole("button", { name: "Kirish" }));
  assert.equal(useUi.getState().returnTo, "/uz/profile/oqish");
});

// ───────────────────────────────────────────── steps

test("steps: fields are bound to the user, labelled, ≥16 px class, progress shows the step", () => {
  stub();
  signIn({ faculty: "Tarix", course: "3" });
  mountStep("oqish");
  const keys = [...document.querySelectorAll("[data-profile-field]")].map((i) => i.getAttribute("data-profile-field"));
  assert.deepEqual(keys, ["university", "faculty", "department", "group", "course"]);
  assert.equal(field("university").value, BASE.university);
  assert.equal(field("faculty").value, "Tarix");
  assert.equal(field("course").value, "3");
  assert.equal(field("group").value, "");
  assert.ok(screen.getByLabelText("Fakultet") === field("faculty"));
  assert.match(field("faculty").className, /text-\[16px\]/);
  const bar = screen.getByRole("progressbar");
  assert.equal(bar.getAttribute("aria-valuenow"), "2");
  assert.equal(bar.getAttribute("aria-valuemax"), "4");
  assert.equal(bar.querySelectorAll("[data-on]").length, 2);
  cleanup();
  mountStep("shaxsiy");
  assert.deepEqual(
    [...document.querySelectorAll("[data-profile-field]")].map((i) => i.getAttribute("data-profile-field")),
    ["name", "author", "city"],
  );
  cleanup();
  mountStep("ish");
  assert.deepEqual(
    [...document.querySelectorAll("[data-profile-field]")].map((i) => i.getAttribute("data-profile-field")),
    ["position", "organization", "subject", "teacher"],
  );
  cleanup();
  mountStep("xavfsizlik");
  assert.ok(!screen.queryByRole("progressbar"), "xavfsizlik is outside the 4-step flow");
});

test("autosave: debounce — one PATCH after the last keystroke, only the edited keys, then «Saqlandi»", async () => {
  const calls = stub();
  signIn();
  mountStep("shaxsiy");
  fireEvent.change(field("city"), { target: { value: "Sam" } });
  await tick(300);
  fireEvent.change(field("city"), { target: { value: "Samarqand" } });
  await tick(AUTOSAVE_MS - 200);
  assert.equal(patches(calls).length, 0, "no save while typing");
  await tick(400);
  assert.equal(patches(calls).length, 1);
  const body = patches(calls)[0]!.body!;
  assert.deepEqual(body, { city: "Samarqand" });
  assert.equal(useAppStore.getState().user?.city, "Samarqand");
  assert.match(document.querySelector("[data-profile-save-status]")?.textContent ?? "", /Saqlandi/);
  assert.equal(field("city").value, "Samarqand");
});

test("autosave: a failed save shows the error, «Qayta urinish» resends the same edit", async () => {
  let status = 500;
  const calls = stub({ patchStatus: () => status });
  signIn();
  mountStep("ish");
  fireEvent.change(field("position"), { target: { value: "o'qituvchi" } });
  await tick(AUTOSAVE_MS + 100);
  const alert = screen.getByRole("alert");
  assert.match(alert.textContent ?? "", /Saqlanmadi/);
  assert.equal(field("position").value, "o'qituvchi", "the edit is kept");
  status = 200;
  fireEvent.click(screen.getByRole("button", { name: /Qayta urinish/ }));
  await tick(20);
  assert.equal(patches(calls).length, 2);
  assert.deepEqual(patches(calls)[1]!.body, { position: "o'qituvchi" });
  assert.ok(!screen.queryByRole("alert"));
  assert.equal(useAppStore.getState().user?.position, "o'qituvchi");
});

test("next: «Saqlash va keyingisi» saves the pending edit first, then moves on; a failed save stays", async () => {
  let status = 200;
  const calls = stub({ patchStatus: () => status });
  signIn();
  const went: ProfileTarget[] = [];
  mountStep("shaxsiy", (to) => went.push(to));
  fireEvent.change(field("author"), { target: { value: "Karimova Dilnoza" } });
  fireEvent.click(screen.getByRole("button", { name: "Saqlash va keyingisi" }));
  assert.deepEqual(went, [], "not before the save");
  await tick(20);
  assert.equal(patches(calls).length, 1, "saved immediately, not after the debounce");
  assert.deepEqual(patches(calls)[0]!.body, { author: "Karimova Dilnoza" });
  assert.deepEqual(went, ["oqish"]);

  status = 500;
  fireEvent.change(field("name"), { target: { value: "Dilnoza" } });
  fireEvent.click(screen.getByRole("button", { name: "Saqlash va keyingisi" }));
  await tick(20);
  assert.deepEqual(went, ["oqish"], "a failed save keeps the user on the step");
  assert.ok(screen.getByRole("alert"));
});

test("next: ish → korinish; korinish is last and returns to the index", async () => {
  stub();
  signIn();
  const went: ProfileTarget[] = [];
  mountStep("ish", (to) => went.push(to));
  fireEvent.click(screen.getByRole("button", { name: "Saqlash va keyingisi" }));
  await tick(10);
  assert.deepEqual(went, ["korinish"]);
  cleanup();
  mountStep("korinish", (to) => went.push(to));
  fireEvent.click(screen.getByRole("button", { name: "Saqlash va yakunlash" }));
  assert.deepEqual(went, ["korinish", "home"]);
  fireEvent.click(screen.getByRole("button", { name: "Orqaga" }));
  assert.deepEqual(went, ["korinish", "home", "home"]);
});

test("save on leave: unmounting with a pending edit sends it at once", async () => {
  const calls = stub();
  signIn();
  const view = mountStep("oqish");
  fireEvent.change(field("group"), { target: { value: "301" } });
  view.unmount();
  await tick(20);
  assert.equal(patches(calls).length, 1);
  assert.deepEqual(patches(calls)[0]!.body, { group: "301" });
  await tick(AUTOSAVE_MS + 50);
  assert.equal(patches(calls).length, 1, "the debounce timer was cancelled");
});

test("theme: Kun / Tun / Avto apply at once; Avto follows the OS; the index hint shows the choice", async () => {
  stub();
  signIn();
  mountStep("korinish");
  const radio = (label: string) => screen.getByRole("radio", { name: new RegExp(`^${label}`) }) as HTMLInputElement;
  assert.ok(radio("Kun").checked);
  fireEvent.click(radio("Tun"));
  assert.equal(useAppStore.getState().theme, "dark");
  assert.ok(document.documentElement.classList.contains("dark"));
  assert.ok(radio("Tun").checked);

  osDark = false;
  fireEvent.click(radio("Avto"));
  assert.equal(window.localStorage.getItem(THEME_AUTO_KEY), "1");
  assert.equal(useAppStore.getState().theme, "light", "Avto takes the OS theme now");
  assert.ok(radio("Avto").checked);
  osDark = true;
  act(() => mqListeners.forEach((l) => l()));
  assert.equal(useAppStore.getState().theme, "dark", "…and follows its changes");
  assert.ok(radio("Avto").checked);

  cleanup();
  mountHome();
  await tick();
  assert.equal(hint("korinish"), "Avto");
  cleanup();
  mountStep("korinish");
  fireEvent.click(radio("Kun"));
  assert.equal(window.localStorage.getItem(THEME_AUTO_KEY), null, "Kun turns Avto off");
  assert.equal(useAppStore.getState().theme, "light");
  osDark = true;
  act(() => mqListeners.forEach((l) => l()));
  assert.equal(useAppStore.getState().theme, "light", "no longer follows the OS");
});

test("logout: two taps for this device and for everywhere, then back to the index", async () => {
  const calls = stub();
  signIn();
  const went: ProfileTarget[] = [];
  mountStep("xavfsizlik", (to) => went.push(to));
  assert.match(document.body.textContent ?? "", /Sessiyalar haqida/);
  assert.match(document.body.textContent ?? "", /\+998 90 123 45 67/);
  fireEvent.click(screen.getByRole("button", { name: "Bu qurilmadan chiqish" }));
  assert.equal(calls.filter((c) => c.method === "DELETE").length, 0, "first tap only asks");
  assert.ok(screen.getByText("Rostdan ham chiqmoqchimisiz?"));
  fireEvent.click(screen.getByRole("button", { name: "Bekor qilish" }));
  assert.ok(!screen.queryByText("Rostdan ham chiqmoqchimisiz?"));
  fireEvent.click(screen.getByRole("button", { name: "Bu qurilmadan chiqish" }));
  fireEvent.click(screen.getByRole("button", { name: "Ha, chiqish" }));
  await tick(10);
  const del = calls.filter((c) => c.method === "DELETE");
  assert.deepEqual(del.map((c) => c.url), ["/api/auth/session"]);
  assert.equal(useAppStore.getState().loggedIn, false);
  assert.deepEqual(went, ["home"]);

  cleanup();
  signIn();
  mountStep("xavfsizlik", (to) => went.push(to));
  fireEvent.click(screen.getByRole("button", { name: "Hamma joydan chiqish" }));
  assert.equal(calls.filter((c) => c.method === "DELETE").length, 1);
  fireEvent.click(screen.getByRole("button", { name: "Ha, hammasidan chiqish" }));
  await tick(10);
  assert.deepEqual(
    calls.filter((c) => c.method === "DELETE").map((c) => c.url),
    ["/api/auth/session", "/api/auth/session?all=1"],
  );
  assert.deepEqual(went, ["home", "home"]);
});

test("ProfilePage (current /uz/profile route): index first, steps switch in place and back", async () => {
  stub();
  signIn();
  render(wrap(h(ProfilePage)));
  await tick();
  assert.ok(document.querySelector("[data-profile-home]"));
  fireEvent.click(row("shaxsiy")!);
  assert.equal(document.querySelector("[data-profile-step]")?.getAttribute("data-profile-step"), "shaxsiy");
  fireEvent.click(screen.getByRole("button", { name: "Saqlash va keyingisi" }));
  await tick(10);
  assert.equal(document.querySelector("[data-profile-step]")?.getAttribute("data-profile-step"), "oqish");
  fireEvent.click(screen.getByRole("button", { name: "Orqaga" }));
  assert.ok(document.querySelector("[data-profile-home]"));
});
