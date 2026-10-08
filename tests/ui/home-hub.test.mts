import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type * as Api from "../../lib/api-client.ts";

/**
 * Bosh hub (docs/redesign/PLAN.md W1, `components/home/HomeHub.tsx`).
 *
 * Migrated from the F0 placeholder (before → after, equal strength):
 *   - title `Salom, <first word of name>` or BRAND_NAME → `Salom, <first name>`
 *     or «Salom!»; a phone stored as name/author is NEVER shown (the F0 bug);
 *   - «Yangi ish yaratish» hero (open «+») → the empty-state CTA opens «+»;
 *   - «Ishlarim» / «Hamyon» links → «Barchasi» → /uz/files, BalanceChip → /uz/wallet;
 *   - `useReturnToLogin()` kept (test: `?returnTo=` opens the login).
 *
 * Mutations (each turned this file red — see the W1 report):
 *   M1  hub-model `nameWord`: drop the digit/@ filter → «greetingName» red;
 *   M1b … and the letter check too (the F0 behaviour) → «Salom, +998…», greeting test red;
 *   M2  HomeHub: drop `useReturnToLogin()` → no login from `?returnTo=`;
 *   M3  useLoginGate: gate on `!loggedIn` only → login before the session is known;
 *   M4  useRecentFiles: trust the store's empty list (no `limit=1` check) → error unseen;
 *   M5  HomeHub: empty CTA `open("login")` instead of «+»;
 *   M6  hub-model `recentFiles`: no sort (store order) → wrong three;
 *   M7  hub-model `fileStatus`: «Yozilmoqda» without the %;
 *   M8  ToolsByGroup: a hand-written group list (drops «Media»);
 *   M9  QuickStart: a hard-coded price instead of the catalogue's;
 *   M10 HomeHub: the search field opens another overlay.
 */

