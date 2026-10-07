import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { HomeFiles } from "../../components/home/HomeFiles.tsx";
import { CreateGrid } from "../../components/home/CreateGrid.tsx";
import { fileDateGroup, fileStatusPill, formatFileDate, formatFileWhen, groupFilesByDate } from "../../components/home/file-meta.ts";
import { filterCatalogue } from "../../components/home/catalogue-filter.ts";
import { useAppStore } from "../../lib/store.ts";
import { TOOLS, visibleToolGroups } from "../../lib/tools.ts";
import { useUi } from "../../lib/ui.ts";
import type * as api from "../../lib/api-client.ts";

/**
 * «Ishlarim» (`/uz/files`, redesign W2 — before: docs/mobile/PLAN.md O5/O7, P5)
 * + the `/uz/create` catalogue:
 *   - one responsive file card (list row below md, grid card from md): title
 *     clamped to 2 lines with the full text in `aria-label`, status pill,
 *     one-line «kind · when» meta, 44 px «⋯»;
 *   - date sections «Bugun / Kecha / Shu hafta / Avvalroq» in Tashkent time;
 *   - delete lives in the «⋯» sheet (confirm / cancel / phone back closes it);
 *   - header search + sort (44 px), sort menu with honest directions, chips row;
 *   - `/uz/create`: group chips + search filter the tool cards.
 *
 * Mutations (each turned this file red, see the sprint reports):
 *   - `PhoneFileCard` title without `line-clamp-2`;
 *   - `FileMenu` confirm without the double-tap guard;
 *   - `FileMenu` not using `useDialog` (back would leave the page);
 *   - `filterCatalogue` ignoring the group / matching only the title;
 *   - chips h-11 → h-9;
 *   - W2: Tashkent offset dropped (machine zone), Monday rule → Sunday, the
 *     «created» direction mapping un-inverted, progress not clamped to 99,
 *     chips row `overflow-x-auto` → `flex-wrap`.
 */

const realFetch = globalThis.fetch;
const win = window as unknown as { matchMedia?: unknown };

