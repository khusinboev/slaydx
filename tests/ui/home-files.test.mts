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

function mount(generations: api.ServerGeneration[], refresh?: () => Promise<void>) {
  useAppStore.setState({
    sessionChecked: true,
    loggedIn: true,
    generations,
    generationsLoaded: true,
    ...(refresh ? { refreshGenerations: refresh } : {}),
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
  // Store birinchi sahifani shu funksiya orqali oladi — kursor eslab qolinadi.
  const first = await api.listGenerations();
  mount(first.generations);
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
  const first = await api.listGenerations();
  mount(first.generations);
  await waitFor(() => assert.ok(card("a1")));
  assert.ok(!screen.queryByRole("button", { name: "Yana ko‘rsatish" }));
});

test("retention: `filesPurgedAt` — eskiz so'ralmaydi, neytral belgi; boshqa karta `?v=` bilan eskiz oladi", async () => {
  (globalThis as unknown as { fetch: unknown }).fetch = async () => json(200, { generations: [] });
  await api.listGenerations();
  mount([row("p1", { filesPurgedAt: "2026-09-01T00:00:00.000Z" }), row("k1")]);
  await waitFor(() => assert.ok(card("p1")));
  const purged = document.querySelectorAll("[data-files-purged]");
  assert.equal(purged.length, 1);
  const imgs = [...document.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? "");
  assert.ok(!imgs.some((s) => s.includes("/p1/")), "o'chgan hujjat eskizi so'ralmaydi");
  assert.ok(imgs.includes("/api/generations/k1/thumb?v=2"), `eskiz versiya bilan: ${imgs.join(",")}`);
});
