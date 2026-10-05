import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { HomeFiles } from "../../components/home/HomeFiles.tsx";
import { CreateGrid } from "../../components/home/CreateGrid.tsx";
import { formatFileDate } from "../../components/home/file-meta.ts";
import { filterCatalogue } from "../../components/home/catalogue-filter.ts";
import { useAppStore } from "../../lib/store.ts";
import { TOOLS, visibleToolGroups } from "../../lib/tools.ts";
import { useUi } from "../../lib/ui.ts";
import type * as api from "../../lib/api-client.ts";

/**
 * Home + catalogue on phones (docs/mobile/PLAN.md O5/O7, package P5):
 *   - phone (coarse pointer / narrow) file cards: 2 columns, title clamped to
 *     2 lines with the full text in `aria-label`, one-line «type · date» meta;
 *   - delete lives in a «⋯» sheet (confirm / cancel / phone back closes it);
 *   - sort + direction controls are 44 px and distinguishable;
 *   - `/uz/create`: group chips + search filter the tool cards.
 * Desktop (no `matchMedia`, as in jsdom) keeps the old layout — locked too.
 *
 * Mutations (each turned this file red, see the sprint report):
 *   - `PhoneFileCard` title without `line-clamp-2`;
 *   - `FileMenu` confirm without the double-tap guard;
 *   - `FileMenu` not using `useDialog` (back would leave the page);
 *   - `filterCatalogue` ignoring the group / matching only the title;
 *   - chips h-11 → h-9.
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

test("desktop: no matchMedia → old card (truncate title, inline trash button), no phone markers", () => {
  mountHome([row("a1")]);
  assert.ok(!document.querySelector("[data-card-layout]"), "phone card must not render on desktop");
  assert.ok(document.querySelector(`[aria-label="${LONG} a1 — o'chirish"]`), "inline trash button kept on desktop");
  assert.ok(document.querySelector(".truncate"), "desktop title still single-line truncated");
  assert.ok(!document.querySelector("[data-file-more]"));
});

test("phone: 2-column cards, title clamped to 2 lines with the full text in aria-label, one-line meta", () => {
  phoneMedia(true);
  mountHome([row("a1"), row("a2", { type: "pro-slide", format: "pptx" })]);
  const cards = document.querySelectorAll('[data-card-layout="phone"]');
  assert.equal(cards.length, 2);
  const grid = cards[0].parentElement as HTMLElement;
  assert.match(grid.className, /grid-cols-2/, "two columns on phones");
  const title = cards[0].querySelector("[data-file-title]") as HTMLElement;
  assert.ok(title);
  assert.equal(title.getAttribute("data-clamp"), "2");
  assert.match(title.className, /line-clamp-2/, "title clamped to two lines");
  assert.doesNotMatch(title.className, /\btruncate\b/, "no single-line truncate on phones");
  assert.equal(title.getAttribute("aria-label"), `${LONG} a1`, "full title for assistive tech");
  assert.equal(title.textContent, `${LONG} a1`, "full text stays in the DOM (CSS clamps it)");
  const meta = cards[0].querySelector("[data-file-meta]") as HTMLElement;
  assert.match(meta.textContent ?? "", /^Referat · \d{1,2} (yan|fev|mar|apr|may|iyn|iyl|avg|sen|okt|noy|dek)/, meta.textContent ?? "");
  assert.match(meta.className, /\btruncate\b/, "meta stays on one line");
  assert.ok(!meta.querySelector("br"));
  // delete is not a loose 24 px icon next to the title any more
  assert.ok(!document.querySelector(`[aria-label$="— o'chirish"]`));
  const more = cards[0].querySelector("[data-file-more]") as HTMLElement;
  assert.ok(more);
  assert.match(more.className, /\bsize-11\b/, "44 px hit area");
});

test("phone: a running file shows its step in the meta line instead of a date", () => {
  phoneMedia(true);
  mountHome([row("q1", { status: "QUEUED", step: "Navbatga qo‘yildi", progress: 0 })]);
  assert.match(document.querySelector("[data-file-meta]")?.textContent ?? "", /Navbatga qo‘yildi/);
});

test("formatFileDate: short Uzbek month, year only when it differs, invalid → empty", () => {
  const now = new Date(2026, 9, 5, 12);
  assert.equal(formatFileDate(new Date(2026, 8, 20, 12).toISOString(), now), "20 sen");
  assert.equal(formatFileDate(new Date(2025, 0, 3, 12).toISOString(), now), "3 yan 2025");
  assert.equal(formatFileDate("not-a-date", now), "");
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

test("phone: sort and direction controls are 44 px, named, and not the same icon; filter select is 44 px / 16 px", async () => {
  phoneMedia(true);
  mountHome([row("a1")]);
  const sort = screen.getByRole("button", { name: /^Saralash: / });
  assert.match(sort.className, /\bh-11\b/);
  const dir = screen.getByRole("button", { name: /^Tartib: yangisi birinchi/ });
  assert.match(dir.className, /\bsize-11\b/);
  const sortSvg = sort.querySelector("svg")?.getAttribute("class") ?? "";
  const dirSvg = dir.querySelector("svg")?.getAttribute("class") ?? "";
  assert.notEqual(sortSvg.match(/lucide-[\w-]+/)?.[0], dirSvg.match(/lucide-[\w-]+/)?.[0], "two different icons");
  await act(async () => {
    fireEvent.click(dir);
  });
  assert.ok(screen.getByRole("button", { name: /^Tartib: eskisi birinchi/ }), "name follows the state");
  const select = document.querySelector("select") as HTMLElement;
  assert.match(select.className, /\bh-11\b/);
  assert.match(select.className, /\btext-base\b/, "16 px, no iOS zoom");
  await act(async () => {
    fireEvent.click(sort);
  });
  const items = screen.getAllByRole("menuitemradio");
  assert.equal(items.length, 3);
  for (const it of items) assert.match(it.className, /\bmin-h-11\b/);
});

test("desktop: sort/direction keep their 40 px size", () => {
  mountHome([row("a1")]);
  assert.match(screen.getByRole("button", { name: /^Saralash: / }).className, /\bh-10\b/);
  assert.match(screen.getByRole("button", { name: /^Tartib: yangisi birinchi/ }).className, /\bsize-10\b/);
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