function phoneMedia(on: boolean) {
  if (!on) {
    delete win.matchMedia;
    return;
  }
  win.matchMedia = (q: string) => ({
    matches: true,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  phoneMedia(false);
  useUi.setState({ overlay: null, returnTo: null });
});

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const LONG = "Oliy ta’limda adaptiv o‘qitish tizimlarini joriy etish va ularning samaradorligini baholash";

function row(id: string, patch: Record<string, unknown> = {}): api.ServerGeneration {
  return {
    id,
    type: "referat",
    topic: `${LONG} ${id}`,
    status: "COMPLETED",
    createdAt: "2026-09-20T08:00:00.000Z",
    finishedAt: "2026-09-20T08:05:00.000Z",
    price: 3000,
    fileName: "r.docx",
    format: "docx",
    progress: 100,
    step: "Tayyor",
    expiresAt: null,
    error: null,
    preview: { lines: ["Kirish"] },
    fileVersion: 2,
    ...patch,
  } as api.ServerGeneration;
}

function mountHome(generations: api.ServerGeneration[]) {
  useAppStore.setState({
    sessionChecked: true,
    loggedIn: true,
    generations,
    generationsLoaded: true,
    generationsCursor: null,
  });
  render(
    h(
      AppRouterContext.Provider,
      { value: router },
      h(SearchParamsContext.Provider, { value: new URLSearchParams() }, h(HomeFiles)),
    ),
  );
}

const sleep = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const dialog = () => document.querySelector("[data-file-menu]");

/* ───────────────────────────── cards ───────────────────────────── */

/*
 * Redesign W2 (before → after): the phone card (2-column grid, coarse pointer
 * only) and the desktop card (truncate title + inline trash) became ONE
 * responsive card on every size — a list row below `md`, a grid card from
 * `md` — with the «⋯» menu everywhere. The phone assertions keep their
 * strength and now hold on every screen.
 */
test("every size: one responsive card — list row below md, grid card from md; «⋯» menu, no inline trash", () => {
  mountHome([row("a1")]);
  const card = document.querySelector("[data-file-card]") as HTMLElement;
  assert.ok(card, "card rendered without matchMedia (desktop / SSR)");
  assert.match(card.className, /(^|\s)flex(\s|$)/, "a row below md");
  assert.match(card.className, /\bmd:flex-col\b/, "a stacked grid card from md");
  const thumb = card.querySelector("[data-file-thumb]") as HTMLElement;
  assert.match(thumb.className, /\bw-\[104px\]/, "thumbnail on the left of the row");
  assert.match(thumb.className, /\bmd:w-full\b/, "full-width thumbnail on the grid card");
  assert.match(thumb.className, /\baspect-video\b/, "16:9 box — the slide thumbnail fills it exactly");
  const list = card.closest("[data-file-list]") as HTMLElement;
  assert.match(list.className, /\bgrid-cols-1\b/, "one column (list) on phones");
  assert.match(list.className, /\bmd:grid-cols-3\b/, "grid on wide screens");
  assert.ok(!document.querySelector(`[aria-label$="— o'chirish"]`), "no loose trash button next to the title");
  assert.ok(card.querySelector("[data-file-more]"), "«⋯» on desktop too");
});

test("card: title clamped to 2 lines with the full text in aria-label, stretched over the card; one-line meta; 44 px «⋯»", () => {
  phoneMedia(true);
  mountHome([row("a1"), row("a2", { type: "pro-slide", format: "pptx" })]);
  const cards = document.querySelectorAll("[data-file-card]");
  assert.equal(cards.length, 2);
  const title = cards[0].querySelector("[data-file-title]") as HTMLElement;
  assert.ok(title);
  assert.equal(title.getAttribute("data-clamp"), "2");
  assert.match(title.className, /line-clamp-2/, "title clamped to two lines");
  assert.doesNotMatch(title.className, /\btruncate\b/, "no single-line truncate");
  // `line-clamp-N` is `display:-webkit-box`; any other display utility silently disables the clamp
  // (found in the Chromium smoke: a stray `block` showed all 5 lines).
  assert.doesNotMatch(title.className, /(^|\s)(block|flex|inline|inline-block|inline-flex|grid)(\s|$)/, "display utility would break the clamp");
  assert.match(title.className, /after:absolute after:inset-0/, "the title link covers the whole card (one big target)");
  assert.equal(title.getAttribute("aria-label"), `${LONG} a1`, "full title for assistive tech");
  assert.equal(title.textContent, `${LONG} a1`, "full text stays in the DOM (CSS clamps it)");
  assert.equal(title.getAttribute("href"), "/uz/files/a1");
  const meta = cards[0].querySelector("[data-file-meta]") as HTMLElement;
  assert.match(meta.textContent ?? "", /^Referat · \d{1,2} (yan|fev|mar|apr|may|iyn|iyl|avg|sen|okt|noy|dek)/, meta.textContent ?? "");
  assert.match(meta.className, /\btruncate\b/, "meta stays on one line");
  assert.ok(!meta.querySelector("br"));
  assert.ok(!document.querySelector(`[aria-label$="— o'chirish"]`));
  const more = cards[0].querySelector("[data-file-more]") as HTMLElement;
  assert.ok(more);
  assert.match(more.className, /\bsize-11\b/, "44 px hit area");
  assert.match(more.className, /\bz-10\b/, "above the stretched title link");
});

test("card: a running file shows its step in the meta line instead of a date, and a progress pill", () => {
  phoneMedia(true);
  mountHome([
    row("q1", { status: "QUEUED", step: "Navbatga qo‘yildi", progress: 0 }),
    row("r1", { status: "IN_PROGRESS", step: "Matn · 3/12 slayd", progress: 41.6, finishedAt: undefined }),
  ]);
  const metaOf = (id: string) => document.querySelector(`[data-file-id="${id}"] [data-file-meta]`)?.textContent ?? "";
  const pillOf = (id: string) => document.querySelector(`[data-file-id="${id}"] [data-status-pill]`)?.textContent ?? "";
  assert.match(metaOf("q1"), /Navbatga qo‘yildi/);
  assert.equal(pillOf("q1"), "Navbatda");
  assert.match(metaOf("r1"), /^Referat · Matn · 3\/12 slayd$/);
  assert.equal(pillOf("r1"), "Yozilmoqda 42%");
});

test("formatFileDate: short Uzbek month, year only when it differs, invalid → empty; Tashkent day, not the machine's", () => {
  const now = new Date(2026, 9, 5, 12);
  assert.equal(formatFileDate(new Date(2026, 8, 20, 12).toISOString(), now), "20 sen");
  assert.equal(formatFileDate(new Date(2025, 0, 3, 12).toISOString(), now), "3 yan 2025");
  assert.equal(formatFileDate("not-a-date", now), "");
  // 20:30 UTC on the 20th is 01:30 on the 21st in Tashkent (UTC+5).
  assert.equal(formatFileDate("2026-09-20T20:30:00Z", new Date("2026-10-05T07:00:00Z")), "21 sen");
  // New Year in Tashkent comes 5 h before UTC's.
  assert.equal(formatFileDate("2025-12-31T19:30:00Z", new Date("2026-03-01T07:00:00Z")), "1 yan");
});

/* ─────────────────────── date sections, status pills (pure) ─────────────────────── */

// Wednesday 2026-10-07, 12:00 in Tashkent.
const WED = new Date("2026-10-07T07:00:00Z");

test("fileDateGroup: Bugun / Kecha / Shu hafta (Monday-based) / Avvalroq by the Tashkent calendar day", () => {
  assert.equal(fileDateGroup("2026-10-07T00:00:00Z", WED), "today", "05:00 Tashkent today");
  assert.equal(fileDateGroup("2026-10-06T19:00:00Z", WED), "today", "00:00 Tashkent today (still the 6th in UTC)");
  assert.equal(fileDateGroup("2026-10-06T18:59:00Z", WED), "yesterday", "23:59 Tashkent yesterday");
  assert.equal(fileDateGroup("2026-10-05T19:00:00Z", WED), "yesterday");
  assert.equal(fileDateGroup("2026-10-05T18:59:00Z", WED), "week", "Monday 23:59 — this week");
  assert.equal(fileDateGroup("2026-10-04T19:00:00Z", WED), "week", "Monday 00:00 — this week");
  assert.equal(fileDateGroup("2026-10-04T18:59:00Z", WED), "earlier", "Sunday 23:59 — last week");
  assert.equal(fileDateGroup("2026-10-08T05:00:00Z", WED), "today", "clock skew: the future counts as today");
  assert.equal(fileDateGroup("garbage", WED), "earlier", "never dropped");
  // On Monday nothing is «this week» except today; Sunday is «Kecha», Saturday «Avvalroq».
  const MON = new Date("2026-10-05T07:00:00Z");
  assert.equal(fileDateGroup("2026-10-04T07:00:00Z", MON), "yesterday");
  assert.equal(fileDateGroup("2026-10-03T07:00:00Z", MON), "earlier");
  // On Sunday the whole week since Monday is «Shu hafta».
  const SUN = new Date("2026-10-11T07:00:00Z");
  assert.equal(fileDateGroup("2026-10-05T07:00:00Z", SUN), "week");
  assert.equal(fileDateGroup("2026-10-04T07:00:00Z", SUN), "earlier");
  // Just after midnight in Tashkent (19:30 UTC the day before), «yesterday» is the UTC «today».
  const AFTER_MIDNIGHT = new Date("2026-10-07T19:30:00Z");
  assert.equal(fileDateGroup("2026-10-07T18:00:00Z", AFTER_MIDNIGHT), "yesterday");
});

test("groupFilesByDate: consecutive sections in the list's own order, every row exactly once, labels in Uzbek", () => {
  const rows = [
    { id: "t1", at: "2026-10-07T05:00:00Z" },
    { id: "t2", at: "2026-10-07T01:00:00Z" },
    { id: "y1", at: "2026-10-06T10:00:00Z" },
    { id: "w1", at: "2026-10-05T10:00:00Z" },
    { id: "e1", at: "2026-10-01T10:00:00Z" },
    { id: "e2", at: "2025-01-01T10:00:00Z" },
  ];
  const groups = groupFilesByDate(rows, (r) => r.at, WED);
  assert.deepEqual(
    groups.map((g) => [g.id, g.label, g.rows.map((r) => r.id).join(",")]),
    [
      ["today", "Bugun", "t1,t2"],
      ["yesterday", "Kecha", "y1"],
      ["week", "Shu hafta", "w1"],
      ["earlier", "Avvalroq", "e1,e2"],
    ],
  );
  // Oldest first: same sections, reversed — order of rows never changes.
  const asc = groupFilesByDate([...rows].reverse(), (r) => r.at, WED);
  assert.deepEqual(asc.map((g) => g.id), ["earlier", "week", "yesterday", "today"]);
  assert.deepEqual(asc.flatMap((g) => g.rows.map((r) => r.id)), [...rows].reverse().map((r) => r.id));
  assert.deepEqual(groupFilesByDate([], (r: { at: string }) => r.at, WED), []);
});

test("formatFileWhen: HH:MM (Tashkent) for today and yesterday, short date otherwise", () => {
  assert.equal(formatFileWhen("2026-10-07T05:04:00Z", WED), "10:04");
  assert.equal(formatFileWhen("2026-10-06T18:59:00Z", WED), "23:59");
  assert.equal(formatFileWhen("2026-10-05T10:00:00Z", WED), "5 okt");
  assert.equal(formatFileWhen("2025-10-05T10:00:00Z", WED), "5 okt 2025");
  assert.equal(formatFileWhen("bad", WED), "");
});

test("fileStatusPill: Tayyor / Navbatda / Yozilmoqda N% (0–99) / Xato / Bekor qilindi with their tones", () => {
  assert.deepEqual(fileStatusPill("COMPLETED", 100), { label: "Tayyor", tone: "ok" });
  assert.deepEqual(fileStatusPill("QUEUED", 0), { label: "Navbatda", tone: "run" });
  assert.deepEqual(fileStatusPill("IN_PROGRESS", 62.4), { label: "Yozilmoqda 62%", tone: "run" });
  assert.deepEqual(fileStatusPill("IN_PROGRESS", 100), { label: "Yozilmoqda 99%", tone: "run" }, "never 100 % before COMPLETED");
  assert.deepEqual(fileStatusPill("IN_PROGRESS", Number.NaN), { label: "Yozilmoqda 0%", tone: "run" });
  assert.deepEqual(fileStatusPill("IN_PROGRESS", -5), { label: "Yozilmoqda 0%", tone: "run" });
  assert.deepEqual(fileStatusPill("FAILED", 30), { label: "Xato", tone: "error" });
  assert.deepEqual(fileStatusPill("REVOKED", 0), { label: "Bekor qilindi", tone: "muted" });
});

/* ─────────────────────── overflow delete flow ─────────────────────── */

function stubDelete() {
  const calls: string[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    // Only writes count: the session refresh after a delete is a GET.
    if (init?.method && init.method !== "GET") calls.push(`${init.method} ${String(input)}`);
    return json(200, { ok: true });
  };
  return calls;
}

test("overflow: «⋯» opens a dialog; delete asks to confirm; a fast second tap does NOT delete, a deliberate one does", async () => {
  phoneMedia(true);
  const calls = stubDelete();
  mountHome([row("a1"), row("a2")]);
  assert.ok(!dialog());
  await act(async () => {
    fireEvent.click(document.querySelectorAll("[data-file-more]")[0]);
  });
  assert.ok(dialog(), "menu dialog opened");
  assert.equal(dialog()?.getAttribute("role"), "dialog");
  assert.equal(dialog()?.getAttribute("aria-modal"), "true");
  // Step 1: not deleted yet.
  await act(async () => {
    fireEvent.click(document.querySelector("[data-file-menu-delete]") as HTMLElement);
  });
  assert.ok(document.querySelector("[data-file-menu-confirm]"), "confirmation step");
  assert.equal(calls.length, 0, "opening the confirmation deletes nothing");
  // Double-tap guard: an immediate click on the confirm button is ignored.
  await act(async () => {
    fireEvent.click(document.querySelector("[data-file-menu-confirm-delete]") as HTMLElement);
  });
  assert.equal(calls.length, 0, "immediate (double-tap) confirm ignored");
  assert.ok(dialog(), "still waiting");
  await sleep(700);
  await act(async () => {
    fireEvent.click(document.querySelector("[data-file-menu-confirm-delete]") as HTMLElement);
  });
  await waitFor(() => assert.equal(calls.length, 1));
  assert.match(calls[0], /^DELETE \/api\/generations\/a1/);
  await waitFor(() => assert.ok(!dialog()), { timeout: 1500 });
  assert.equal(document.querySelectorAll("[data-file-card]").length, 1, "card removed");
});

test("overflow: «Bekor qilish» (both steps) closes without deleting", async () => {
  phoneMedia(true);
  const calls = stubDelete();
  mountHome([row("a1")]);
  await act(async () => {
    fireEvent.click(document.querySelector("[data-file-more]") as HTMLElement);
  });
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: "Bekor qilish" })[0]);
  });
  assert.ok(!dialog(), "cancel on the action list");
  await act(async () => {
    fireEvent.click(document.querySelector("[data-file-more]") as HTMLElement);
  });
  await act(async () => {
    fireEvent.click(document.querySelector("[data-file-menu-delete]") as HTMLElement);
  });
  await sleep(700);
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: "Bekor qilish" })[0]);
  });
  assert.ok(!dialog(), "cancel on the confirmation");
  assert.equal(calls.length, 0, "nothing deleted");
  assert.equal(document.querySelectorAll("[data-file-card]").length, 1);
});

