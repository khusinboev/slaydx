import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { DomlaPage } from "../../components/domla/DomlaPage.tsx";

/**
 * «Qattiqqo'l domla» page (`/uz/domla`, owner request 15): works list, price from the server, start, open defence,
 * history with grades, switched off, no Telegram, server errors.
 * Mutations (restored): price shown from a constant instead of the server -> «price»; the start POST body carrying a
 * price -> «start posts only the work id»; the history grade dropped -> «history»; the kill-switch branch removed -> «off».
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const WORKS = [
  { id: "w-1", toolId: "slide", topic: "Fotosintez", slides: 8, createdAt: "2026-10-20T10:00:00Z" },
  { id: "w-2", toolId: "pro-slide", topic: "Iqlim o'zgarishi", slides: 12, createdAt: "2026-10-18T10:00:00Z" },
];
const BASE = { enabled: true, price: 3000, telegramLinked: true, botUrl: "https://t.me/slaydx_test_bot", works: WORKS, open: null, history: [] };
const HISTORY = [
  {
    id: "h-1",
    status: "finished",
    topic: "Fotosintez",
    grade: 4,
    createdAt: "2026-10-19T10:00:00Z",
    progress: { answered: 5, total: 5 },
    results: [
      { question: "Nega yorug'lik kerak?", score: 5, verdict: "" },
      { question: "Xlorofill nima?", score: 2, verdict: "" },
    ],
    weakest: { question: "Xlorofill nima?", mistake: "Pigment ekanini aytmadingiz", ideal: "Yashil pigment." },
  },
];

type Call = { url: string; method: string; body: string | null };
function stub(state: unknown, post?: () => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const c = { url: String(input), method: (init.method ?? "GET").toUpperCase(), body: typeof init.body === "string" ? init.body : null };
    calls.push(c);
    if (c.method === "POST") return post ? post() : json(200, { ok: true, alreadyOpen: false });
    return json(200, state);
  }) as typeof fetch;
  return calls;
}
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const all = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];

test("works list, price from the server and the first work preselected", async () => {
  stub(BASE);
  render(h(DomlaPage));
  await waitFor(() => assert.ok(q("[data-domla-works]")));
  assert.match(q("[data-domla-price]")!.textContent!, /3\s000 so‘m/);
  assert.equal(all("[data-domla-work]").length, 2);
  assert.equal(all("[data-domla-work]")[0]!.getAttribute("aria-checked"), "true");
  assert.match(all("[data-domla-work]")[1]!.textContent!, /Pro slayd · 12 ta/);
  assert.ok(q("[data-domla-history-empty]"));
});

test("price follows the server (not a constant)", async () => {
  stub({ ...BASE, price: 1500 });
  render(h(DomlaPage));
  await waitFor(() => assert.match(q("[data-domla-price]")!.textContent!, /1\s500 so‘m/));
});

test("start posts only the work id, then points to the bot", async () => {
  const calls = stub(BASE);
  render(h(DomlaPage));
  await waitFor(() => assert.ok(q("[data-domla-start]")));
  fireEvent.click(all("[data-domla-work]")[1]!);
  assert.equal(all("[data-domla-work]")[1]!.getAttribute("aria-checked"), "true");
  fireEvent.click(q("[data-domla-start]")!);
  await waitFor(() => assert.ok(q("[data-domla-started]")));
  const post = calls.find((c) => c.method === "POST")!;
  assert.equal(post.url, "/api/domla");
  assert.deepEqual(JSON.parse(post.body!), { generationId: "w-2" }, "start posts only the work id");
  assert.match(q("[data-domla-started]")!.textContent!, /Boshlandi/);
  assert.equal(q("[data-domla-bot-link]")!.getAttribute("href"), "https://t.me/slaydx_test_bot");
});

test("a repeated start says nothing was charged again", async () => {
  stub(BASE, () => json(200, { ok: true, alreadyOpen: true }));
  render(h(DomlaPage));
  await waitFor(() => assert.ok(q("[data-domla-start]")));
  fireEvent.click(q("[data-domla-start]")!);
  await waitFor(() => assert.match(q("[data-domla-started]")!.textContent!, /qayta to‘lov yechilmadi/));
});

test("server refusals are shown (insufficient funds)", async () => {
  stub(BASE, () => json(402, { error: "Hisobda mablag‘ yetarli emas", code: "insufficient" }));
  render(h(DomlaPage));
  await waitFor(() => assert.ok(q("[data-domla-start]")));
  fireEvent.click(q("[data-domla-start]")!);
  await waitFor(() => assert.match(q("[data-domla-error]")!.textContent!, /mablag‘ yetarli emas/));
  assert.ok(!q("[data-domla-started]"));
});

test("an open defence replaces the start card and shows the progress", async () => {
  stub({ ...BASE, open: { id: "o-1", status: "active", topic: "Fotosintez", grade: null, createdAt: "2026-10-24T10:00:00Z", progress: { answered: 2, total: 5 }, results: [], weakest: null } });
  render(h(DomlaPage));
  await waitFor(() => assert.ok(q("[data-domla-open]")));
  assert.equal(q("[data-domla-progress]")!.textContent, "2/5");
  assert.ok(!q("[data-domla-start]"));
  assert.match(q("[data-domla-open]")!.textContent!, /ovozli xabar/);
  assert.ok(q("[data-domla-bot-link]"));
});

test("history shows the grade, the questions and the weakest one with the right answer", async () => {
  stub({ ...BASE, history: HISTORY });
  render(h(DomlaPage));
  await waitFor(() => assert.ok(q("[data-domla-history]")));
  assert.equal(q("[data-domla-grade]")!.textContent, "4");
  assert.match(q("[data-domla-item]")!.textContent!, /5\/5 — Nega yorug'lik kerak\?/);
  const weak = q("[data-domla-weakest]")!.textContent!;
  assert.match(weak, /Adashgan joyingiz: Xlorofill nima\? — Pigment ekanini aytmadingiz/);
  assert.match(weak, /To‘g‘ri javob: Yashil pigment\./);
});

test("kill switch: only the notice, no start button", async () => {
  stub({ ...BASE, enabled: false });
  render(h(DomlaPage));
  await waitFor(() => assert.ok(q("[data-domla-off]")));
  assert.ok(!q("[data-domla-start]") && !q("[data-domla-works]"));
});

test("no Telegram account / no works: explained, no start", async () => {
  stub({ ...BASE, telegramLinked: false });
  render(h(DomlaPage));
  await waitFor(() => assert.ok(q("[data-domla-no-telegram]")));
  assert.ok(!q("[data-domla-start]"));
  cleanup();
  stub({ ...BASE, works: [] });
  render(h(DomlaPage));
  await waitFor(() => assert.ok(q("[data-domla-no-works]")));
  assert.ok(!q("[data-domla-start]"));
});

test("a failed load shows the error", async () => {
  globalThis.fetch = (async () => json(500, { error: "Ichki xatolik" })) as typeof fetch;
  render(h(DomlaPage));
  await waitFor(() => assert.ok(q("[data-domla-load-error]")));
});
