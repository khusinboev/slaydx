import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { TestsPage } from "../../components/tests/TestsPage.tsx";

/**
 * «Test ishlash» page (`/uz/tests`, owner request 7): subject list with the server's price, the start request (no price),
 * the question screen (image / text, A-D, progress, timer, «Keyingi» / «Tugatish»), the result (score, correctness, the
 * correct letter, explanation), the history, the open attempt, the kill switch and the server's refusals.
 * Mutations (restored): the start POST carrying a price -> «start posts only the mode, subject and key»; the page showing a
 * correct letter while the attempt runs -> «no answer key on the running screen»; the finish button enabled before a choice
 * -> «Keyingi / Tugatish wait for a choice»; the timer ignoring the deadline -> «the timer finishes the attempt at the server deadline»;
 * the analysis rendered for a correct answer too -> «analysis: skeleton first, then the text»; the poll stopped after the first
 * answer -> same test; the retry posting without `retry=1` -> «analysis failed: a short notice and a retry».
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const all = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];

const OV = {
  enabled: true,
  prices: { subject: 1500, all: 4000 },
  firstFree: false,
  pointsPerCorrect: 1.1,
  subjects: [
    { code: "math", name: "Matematika", questions: 10, minutes: 20, available: true },
    { code: "ona_tili", name: "Ona tili", questions: 10, minutes: 20, available: true },
    { code: "tarix", name: "Tarix", questions: 10, minutes: 20, available: true },
  ],
  all: { questions: 30, minutes: 60, available: true },
  open: null as null | { id: string; mode: "subject"; subject: string; deadlineAt: string },
  history: [] as unknown[],
};
const QUESTIONS = [
  { id: 11, position: 1, subject: "Matematika", text: null, options: null, imageUrl: "/api/tests/attempts/A1/image/11", hasFigure: false },
  { id: 12, position: 2, subject: "Matematika", text: "2 + 2 nechaga teng?", options: ["3", "4", "5", "6"], imageUrl: null, hasFigure: false },
  { id: 13, position: 3, subject: "Matematika", text: "3 x 3?", options: ["6", "7", "8", "9"], imageUrl: null, hasFigure: false },
];
const activeView = (deadlineMs = 20 * 60_000, extra: Record<string, unknown> = {}) => ({
  state: "active",
  id: "A1",
  mode: "subject",
  subject: "Matematika",
  total: 3,
  startedAt: new Date().toISOString(),
  deadlineAt: new Date(Date.now() + deadlineMs).toISOString(),
  serverNow: new Date().toISOString(),
  questions: QUESTIONS,
  answers: {},
  ...extra,
});
const FINISHED = {
  state: "finished",
  id: "A1",
  mode: "subject",
  subject: "Matematika",
  total: 3,
  correct: 2,
  score: 2.2,
  pointsPerCorrect: 1.1,
  reason: "manual",
  bySubject: [{ subject: "Matematika", correct: 2, total: 3 }],
  review: [
    { id: 11, position: 1, subject: "Matematika", text: null, options: null, imageUrl: "/api/tests/attempts/A1/image/11", hasFigure: false, chosen: 0, chosenLetter: "A", correct: 0, correctLetter: "A", isCorrect: true, explanation: null },
    { id: 12, position: 2, subject: "Matematika", text: "2 + 2 nechaga teng?", options: ["3", "4", "5", "6"], imageUrl: null, hasFigure: false, chosen: 2, chosenLetter: "C", correct: 1, correctLetter: "B", isCorrect: false, explanation: "Ikkita ikkini qo'shsak to'rt chiqadi." },
    { id: 13, position: 3, subject: "Matematika", text: "3 x 3?", options: ["6", "7", "8", "9"], imageUrl: null, hasFigure: false, chosen: 3, chosenLetter: "D", correct: 3, correctLetter: "D", isCorrect: true, explanation: null },
  ],
};

const READY_12 = { questionId: 12, position: 2, status: "ready", correctLetter: "B", chosenLetter: "C", explanation: "2 + 2 = 4, demak B.", chosenWhy: "5 — bitta ortiq." };

type Call = { url: string; method: string; body: string | null };
type Routes = Partial<Record<string, (c: Call) => Response>>;
/** Routes keyed `METHOD /path`; anything unlisted fails the test. */
function stub(routes: Routes): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const c = { url: String(input), method: (init.method ?? "GET").toUpperCase(), body: typeof init.body === "string" ? init.body : null };
    calls.push(c);
    const fn = routes[`${c.method} ${c.url}`];
    if (!fn) throw new Error(`unexpected request ${c.method} ${c.url}`);
    return fn(c);
  }) as typeof fetch;
  return calls;
}