test("overflow: the phone's back button closes the menu (not the page); Escape too", async () => {
  phoneMedia(true);
  const calls = stubDelete();
  const nav = await import("../../lib/nav/history.ts");
  nav.__resetNavForTests();
  window.history.pushState(null, "", "/uz");
  window.sessionStorage.clear();
  nav.installNav();
  nav.setNavRouter(router);
  mountHome([row("a1")]);
  const before = window.location.pathname;
  const depth = window.history.length;
  await act(async () => {
    fireEvent.click(document.querySelector("[data-file-more]") as HTMLElement);
  });
  assert.ok(dialog());
  assert.ok(window.history.length > depth, "the open menu owns a history entry");
  await act(async () => {
    window.history.back();
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 2));
  });
  assert.ok(!dialog(), "back closed the menu");
  assert.equal(window.location.pathname, before, "still on the same page");
  assert.equal(document.querySelectorAll("[data-file-card]").length, 1);
  // Escape
  await act(async () => {
    fireEvent.click(document.querySelector("[data-file-more]") as HTMLElement);
  });
  assert.ok(dialog());
  await act(async () => {
    fireEvent.keyDown(window, { key: "Escape" });
  });
  assert.ok(!dialog(), "Escape closes the menu");
  assert.equal(calls.length, 0);
});