const { HomeHub } = await import("../../components/home/HomeHub.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { TOOLS, TOOL_BY_ID, visibleToolGroups, clientAdjustedPrice } = await import("../../lib/tools.ts");
const model = await import("../../components/home/hub/hub-model.ts");

const pushes: string[] = [];
const router = {
  back() {},
  forward() {},
  refresh() {},
  push(href: string) {
    pushes.push(href);
  },
  replace() {},
  prefetch() {},
} as unknown as AppRouterInstance;

const realFetch = globalThis.fetch;
const realRefresh = useAppStore.getState().refreshGenerations;
const fetches: string[] = [];

/** `limit=1` empty-list check: `rows` → 200 with them, `"fail"` → network error. */
function stubFetch(answer: Api.ServerGeneration[] | "fail" | "500") {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetches.push(url);
    if (answer === "fail") throw new TypeError("network");
    if (answer === "500") return new Response("{}", { status: 500 });
    return new Response(JSON.stringify({ generations: answer, nextCursor: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

afterEach(async () => {
  cleanup();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  globalThis.fetch = realFetch;
  fetches.length = 0;
  pushes.length = 0;
  useUi.setState({ overlay: null, returnTo: null });
  useAppStore.setState({
    sessionChecked: false,
    loggedIn: false,
    user: null,
    features: null,
    generations: [],
    generationsLoaded: false,
    generationsCursor: null,
    refreshGenerations: realRefresh,
  });
  window.history.replaceState(null, "", "/uz");
});

function gen(id: string, patch: Partial<Api.ServerGeneration> = {}): Api.ServerGeneration {
  return {
    id,
    type: "referat",
    topic: `Hujjat ${id}`,
    status: "COMPLETED",
    createdAt: "2026-10-01T08:00:00.000Z",
    finishedAt: "2026-10-01T08:05:00.000Z",
    price: 3000,
    fileName: "r.docx",
    format: "docx",
    progress: 100,
    step: "Tayyor",
    expiresAt: null,
    error: null,
    preview: { lines: ["Kirish"] },
    ...patch,
  } as Api.ServerGeneration;
}

const USER = { id: "u1", name: "Ali Valiyev", author: "Valiyev Ali", points: 2000, quota: 0, balance: 500, isAdmin: false };

function signIn(user: Record<string, unknown> = USER, generations: Api.ServerGeneration[] = [], loaded = true) {
  useAppStore.setState({
    sessionChecked: true,
    loggedIn: true,
    user: user as never,
    generations,
    generationsLoaded: loaded,
  });
}

function signOut() {
  useAppStore.setState({ sessionChecked: true, loggedIn: false, user: null, generations: [], generationsLoaded: true });
}

function mount(search = "") {
  window.history.replaceState(null, "", `/uz${search}`);
  return render(
    h(AppRouterContext.Provider, { value: router }, h(SearchParamsContext.Provider, { value: new URLSearchParams(search) }, h(HomeHub))),
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 1));
  });
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T & HTMLElement>(sel);
const title = () => q("[data-page-header] h1")?.textContent ?? "";
const headerText = () => q("[data-page-header]")?.textContent ?? "";

/* ───────────── greeting ───────────── */

test("greeting: «Salom, <first name>»; a phone in name/author is never shown — «Salom!» instead", async () => {
  signIn();
  mount();
  assert.equal(title(), "Salom, Ali");
  assert.equal(q("[data-page-header] p")?.textContent, "Bugun nima yaratamiz?");
  cleanup();

  // Phone login: `name` and `author` are the phone (lib/server/auth.ts upsertLocalUser) — the F0 bug.
  for (const phone of ["+998901234567", "998901112233", "+998 90 123 45 67"]) {
    signIn({ ...USER, name: phone, author: phone, phone });
    mount();
    assert.equal(title(), "Salom!", `phone «${phone}» as name`);
    assert.ok(!/\d{3}/.test(headerText()), `header shows digits: ${headerText()}`);
    cleanup();
  }

  // Phone as name, a real author → the author's first word.
  signIn({ ...USER, name: "+998901234567", author: "Karimova Dilnoza" });
  mount();
  assert.equal(title(), "Salom, Karimova");
  cleanup();

  // Signed out / unknown session: «Salom!» (F0 showed the brand name).
  signOut();
  mount();
  assert.equal(title(), "Salom!");
});

test("greetingName: names only — digits, e-mails, handles and punctuation are not names", () => {
  assert.equal(model.greetingName({ name: "  Dilnoza  Karimova ", author: "" }), "Dilnoza");
  assert.equal(model.greetingName({ name: "O‘g‘iloy", author: "" }), "O‘g‘iloy");
  assert.equal(model.greetingName({ name: "ali@mail.uz", author: "" }), null);
  assert.equal(model.greetingName({ name: "user123", author: "" }), null);
  assert.equal(model.greetingName({ name: "—", author: "" }), null);
  assert.equal(model.greetingName({ name: "", author: "" }), null);
  assert.equal(model.greetingName(null), null);
  assert.equal(model.greetingTitle({ name: "+998900000001", author: "+998900000001" }), "Salom!");
});

/* ───────────── signed out ───────────── */

test("signed out: login card instead of «Davom ettirish»; «Kirish» opens the login; `?returnTo=` opens it with the target", async () => {
  signOut();
  mount("?returnTo=%2Fuz%2Fslide");
  await settle();
  assert.equal(useUi.getState().overlay, "login", "returnTo → login");
  assert.equal(useUi.getState().returnTo, "/uz/slide");
  assert.ok(q("[data-hub-signed-out]"), "login card");
  assert.ok(!q('[data-hub-section="recent"]'), "no recent files section signed out");
  assert.ok(!q("[data-balance]"), "no balance chip signed out");
  // Tools stay browsable.
  assert.equal(document.querySelectorAll("[data-quick-tool]").length, 4);
  assert.ok(document.querySelectorAll("[data-hub-tool]").length > 0);

  useUi.setState({ overlay: null, returnTo: null });
  fireEvent.click(q("[data-hub-login]")!);
  assert.equal(useUi.getState().overlay, "login");
  assert.equal(useUi.getState().returnTo, null);
});

/* ───────────── quick start ───────────── */

test("«Tez boshlash»: Slayd, Referat, Insho, Rezyume → /uz/<slug>, format badge + catalogue price", () => {
  signIn();
  mount();
  const cards = [...document.querySelectorAll<HTMLAnchorElement>("[data-quick-tool]")];
  assert.deepEqual(
    cards.map((c) => c.dataset.quickTool),
    ["slide", "referat", "essay", "resume"],
  );
  for (const c of cards) {
    const tool = TOOL_BY_ID[c.dataset.quickTool as keyof typeof TOOL_BY_ID];
    assert.equal(c.getAttribute("href"), `/uz/${tool.slug}`);
    assert.ok(c.textContent!.includes(tool.title), `${tool.id} title`);
    const price = model.groupDigits(clientAdjustedPrice(tool.id, tool.basePrice));
    assert.equal(c.querySelector("[data-quick-detail]")!.textContent, `${price} tangadan`);
    assert.equal(c.querySelector("[data-quick-format]")!.textContent, tool.output.toUpperCase());
  }
  assert.equal(q("[data-quick-tool=slide] [data-quick-detail]")!.textContent, "3\u00a0000 tangadan");
  // Owner request 2026-10-08: a big «Barcha vositalar» right under the four cards → the full catalogue.
  const all = q<HTMLAnchorElement>("[data-hub-all-tools]");
  assert.ok(all, "«Barcha vositalar» button");
  assert.equal(all!.getAttribute("href"), "/uz/create");
  assert.match(all!.textContent ?? "", /Barcha vositalar/);
  assert.ok(all!.className.includes("min-h-14"), "big (≥ 56 px) touch target");
});

test("login gate on tool links: signed out → login over the tool with returnTo; signed in or session unknown → none", () => {
  // Session not checked yet (FE-09): not «signed out».
  mount();
  fireEvent.click(q("[data-quick-tool=essay]")!);
  assert.equal(useUi.getState().overlay, null, "unchecked session: no login");
  cleanup();

  signIn();
  mount();
  fireEvent.click(q("[data-quick-tool=essay]")!);
  assert.equal(useUi.getState().overlay, null, "signed in: no login");
  cleanup();

  signOut();
  mount();
  fireEvent.click(q("[data-quick-tool=resume]")!);
  assert.equal(useUi.getState().overlay, "login");
  assert.equal(useUi.getState().returnTo, "/uz/resume");
  useUi.setState({ overlay: null, returnTo: null });
  const tile = q<HTMLAnchorElement>("[data-hub-tool]")!;
  fireEvent.click(tile);
  assert.equal(useUi.getState().returnTo, tile.getAttribute("href"), "group tile gated too");
  useUi.setState({ overlay: null, returnTo: null });
  fireEvent.click(q("[data-hub-catalogue]")!);
  assert.equal(useUi.getState().returnTo, "/uz/create", "«Hammasi» gated too");
});

test("a tool without its provider key is drawn disabled with the reason (not a link)", () => {
  signIn();
  useAppStore.setState({ features: { llm: false, images: true, telegram: false, telegramBot: null } as never });
  mount();
  const slide = q("[data-quick-tool=slide]")!;
  assert.equal(slide.tagName, "DIV");
  assert.equal(slide.getAttribute("aria-disabled"), "true");
  assert.equal(slide.querySelector("[data-quick-detail]")!.textContent, "Vaqtincha o‘chiq");
  assert.match(slide.textContent!, /AI xizmati vaqtincha o‘chiq/, "full reason for screen readers");
  assert.match(slide.getAttribute("title")!, /AI xizmati vaqtincha o‘chiq/);
});

/* ───────────── recent files ───────────── */

test("«Davom ettirish»: 3 latest files (newest first) with thumbnail, title, status pill, kind; «Barchasi» → /uz/files", async () => {
  stubFetch([]);
  signIn(USER, [
    gen("old", { finishedAt: "2026-09-01T08:00:00.000Z", createdAt: "2026-09-01T07:00:00.000Z" }),
    gen("run", { type: "slide", status: "IN_PROGRESS", progress: 62, finishedAt: undefined, createdAt: "2026-10-03T09:00:00.000Z", format: "pptx" }),
    gen("bad", { type: "essay", status: "FAILED", finishedAt: "2026-10-02T10:00:00.000Z" }),
    gen("done", { finishedAt: "2026-10-04T10:00:00.000Z" }),
  ]);
  mount();
  await settle();
  const rows = [...document.querySelectorAll<HTMLAnchorElement>("[data-hub-file]")];
  assert.deepEqual(rows.map((r) => r.dataset.hubFile), ["done", "run", "bad"]);
  assert.deepEqual(rows.map((r) => r.getAttribute("href")), ["/uz/files/done", "/uz/files/run", "/uz/files/bad"]);
  const pills = rows.map((r) => r.querySelector("[data-hub-file-status]")!);
  assert.deepEqual(pills.map((p) => p.textContent), ["Tayyor", "Yozilmoqda 62%", "Xato"]);
  assert.deepEqual(pills.map((p) => p.getAttribute("data-hub-file-status")), ["ok", "run", "error"]);
  assert.equal(rows[0]!.querySelector("[data-hub-file-title]")!.textContent, "Hujjat done");
  assert.match(rows[0]!.textContent!, /Referat · 4 okt/);
  assert.match(rows[1]!.textContent!, /Slayd/);
  for (const r of rows) assert.ok(r.querySelector("span[aria-hidden]"), "thumbnail box");
  assert.equal(q("[data-hub-all-files]")!.getAttribute("href"), "/uz/files");
  assert.equal(fetches.length, 0, "rows in the store: no request of its own");
});

test("«Davom ettirish» loading: skeleton until the session and the first page are known", async () => {
  stubFetch([]);
  mount();
  assert.equal(q("[data-hub-recent]")!.dataset.hubRecent, "loading");
  assert.equal(q("[data-hub-recent]")!.getAttribute("aria-busy"), "true");
  cleanup();
  signIn(USER, [], false);
  mount();
  await settle();
  assert.equal(q("[data-hub-recent]")!.dataset.hubRecent, "loading");
  assert.equal(fetches.length, 0, "no check before the store's page arrived");
});

test("«Davom ettirish» empty: confirmed with limit=1, then the CTA opens the «+» sheet", async () => {
  stubFetch([]);
  signIn(USER, []);
  mount();
  await waitFor(() => assert.equal(q("[data-hub-recent]")!.dataset.hubRecent, "empty"));
  assert.ok(fetches.some((u) => /\/api\/generations\?limit=1$/.test(u)), `fetches: ${fetches.join(", ")}`);
  fireEvent.click(q("[data-hub-empty-create]")!);
  assert.equal(useUi.getState().overlay, "create");
});

test("«Davom ettirish» error: the list did not load → «Fayllar yuklanmadi» + «Qayta urinish» (not «no files»)", async () => {
  stubFetch("fail");
  signIn(USER, []);
  mount();
  await waitFor(() => assert.equal(q("[data-hub-recent]")!.dataset.hubRecent, "error"));
  assert.equal(q("[data-hub-recent]")!.getAttribute("role"), "alert");
  assert.ok(!q("[data-hub-empty-create]"), "no empty state on error");

  // Retry: the server answers now, the user has no files.
  stubFetch([]);
  fireEvent.click(q("[data-hub-retry]")!);
  await waitFor(() => assert.equal(q("[data-hub-recent]")!.dataset.hubRecent, "empty"));

  // A 500 is an error too.
  cleanup();
  stubFetch("500");
  signIn(USER, []);
  mount();
  await waitFor(() => assert.equal(q("[data-hub-recent]")!.dataset.hubRecent, "error"));
});

test("empty store but the server has files: the store is refreshed and the rows appear", async () => {
  const rows = [gen("a"), gen("b")];
  stubFetch(rows);
  let refreshed = 0;
  signIn(USER, []);
  useAppStore.setState({
    refreshGenerations: async () => {
      refreshed++;
      useAppStore.setState({ generations: rows, generationsLoaded: true });
    },
  });
  mount();
  await waitFor(() => assert.equal(document.querySelectorAll("[data-hub-file]").length, 2));
  assert.equal(refreshed, 1);
});

test("groupDigits: one text on server and client (no locale data needed)", () => {
  assert.equal(model.groupDigits(3000), "3\u00a0000");
  assert.equal(model.groupDigits(12000), "12\u00a0000");
  assert.equal(model.groupDigits(1234567), "1\u00a0234\u00a0567");
  assert.equal(model.groupDigits(500), "500");
});

test("fileStatus / recentFiles", () => {
  assert.deepEqual(model.fileStatus({ status: "QUEUED", progress: 0 }), { label: "Navbatda", tone: "run" });
  assert.deepEqual(model.fileStatus({ status: "IN_PROGRESS", progress: 7.6 }), { label: "Yozilmoqda 8%", tone: "run" });
  assert.deepEqual(model.fileStatus({ status: "IN_PROGRESS", progress: 100 }), { label: "Yozilmoqda 99%", tone: "run" });
  assert.deepEqual(model.fileStatus({ status: "REVOKED", progress: 0 }), { label: "Bekor qilindi", tone: "muted" });
  const g = (id: string, createdAt: string, finishedAt?: string) => ({ id, createdAt, finishedAt });
  assert.deepEqual(
    model.recentFiles([g("a", "2026-01-01"), g("b", "2026-01-02", "2026-01-09"), g("c", "2026-01-05"), g("d", "2026-01-03")], 3).map((x) => x.id),
    ["b", "c", "d"],
  );
});

/* ───────────── header actions ───────────── */

test("header: search icon and the search field open search; the bell opens notifications; sun/moon flips the theme; balance → Hamyon", () => {
  signIn();
  useAppStore.getState().setTheme("light");
  mount();
  fireEvent.click(q('[data-page-header-actions] [aria-label="Qidirish"]')!);
  assert.equal(useUi.getState().overlay, "search");
  useUi.setState({ overlay: null });
  const field = q("[data-hub-search]")!;
  assert.match(field.textContent!, /Vosita yoki fayl qidirish/);
  fireEvent.click(field);
  assert.equal(useUi.getState().overlay, "search");
  useUi.setState({ overlay: null });
  fireEvent.click(q('[aria-label="Bildirishnomalar"]')!);
  assert.equal(useUi.getState().overlay, "notifications");
  fireEvent.click(q("[data-theme-toggle]")!);
  assert.equal(useAppStore.getState().theme, "dark");
  fireEvent.click(q("[data-theme-toggle]")!);
  assert.equal(useAppStore.getState().theme, "light");
  const chip = q("[data-balance]")!;
  assert.equal(chip.getAttribute("href"), "/uz/wallet");
  assert.match(chip.textContent!, /2[\s  ]?500/);
});

/* ───────────── all tools ───────────── */

test("«Barcha vositalar»: one chip per visible group (registry), the chosen group's tools, «Hammasi» → /uz/create", () => {
  signIn();
  mount();
  const chips = [...document.querySelectorAll<HTMLButtonElement>("[data-hub-group]")];
  assert.deepEqual(chips.map((c) => c.textContent), visibleToolGroups().map((g) => g.label));
  assert.equal(chips[0]!.getAttribute("aria-pressed"), "true");
  for (const g of visibleToolGroups()) {
    fireEvent.click(q(`[data-hub-group="${g.id}"]`)!);
    assert.equal(q(`[data-hub-group="${g.id}"]`)!.getAttribute("aria-pressed"), "true");
    const shown = [...document.querySelectorAll<HTMLAnchorElement>("[data-hub-tool]")];
    const want = TOOLS.filter((t) => t.group === g.id);
    assert.deepEqual(shown.map((a) => a.dataset.hubTool), want.map((t) => t.id), g.id);
    assert.deepEqual(shown.map((a) => a.getAttribute("href")), want.map((t) => `/uz/${t.slug}`));
  }
  assert.equal(q("[data-hub-catalogue]")!.getAttribute("href"), "/uz/create");
});

test("sections: three, labelled, staggered ≤ 200 ms and motion-safe only", () => {
  signIn();
  mount();
  const sections = [...document.querySelectorAll<HTMLElement>("[data-hub-section]")];
  assert.deepEqual(sections.map((s) => s.dataset.hubSection), ["quick", "recent", "tools"]);
  for (const s of sections) {
    assert.ok(s.getAttribute("aria-labelledby") && document.getElementById(s.getAttribute("aria-labelledby")!), "labelled");
    assert.match(s.className, /motion-safe:animate-/);
    assert.ok(!/(^|\s)animate-/.test(s.className), "no animation outside motion-safe");
    assert.ok(parseInt(s.style.animationDelay, 10) <= 200, s.style.animationDelay);
  }
});