test("list: subjects in order, «Hammasi» 30 questions / 60 minutes, the server's price", async () => {
  stub({ "GET /api/tests": () => json(200, OV) });
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-price]")));
  assert.deepEqual(all("[data-tests-subject]").map((b) => b.dataset.testsSubject), ["math", "ona_tili", "tarix", "all"]);
  assert.match(all("[data-tests-subject]")[3]!.textContent!, /Hammasi/);
  assert.match(all("[data-tests-subject]")[3]!.textContent!, /30 ta savol · 60 daqiqa/);
  assert.match(all("[data-tests-subject]")[0]!.textContent!, /10 ta savol · 20 daqiqa/);
  assert.match(q("[data-tests-price]")!.textContent!, /1\s500 so‘m/, "a subject is picked: the one-subject price");
  assert.equal(all("[data-tests-subject]")[0]!.getAttribute("aria-checked"), "true", "the first subject is preselected");
  assert.match(q("[data-tests-rules]")!.textContent!, /1,1 ball/);
  assert.ok(q("[data-tests-history-empty]"));
});

test("price by mode: each option shows its price, the header follows the picked mode", async () => {
  stub({ "GET /api/tests": () => json(200, OV) });
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-price]")));
  const opt = all("[data-tests-option-price]").map((e) => e.textContent!.replace(/\s/g, " "));
  assert.deepEqual(opt, ["1 500 so‘m", "1 500 so‘m", "1 500 so‘m", "4 000 so‘m"]);
  fireEvent.click(q('[data-tests-subject="all"]')!);
  assert.match(q("[data-tests-price]")!.textContent!, /4\s000 so‘m/, "«Hammasi» picked: the all-subjects price");
  fireEvent.click(q('[data-tests-subject="tarix"]')!);
  assert.match(q("[data-tests-price]")!.textContent!, /1\s500 so‘m/);
  assert.match(q("[data-tests-rules]")!.textContent!, /AI tahlili/);
});

test("price follows the server: custom, free first attempt, free", async () => {
  stub({ "GET /api/tests": () => json(200, { ...OV, prices: { subject: 700, all: 2500 } }) });
  render(h(TestsPage));
  await waitFor(() => assert.match(q("[data-tests-price]")!.textContent!, /700 so‘m/));
  fireEvent.click(q('[data-tests-subject="all"]')!);
  assert.match(q("[data-tests-price]")!.textContent!, /2\s500 so‘m/);
  cleanup();
  stub({ "GET /api/tests": () => json(200, { ...OV, firstFree: true }) });
  render(h(TestsPage));
  await waitFor(() => assert.match(q("[data-tests-price]")!.textContent!, /Birinchi urinish bepul/));
  cleanup();
  stub({ "GET /api/tests": () => json(200, { ...OV, prices: { subject: 0, all: 0 } }) });
  render(h(TestsPage));
  await waitFor(() => assert.equal(q("[data-tests-price]")!.textContent, "Bepul"));
});

test("start posts only the mode, subject and key -- then the first question shows", async () => {
  const calls = stub({
    "GET /api/tests": () => json(200, OV),
    "POST /api/tests/start": () => json(200, { ok: true, attemptId: "A1", alreadyOpen: false, price: 1500 }),
    "GET /api/tests/attempts/A1": () => json(200, activeView()),
  });
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-start]")));
  fireEvent.click(all("[data-tests-subject]")[1]!);
  assert.equal(all("[data-tests-subject]")[1]!.getAttribute("aria-checked"), "true");
  fireEvent.click(q("[data-tests-start]")!);
  await waitFor(() => assert.ok(q("[data-tests-run]")));
  const post = calls.find((c) => c.method === "POST")!;
  const body = JSON.parse(post.body!) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["key", "mode", "subject"], "start posts only the mode, subject and key");
  assert.equal(body.mode, "subject");
  assert.equal(body.subject, "ona_tili");
  assert.match(String(body.key), /^[A-Za-z0-9_-]{8,64}$/);
  assert.equal(q("[data-tests-progress]")!.textContent, "1 / 3");
  assert.match(q("[data-tests-timer]")!.textContent!, /^(19:5\d|20:00)$/);
});

test("«Hammasi» starts mode all without a subject", async () => {
  const calls = stub({
    "GET /api/tests": () => json(200, OV),
    "POST /api/tests/start": () => json(200, { ok: true, attemptId: "A1" }),
    "GET /api/tests/attempts/A1": () => json(200, activeView()),
  });
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-start]")));
  fireEvent.click(q('[data-tests-subject="all"]')!);
  fireEvent.click(q("[data-tests-start]")!);
  await waitFor(() => assert.ok(q("[data-tests-run]")));
  const body = JSON.parse(calls.find((c) => c.method === "POST")!.body!) as Record<string, unknown>;
  assert.equal(body.mode, "all");
  assert.ok(!("subject" in body));
});