/* ───────────────────────── sort / filter controls ───────────────────────── */

/*
 * Redesign W2 (before → after): the phone sort pill + separate direction
 * button + <select> filter (desktop: 40 px pills, wrapped chips) became, on
 * every size: 44 px header icon buttons (search, sort), a sort menu holding
 * both the field (3 radios) and the direction (2 radios, honest names), and
 * one horizontally scrolling row of 44 px filter chips.
 */
test("header: «Ishlarim» + count; search and sort are 44 px, named, different icons; sort menu = 3 fields + 2 directions, 44 px rows", async () => {
  mountHome([row("a1"), row("a2")]);
  assert.equal(document.querySelector("h1")?.textContent, "Ishlarim");
  assert.equal(document.querySelector("[data-files-count]")?.textContent, "2 ta ish");
  assert.ok(!document.querySelector('a[href="/uz/create"]'), "no big «Yaratish» button — the bar's «+» owns creation");
  const search = screen.getByRole("button", { name: "Qidirish" });
  const sort = screen.getByRole("button", { name: /^Saralash: Oxirgi o'zgartirilgan$/ });
  for (const b of [search, sort]) assert.match(b.className, /\bsize-11\b/, "44 px");
  const icon = (b: HTMLElement) => (b.querySelector("svg")?.getAttribute("class") ?? "").match(/lucide-[\w-]+/)?.[0];
  assert.notEqual(icon(search), icon(sort), "two different icons");
  await act(async () => {
    fireEvent.click(search);
  });
  assert.equal(useUi.getState().overlay, "search", "search opens the search dialog");
  await act(async () => {
    useUi.setState({ overlay: null });
  });
  assert.equal(sort.getAttribute("aria-expanded"), "false");
  await act(async () => {
    fireEvent.click(sort);
  });
  assert.equal(sort.getAttribute("aria-expanded"), "true");
  const items = screen.getAllByRole("menuitemradio");
  assert.deepEqual(
    items.map((i) => [i.textContent, i.getAttribute("aria-checked")]),
    [
      ["Oxirgi o'zgartirilgan", "true"],
      ["Avval yaratilgan", "false"],
      ["Nomi", "false"],
      ["Yangisi birinchi", "true"],
      ["Eskisi birinchi", "false"],
    ],
  );
  for (const it of items) assert.match(it.className, /\bmin-h-11\b/);
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Eskisi birinchi" }));
  });
  assert.ok(!screen.queryByRole("menu"), "a pick closes the menu");
  assert.ok(document.querySelector("[data-sort-button][data-sort-custom]"), "a non-default order is marked on the button");
  // Sorted by name the direction does not apply — the menu does not offer it.
  await act(async () => {
    fireEvent.click(sort);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Nomi" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Saralash: Nomi" }));
  });
  assert.deepEqual(screen.getAllByRole("menuitemradio").map((i) => i.textContent), ["Oxirgi o'zgartirilgan", "Avval yaratilgan", "Nomi"]);
  // Escape and a tap outside close it.
  await act(async () => {
    fireEvent.keyDown(window, { key: "Escape" });
  });
  assert.ok(!screen.queryByRole("menu"), "Escape");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Saralash: Nomi" }));
  });
  await act(async () => {
    fireEvent.pointerDown(document.body);
  });
  assert.ok(!screen.queryByRole("menu"), "outside tap");
});

