import "./setup.ts";

/*
 * Phase 4 UX review, finding 7: the root `Providers` bootstrapped the consumer session
 * (`/api/auth/session`) and, once logged in, the admin's own generations list
 * (`/api/generations`) on every `/admin` page load, although the panel has its own session
 * and never reads either. Admin paths now skip that bootstrap; consumer paths are unchanged
 * and the theme still initialises everywhere (the admin ThemeToggle shares this store).
 *
 * Mutation: drop the `onAdmin` early return → the admin test sees both calls; run the
 * bootstrap only on mount (no pathname dependency) → the navigation test sees no session call.
 */

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

const { useAppStore } = await import("../../lib/store.ts");
const { Providers } = await import("../../components/providers.tsx");

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const user = {
  id: "u1", telegramId: "42", username: "ali", name: "Ali", photoUrl: null, language: "uz", points: 0, quota: 0,
  balance: 5000, university: "", faculty: "", department: "",
  group: "", course: "", author: "", subject: "", teacher: "", city: "", position: "", organization: "", phone: null,
  isAdmin: true,
};
const features = {
  llm: true, images: true, telegram: false, telegramBot: null, devLogin: false, pdf: true,
  payments: { click: false, payme: false },
};

function stubFetch(): string[] {
  const calls: string[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("/api/auth/session")) return json(200, { user, features });
    if (url.startsWith("/api/generations")) return json(200, { generations: [], nextCursor: null });
    throw new Error(`kutilmagan so'rov: ${url}`);
  };
  return calls;
}

/** A fresh, logged-out store with a persisted dark theme, as on a first page load. */
function resetStore() {
  useAppStore.setState({
    hydrated: false,
    sessionChecked: false,
    loggedIn: false,
    user: null,
    generations: [],
    generationsLoaded: false,
    theme: "dark",
    dir: "ltr",
  });
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("dir");
}

const at = (pathname: string) => h(PathnameContext.Provider, { value: pathname }, h(Providers, null, h("main", null, "sahifa")));
const sessionCalls = (calls: string[]) => calls.filter((u) => u.startsWith("/api/auth/session")).length;
const generationCalls = (calls: string[]) => calls.filter((u) => u.startsWith("/api/generations")).length;
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

test("Providers: iste'molchi sahifasi seans va generatsiyalarni yuklaydi, mavzu qo'llanadi", async () => {
  resetStore();
  const calls = stubFetch();
  render(at("/uz"));
  await waitFor(() => assert.equal(generationCalls(calls), 1));
  assert.equal(sessionCalls(calls), 1);
  assert.equal(useAppStore.getState().loggedIn, true);
  assert.ok(document.documentElement.classList.contains("dark"), "mavzu qo'llangan");
  assert.equal(document.documentElement.getAttribute("dir"), "ltr");
  assert.equal(useAppStore.getState().hydrated, true);
});

test("Providers: /admin sahifasi iste'molchi seansi va generatsiyalarini so'ramaydi, mavzu baribir qo'llanadi", async () => {
  for (const path of ["/admin", "/admin/users", "/admin/generations/1b89a169-6d51-4923-9697-46ea357fa0cc"]) {
    resetStore();
    const calls = stubFetch();
    render(at(path));
    await tick();
    assert.deepEqual(calls, [], `${path}: so'rovlar yo'q`);
    assert.equal(useAppStore.getState().hydrated, true, path);
    assert.ok(document.documentElement.classList.contains("dark"), `${path}: mavzu qo'llangan`);
    assert.equal(document.documentElement.getAttribute("dir"), "ltr");
    // The admin ThemeToggle writes the same store; the change still reaches <html>.
    useAppStore.getState().setTheme("light");
    await waitFor(() => assert.ok(!document.documentElement.classList.contains("dark")));
    cleanup();
  }
});

test("Providers: /administrator kabi yo'l admin hisoblanmaydi", async () => {
  resetStore();
  const calls = stubFetch();
  render(at("/administrator"));
  await waitFor(() => assert.equal(sessionCalls(calls), 1));
});

test("Providers: paneldan mijoz tomonida iste'molchi sahifasiga o'tilsa seans bir marta yuklanadi", async () => {
  resetStore();
  const calls = stubFetch();
  const { rerender } = render(at("/admin/users"));
  await tick();
  assert.deepEqual(calls, []);
  rerender(at("/uz"));
  await waitFor(() => assert.equal(generationCalls(calls), 1));
  assert.equal(sessionCalls(calls), 1);
  rerender(at("/admin"));
  rerender(at("/uz/create"));
  await tick();
  assert.equal(sessionCalls(calls), 1, "bootstrap faqat bir marta");
  assert.equal(generationCalls(calls), 1);
});
