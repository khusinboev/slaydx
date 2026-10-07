import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { HomeFiles } from "../../components/home/HomeFiles.tsx";
import { useAppStore } from "../../lib/store.ts";
import * as api from "../../lib/api-client.ts";

/**
 * «Mening fayllarim» (C09 klient qismi, W2-E):
 *   • FE-12 — ro'yxat pollingi 3 s da qotib qolmaydi: oraliq o'sadi, yashirin
 *     yorliqda so'rov yo'q, ko'ringanda darhol so'raladi;
 *   • FE-08 — server sahifalaydi (standart 50) → «Yana ko'rsatish» `nextCursor`
 *     bilan eski hujjatlarni ochadi;
 *   • W2-D2 retention — fayli o'chirilgan hujjat kartasida eskiz so'ralmaydi.
 */

const realFetch = globalThis.fetch;
let hidden = false;
Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  hidden = false;
});

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function row(id: string, patch: Record<string, unknown> = {}): api.ServerGeneration {
  return {
    id,
    type: "referat",
    topic: `Hujjat ${id}`,
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

/** Store ning haqiqiy `refreshGenerations` i — `mount` stub bilan almashtirganda qaytarish uchun. */
const realRefresh = useAppStore.getState().refreshGenerations;

function mount(generations: api.ServerGeneration[], refresh?: () => Promise<void>, cursor: string | null = null) {
  useAppStore.setState({
    sessionChecked: true,
    loggedIn: true,
    generations,
    generationsLoaded: true,
    generationsCursor: cursor,
    refreshGenerations: refresh ?? realRefresh,
  });
  render(
    h(
      AppRouterContext.Provider,
      { value: router },
      h(SearchParamsContext.Provider, { value: new URLSearchParams() }, h(HomeFiles)),
    ),
  );
}

/** Karta (W2: `data-file-id`) — sarlavha kartada ikki marta (nom + eskiz qatorlari) chiqadi, shuning uchun matn bilan emas. */
function card(id: string) {
  return document.querySelector(`[data-file-card][data-file-id="${id}"]`);
}

/** Soxta vaqtni `ms` ga suradi (500 ms qadamlar, har qadamda mikrovazifalar bo'shatiladi). */
async function advance(t: import("node:test").TestContext, ms: number) {
  for (let done = 0; done < ms; done += 500) {
    await act(async () => {
      t.mock.timers.tick(500);
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  }
}

test("FE-12: QUEUED bor — 60 s da ≤6 so'rov (ilgari 20: qat'iy 3 s interval)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let n = 0;
  mount([row("q1", { status: "QUEUED", step: "Navbatga qo‘yildi", progress: 0 })], async () => {
    n++;
  });
  await advance(t, 60_000);
  assert.ok(n >= 3, `polling ishlayapti (${n})`);
  assert.ok(n <= 6, `oraliq o'sadi — 60 s da ${n} so'rov`);
});

test("FE-12: yashirin yorliqda so'rov yo'q, ko'ringan zahoti darhol so'raladi", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  hidden = true;
  let n = 0;
  mount([row("q1", { status: "QUEUED", step: "Navbatga qo‘yildi", progress: 0 })], async () => {
    n++;
  });
  await advance(t, 60_000);
  assert.equal(n, 0, "yashirin yorliq serverni bosmaydi");
  hidden = false;
  await act(async () => {
    document.dispatchEvent(new window.Event("visibilitychange"));
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  assert.equal(n, 1, "ko'ringanda taymerni kutmasdan so'raladi");
});

test("FE-08: «Yana ko'rsatish» `nextCursor` bilan keyingi sahifani qo'shadi", async () => {
  const urls: string[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if (url === "/api/generations") return json(200, { generations: [row("a1")], nextCursor: "c2" });
    if (url === "/api/generations?cursor=c2") return json(200, { generations: [row("old1"), row("a1")], nextCursor: null });
    return json(404, { error: "yo'q" });
  };
  // Birinchi sahifani store o'zi oladi va `nextCursor` ni O'ZI saqlaydi (api-client da modul holati yo'q).
  useAppStore.setState({ loggedIn: true, refreshGenerations: realRefresh });
  await useAppStore.getState().refreshGenerations();
  assert.equal(useAppStore.getState().generationsCursor, "c2", "store birinchi sahifa kursorini saqlaydi");
  mount(useAppStore.getState().generations, undefined, useAppStore.getState().generationsCursor);
  const more = await waitFor(() => screen.getByRole("button", { name: "Yana ko‘rsatish" }));
  assert.ok(!card("old1"));
  await act(async () => {
    fireEvent.click(more);
  });
  await waitFor(() => assert.ok(card("old1")));
  assert.ok(urls.includes("/api/generations?cursor=c2"));
  assert.equal(document.querySelectorAll(`[data-file-card][data-file-id="a1"]`).length, 1, "takror karta yo'q");
  assert.ok(!screen.queryByRole("button", { name: "Yana ko‘rsatish" }), "oxirgi sahifadan keyin tugma yo'q");
});

test("FE-08: eski server (`nextCursor` yo'q) — tugma chiqmaydi", async () => {
  (globalThis as unknown as { fetch: unknown }).fetch = async () => json(200, { generations: [row("a1")] });
  useAppStore.setState({ loggedIn: true, refreshGenerations: realRefresh });
  await useAppStore.getState().refreshGenerations();
  assert.equal(useAppStore.getState().generationsCursor, null);
  mount(useAppStore.getState().generations, undefined, useAppStore.getState().generationsCursor);
  await waitFor(() => assert.ok(card("a1")));
  assert.ok(!screen.queryByRole("button", { name: "Yana ko‘rsatish" }));
});

test("retention: `filesPurgedAt` — eskiz so'ralmaydi, neytral belgi; boshqa karta `?v=` bilan eskiz oladi", async () => {
  (globalThis as unknown as { fetch: unknown }).fetch = async () => json(200, { generations: [] });
  mount([row("p1", { filesPurgedAt: "2026-09-01T00:00:00.000Z" }), row("k1")]);
  await waitFor(() => assert.ok(card("p1")));
  const purged = document.querySelectorAll("[data-files-purged]");
  assert.equal(purged.length, 1);
  const imgs = [...document.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? "");
  assert.ok(!imgs.some((s) => s.includes("/p1/")), "o'chgan hujjat eskizi so'ralmaydi");
  assert.ok(imgs.includes("/api/generations/k1/thumb?v=2"), `eskiz versiya bilan: ${imgs.join(",")}`);
});

test("waitTurn: `early:false` (server Retry-After) — yorliq almashtirish kutishni qisqartirmaydi; standart holda qisqartiradi", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  let strict = false;
  let loose = false;
  void api.waitTurn(10_000, undefined, { early: false }).then(() => (strict = true));
  void api.waitTurn(10_000).then(() => (loose = true));
  document.dispatchEvent(new window.Event("visibilitychange"));
  await flush();
  assert.equal(loose, true, "oddiy kutish ko'ringanda darhol tugaydi");
  assert.equal(strict, false, "Retry-After kutishi davom etadi");
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(strict, true);
});

test("FE-08: «Testlar»/«O'yinlar» bo'sh emas — har tur o'z filtrida (pro slayd → Slaydlar, infografika → Rasmlar)", async () => {
  (globalThis as unknown as { fetch: unknown }).fetch = async () => json(200, { generations: [] });
  mount([
    row("t1", { type: "test" }),
    row("g1", { type: "crossword" }),
    row("g2", { type: "flashcards" }),
    row("p1", { type: "pro-slide", format: "pptx" }),
    row("i1", { type: "infographic", format: "png" }),
    row("r1", { type: "referat" }),
  ]);
  await waitFor(() => assert.ok(card("t1")));
  const shown = () => ["t1", "g1", "g2", "p1", "i1", "r1"].filter((id) => card(id));
  const pick = async (label: string) => {
    const chip = [...document.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent === label);
    assert.ok(chip, label);
    await act(async () => {
      fireEvent.click(chip);
    });
  };
  await pick("Testlar");
  assert.deepEqual(shown(), ["t1"]);
  await pick("O'yinlar");
  assert.deepEqual(shown(), ["g1", "g2"]);
  await pick("Slaydlar");
  assert.deepEqual(shown(), ["p1"]);
  await pick("Rasmlar");
  assert.deepEqual(shown(), ["i1"]);
  await pick("Hujjatlar");
  assert.deepEqual(shown(), ["r1"], "test va o'yinlar endi «Hujjatlar» da yashirinmaydi");
});

test("W2-E: qidiruv faqat yuklangan sahifada — eskilari bor bo'lsa halol aytiladi, bo'lmasa jim", async () => {
  const { SearchDialog } = await import("../../components/overlays/SearchDialog.tsx");
  const { useUi } = await import("../../lib/ui.ts");
  const show = (cursor: string | null) => {
    useAppStore.setState({ loggedIn: true, sessionChecked: true, generations: [row("s1")], generationsCursor: cursor });
    useUi.setState({ overlay: "search" });
    render(h(AppRouterContext.Provider, { value: router }, h(SearchDialog)));
  };
  show("c2");
  const hint = document.querySelector("[data-search-partial]");
  assert.ok(hint, "serverda yana sahifa bor — ogohlantirish");
  assert.match(hint.textContent ?? "", /faqat yuklanganlar orasida/);
  cleanup();
  show(null);
  assert.ok(!document.querySelector("[data-search-partial]"), "hamma fayl yuklangan — ogohlantirish yo'q");
  useUi.setState({ overlay: null });
});

test("FE-08: har vosita turi `all` dan tashqari aniq BITTA filtrga tushadi", async () => {
  const { TOOLS } = await import("../../lib/tools.ts");
  const { FILE_FILTERS, fileFilterMatch } = await import("../../lib/ui.ts");
  for (const t of TOOLS) {
    const hits = FILE_FILTERS.filter((f) => f.id !== "all" && fileFilterMatch(f.id, t.id)).map((f) => f.id);
    assert.equal(hits.length, 1, `${t.id}: ${hits.join(",")}`);
  }
});

/* ───────────────────── redesign W2: «Ishlarim» states ───────────────────── */

function mountView(generations: api.ServerGeneration[], opts: { search?: string; loggedIn?: boolean; loaded?: boolean; checked?: boolean; cursor?: string | null } = {}) {
  useAppStore.setState({
    sessionChecked: opts.checked ?? true,
    loggedIn: opts.loggedIn ?? true,
    generations,
    generationsLoaded: opts.loaded ?? true,
    generationsCursor: opts.cursor ?? null,
    refreshGenerations: async () => {},
  });
  render(
    h(
      AppRouterContext.Provider,
      { value: router },
      h(SearchParamsContext.Provider, { value: new URLSearchParams(opts.search ?? "") }, h(HomeFiles)),
    ),
  );
}

const sectionsShown = () =>
  [...document.querySelectorAll("[data-file-group]")].map((s) => [
    s.getAttribute("data-file-group"),
    s.querySelector("h2")?.textContent ?? null,
    [...s.querySelectorAll("[data-file-card]")].map((c) => c.getAttribute("data-file-id")).join(","),
  ]);

test("W2: date sections «Bugun / Kecha / Shu hafta / Avvalroq» (Tashkent), reversed with oldest first, none when sorted by name", async (t) => {
  // Wednesday 2026-10-07 00:30 in Tashkent — still the 6th in UTC.
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-06T19:30:00Z") });
  (globalThis as unknown as { fetch: unknown }).fetch = async () => json(200, { generations: [] });
  const at = (iso: string) => ({ createdAt: iso, finishedAt: iso });
  const rows = [
    row("t1", at("2026-10-06T19:10:00Z")), // 00:10 today in Tashkent (yesterday in UTC)
    row("y1", at("2026-10-06T10:00:00Z")),
    row("w1", at("2026-10-05T03:00:00Z")), // Monday
    row("e1", at("2026-10-04T10:00:00Z")), // last Sunday
    row("e2", at("2026-08-01T10:00:00Z")),
  ];
  mountView(rows);
  assert.deepEqual(sectionsShown(), [
    ["today", "Bugun", "t1"],
    ["yesterday", "Kecha", "y1"],
    ["week", "Shu hafta", "w1"],
    ["earlier", "Avvalroq", "e1,e2"],
  ]);
  // Today's / yesterday's cards say the time, older ones the date.
  const meta = (id: string) => document.querySelector(`[data-file-id="${id}"] [data-file-meta]`)?.textContent ?? "";
  assert.equal(meta("t1"), "Referat · 00:10");
  assert.equal(meta("y1"), "Referat · 15:00");
  assert.equal(meta("e2"), "Referat · 1 avg");
  cleanup();
  mountView(rows, { search: "desc=0" });
  assert.deepEqual(sectionsShown().map((s) => s[0]), ["earlier", "week", "yesterday", "today"]);
  cleanup();
  mountView(rows, { search: "sort=name" });
  assert.deepEqual(sectionsShown(), [["all", null, "e1,e2,t1,w1,y1"]], "alphabetical, no date headings");
});

test("W2: chips — filter from the URL is pressed on open, «Hammasi · N» counts loaded files («+» when more pages exist)", async () => {
  (globalThis as unknown as { fetch: unknown }).fetch = async () => json(200, { generations: [] });
  mountView([row("a1"), row("g1", { type: "crossword" })], { search: "filter=games", cursor: "c2" });
  const chip = (id: string) => document.querySelector(`[data-filter-chip="${id}"]`) as HTMLElement;
  assert.equal(chip("games").getAttribute("aria-pressed"), "true");
  assert.equal(chip("all").getAttribute("aria-pressed"), "false");
  assert.match(chip("all").textContent ?? "", /^Hammasi\s*· 2\+$/);
  assert.equal(document.querySelector("[data-files-count]")?.textContent, "2+ ta ish");
  assert.deepEqual([...document.querySelectorAll("[data-file-card]")].map((c) => c.getAttribute("data-file-id")), ["g1"]);
  await act(async () => {
    fireEvent.click(chip("all"));
  });
  assert.equal(document.querySelectorAll("[data-file-card]").length, 2);
});

test("W2: empty states — no files → «Yangi ish yaratish» opens the «+» sheet; empty filter → «Hammasini ko'rsatish»; signed out → «Kirish»", async () => {
  const { useUi } = await import("../../lib/ui.ts");
  useUi.setState({ overlay: null });
  mountView([]);
  assert.ok(document.querySelector("[data-files-empty]"));
  const cta = screen.getByRole("button", { name: "Yangi ish yaratish" });
  assert.match(cta.className, /\bh-12\b/, "48 px CTA");
  await act(async () => {
    fireEvent.click(cta);
  });
  assert.equal(useUi.getState().overlay, "create", "the CTA opens the «+» tool sheet");
  useUi.setState({ overlay: null });
  cleanup();

  mountView([row("a1")], { search: "filter=image" });
  assert.ok(!screen.queryByRole("button", { name: "Yangi ish yaratish" }), "a filter with no match is not «no files»");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Hammasini ko‘rsatish" }));
  });
  assert.ok(document.querySelector('[data-file-id="a1"]'), "filter reset shows the files");
  cleanup();

  mountView([], { loggedIn: false });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Kirish" }));
  });
  assert.equal(useUi.getState().overlay, "login");
  useUi.setState({ overlay: null });
});