test("question flow: image question, text question, Keyingi / Tugatish wait for a choice, no answer key on the running screen", async () => {
  const calls = stub({
    "GET /api/tests": () => json(200, OV),
    "POST /api/tests/start": () => json(200, { ok: true, attemptId: "A1" }),
    "GET /api/tests/attempts/A1": () => json(200, activeView()),
    "POST /api/tests/attempts/A1/answer": () => json(200, { ok: true, answered: 1 }),
    "POST /api/tests/attempts/A1/finish": () => json(200, FINISHED),
    "GET /api/tests/attempts/A1/analysis": () => json(200, { attemptId: "A1", done: true, items: [READY_12] }),
  });
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-start]")));
  fireEvent.click(q("[data-tests-start]")!);
  await waitFor(() => assert.ok(q("[data-tests-run]")));
  assert.ok(!calls.some((c) => c.url.includes("/analysis")), "no analysis request while the attempt runs");

  // 1: image-only -- lazy image, letters only.
  const img = q("[data-tests-image]") as HTMLImageElement;
  assert.equal(img.getAttribute("loading"), "lazy");
  assert.equal(img.getAttribute("src"), "/api/tests/attempts/A1/image/11");
  assert.deepEqual(all("[data-tests-choice]").map((b) => b.textContent), ["A", "B", "C", "D"]);
  assert.ok((q("[data-tests-next]") as HTMLButtonElement).disabled, "Keyingi waits for a choice");
  fireEvent.click(q('[data-tests-choice="A"]')!);
  await waitFor(() => assert.equal(q('[data-tests-choice="A"]')!.getAttribute("aria-checked"), "true"));
  assert.deepEqual(JSON.parse(calls.find((c) => c.url.endsWith("/answer"))!.body!), { questionId: 11, choice: 0 });
  assert.ok(!(q("[data-tests-next]") as HTMLButtonElement).disabled);
  fireEvent.click(q("[data-tests-next]")!);

  // 2: text question -- the option texts next to the letters.
  await waitFor(() => assert.equal(q("[data-tests-progress]")!.textContent, "2 / 3"));
  assert.equal(q("[data-tests-text]")!.textContent, "2 + 2 nechaga teng?");
  assert.match(all("[data-tests-choice]")[1]!.textContent!, /B\.\s*4/);
  assert.ok(!q("[data-tests-image]"));
  fireEvent.click(q('[data-tests-choice="C"]')!);
  await waitFor(() => assert.equal(q('[data-tests-choice="C"]')!.getAttribute("aria-checked"), "true"));
  assert.ok(!q("[data-tests-correct-letter]") && !q("[data-tests-explanation]"), "no answer key on the running screen");
  fireEvent.click(q("[data-tests-next]")!);

  // 3: the last one -- «Tugatish» instead of «Keyingi», disabled until a choice.
  await waitFor(() => assert.equal(q("[data-tests-progress]")!.textContent, "3 / 3"));
  assert.ok(!q("[data-tests-next]"));
  assert.ok((q("[data-tests-finish]") as HTMLButtonElement).disabled, "Tugatish waits for a choice");
  fireEvent.click(q('[data-tests-choice="D"]')!);
  await waitFor(() => assert.ok(!(q("[data-tests-finish]") as HTMLButtonElement).disabled));
  fireEvent.click(q("[data-tests-finish]")!);

  // Result.
  await waitFor(() => assert.ok(q("[data-tests-result]")));
  assert.match(q("[data-tests-score]")!.textContent!, /^2,2\s*ball/);
  assert.match(q("[data-tests-correct-count]")!.textContent!, /2 \/ 3 ta to‘g‘ri/);
  const items = all("[data-tests-review-item]");
  assert.deepEqual(items.map((i) => i.dataset.correct), ["true", "false", "true"]);
  assert.equal(items[1]!.querySelector("[data-tests-correct-letter]")!.textContent, "B");
  assert.equal(items[1]!.querySelector("[data-tests-chosen-letter]")!.textContent, "C");
  // A text question shows its four options in the review: the correct one marked, the user's wrong pick marked.
  const rows = [...items[1]!.querySelectorAll<HTMLElement>("[data-tests-review-options] [data-option]")];
  assert.deepEqual(rows.map((r) => [r.dataset.option, r.dataset.state]), [["A", "plain"], ["B", "correct"], ["C", "wrong"], ["D", "plain"]]);
  assert.match(rows[1]!.textContent!, /B\.\s*4.*To‘g‘ri/);
  assert.match(rows[2]!.textContent!, /C\.\s*5.*Sizniki/);
  assert.ok(!items[0]!.querySelector("[data-tests-review-options]"), "an image-only question has no option rows");
  assert.match(items[1]!.querySelector("[data-tests-explanation]")!.textContent!, /to'rt chiqadi/);
  assert.ok(!items[0]!.querySelector("[data-tests-explanation]"), "an explanation only where one exists");
  assert.ok(items[0]!.querySelector("[data-tests-image]"), "image questions keep their image in the review");
  assert.ok(!q("[data-tests-timeout]"));
  await waitFor(() => assert.ok(items[1]!.querySelector('[data-tests-analysis="ready"]')));
  assert.ok(!items[0]!.querySelector("[data-tests-analysis]") && !items[2]!.querySelector("[data-tests-analysis]"), "no analysis for a correct answer");
});

