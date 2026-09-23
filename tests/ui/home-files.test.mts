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

/** Karta (o'chirish tugmasi orqali) — sarlavha kartada ikki marta (nom + eskiz qatorlari) chiqadi. */
function card(id: string) {
  return document.querySelector(`[aria-label="Hujjat ${id} — o'chirish"]`);
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
  assert.equal(document.querySelectorAll(`[aria-label="Hujjat a1 — o'chirish"]`).length, 1, "takror karta yo'q");
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

test("FE-08: har vosita turi `all` dan tashqari aniq BITTA filtrga tushadi", async () => {
  const { TOOLS } = await import("../../lib/tools.ts");
  const { FILE_FILTERS, fileFilterMatch } = await import("../../lib/ui.ts");
  for (const t of TOOLS) {
    const hits = FILE_FILTERS.filter((f) => f.id !== "all" && fileFilterMatch(f.id, t.id)).map((f) => f.id);
    assert.equal(hits.length, 1, `${t.id}: ${hits.join(",")}`);
  }
});