test("W2: loading — shimmering skeleton rows, no cards, no empty state", () => {
  mountView([], { checked: false });
  const sk = document.querySelector("[data-files-skeleton]");
  assert.ok(sk);
  assert.ok(sk.querySelector(".slx-shimmer"), "shimmer (stops under reduced motion via globals.css)");
  assert.ok(!document.querySelector("[data-files-empty]"));
  assert.ok(!document.querySelector("[data-file-card]"));
  assert.equal(document.querySelector("[data-files-count]")?.textContent, "Yuklanmoqda…");
  cleanup();
  mountView([], { loaded: false });
  assert.ok(document.querySelector("[data-files-skeleton]"), "signed in, list not loaded yet");
});

test("W2: a failed «Yana ko'rsatish» shows an error with «Qayta urinish», which retries and clears it", async () => {
  let fail = true;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown) => {
    if (String(input) === "/api/generations?cursor=c2") {
      return fail ? json(500, { error: "Server xatosi" }) : json(200, { generations: [row("old1")], nextCursor: null });
    }
    return json(200, { generations: [] });
  };
  mountView([row("a1")], { cursor: "c2" });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Yana ko‘rsatish" }));
  });
  const alert = await waitFor(() => {
    const el = document.querySelector("[data-files-error]");
    assert.ok(el);
    return el;
  });
  assert.equal(alert.getAttribute("role"), "alert");
  assert.ok(!card("old1"));
  fail = false;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  });
  await waitFor(() => assert.ok(card("old1"), "the retry loaded the page"));
  assert.ok(!document.querySelector("[data-files-error]"), "error cleared");
});

test("W2: short entrance stagger — ≤ 140 ms delays, motion-safe only", () => {
  (globalThis as unknown as { fetch: unknown }).fetch = async () => json(200, { generations: [] });
  mountView(Array.from({ length: 12 }, (_, i) => row(`s${i}`)));
  const items = [...document.querySelectorAll("[data-file-list] > li")] as HTMLElement[];
  assert.equal(items.length, 12);
  for (const li of items) assert.match(li.className, /^motion-safe:animate-\[slx-enter-fade_180ms/, "no animation under reduced motion");
  const delays = items.map((li) => Number.parseInt(li.style.animationDelay || "0", 10));
  assert.equal(delays[0], 0);
  assert.equal(delays[1], 20);
  assert.equal(Math.max(...delays), 140, "the tail does not wait longer");
});