test("analysis: skeleton first, then the text (polled while pending); the result never waits for it", async () => {
  let n = 0;
  stub({
    "GET /api/tests": () => json(200, { ...OV, history: [{ id: "A1", mode: "subject", subject: "Matematika", status: "finished", total: 3, correct: 2, score: 2.2, startedAt: "2026-10-20T10:00:00Z" }] }),
    "GET /api/tests/attempts/A1": () => json(200, FINISHED),
    "GET /api/tests/attempts/A1/analysis": () => {
      n++;
      return json(200, n === 1 ? { attemptId: "A1", done: false, items: [{ ...READY_12, status: "pending", explanation: null, chosenWhy: null }] } : { attemptId: "A1", done: true, items: [READY_12] });
    },
  });
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-history-item]")));
  fireEvent.click(q("[data-tests-history-item]")!);
  await waitFor(() => assert.ok(q("[data-tests-result]")));
  const wrong = q('[data-tests-review-item="2"]')!;
  await waitFor(() => assert.ok(wrong.querySelector('[data-tests-analysis="pending"]'), "a skeleton while the model works"));
  assert.ok(q("[data-tests-score]"), "the score is already there");
  await waitFor(() => assert.ok(wrong.querySelector('[data-tests-analysis="ready"]')), { timeout: 5000 });
  assert.equal(n, 2, "polled once more, then stopped");
  assert.match(wrong.querySelector("[data-tests-analysis-correct]")!.textContent!, /Nega B to‘g‘ri: 2 \+ 2 = 4/);
  assert.match(wrong.querySelector("[data-tests-analysis-chosen]")!.textContent!, /Nega C xato: 5 — bitta ortiq/);
  await new Promise((r) => setTimeout(r, 3300));
  assert.equal(n, 2, "no polling after done");
});

test("analysis failed: a short notice and a retry (retry=1); a broken request never breaks the page", async () => {
  const urls: string[] = [];
  let mode: "failed" | "ready" | "error" = "failed";
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url === "/api/tests") return json(200, { ...OV, history: [{ id: "A1", mode: "subject", subject: "Matematika", status: "finished", total: 3, correct: 2, score: 2.2, startedAt: "2026-10-20T10:00:00Z" }] });
    if (url === "/api/tests/attempts/A1") return json(200, FINISHED);
    if (url.startsWith("/api/tests/attempts/A1/analysis")) {
      urls.push(url);
      if (mode === "error") return json(500, { error: "Ichki xatolik" });
      return json(200, { attemptId: "A1", done: true, items: [mode === "failed" ? { ...READY_12, status: "failed", explanation: null, chosenWhy: null } : READY_12] });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-history-item]")));
  fireEvent.click(q("[data-tests-history-item]")!);
  await waitFor(() => assert.ok(q('[data-tests-analysis="failed"]')));
  assert.match(q('[data-tests-analysis="failed"]')!.textContent!, /Tahlil hozircha tayyor emas/);
  assert.deepEqual(urls, ["/api/tests/attempts/A1/analysis"]);
  mode = "ready";
  fireEvent.click(q("[data-tests-analysis-retry]")!);
  await waitFor(() => assert.ok(q('[data-tests-analysis="ready"]')));
  assert.deepEqual(urls, ["/api/tests/attempts/A1/analysis", "/api/tests/attempts/A1/analysis?retry=1"]);

  cleanup();
  urls.length = 0;
  mode = "error";
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-history-item]")));
  fireEvent.click(q("[data-tests-history-item]")!);
  await waitFor(() => assert.ok(q('[data-tests-analysis="failed"]')));
  assert.ok(q("[data-tests-score]") && q('[data-tests-review-item="2"] [data-tests-correct-letter]'), "the result itself is intact");
  mode = "ready";
  fireEvent.click(q("[data-tests-analysis-retry]")!);
  await waitFor(() => assert.ok(q('[data-tests-analysis="ready"]')));
});