test("«Avval yaratilgan»: the direction names stay honest (first-made first = «Eskisi birinchi»)", async () => {
  mountHome([
    row("old", { createdAt: "2026-09-01T08:00:00.000Z", finishedAt: "2026-09-01T08:05:00.000Z" }),
    row("new", { createdAt: "2026-09-20T08:00:00.000Z", finishedAt: "2026-09-20T08:05:00.000Z" }),
  ]);
  const order = () => [...document.querySelectorAll("[data-file-card]")].map((c) => c.getAttribute("data-file-id"));
  assert.deepEqual(order(), ["new", "old"], "default: newest first");
  await act(async () => {
    fireEvent.click(document.querySelector("[data-sort-button]") as HTMLElement);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Avval yaratilgan" }));
  });
  assert.deepEqual(order(), ["old", "new"]);
  await act(async () => {
    fireEvent.click(document.querySelector("[data-sort-button]") as HTMLElement);
  });
  assert.equal(screen.getByRole("menuitemradio", { name: "Eskisi birinchi" }).getAttribute("aria-checked"), "true");
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Yangisi birinchi" }));
  });
  assert.deepEqual(order(), ["new", "old"], "«Yangisi birinchi» really puts the newest first");
});

test("filter chips: one scrolling row, 44 px targets, «Hammasi · N» first, pressed state follows the filter", async () => {
  phoneMedia(true);
  mountHome([row("a1"), row("s1", { type: "slide", format: "pptx" })]);
  const box = document.querySelector("[data-filter-chips]") as HTMLElement;
  assert.match(box.className, /\boverflow-x-auto\b/, "single scrollable row");
  assert.doesNotMatch(box.className, /\bflex-wrap\b/);
  assert.ok(!document.querySelector("select"), "no <select> any more");
  const chips = [...box.querySelectorAll("button")];
  assert.deepEqual(
    chips.map((c) => c.getAttribute("data-filter-chip")),
    ["all", "slide", "docs", "image", "tests", "games"],
  );
  for (const c of chips) {
    assert.match(c.className, /\bh-11\b/, "44 px");
    assert.match(c.className, /\bflex-none\b/, "chips do not shrink — the row scrolls");
  }
  assert.match(chips[0].textContent ?? "", /^Hammasi\s*· 2$/);
  assert.equal(chips[0].getAttribute("aria-pressed"), "true");
  await act(async () => {
    fireEvent.click(chips[1]);
  });
  assert.equal(chips[1].getAttribute("aria-pressed"), "true");
  assert.equal(chips[0].getAttribute("aria-pressed"), "false");
  assert.deepEqual([...document.querySelectorAll("[data-file-card]")].map((c) => c.getAttribute("data-file-id")), ["s1"]);
});

