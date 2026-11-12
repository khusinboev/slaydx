import "./setup.ts";
import test, { afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type * as Api from "../../lib/api-client.ts";
import { card, json } from "./market-fixture.ts";

/**
 * Bosh hub, variant C «Xizmatlar panjarasi» (owner decision 2026-11-06, docs/redesign/PLAN.md,
 * `components/home/HomeHub.tsx`).
 *
 * Migrated from the W1 hub (before → after, equal strength):
 *   - «Tez boshlash» four cards + order → the eight grid cells + order, routes, labels, icons, tints;
 *   - quick-card / group-tile / «Hammasi» login gate → cell and slide login gate, `?group=` target included;
 *   - blocked quick card (disabled + reason) → blocked cell (disabled + reason, the grid stays 8);
 *   - promo cards by switch (studio, chat, domla) → banner slides by switch (+ market), copy and order pinned;
 *   - «Barcha vositalar» group chips, services per group, Studio first in Media, fold links → the «+» sheet carries
 *     them, pinned by tests/ui/create-sheet.test.mts (groups, services + switches, fold) and studio-model (Studio first);
 *   - search field → gone, pinned absent; the header icon stays and the shell binds Cmd/Ctrl+K (pinned here);
 *   - empty-state CTA → no section at all; the `limit=1` confirmation and the error state are kept;
 *   - `useReturnToLogin()` kept (test: `?returnTo=` opens the login).
 *
 * Migrated to the 12-cell home (owner request 2026-11-12, before → after, equal strength):
 *   - the eight cells + order/routes/labels/tints → the twelve cells + order/routes/labels/tints, `lg:grid-cols-8` →
 *     `lg:grid-cols-6` (two rows), equal cell heights (`h-full`);
 *   - «chat off → Kurs ishi» → every switch off → the ordered fallbacks O'yinlar, Rezyume, Tarjimon (always 12,
 *     distinct targets); O'yinlar leaves the default grid and is pinned as the first fallback;
 *   - one skeleton at the chat place → three skeletons at the tests / chat / domla places;
 *   - «no auto-advance timer» → the 5 s rotation with its holds (hover, keyboard focus, touch, drag, hidden document,
 *     mid-scroll), restart on a dot, wrap, one slide / skeleton / unmount = no timer, a11y slide labels + live region;
 *   - slides market, studio, chat, domla → market, titul, chat, tests, studio, domla;
 *   - sections banner, grid, recent(, market) → banner, grid, free, recent(, market).
 *
 * Mutations of the 12-cell home (each turned this file red):
 *   N1  homeCells: Pro slayd and Mustaqil ish swapped → order red;
 *   N2  homeCells: fallbacks not shifted (every off switch gets O'yinlar) → «distinct targets» red;
 *   N3  homeCells: «Barchasi» before Qattiqqo'l domla → order red;
 *   N4  HubGrid: `lg:grid-cols-12` → grid classes red; N4b no `h-full` → equal-height red;
 *   N5  HubGrid: skeleton for every cell while pending → «3 skeletons» red;
 *   N6  HubBanner: no `% count` (no wrap) → wrap red;
 *   N7  HubBanner: hover hold ignored → hover red; N7b any pointer type holds → «touch hover» red;
 *   N8  HubBanner: focus hold ignored → focus red; N8b focus after a tap holds → tap red;
 *   N9  HubBanner: touch hold ignored; N9b touchend ignored; N9c the window `pointerup` not listened → drag red;
 *   N10 HubBanner: visibility ignored → hidden red;
 *   N11 HubBanner: no `kick` on a dot → restart red;
 *   N12 HubBanner: timer not cleared → timers red; N12b runs with one slide; N12c runs while pending → red;
 *   N13 HubBanner: the mid-scroll check removed → mid-scroll red; N13b live region always polite; N13c slides
 *       labelled by title instead of «N / M» → red;
 *   N14 homeSlides: the chat slide dropped → slide order red; N14b tests slide ignores its switch → red;
 *   N15 homeFreeItems: chat ignores its switch → free row red; N15b FreeRow without `onPick` → gate red;
 *       N15c no `sm:flex-wrap` → row red;
 *   N16 HomeHub: no free row → section order red;
 *   N17 CreateGrid: the «Bepul» branch never taken → «0 so'm dan» red; N18 FreeBadge says «Tekin» → badge red.
 *
 * Mutations (each turned this file red):
 *   M1  hub-model `nameWord`: drop the digit/@ filter → «greetingName» red;
 *   M1b … and the letter check too (the F0 behaviour) → «Salom, +998…», greeting test red;
 *   M2  HomeHub: drop `useReturnToLogin()` → no login from `?returnTo=`;
 *   M3  useLoginGate: gate on `!loggedIn` only → login before the session is known;
 *   M4  useRecentFiles: trust the store's empty list (no `limit=1` check) → error unseen;
 *   M5  HomeHub: keep the section for a user without files → «no files» red;
 *   M6  hub-model `recentFiles`: no sort (store order) → wrong three;
 *   M7  hub-model `fileStatus`: «Yozilmoqda» without the %;
 *   M8  homeCells: Slayd and Mustaqil ish swapped → order red;
 *   M9  homeCells: a cell missing → «exactly 8» red; M9b the substitute repeats Slayd → distinct-target red;
 *   M10 HubGrid: `onPick` dropped from the cell link → gate red; M28 same on HubBanner's slide;
 *   M11 HubGrid: the blocked branch removed → disabled red;
 *   M12 homeSlides: market ignores `marketOn`; M12b HomeHub: `features.market` alone (no admin) → banner flag red;
 *   M13 homeSlides: domla slide always on → banner flag red;
 *   M14 HubBanner: dots with one slide → «no dots» red;
 *   M15 no `onScroll`; M15b dots do not move the list; M15c the active dot is not clamped → dots red;
 *   M16 HomeHub: `pending` always false → skeleton red;
 *   M17 hub-model: the games cell without `?group=` → route red;
 *   M18 HubGrid: no ring on the first cell; M18b two emphasised cells → primary red;
 *   M19 AppShell: Ctrl+K unbound → shortcut red;
 *   M20 catalogueGroupOf: any string accepted → «wrong group» red;
 *   M21 CreateGrid: login returnTo without the chip; M22 `initialGroup` ignored; M29 the page does not pass `?group=` → red;
 *   M23 HomeHub: grid above the banner → order red;
 *   M24 HomeHub: «Kirish» opens another overlay;
 *   M25 HomeHub: no MarketRail → rail red;
 *   M26 HubBanner: smooth scroll outside `motion-safe` → reduced-motion red;
 *   M27 HomeHub: no balance chip in the header → header red.
 */

const { HomeHub } = await import("../../components/home/HomeHub.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { TOOL_BY_ID, TOOL_GROUPS } = await import("../../lib/tools.ts");
const { SERVICES, SERVICE_BY_ID } = await import("../../lib/services.ts");
const { TOOL_ICONS } = await import("../../components/shell/icons.tsx");
const model = await import("../../components/home/hub/hub-model.ts");
const { groupDigits } = await import("../../lib/format.ts");
const { STUDIO_ENTRY } = await import("../../components/studio/studio-entry.ts");
const { CreateGrid } = await import("../../components/home/CreateGrid.tsx");
const { HubBanner, BANNER_ROTATE_MS } = await import("../../components/home/hub/HubBanner.tsx");
const { FreeRow } = await import("../../components/home/hub/FreeRow.tsx");
const { catalogueGroupOf, catalogueHref } = await import("../../components/home/catalogue-filter.ts");
const { default: CreatePage } = await import("../../app/uz/create/page.tsx");

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
const cells = () => [...document.querySelectorAll<HTMLAnchorElement>("[data-hub-grid] > li > *")];
const cellIds = () => cells().map((c) => c.dataset.hubCell);
const slideIds = () => [...document.querySelectorAll<HTMLElement>("[data-hub-slide]")].map((a) => a.dataset.hubSlide);
const features = (patch: Record<string, unknown>) => useAppStore.setState({ features: { llm: true, images: true, telegram: false, telegramBot: null, ...patch } as never });

/* ───────────── greeting ───────────── */

test("greeting: «Salom, <first name>»; a phone in name/author is never shown — «Salom!» instead", async () => {
  signIn();
  mount();
  assert.equal(title(), "Salom, Ali");
  assert.ok(!q("[data-page-header] p"), "the greeting stands alone, the mock-up has no subtitle");
  cleanup();

  // Phone login: `name` and `author` are the phone (lib/server/auth.ts upsertLocalUser) — the F0 bug.
  for (const phone of ["+998901234567", "998901112233", "+998 90 123 45 67"]) {
    signIn({ ...USER, name: phone, author: phone, phone });
    mount();
    assert.equal(title(), "Salom!", `phone «${phone}» as name`);
    // The balance chip has its own digits; the rest of the header has none.
    const header = headerText().replace(q("[data-balance]")!.textContent!, "");
    assert.ok(!/\d{3}/.test(header), `header shows digits: ${header}`);
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
  // The grid and the banner stay browsable, and the card stands where the files would.
  assert.equal(cells().length, 12);
  assert.ok(q("[data-hub-slide]"));
  assert.ok(q("[data-hub-grid]")!.compareDocumentPosition(q("[data-hub-signed-out]")!) & Node.DOCUMENT_POSITION_FOLLOWING, "login card under the grid");

  useUi.setState({ overlay: null, returnTo: null });
  fireEvent.click(q("[data-hub-login]")!);
  assert.equal(useUi.getState().overlay, "login");
  assert.equal(useUi.getState().returnTo, null);
});

/* ───────────── service grid ───────────── */

const ALL_ON = { llm: true, images: true, telegram: false, telegramBot: null, domla: true, chat: true, tests: true, market: true } as never;

const TWELVE = ["slide", "pro-slide", "mustaqil-ish", "referat", "konspekt", "coursework", "essay", "tests", "studio", "chat", "domla", "all"];

test("grid: the twelve cells in the owner's order, routes, labels, icons, tints", () => {
  signIn();
  useAppStore.setState({ features: ALL_ON });
  mount();
  assert.deepEqual(cellIds(), TWELVE);
  const hrefs = cells().map((c) => c.getAttribute("href"));
  assert.deepEqual(hrefs, [
    "/uz/slide",
    "/uz/pro-slide",
    "/uz/mustaqil-ish",
    "/uz/referat",
    "/uz/konspekt",
    "/uz/coursework",
    "/uz/essay",
    "/uz/tests",
    "/uz/studio",
    "/uz/chat",
    "/uz/domla",
    "/uz/create",
  ]);
  assert.deepEqual(cells().map((c) => c.textContent), [
    "Slayd",
    "Pro slayd",
    "Mustaqil ish",
    "Referat",
    "Konspekt",
    "Kurs ishi",
    "Insho",
    "Test ishlash",
    "Studio",
    "AI yordamchi",
    "Qattiqqo‘l domla",
    "Barchasi",
  ]);
  for (const c of cells()) assert.ok(c.querySelector("svg"), `${c.dataset.hubCell}: icon drawn`);
  // The tint is the tool's / service's own colour; «Barchasi» is neutral.
  assert.deepEqual(cells().map((c) => c.style.getPropertyValue("--tc")), [
    TOOL_BY_ID.slide.tc,
    TOOL_BY_ID["pro-slide"].tc,
    TOOL_BY_ID["mustaqil-ish"].tc,
    TOOL_BY_ID.referat.tc,
    TOOL_BY_ID.konspekt.tc,
    TOOL_BY_ID.coursework.tc,
    TOOL_BY_ID.essay.tc,
    SERVICE_BY_ID.tests.tc,
    STUDIO_ENTRY.tc,
    SERVICE_BY_ID.chat.tc,
    SERVICE_BY_ID.domla.tc,
    "",
  ]);
  // O'yinlar left the default grid (it stays reachable through «Barchasi»).
  assert.ok(!q("[data-hub-cell=games]"));
  // Four columns × three rows on a phone, six × two on a desktop (not twelve in a line); ≥ 44 px targets; labels ≥ 12.5 px.
  const grid = q("[data-hub-grid]")!.className;
  assert.match(grid, /(^|\s)grid-cols-4(\s|$)/);
  assert.match(grid, /(^|\s)lg:grid-cols-6(\s|$)/);
  assert.ok(!/grid-cols-(8|12)\b/.test(grid), grid);
  for (const c of cells()) {
    assert.match(c.className, /min-h-\[5\.75rem\]/, "taller than 44 px");
    // A grid row stretches its items: `h-full` makes a one-line and a two-line label the same cell height.
    assert.match(c.className, /(^|\s)h-full(\s|$)/, "equal cell heights");
    assert.match(c.className, /focus-visible:ring-2/, "keyboard focus visible");
    const label = c.lastElementChild!.className;
    assert.match(label, /text-\[13px\]/);
    // Two lines allowed, never a one-line truncate («Qattiqqo‘l domla», «AI yordamchi» at 360 px).
    assert.match(label, /line-clamp-2/);
    assert.ok(!/(^|\s)(truncate|whitespace-nowrap)(\s|$)/.test(label), label);
  }
});

test("grid: Slayd alone is emphasised, in a tile of the same size", () => {
  signIn();
  mount();
  assert.deepEqual([...document.querySelectorAll<HTMLElement>("[data-hub-cell-primary]")].map((c) => c.dataset.hubCell), ["slide"]);
  const tile = (c: Element) => c.firstElementChild!.className;
  assert.match(tile(cells()[0]!), /ring-2/);
  assert.ok(!/ring-2/.test(tile(cells()[1]!)));
  assert.match(tile(cells()[0]!), /size-\[3\.25rem\]/);
  assert.match(tile(cells()[1]!), /size-\[3\.25rem\]/);
});

test("grid: a switch off → its cell is the next fallback (O'yinlar, Rezyume, Tarjimon); always 12, every cell a distinct target", () => {
  signIn();
  const base = { tests: true, chat: true, domla: true };
  // [switches, the three gated places (tests, chat, domla)]
  const cases: [Record<string, unknown>, string[]][] = [
    [base, ["tests", "chat", "domla"]],
    [{ ...base, tests: false }, ["games", "chat", "domla"]],
    [{ ...base, chat: false }, ["tests", "games", "domla"]],
    [{ ...base, domla: false }, ["tests", "chat", "games"]],
    [{ ...base, tests: false, chat: false }, ["games", "resume", "domla"]],
    [{ ...base, chat: false, domla: false }, ["tests", "games", "resume"]],
    [{ tests: false, chat: false, domla: false }, ["games", "resume", "translation"]],
    [{}, ["games", "resume", "translation"]],
  ];
  for (const [f, gated] of cases) {
    features(f);
    mount();
    const ids = cellIds();
    assert.equal(ids.length, 12, JSON.stringify(f));
    assert.deepEqual([ids[7], ids[9], ids[10]], gated, JSON.stringify(f));
    // The fixed cells never move; «Barchasi» is last.
    assert.deepEqual(ids.filter((_, i) => i !== 7 && i !== 9 && i !== 10), ["slide", "pro-slide", "mustaqil-ish", "referat", "konspekt", "coursework", "essay", "studio", "all"]);
    assert.equal(new Set(cells().map((c) => c.getAttribute("href"))).size, 12, `distinct targets ${JSON.stringify(f)}`);
    cleanup();
  }
  // Each fallback: its own route, name, tint.
  features({});
  mount();
  const at = (i: number) => cells()[i]!;
  assert.equal(at(7).getAttribute("href"), "/uz/create?group=oyinlar");
  assert.equal(at(7).textContent, "O'yinlar");
  assert.equal(at(7).style.getPropertyValue("--tc"), TOOL_BY_ID.crossword.tc);
  assert.equal(at(9).getAttribute("href"), "/uz/resume");
  assert.equal(at(9).textContent, TOOL_BY_ID.resume.title);
  assert.equal(at(10).getAttribute("href"), "/uz/translation");
  assert.equal(at(10).textContent, TOOL_BY_ID.translation.title);
  assert.equal(at(10).style.getPropertyValue("--tc"), TOOL_BY_ID.translation.tc);
});

test("grid: the fourth fallback (Maqola) is in the model's list; the gated cells are flagged, the rest not", () => {
  const cellsOff = model.homeCells({ llm: true } as never);
  assert.deepEqual(cellsOff.map((c) => c.flagged === true), TWELVE.map((_, i) => i === 7 || i === 9 || i === 10));
  // Three gated places use three of the four fallbacks; the list itself, in the owner's order, with Maqola fourth.
  const fallbacks = model.homeFallbackCells({ llm: true } as never);
  assert.deepEqual(fallbacks.map((c) => c.id), ["games", "resume", "translation", "article"]);
  assert.deepEqual(fallbacks.map((c) => c.href), ["/uz/create?group=oyinlar", "/uz/resume", "/uz/translation", "/uz/article"]);
  // A fallback tool without its provider key is drawn disabled like any tool cell.
  assert.ok(model.homeFallbackCells({ llm: false } as never)[1]!.blocked, "Rezyume blocked without the LLM key");
});

test("grid: tool cells follow the fold's link builder", () => {
  assert.deepEqual(model.homeCells({ legacyFold: true } as never).filter((c) => c.id in TOOL_BY_ID).map((c) => c.href), [
    "/uz/slide",
    "/uz/pro-slide",
    "/uz/mustaqil-ish",
    "/uz/referat",
    "/uz/konspekt",
    "/uz/coursework",
    "/uz/essay",
    "/uz/resume",
    "/uz/translation",
  ]);
});

test("login gate on cells and slides: signed out → login over the target with returnTo; signed in or session unknown → none", () => {
  // Session not checked yet (FE-09): not «signed out». Slayd is drawn even then.
  mount();
  fireEvent.click(q("[data-hub-cell=essay]")!);
  assert.equal(useUi.getState().overlay, null, "unchecked session: no login");
  cleanup();

  signIn();
  useAppStore.setState({ features: ALL_ON });
  mount();
  fireEvent.click(q("[data-hub-cell=essay]")!);
  fireEvent.click(q('[data-hub-slide="studio"]')!);
  assert.equal(useUi.getState().overlay, null, "signed in: no login");
  cleanup();

  signOut();
  useAppStore.setState({ features: ALL_ON });
  mount();
  for (const c of cells()) {
    fireEvent.click(c);
    assert.equal(useUi.getState().overlay, "login", c.dataset.hubCell);
    assert.equal(useUi.getState().returnTo, c.getAttribute("href"), `${c.dataset.hubCell}: gated with its target`);
    useUi.setState({ overlay: null, returnTo: null });
  }
  for (const a of document.querySelectorAll<HTMLAnchorElement>("[data-hub-slide]")) {
    fireEvent.click(a);
    assert.equal(useUi.getState().returnTo, a.getAttribute("href"), `${a.dataset.hubSlide}: gated with its target`);
    useUi.setState({ overlay: null, returnTo: null });
  }
});

test("a tool without its provider key stays in the grid, disabled with the reason (not a link)", () => {
  signIn();
  useAppStore.setState({ features: { llm: false, images: true, telegram: false, telegramBot: null } as never });
  mount();
  assert.equal(cells().length, 12, "no hole");
  const slide = q("[data-hub-cell=slide]")!;
  assert.equal(slide.tagName, "DIV");
  assert.equal(slide.getAttribute("aria-disabled"), "true");
  assert.match(slide.textContent!, /AI xizmati vaqtincha o‘chiq/, "full reason for screen readers");
  assert.match(slide.getAttribute("title")!, /AI xizmati vaqtincha o‘chiq/);
  fireEvent.click(slide);
  assert.equal(useUi.getState().overlay, null);
  // Studio, the catalogue and the games keep their links.
  assert.equal(q("[data-hub-cell=all]")!.tagName, "A");
  assert.equal(q("[data-hub-cell=games]")!.tagName, "A");
});

test("«O'yinlar» opens the games chip of the catalogue; a wrong `?group=` is «all»", async () => {
  assert.equal(catalogueGroupOf("oyinlar"), "oyinlar");
  for (const bad of ["nope", "", undefined, ["oyinlar"], "all", "__proto__"]) assert.equal(catalogueGroupOf(bad), "all", String(bad));
  for (const g of TOOL_GROUPS) assert.equal(catalogueGroupOf(g.id), g.id);
  assert.equal(catalogueHref("all"), "/uz/create");

  // The route hands the query to the grid.
  const page = await CreatePage({ searchParams: Promise.resolve({ group: "oyinlar" }) });
  assert.equal(page.props.initialGroup, "oyinlar");
  assert.equal((await CreatePage({ searchParams: Promise.resolve({}) })).props.initialGroup, "all");

  useAppStore.setState({ hydrated: true });
  signIn();
  render(h(AppRouterContext.Provider, { value: router }, h(CreateGrid, { initialGroup: "oyinlar" })));
  assert.equal(q('[data-group-chip="oyinlar"]')!.getAttribute("aria-pressed"), "true");
  assert.deepEqual([...document.querySelectorAll<HTMLElement>("[data-catalogue-group]")].map((s) => s.dataset.catalogueGroup), ["oyinlar"]);
  cleanup();

  // Signed out the catalogue's own gate keeps the chip in `returnTo`.
  signOut();
  render(h(AppRouterContext.Provider, { value: router }, h(CreateGrid, { initialGroup: "oyinlar" })));
  await settle();
  assert.equal(useUi.getState().returnTo, "/uz/create?group=oyinlar");
});

/* ───────────── promo banner ───────────── */

test("banner: slides by switch, in order, each a link to its page", () => {
  signIn();
  const cases: [Record<string, unknown>, string[]][] = [
    [{}, ["title-page", "studio"]],
    [{ market: true }, ["market", "title-page", "studio"]],
    [{ chat: true }, ["title-page", "chat", "studio"]],
    [{ tests: true }, ["title-page", "tests", "studio"]],
    [{ domla: true }, ["title-page", "studio", "domla"]],
    [{ market: true, chat: true, tests: true, domla: true }, ["market", "title-page", "chat", "tests", "studio", "domla"]],
    [{ market: false, chat: false, tests: false, domla: false }, ["title-page", "studio"]],
  ];
  for (const [f, want] of cases) {
    features(f);
    mount();
    assert.deepEqual(slideIds(), want, JSON.stringify(f));
    cleanup();
  }
  features({ market: true, chat: true, tests: true, domla: true });
  mount();
  const text = (id: string) => q(`[data-hub-slide="${id}"]`)!;
  assert.equal(text("market").getAttribute("href"), "/uz/market");
  assert.equal(text("title-page").getAttribute("href"), "/uz/titul");
  assert.equal(text("studio").getAttribute("href"), "/uz/studio");
  assert.equal(text("chat").getAttribute("href"), "/uz/chat");
  assert.equal(text("tests").getAttribute("href"), "/uz/tests");
  assert.equal(text("domla").getAttribute("href"), "/uz/domla");
  assert.match(text("title-page").textContent!, /Titul varag‘i — bepul/);
  assert.match(text("title-page").textContent!, /Kurs ishi, diplom va mustaqil ish uchun tayyor titul/);
  assert.match(text("title-page").textContent!, /Titul yaratish/);
  assert.match(text("tests").textContent!, /Test ishlash/);
  assert.match(text("tests").textContent!, /Testni boshlash/);
  assert.match(text("market").textContent!, /Ishlar bozori ochildi/);
  assert.match(text("studio").textContent!, /Eng kuchli modellar/);
  assert.match(text("chat").textContent!, /Savol bering yoki hujjat buyuring/);
  assert.match(text("chat").textContent!, /kuniga 10 ta tekin/);
  assert.match(text("chat").textContent!, /Suhbatni boshlash/);
  assert.match(text("domla").textContent!, /Slaydingizni ovoz bilan himoya qiling/);
  for (const id of slideIds()) assert.ok(text(id!).querySelector("svg"), `${id}: icon`);
  // Above the grid; the hero token; an accessible carousel of labelled slides.
  const banner = q('[data-hub-section="banner"]')!;
  assert.equal(banner.getAttribute("aria-roledescription"), "carousel");
  const items = [...document.querySelectorAll<HTMLElement>("[data-hub-banner] > li")];
  assert.deepEqual(items.map((li) => li.getAttribute("aria-label")), ["1 / 6", "2 / 6", "3 / 6", "4 / 6", "5 / 6", "6 / 6"]);
  for (const li of items) {
    assert.equal(li.getAttribute("role"), "group");
    assert.equal(li.getAttribute("aria-roledescription"), "slide");
  }
  assert.ok(banner.compareDocumentPosition(q("[data-hub-grid]")!) & Node.DOCUMENT_POSITION_FOLLOWING, "banner above the grid");
  assert.match(banner.className, /bg-\[image:var\(--hero\)\]/);
  assert.match(banner.className, /text-hero-foreground/);
  assert.equal(banner.getAttribute("aria-label"), "Takliflar");
});

test("banner: an admin sees the market slide with the switch off, as on the market's own pages", () => {
  signIn({ ...USER, isAdmin: true });
  features({});
  mount();
  assert.deepEqual(slideIds(), ["market", "title-page", "studio"]);
});

const ONE_SLIDE = [{ id: "studio", href: "/uz/studio", title: "Studio", promise: "p", cta: "c", icon: "sparkles" }];

test("banner: dots only with more than one slide; they follow the scroll and move it; scrolling stays inside the banner", () => {
  // Titul and Studio have no switch, so the hub always has two slides; the one-slide banner is drawn on its own.
  render(h(HubBanner, { slides: ONE_SLIDE, pending: false, onPick: () => {}, index: 0 }));
  assert.ok(q("[data-hub-slide=studio]"));
  assert.ok(!q("[data-hub-banner-dots]"), "one slide: no dots");
  cleanup();

  signIn();
  features({ market: true, chat: true });
  mount();
  const list = q("[data-hub-banner]")!;
  Object.defineProperty(list, "clientWidth", { value: 300, configurable: true });
  const current = () => [...document.querySelectorAll<HTMLElement>("[data-hub-banner-dot]")].filter((d) => d.getAttribute("aria-current") === "true").map((d) => d.dataset.hubBannerDot);
  assert.deepEqual([...document.querySelectorAll<HTMLElement>("[data-hub-banner-dot]")].map((d) => d.getAttribute("aria-label")), [
    "1-taklif: Ishlar bozori ochildi",
    "2-taklif: Titul varag‘i — bepul",
    "3-taklif: AI yordamchi",
    "4-taklif: Studio",
  ]);
  assert.deepEqual(current(), ["market"]);
  list.scrollLeft = 310;
  fireEvent.scroll(list);
  assert.deepEqual(current(), ["title-page"]);
  fireEvent.click(q('[data-hub-banner-dot="chat"]')!);
  assert.equal(list.scrollLeft, 600, "the dot moves the carousel");
  assert.deepEqual(current(), ["chat"]);
  // Snap, own scroller, the page never scrolls sideways; smooth only without reduced motion (the turns jump then).
  assert.match(list.className, /overflow-x-auto/);
  assert.match(list.className, /snap-mandatory/);
  assert.match(list.className, /overscroll-x-contain/);
  assert.match(list.className, /motion-safe:scroll-smooth/);
  assert.ok(!/(^|\s)scroll-smooth/.test(list.className), "no smooth scroll outside motion-safe");
  assert.match(q('[data-hub-section="banner"]')!.className, /overflow-hidden/);
  // A switch going off under an active dot: the last slide is current, not nothing.
  list.scrollLeft = 900;
  fireEvent.scroll(list);
  assert.deepEqual(current(), ["studio"]);
  act(() => features({ market: true, chat: false }));
  assert.deepEqual(slideIds(), ["market", "title-page", "studio"]);
  assert.deepEqual(current(), ["studio"]);
});

/* ───────────── banner auto-rotation ───────────── */

/**
 * Fake `setTimeout`/`Date` (node:test mock timers) plus a live set of the banner's own timers (the ones of
 * `BANNER_ROTATE_MS`), so «no timer» and «cleared on unmount» are observed, not inferred.
 */
function fakeTimers() {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const mockedSet = globalThis.setTimeout;
  const mockedClear = globalThis.clearTimeout;
  const live = new Set<unknown>();
  globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
    if (ms !== BANNER_ROTATE_MS) return mockedSet(fn, ms, ...rest);
    const id: unknown = mockedSet(() => {
      live.delete(id);
      fn();
    }, ms);
    live.add(id);
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: unknown) => {
    live.delete(id);
    mockedClear(id as never);
  }) as typeof clearTimeout;
  return {
    live,
    tick: (ms: number) =>
      act(async () => {
        mock.timers.tick(ms);
      }),
    restore() {
      globalThis.setTimeout = mockedSet;
      globalThis.clearTimeout = mockedClear;
      mock.timers.reset();
    },
  };
}

/** Signed in with one file (no `limit=1` request), chat on, market off: slides titul, chat, studio. */
function mountRotating() {
  signIn(USER, [gen("a")]);
  features({ chat: true });
  mount();
  const list = q("[data-hub-banner]")!;
  Object.defineProperty(list, "clientWidth", { value: 300, configurable: true });
  return list;
}
const activeDot = () => [...document.querySelectorAll<HTMLElement>("[data-hub-banner-dot]")].findIndex((d) => d.getAttribute("aria-current") === "true");
const bannerSection = () => q('[data-hub-section="banner"]')!;
const rotatingNow = () => bannerSection().hasAttribute("data-hub-banner-rotating");

test("rotation: the next slide after 5 000 ms, wrapping to the first after the last; the live region is off while it turns", async () => {
  const t = fakeTimers();
  try {
    const list = mountRotating();
    assert.deepEqual(slideIds(), ["title-page", "chat", "studio"]);
    assert.equal(BANNER_ROTATE_MS, 5000);
    assert.equal(activeDot(), 0);
    assert.ok(rotatingNow());
    assert.equal(list.getAttribute("aria-live"), "off", "no announcement every 5 s");
    await t.tick(4999);
    assert.equal(activeDot(), 0, "not before 5 s");
    await t.tick(1);
    assert.equal(activeDot(), 1);
    assert.equal(list.scrollLeft, 300, "the carousel moved");
    await t.tick(5000);
    assert.equal(activeDot(), 2);
    assert.equal(list.scrollLeft, 600);
    await t.tick(5000);
    assert.equal(activeDot(), 0, "wraps to the first");
    assert.equal(list.scrollLeft, 0);
    assert.equal(t.live.size, 1, "exactly one timer at a time");
  } finally {
    t.restore();
  }
});

test("rotation: the mouse over the banner holds it; leaving resumes; a touch pointer entering does not hold", async () => {
  const t = fakeTimers();
  try {
    mountRotating();
    await t.tick(3000);
    await act(async () => {
      fireEvent.pointerEnter(bannerSection(), { pointerType: "mouse" });
    });
    assert.ok(!rotatingNow());
    assert.equal(q("[data-hub-banner]")!.getAttribute("aria-live"), "polite", "held: the slide is announced");
    assert.equal(t.live.size, 0, "no timer while held");
    await t.tick(20000);
    assert.equal(activeDot(), 0, "held under the mouse");
    await act(async () => {
      fireEvent.pointerLeave(bannerSection(), { pointerType: "mouse" });
    });
    await t.tick(4999);
    assert.equal(activeDot(), 0, "a whole period again after the hold");
    await t.tick(1);
    assert.equal(activeDot(), 1);

    await act(async () => {
      fireEvent.pointerEnter(bannerSection(), { pointerType: "touch" });
    });
    assert.ok(rotatingNow(), "a finger is not a hover");
  } finally {
    t.restore();
  }
});

test("rotation: keyboard focus inside holds it, blur resumes; the focus a tap leaves on a dot does not hold", async () => {
  const t = fakeTimers();
  try {
    mountRotating();
    const dot = q('[data-hub-banner-dot="chat"]')!;
    await act(async () => {
      dot.focus();
    });
    assert.ok(!rotatingNow(), "focus inside");
    await t.tick(15000);
    assert.equal(activeDot(), 0);
    // Focus moving between the banner's own controls keeps the hold.
    await act(async () => {
      q('[data-hub-banner-dot="studio"]')!.focus();
    });
    assert.ok(!rotatingNow(), "still inside");
    await act(async () => {
      q('[data-hub-banner-dot="studio"]')!.blur();
    });
    assert.ok(rotatingNow(), "focus left");
    await t.tick(5000);
    assert.equal(activeDot(), 1);

    // A tap: pointerdown, the focus it gives, pointerup — rotating again once released.
    await act(async () => {
      fireEvent.pointerDown(dot, { pointerType: "touch" });
      dot.focus();
    });
    await act(async () => {
      fireEvent.pointerUp(window, { pointerType: "touch" });
    });
    assert.ok(document.activeElement === dot, "the dot has the focus");
    assert.ok(rotatingNow(), "tap focus is not a keyboard hold");
  } finally {
    t.restore();
  }
});

test("rotation: a finger on the banner and a mouse drag hold it until released (anywhere)", async () => {
  const t = fakeTimers();
  try {
    mountRotating();
    await act(async () => {
      fireEvent.touchStart(bannerSection(), { touches: [{ clientX: 1, clientY: 1 }] });
    });
    assert.ok(!rotatingNow(), "touching");
    await t.tick(12000);
    assert.equal(activeDot(), 0);
    await act(async () => {
      fireEvent.touchEnd(bannerSection(), { touches: [] });
    });
    assert.ok(rotatingNow(), "finger lifted");
    await t.tick(5000);
    assert.equal(activeDot(), 1);

    await act(async () => {
      fireEvent.pointerDown(q("[data-hub-banner]")!, { pointerType: "mouse" });
    });
    assert.ok(!rotatingNow(), "dragging");
    await t.tick(12000);
    assert.equal(activeDot(), 1);
    // Released outside the banner.
    await act(async () => {
      fireEvent.pointerUp(window, { pointerType: "mouse" });
    });
    assert.ok(rotatingNow(), "released");
    await t.tick(5000);
    assert.equal(activeDot(), 2);
  } finally {
    t.restore();
  }
});

test("rotation: a hidden document holds it; visible again, it resumes", async () => {
  const t = fakeTimers();
  const setVisibility = (v: "hidden" | "visible") =>
    act(async () => {
      Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
      document.dispatchEvent(new window.Event("visibilitychange"));
    });
  try {
    mountRotating();
    await setVisibility("hidden");
    assert.ok(!rotatingNow());
    await t.tick(20000);
    assert.equal(activeDot(), 0);
    await setVisibility("visible");
    assert.ok(rotatingNow());
    await t.tick(5000);
    assert.equal(activeDot(), 1);
  } finally {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    t.restore();
  }
});

test("rotation: a dot or a swipe restarts the period; the user's own scroll is never fought", async () => {
  const t = fakeTimers();
  try {
    const list = mountRotating();
    await t.tick(3000);
    fireEvent.click(q('[data-hub-banner-dot="studio"]')!);
    assert.equal(activeDot(), 2);
    await t.tick(4999);
    assert.equal(activeDot(), 2, "the dot restarted the 5 s");
    await t.tick(1);
    assert.equal(activeDot(), 0);
    // Clicking the CURRENT dot restarts it too.
    await t.tick(3000);
    fireEvent.click(q('[data-hub-banner-dot="title-page"]')!);
    await t.tick(3000);
    assert.equal(activeDot(), 0, "restarted, not 5 s since the last turn");
    await t.tick(2000);
    assert.equal(activeDot(), 1);

    // A swipe to another slide restarts the period.
    await t.tick(2000);
    list.scrollLeft = 600;
    fireEvent.scroll(list);
    assert.equal(activeDot(), 2);
    await t.tick(4999);
    assert.equal(activeDot(), 2);
    await t.tick(1);
    assert.equal(activeDot(), 0);

    // Mid-scroll at the turn (a trackpad within the same slide): the turn waits.
    await t.tick(4600);
    list.scrollLeft = 20;
    fireEvent.scroll(list);
    await t.tick(400);
    assert.equal(activeDot(), 0, "no turn under the user's scroll");
    assert.equal(list.scrollLeft, 20, "the position the user left");
    await t.tick(5000);
    assert.equal(activeDot(), 1, "turns once the scroll has settled");
  } finally {
    t.restore();
  }
});

test("rotation: one slide, the skeleton and an unmount leave no timer", async () => {
  const t = fakeTimers();
  try {
    render(h(HubBanner, { slides: ONE_SLIDE, pending: false, onPick: () => {}, index: 0 }));
    assert.equal(t.live.size, 0, "one slide: no timer");
    assert.ok(!rotatingNow());
    cleanup();
    render(h(HubBanner, { slides: [...ONE_SLIDE, { ...ONE_SLIDE[0]!, id: "chat" }], pending: true, onPick: () => {}, index: 0 }));
    assert.ok(q("[data-hub-banner-skeleton]"));
    assert.equal(t.live.size, 0, "skeleton: no timer");
    cleanup();
    mountRotating();
    assert.equal(t.live.size, 1);
    cleanup();
    assert.equal(t.live.size, 0, "unmount clears the timer");
  } finally {
    t.restore();
  }
});

test("loading: until the session is known the banner and the three switch cells are skeletons of the same size; the grid is 12 cells already", () => {
  mount();
  const skeleton = q("[data-hub-banner-skeleton]")!;
  assert.ok(skeleton, "banner skeleton");
  assert.equal(skeleton.getAttribute("aria-hidden"), "true");
  assert.ok(!q("[data-hub-banner]"));
  assert.equal(cells().length, 12);
  assert.equal(document.querySelectorAll("[data-hub-cell-skeleton]").length, 3);
  assert.deepEqual(cells().map((c, i) => (c.hasAttribute("data-hub-cell-skeleton") ? i : -1)).filter((i) => i >= 0), [7, 9, 10], "Test ishlash, AI yordamchi, Qattiqqo‘l domla");
  assert.deepEqual([cells()[0]!.dataset.hubCell, cells()[11]!.dataset.hubCell], ["slide", "all"]);
  const height = skeleton.className.split(/\s+/).find((c) => c.startsWith("h-["))!;
  cleanup();
  signIn();
  features({});
  mount();
  assert.ok(!q("[data-hub-banner-skeleton]"));
  assert.ok(!q("[data-hub-cell-skeleton]"));
  assert.ok(q('[data-hub-section="banner"]')!.className.split(/\s+/).includes(height), "same height, no layout shift");
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

test("«Davom ettirish» without files: confirmed with limit=1, then no section at all (nothing hollow)", async () => {
  stubFetch([]);
  signIn(USER, []);
  mount();
  assert.equal(q("[data-hub-recent]")!.dataset.hubRecent, "loading", "not dropped before the check");
  await waitFor(() => assert.ok(!q('[data-hub-section="recent"]')));
  assert.ok(!q("[data-hub-recent]"));
  assert.ok(fetches.some((u) => /\/api\/generations\?limit=1$/.test(u)), `fetches: ${fetches.join(", ")}`);
  assert.equal(cells().length, 12, "the grid stays");
});

test("«Davom ettirish» error: the list did not load → «Fayllar yuklanmadi» + «Qayta urinish» (not «no files»)", async () => {
  stubFetch("fail");
  signIn(USER, []);
  mount();
  await waitFor(() => assert.equal(q("[data-hub-recent]")!.dataset.hubRecent, "error"));
  assert.equal(q("[data-hub-recent]")!.getAttribute("role"), "alert");

  // Retry: the server answers now, the user has no files.
  stubFetch([]);
  fireEvent.click(q("[data-hub-retry]")!);
  await waitFor(() => assert.ok(!q('[data-hub-section="recent"]')));

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
  assert.equal(groupDigits(3000), "3\u00a0000");
  assert.equal(groupDigits(12000), "12\u00a0000");
  assert.equal(groupDigits(1234567), "1\u00a0234\u00a0567");
  assert.equal(groupDigits(500), "500");
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

test("header: greeting, balance → Hamyon, search icon, theme, bell; no search field in the page", () => {
  signIn();
  useAppStore.getState().setTheme("light");
  mount();
  fireEvent.click(q('[data-page-header-actions] [aria-label="Qidirish"]')!);
  assert.equal(useUi.getState().overlay, "search");
  useUi.setState({ overlay: null });
  assert.ok(!q("[data-hub-search]"), "no duplicate search field");
  assert.ok(!/Vosita yoki fayl qidirish/.test(document.body.textContent!));
  assert.match(q('[aria-label="Qidirish"]')!.getAttribute("title")!, /Ctrl\+K/);
  fireEvent.click(q('[aria-label="Bildirishnomalar"]')!);
  assert.equal(useUi.getState().overlay, "notifications");
  fireEvent.click(q("[data-theme-toggle]")!);
  assert.equal(useAppStore.getState().theme, "dark");
  fireEvent.click(q("[data-theme-toggle]")!);
  assert.equal(useAppStore.getState().theme, "light");
  const chip = q("[data-balance]")!;
  assert.equal(chip.getAttribute("href"), "/uz/wallet");
  assert.match(chip.textContent!, /2[\s  ]?500/);
  assert.ok(q("[data-page-header-actions]")!.contains(chip), "in the header, beside the icons");
  assert.ok(chip.compareDocumentPosition(q('[aria-label="Qidirish"]')!) & Node.DOCUMENT_POSITION_FOLLOWING, "before the search icon");
});

test("Cmd/Ctrl+K stays bound by the shell, which the home's search icon relies on", () => {
  const shell = readFileSync(new URL("../../components/shell/AppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /\(e\.metaKey \|\| e\.ctrlKey\) && key === "k"/);
  assert.match(shell, /open\("search"\)/);
});

/* ───────────── layout ───────────── */

test("removed: no «Tez boshlash», no «Barcha vositalar» list; every service icon is in the table", () => {
  signIn();
  useAppStore.setState({ features: ALL_ON });
  mount();
  for (const sel of ["[data-quick-tool]", "[data-hub-quick]", "[data-hub-tools]", "[data-hub-group]", "[data-hub-tool]", "[data-hub-promo]", "[data-hub-all-tools]", "[data-hub-catalogue]"]) {
    assert.ok(!q(sel), sel);
  }
  assert.ok(!/Tez boshlash|Barcha vositalar/.test(document.body.textContent!));
  // A missing icon would be dropped silently.
  for (const v of SERVICES) assert.ok(TOOL_ICONS[v.icon], `icon ${v.icon}`);
  assert.ok(TOOL_ICONS["layout-grid"], "«Barchasi»");
  assert.ok(TOOL_ICONS.sparkles, "Studio");
});

test("sections: banner, grid, free, files, labelled, staggered ≤ 200 ms and motion-safe only", () => {
  stubFetch([]);
  signIn(USER, [gen("a")]);
  features({ chat: true });
  mount();
  const sections = [...document.querySelectorAll<HTMLElement>("[data-hub-section]")];
  assert.deepEqual(sections.map((s) => s.dataset.hubSection), ["banner", "grid", "free", "recent"]);
  const delays = sections.map((s) => parseInt(s.style.animationDelay, 10));
  assert.deepEqual(delays, [...delays].sort((a, b) => a - b), `staggered top to bottom: ${delays.join(", ")}`);
  assert.equal(new Set(delays).size, delays.length);
  for (const s of sections) {
    const labelled = s.getAttribute("aria-label") ?? document.getElementById(s.getAttribute("aria-labelledby")!)?.textContent;
    assert.ok(labelled, "labelled");
    assert.match(s.className, /motion-safe:animate-/);
    assert.ok(!/(^|\s)animate-/.test(s.className), "no animation outside motion-safe");
    assert.ok(parseInt(s.style.animationDelay, 10) <= 200, s.style.animationDelay);
  }
});

test("the market rail keeps its place under the files, in the hub's own width, only with the switch on", async () => {
  globalThis.fetch = (async () => json(200, { items: [card("c1")] })) as typeof fetch;
  signIn(USER, [gen("a")]);
  useAppStore.setState({ features: ALL_ON });
  mount();
  await waitFor(() => assert.ok(q('[data-hub-section="market"]')));
  const sections = [...document.querySelectorAll<HTMLElement>("[data-hub-section]")];
  assert.deepEqual(sections.map((s) => s.dataset.hubSection), ["banner", "grid", "free", "recent", "market"]);
  assert.ok(parseInt(sections[4]!.style.animationDelay, 10) <= 200, "the last section still starts by 200 ms");
  cleanup();
  features({ market: false });
  mount();
  assert.ok(!q('[data-hub-section="market"]'));
});

/* ───────────── «Bepul xizmatlar» ───────────── */

const freeItems = () => [...document.querySelectorAll<HTMLAnchorElement>("[data-hub-free-item]")];

test("free row: Titul, AI yordamchi, converters — names, promises, «Bepul» badge, registry routes; signed out it still shows", () => {
  signIn();
  useAppStore.setState({ features: ALL_ON });
  mount();
  const section = q('[data-hub-section="free"]')!;
  assert.ok(section);
  assert.equal(document.getElementById(section.getAttribute("aria-labelledby")!)!.textContent, "Bepul xizmatlar");
  assert.deepEqual(freeItems().map((a) => a.dataset.hubFreeItem), ["title-page", "chat", "convert", "alifbo"]);
  assert.deepEqual(freeItems().map((a) => a.getAttribute("href")), ["/uz/titul", "/uz/chat", "/uz/convert", "/uz/alifbo"]);
  // The routes ARE the registries' (no second copy of a href).
  assert.deepEqual(freeItems().map((a) => a.getAttribute("href")), [`/uz/${TOOL_BY_ID["title-page"].slug}`, SERVICE_BY_ID.chat.href, SERVICE_BY_ID.convert.href, SERVICE_BY_ID.alifbo.href]);
  const text = (id: string) => q(`[data-hub-free-item="${id}"]`)!.textContent!;
  assert.match(text("title-page"), /^Titul/);
  assert.match(text("title-page"), /Titul varag‘ini 1 daqiqada/);
  assert.match(text("chat"), /AI yordamchi/);
  assert.match(text("chat"), /Kuniga 10 ta savol bepul/);
  assert.match(text("convert"), /Fayl konvertatsiya/);
  assert.match(text("convert"), /PDF, Word, rasm formatlari/);
  assert.match(text("alifbo"), /Alifbo o'giruvchi/);
  assert.match(text("alifbo"), /Kirill ↔ lotin/);
  for (const a of freeItems()) {
    assert.equal(a.querySelector("[data-free-badge]")?.textContent, "Bepul", `${a.dataset.hubFreeItem}: badge`);
    assert.ok(a.querySelector("svg"), `${a.dataset.hubFreeItem}: icon`);
    assert.ok(a.style.getPropertyValue("--tc"), `${a.dataset.hubFreeItem}: tint`);
    assert.ok(!/so['‘’]m/.test(a.textContent!), "no price on a free card");
  }
  // Directly under the grid, above the files.
  assert.ok(q("[data-hub-grid]")!.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING);
  // A phone row that scrolls inside itself with snap and no scrollbar; it wraps from 640 px.
  const row = q("[data-hub-free]")!.className;
  for (const c of ["flex", "overflow-x-auto", "snap-x", "snap-mandatory", "overscroll-x-contain", "[scrollbar-width:none]", "sm:flex-wrap", "sm:overflow-visible"]) {
    assert.ok(row.split(/\s+/).includes(c), `row class ${c}`);
  }
  for (const li of document.querySelectorAll<HTMLElement>("[data-hub-free] > li")) assert.match(li.className, /(^|\s)snap-start(\s|$)/);
  cleanup();

  signOut();
  useAppStore.setState({ features: ALL_ON });
  mount();
  assert.equal(freeItems().length, 4, "browsable signed out");
});

test("free row: AI yordamchi only with the chat switch; the model follows the fold's link builder", () => {
  signIn();
  for (const [f, want] of [
    [{ chat: false }, ["title-page", "convert", "alifbo"]],
    [{}, ["title-page", "convert", "alifbo"]],
    [{ chat: true }, ["title-page", "chat", "convert", "alifbo"]],
  ] as [Record<string, unknown>, string[]][]) {
    features(f);
    mount();
    assert.deepEqual(freeItems().map((a) => a.dataset.hubFreeItem), want, JSON.stringify(f));
    cleanup();
  }
  assert.deepEqual(model.homeFreeItems(null).map((i) => i.id), ["title-page", "convert", "alifbo"]);
  assert.equal(model.homeFreeItems({ legacyFold: true } as never)[0]!.href, "/uz/titul");
});

test("free row: links keep the hub's login gate; one card left still draws the section", () => {
  signOut();
  useAppStore.setState({ features: ALL_ON });
  mount();
  for (const a of freeItems()) {
    fireEvent.click(a);
    assert.equal(useUi.getState().overlay, "login", a.dataset.hubFreeItem);
    assert.equal(useUi.getState().returnTo, a.getAttribute("href"), `${a.dataset.hubFreeItem}: gated with its target`);
    useUi.setState({ overlay: null, returnTo: null });
  }
  cleanup();
  signIn();
  useAppStore.setState({ features: ALL_ON });
  mount();
  fireEvent.click(freeItems()[0]!);
  assert.equal(useUi.getState().overlay, null, "signed in: no login");
  cleanup();

  const picks: string[] = [];
  render(h(FreeRow, { items: model.homeFreeItems(null).slice(0, 1), onPick: (href: string) => picks.push(href), index: 2 }));
  assert.ok(q('[data-hub-section="free"]'), "the section with one card");
  assert.equal(freeItems().length, 1);
  fireEvent.click(freeItems()[0]!);
  assert.deepEqual(picks, ["/uz/titul"]);
});

/* ───────────── «Bepul» instead of a zero price ───────────── */

test("catalogue: a free tool shows the «Bepul» badge, never «0 so'm»; a paid one keeps «N so'm dan»", () => {
  useAppStore.setState({ hydrated: true });
  signIn();
  features({});
  render(h(AppRouterContext.Provider, { value: router }, h(CreateGrid)));
  const titul = q('[data-catalogue-group] a[href="/uz/titul"]')!;
  assert.ok(titul, "Titul in the catalogue");
  assert.equal(titul.querySelector("[data-tool-price]")!.getAttribute("data-tool-price"), "free");
  assert.equal(titul.querySelector("[data-free-badge]")!.textContent, "Bepul");
  assert.ok(!/\b0\s?so['‘’]m/.test(document.body.textContent!), "no «0 so'm» anywhere in the catalogue");
  const slide = q('[data-catalogue-group] a[href="/uz/slide"]')!;
  assert.ok(!slide.querySelector("[data-free-badge]"));
  assert.match(slide.querySelector("[data-tool-price]")!.textContent!, /^3\s000 so'm dan$/);
  // Every listed tool card prints a price or the badge — exactly one of them.
  for (const p of document.querySelectorAll<HTMLElement>("[data-tool-price]")) {
    const free = p.getAttribute("data-tool-price") === "free";
    assert.equal(free, !!p.querySelector("[data-free-badge]"));
    if (!free) assert.match(p.textContent!, /so'm dan$/);
  }
});