test("?attempt=<id> (the bot's result button) opens that result directly", async () => {
  window.history.replaceState(null, "", "/uz/tests?attempt=00000000-0000-4000-8000-0000000000a1");
  try {
    stub({
      "GET /api/tests": () => json(200, OV),
      "GET /api/tests/attempts/00000000-0000-4000-8000-0000000000a1": () => json(200, { ...FINISHED, id: "00000000-0000-4000-8000-0000000000a1" }),
      "GET /api/tests/attempts/00000000-0000-4000-8000-0000000000a1/analysis": () => json(200, { attemptId: "x", done: true, items: [READY_12] }),
    });
    render(h(TestsPage));
    await waitFor(() => assert.ok(q("[data-tests-result]")));
    await waitFor(() => assert.ok(q('[data-tests-analysis="ready"]')));
  } finally {
    window.history.replaceState(null, "", "/");
  }
});

test("zoom: a tap opens the image large, a second tap zooms, Esc closes", async () => {
  stub({
    "GET /api/tests": () => json(200, OV),
    "POST /api/tests/start": () => json(200, { ok: true, attemptId: "A1" }),
    "GET /api/tests/attempts/A1": () => json(200, activeView()),
  });
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-start]")));
  fireEvent.click(q("[data-tests-start]")!);
  await waitFor(() => assert.ok(q("[data-tests-zoom]")));
  assert.ok(!q("[data-tests-lightbox]"));
  fireEvent.click(q("[data-tests-zoom]")!);
  assert.ok(q("[data-tests-lightbox]"));
  const big = q("[data-tests-lightbox-image]")!;
  assert.ok(!big.getAttribute("style"));
  fireEvent.click(big);
  assert.match(q("[data-tests-lightbox-image]")!.getAttribute("style") ?? "", /200vw/);
  fireEvent.click(q("[data-tests-lightbox-image]")!);
  assert.ok(!q("[data-tests-lightbox-image]")!.getAttribute("style"));
  fireEvent.keyDown(window, { key: "Escape" });
  assert.ok(!q("[data-tests-lightbox]"));
  fireEvent.click(q("[data-tests-zoom]")!);
  fireEvent.click(q("[data-tests-lightbox-close]")!);
  assert.ok(!q("[data-tests-lightbox]"));
});

test("the timer finishes the attempt at the server deadline", async () => {
  const calls = stub({
    "GET /api/tests": () => json(200, OV),
    "POST /api/tests/start": () => json(200, { ok: true, attemptId: "A1" }),
    "GET /api/tests/attempts/A1": () => json(200, activeView(1300)),
    "POST /api/tests/attempts/A1/finish": () => json(200, { ...FINISHED, reason: "timeout" }),
  });
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-start]")));
  fireEvent.click(q("[data-tests-start]")!);
  await waitFor(() => assert.ok(q("[data-tests-run]")));
  await waitFor(() => assert.ok(q("[data-tests-result]")), { timeout: 5000 });
  assert.equal(calls.filter((c) => c.url.endsWith("/finish")).length, 1, "finished exactly once");
  assert.match(q("[data-tests-timeout]")!.textContent!, /Vaqt tugadi/);
});

test("clock skew: the timer follows the server's now, not the device clock", async () => {
  const view = activeView(10 * 60_000, { serverNow: new Date(Date.now() + 5 * 60_000).toISOString(), deadlineAt: new Date(Date.now() + 15 * 60_000).toISOString() });
  stub({
    "GET /api/tests": () => json(200, OV),
    "POST /api/tests/start": () => json(200, { ok: true, attemptId: "A1" }),
    "GET /api/tests/attempts/A1": () => json(200, view),
  });
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-start]")));
  fireEvent.click(q("[data-tests-start]")!);
  await waitFor(() => assert.ok(q("[data-tests-timer]")));
  // 15 min deadline - 5 min server lead = 10 min left, although the device clock says 15.
  assert.match(q("[data-tests-timer]")!.textContent!, /^(09:5\d|10:00)$/);
});

test("an answer refused as expired by the server ends the attempt", async () => {
  stub({
    "GET /api/tests": () => json(200, OV),
    "POST /api/tests/start": () => json(200, { ok: true, attemptId: "A1" }),
    "GET /api/tests/attempts/A1": () => json(200, activeView()),
    "POST /api/tests/attempts/A1/answer": () => json(409, { error: "Vaqt tugadi — javob hisobga olinmadi", code: "expired" }),
    "POST /api/tests/attempts/A1/finish": () => json(200, { ...FINISHED, reason: "timeout" }),
  });
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-start]")));
  fireEvent.click(q("[data-tests-start]")!);
  await waitFor(() => assert.ok(q("[data-tests-run]")));
  fireEvent.click(q('[data-tests-choice="B"]')!);
  await waitFor(() => assert.ok(q("[data-tests-result]")));
  assert.ok(q("[data-tests-timeout]"));
});