/* ───────────────────────────── catalogue ───────────────────────────── */

const features = { llm: true, images: true, telegram: false, telegramBot: null, devLogin: false, pdf: true, payments: { click: false, payme: false } };

function mountCatalogue() {
  useAppStore.setState({ hydrated: true, sessionChecked: true, loggedIn: true, features } as never);
  render(h(AppRouterContext.Provider, { value: router }, h(CreateGrid)));
}

const sections = () => [...document.querySelectorAll("[data-catalogue-group]")].map((s) => s.getAttribute("data-catalogue-group"));
const cardsIn = (g: string) => document.querySelectorAll(`[data-catalogue-group="${g}"] a[href^="/uz/"]`).length;

test("filterCatalogue: group + words (title/description, apostrophe-insensitive); ids untouched", () => {
  const all = filterCatalogue(TOOLS, "all", "");
  assert.equal(all.length, TOOLS.length);
  const games = filterCatalogue(TOOLS, "oyinlar", "");
  assert.ok(games.length > 0 && games.every((t) => t.group === "oyinlar"));
  const rez = filterCatalogue(TOOLS, "all", "rezyume");
  assert.ok(rez.some((t) => t.id === "resume"));
  assert.ok(rez.length < TOOLS.length);
  // description match, not just the title
  const t = TOOLS.find((x) => x.description.length > 20)!;
  const word = t.description.split(/\s+/).find((w) => w.length > 6)!;
  assert.ok(filterCatalogue(TOOLS, "all", word).some((x) => x.id === t.id), "description searched");
  // group AND query together
  assert.equal(filterCatalogue(TOOLS, "oyinlar", "rezyume").length, 0);
  // curly vs straight apostrophe
  assert.deepEqual(
    filterCatalogue(TOOLS, "all", "o’qituvchi").map((x) => x.id),
    filterCatalogue(TOOLS, "all", "o'qituvchi").map((x) => x.id),
  );
  assert.equal(filterCatalogue(TOOLS, "all", "zzzzqqq").length, 0);
});