test("server refusals are shown (insufficient funds, open attempt) and a network retry reuses the key", async () => {
  let n = 0;
  const calls = stub({
    "GET /api/tests": () => json(200, OV),
    "POST /api/tests/start": () => {
      n++;
      if (n === 1) throw new Error("boom");
      return json(402, { error: "Hisobda mablag‘ yetarli emas", code: "insufficient" });
    },
  });
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-start]")));
  fireEvent.click(q("[data-tests-start]")!);
  await waitFor(() => assert.ok(q("[data-tests-error]")));
  fireEvent.click(q("[data-tests-start]")!);
  await waitFor(() => assert.match(q("[data-tests-error]")!.textContent!, /mablag‘ yetarli emas/));
  const keys = calls.filter((c) => c.method === "POST").map((c) => (JSON.parse(c.body!) as { key: string }).key);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1], "the retry after a network error reuses the idempotency key");
  assert.ok(!q("[data-tests-run]"));
});

test("an open attempt is offered instead of a new start and resumes", async () => {
  stub({
    "GET /api/tests": () => json(200, { ...OV, open: { id: "A1", mode: "subject", subject: "Matematika", deadlineAt: new Date(Date.now() + 600_000).toISOString() } }),
    "GET /api/tests/attempts/A1": () => json(200, activeView(600_000, { answers: { "11": 2 } })),
  });
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-open]")));
  assert.ok(!q("[data-tests-start]"));
  fireEvent.click(q("[data-tests-resume]")!);
  await waitFor(() => assert.ok(q("[data-tests-run]")));
  assert.equal(q('[data-tests-choice="C"]')!.getAttribute("aria-checked"), "true", "the stored choice is restored");
});

test("history: scores, and a finished attempt opens its review", async () => {
  stub({
    "GET /api/tests": () =>
      json(200, {
        ...OV,
        history: [
          { id: "A1", mode: "subject", subject: "Matematika", status: "finished", total: 3, correct: 2, score: 2.2, startedAt: "2026-10-20T10:00:00Z" },
          { id: "A0", mode: "all", subject: null, status: "finished", total: 30, correct: 0, score: 0, startedAt: "2026-10-19T10:00:00Z" },
        ],
      }),
    "GET /api/tests/attempts/A1": () => json(200, FINISHED),
  });
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-history]")));
  const items = all("[data-tests-history-item]");
  assert.match(items[0]!.textContent!, /Matematika/);
  assert.match(items[0]!.textContent!, /2,2 ball · 2\/3/);
  assert.match(items[1]!.textContent!, /Hammasi/);
  fireEvent.click(items[0]!);
  await waitFor(() => assert.ok(q("[data-tests-result]")));
  fireEvent.click(q("[data-tests-back]")!);
  await waitFor(() => assert.ok(q("[data-tests-subject]")));
});

test("kill switch: only the notice, no start", async () => {
  stub({ "GET /api/tests": () => json(200, { ...OV, enabled: false, subjects: [], all: { questions: 0, minutes: 60, available: false } }) });
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-off]")));
  assert.ok(!q("[data-tests-start]") && !q("[data-tests-subject]"));
});

test("no questions imported yet: explained, no start; a failed load shows the error", async () => {
  stub({ "GET /api/tests": () => json(200, { ...OV, subjects: [], all: { questions: 0, minutes: 60, available: false } }) });
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-none]")));
  assert.ok(!q("[data-tests-start]"));
  cleanup();
  globalThis.fetch = (async () => json(500, { error: "Ichki xatolik" })) as typeof fetch;
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-load-error]")));
});

test("an unavailable subject cannot be picked", async () => {
  stub({ "GET /api/tests": () => json(200, { ...OV, subjects: [{ ...OV.subjects[0]!, available: false }, OV.subjects[1]!, OV.subjects[2]!], all: { ...OV.all, available: false } }) });
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-start]")));
  assert.ok((q('[data-tests-subject="math"]') as HTMLButtonElement).disabled);
  assert.ok((q('[data-tests-subject="all"]') as HTMLButtonElement).disabled);
  assert.equal(q('[data-tests-subject="ona_tili"]')!.getAttribute("aria-checked"), "true", "the first AVAILABLE subject is preselected");
});

/* ───────────────────────── text questions (migration 064): text, formulas, figure, «Asl rasm» ───────────────────────── */

const IMG = (id: number) => `/api/tests/attempts/A1/image/${id}?v=abababab`;
const TEXT_QUESTIONS = [
  // 21: text only, the original screenshot behind «Asl rasm».
  { id: 21, position: 1, subject: "Matematika", text: "O‘lchamlari 2m×1m×3m bo‘lgan akvariumning hajmini toping (m³).", options: ["3", "6", "5", "4"], imageUrl: IMG(21), hasFigure: false },
  // 22: a figure: the image stays next to the text.
  { id: 22, position: 2, subject: "Matematika", text: "Jadvalda ekin maydonlari berilgan. Umumiy maydonni toping.", options: ["51", "41", "56", "45"], imageUrl: IMG(22), hasFigure: true },
  // 23: LaTeX in the stem and in an option; a multi-line option.
  { id: 23, position: 3, subject: "Matematika", text: "Hisoblang: $\\frac{1}{4}-\\frac{1}{5}+\\frac{1}{6}$", options: ["0", "1", "−1", "$\\frac{1}{5}$"], imageUrl: IMG(23), hasFigure: false },
  // 24: an image-only question next to them.
  { id: 24, position: 4, subject: "Matematika", text: null, options: null, imageUrl: IMG(24), hasFigure: false },
];
async function startTextAttempt(questions: typeof TEXT_QUESTIONS = TEXT_QUESTIONS) {
  const calls = stub({
    "GET /api/tests": () => json(200, OV),
    "POST /api/tests/start": () => json(200, { ok: true, attemptId: "A1" }),
    "GET /api/tests/attempts/A1": () => json(200, activeView(20 * 60_000, { total: questions.length, questions })),
    "POST /api/tests/attempts/A1/answer": () => json(200, { ok: true, answered: 1 }),
  });
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-start]")));
  fireEvent.click(q("[data-tests-start]")!);
  await waitFor(() => assert.ok(q("[data-tests-run]")));
  return calls;
}
const choose = async (L: string) => {
  fireEvent.click(q(`[data-tests-choice="${L}"]`)!);
  await waitFor(() => assert.equal(q(`[data-tests-choice="${L}"]`)!.getAttribute("aria-checked"), "true"));
  fireEvent.click(q("[data-tests-next]")!);
};

test("text question: the text and four tappable option rows; the image is hidden behind «Asl rasm» and comes back on demand", async () => {
  await startTextAttempt();
  assert.equal(q("[data-tests-text]")!.textContent, "O‘lchamlari 2m×1m×3m bo‘lgan akvariumning hajmini toping (m³).");
  assert.deepEqual(all("[data-tests-choice]").map((b) => b.textContent), ["A.3", "B.6", "C.5", "D.4"]);
  assert.ok(all("[data-tests-choice]").every((b) => b.getAttribute("role") === "radio"));
  assert.ok(!q("[data-tests-image]"), "text only: no image yet");
  const toggle = q("[data-tests-original]")!;
  assert.equal(toggle.textContent, "Asl rasm");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  fireEvent.click(toggle);
  assert.equal((q("[data-tests-image]") as HTMLImageElement).getAttribute("src"), IMG(21));
  assert.equal(q("[data-tests-original]")!.textContent, "Asl rasmni yashirish");
  assert.ok(q("[data-tests-text]"), "the text stays while the original is shown");
  fireEvent.click(q("[data-tests-zoom]")!);
  assert.ok(q("[data-tests-lightbox]"), "the original zooms like any question image");
  fireEvent.click(q("[data-tests-lightbox-close]")!);
  fireEvent.click(q("[data-tests-original]")!);
  assert.ok(!q("[data-tests-image]"), "hidden again");
});

test("«Asl rasm» opened on one question does not stay open on the next text question", async () => {
  await startTextAttempt([TEXT_QUESTIONS[0]!, TEXT_QUESTIONS[2]!]);
  fireEvent.click(q("[data-tests-original]")!);
  assert.equal((q("[data-tests-image]") as HTMLImageElement).getAttribute("src"), IMG(21));
  await choose("B");
  await waitFor(() => assert.equal(q("[data-tests-progress]")!.textContent, "2 / 2"));
  assert.ok(q("[data-tests-original]"), "the next question has its own toggle");
  assert.ok(!q("[data-tests-image]"), "closed: the original of question 1 is not carried over");
  assert.equal(q("[data-tests-original]")!.getAttribute("aria-expanded"), "false");
});

test("figure question: the image stays next to the text, no «Asl rasm» toggle; image-only is unchanged", async () => {
  await startTextAttempt();
  await choose("A");
  await waitFor(() => assert.equal(q("[data-tests-progress]")!.textContent, "2 / 4"));
  assert.match(q("[data-tests-text]")!.textContent!, /Jadvalda ekin maydonlari/);
  assert.equal((q("[data-tests-image]") as HTMLImageElement).getAttribute("src"), IMG(22));
  assert.ok(!q("[data-tests-original]"));
  assert.deepEqual(all("[data-tests-choice]").map((b) => b.textContent), ["A.51", "B.41", "C.56", "D.45"]);
  await choose("A");
  await choose("A");
  await waitFor(() => assert.equal(q("[data-tests-progress]")!.textContent, "4 / 4"));
  assert.ok(!q("[data-tests-text]") && !q("[data-tests-original]"), "image-only: no text, no toggle");
  assert.equal((q("[data-tests-image]") as HTMLImageElement).getAttribute("src"), IMG(24));
  assert.deepEqual(all("[data-tests-choice]").map((b) => b.textContent), ["A", "B", "C", "D"], "image-only keeps the letter buttons");
});