test("catalogue: chips (Hammasi + every visible group) and search; filtering hides other groups/tools", async () => {
  phoneMedia(true);
  mountCatalogue();
  const chipsBox = document.querySelector("[data-group-chips]") as HTMLElement;
  assert.ok(chipsBox);
  const chips = [...chipsBox.querySelectorAll("button")];
  assert.deepEqual(
    chips.map((c) => c.getAttribute("data-group-chip")),
    ["all", ...visibleToolGroups().map((g) => g.id)],
  );
  for (const c of chips) assert.match(c.className, /\bh-11\b/, "44 px chips on phones");
  assert.match(chipsBox.className, /overflow-x-auto/, "single scrollable row");
  assert.equal(chips[0].getAttribute("aria-pressed"), "true");
  assert.deepEqual(sections(), visibleToolGroups().map((g) => g.id));

  // group chip
  await act(async () => {
    fireEvent.click(chips.find((c) => c.getAttribute("data-group-chip") === "oyinlar")!);
  });
  assert.deepEqual(sections(), ["oyinlar"]);
  assert.equal(cardsIn("oyinlar"), TOOLS.filter((t) => t.group === "oyinlar").length);
  assert.equal(chips.find((c) => c.getAttribute("data-group-chip") === "oyinlar")!.getAttribute("aria-pressed"), "true");
  await act(async () => {
    fireEvent.click(chips[0]);
  });
  assert.equal(sections().length, visibleToolGroups().length);

  // search (16 px font via text-base, 44 px)
  const input = document.querySelector("[data-catalogue-search]") as HTMLInputElement;
  assert.match(input.className, /\btext-base\b/);
  assert.match(input.className, /\bh-11\b/);
  await act(async () => {
    fireEvent.change(input, { target: { value: "rezyume" } });
  });
  const hits = filterCatalogue(TOOLS, "all", "rezyume");
  assert.equal(document.querySelectorAll("[data-catalogue-group] a[href^='/uz/']").length, hits.length);
  assert.ok(document.querySelector("a[href='/uz/rezyume']") || document.querySelector(`a[href^="/uz/"]`), "resume card present");
  assert.ok(!document.querySelector("[data-catalogue-empty]"));

  // nothing found → message + reset
  await act(async () => {
    fireEvent.change(input, { target: { value: "zzzzqqq" } });
  });
  assert.ok(document.querySelector("[data-catalogue-empty]"));
  assert.equal(sections().length, 0);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Filtrni tozalash" }));
  });
  assert.equal(input.value, "");
  assert.equal(sections().length, visibleToolGroups().length);
});

test("catalogue: the chip bar is sticky, prices and routes of the cards are unchanged", () => {
  mountCatalogue();
  assert.match((document.querySelector("[data-catalogue-bar]") as HTMLElement).className, /\bsticky\b/);
  const links = [...document.querySelectorAll("[data-catalogue-group] a[href^='/uz/']")].map((a) => a.getAttribute("href"));
  assert.deepEqual(
    links.sort(),
    TOOLS.map((t) => `/uz/${t.slug}`).sort(),
    "every tool reachable at its own route",
  );
  assert.ok(document.body.textContent?.includes("tanga dan"));
});

/*
 * Before → after (W2): the failed/revoked word moved from the meta text into
 * the status pill (with its tone); «the preview title clears the overlaid «⋯»»
 * became «the «⋯» is not over the preview at all» (it sits beside / under it).
 */
test("PhoneFileCard: a failed or revoked file says so in its status pill; the «⋯» never covers the preview (UX review m8, m9)", async () => {
  const { render } = await import("@testing-library/react");
  const { createElement } = await import("react");
  const { PhoneFileCard } = await import("../../components/home/PhoneFileCard.tsx");
  const base = { id: "00000000-0000-4000-8000-000000000001", topic: "Kurs ishi mavzusi", format: "docx", createdAt: "2026-10-05T10:00:00Z", finishedAt: null, step: "", filesPurgedAt: null, progress: 30 };
  for (const [status, word, tone] of [["FAILED", "Xato", "error"], ["REVOKED", "Bekor qilindi", "muted"], ["COMPLETED", "Tayyor", "ok"]] as const) {
    const { container, unmount } = render(createElement(PhoneFileCard, { gen: { ...base, status } as never, tool: undefined, onMenu: () => {} }));
    const pill = container.querySelector("[data-status-pill]");
    assert.ok(pill, status);
    assert.equal(pill.textContent, word, `${status} → «${word}»`);
    assert.equal(pill.getAttribute("data-status-pill"), tone);
    assert.match(pill.className, /text-\[12\.5px\]/, "pill text ≥ 12.5 px");
    const meta = container.querySelector("[data-file-meta]");
    assert.equal(meta!.getAttribute("data-file-status"), status === "COMPLETED" ? null : status.toLowerCase());
    const thumb = container.querySelector("[data-file-thumb]")!;
    assert.ok(!thumb.querySelector("[data-file-more]"), "«⋯» is not inside the preview");
    const more = container.querySelector("[data-file-more]")!;
    assert.doesNotMatch(more.className, /\btop-/, "not pinned over the top of the card (where the preview is)");
    unmount();
  }
});