test("LaTeX in `$…$` is rendered with KaTeX in the question and in an option; the rest stays plain text", async () => {
  await startTextAttempt();
  await choose("A");
  await choose("A");
  await waitFor(() => assert.equal(q("[data-tests-progress]")!.textContent, "3 / 4"));
  await waitFor(() => assert.ok(q("[data-tests-text] .katex"), "the stem formula is typeset"));
  const stem = q("[data-tests-text]")!;
  assert.equal(stem.querySelectorAll("[data-tests-math]").length, 1, "one formula in the stem");
  assert.equal(stem.querySelectorAll(".katex-html .mfrac").length, 3, "with three fractions, typeset");
  assert.ok(stem.textContent!.startsWith("Hisoblang: "), "the plain part is kept");
  assert.ok(!stem.textContent!.includes("$"), "the delimiters are gone");
  assert.ok(!stem.querySelector(".katex-html")!.textContent!.includes("\\frac"), "no raw LaTeX in the visible part");
  const optionD = q('[data-tests-choice="D"]')!;
  assert.ok(optionD.querySelector(".katex"), "an option formula is typeset too");
  assert.ok(optionD.textContent!.startsWith("D."), "the letter stays");
  assert.deepEqual(all("[data-tests-choice]").slice(0, 3).map((b) => b.querySelector(".katex")), [null, null, null], "plain options carry no KaTeX");
  // A broken formula never breaks the question (KaTeX throwOnError: false).
  assert.equal(q('[data-tests-choice="C"]')!.textContent, "C.−1");
});

test("review: a text question shows its four options with the correct / chosen marks and the figure it needs", async () => {
  const review = [
    { id: 21, position: 1, subject: "Matematika", text: TEXT_QUESTIONS[0]!.text, options: TEXT_QUESTIONS[0]!.options, imageUrl: IMG(21), hasFigure: false, chosen: 0, chosenLetter: "A", correct: 1, correctLetter: "B", isCorrect: false, explanation: null },
    { id: 22, position: 2, subject: "Matematika", text: TEXT_QUESTIONS[1]!.text, options: TEXT_QUESTIONS[1]!.options, imageUrl: IMG(22), hasFigure: true, chosen: null, chosenLetter: null, correct: 2, correctLetter: "C", isCorrect: false, explanation: null },
    { id: 23, position: 3, subject: "Matematika", text: TEXT_QUESTIONS[2]!.text, options: TEXT_QUESTIONS[2]!.options, imageUrl: IMG(23), hasFigure: false, chosen: 3, chosenLetter: "D", correct: 3, correctLetter: "D", isCorrect: true, explanation: null },
  ];
  stub({
    "GET /api/tests": () => json(200, { ...OV, history: [{ id: "A1", mode: "subject", subject: "Matematika", status: "finished", total: 3, correct: 1, score: 1.1, startedAt: "2026-10-20T10:00:00Z" }] }),
    "GET /api/tests/attempts/A1": () => json(200, { ...FINISHED, total: 3, correct: 1, review }),
    "GET /api/tests/attempts/A1/analysis": () => json(200, { attemptId: "A1", done: true, items: [] }),
  });
  render(h(TestsPage));
  await waitFor(() => assert.ok(q("[data-tests-history-item]")));
  fireEvent.click(q("[data-tests-history-item]")!);
  await waitFor(() => assert.ok(q("[data-tests-result]")));
  const items = all("[data-tests-review-item]");
  const marks = (i: number) => [...items[i]!.querySelectorAll<HTMLElement>("[data-option]")].map((r) => `${r.dataset.option}:${r.dataset.state}`);
  assert.deepEqual(marks(0), ["A:wrong", "B:correct", "C:plain", "D:plain"]);
  assert.deepEqual(marks(1), ["A:plain", "B:plain", "C:correct", "D:plain"], "unanswered: only the correct one is marked");
  assert.deepEqual(marks(2), ["A:plain", "B:plain", "C:plain", "D:correct"], "a right answer is just the correct row");
  assert.ok(!items[0]!.querySelector("[data-tests-image]") && items[0]!.querySelector("[data-tests-original]"), "text only + «Asl rasm»");
  assert.ok(items[1]!.querySelector("[data-tests-image]") && !items[1]!.querySelector("[data-tests-original]"), "the figure stays in the review");
  assert.ok(!items[2]!.querySelector("[data-tests-image]"));
  await waitFor(() => assert.ok(items[2]!.querySelector('[data-option="D"] .katex'), "formulas are typeset in the review too"));
  assert.match(items[0]!.textContent!, /Sizning javobingiz: A/);
});
