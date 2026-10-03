import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GamePlayer, newSubmissionId } from "../../components/game/Player.tsx";
import { crosswordSlots } from "../../lib/game/engine.ts";
import { publicGameView, publicItemId, type PublicGameKind, type PublicGameView } from "../../lib/game/public.ts";
import { scoreAnswers, scorePercent } from "../../lib/game/score.ts";
import { sampleGameDoc } from "../../lib/generation/games/samples.ts";
import { sampleTeacherDoc } from "../../lib/generation/teacher/samples.ts";
import type { AcademicDoc } from "../../lib/generation/types.ts";
import * as nav from "../../lib/nav/history.ts";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

/**
 * O'YINCHI TOMONI (AUDIT-22 WP-C) — jsdom oqimi.
 *
 * `tests/game-engine.test.mts` DVIGATELNI (sof holat) sinaydi; bu fayl
 * esa CHIZILISHNI va TARMOQNI: `GET /api/o/[token]` → ism darvozasi →
 * besh turdan biri → `POST …/submit` → natija ekrani.
 *
 * Submit stub i ballni O'YLAB TOPMAYDI — u HAQIQIY `scoreAnswers` ni
 * chaqiradi. Ya'ni test «o'yinchi bosgan tugma → payload → server
 * hisobi» halqasini to'liq yuradi: komponent indeksni chalkashtirsa
 * (yoki payload kalitini noto'g'ri qo'ysa) ball tushib qoladi va test
 * qizaradi.
 *
 * MUTATSIYALAR (tasdiqlangan):
 *   1. `Quiz.tsx` da `data-option` o'rniga teskari indeks yuborildi
 *      (`q.options.length - 1 - i`) — «test: to'g'ri javob to'liq ball»
 *      qizardi;
 *   2. `Player.tsx` submit tanasidan `name` olib tashlandi — «ism
 *      submit tanasida ketadi» qizardi;
 *   3. `Player.tsx` da 429 xatosi ingliz matniga almashtirildi —
 *      «429: o'zbekcha xato» qizardi;
 *   4. `Crossword.tsx` da `data-cell` kaliti `c:r` (teskari) qilindi —
 *      «krossvord: kataklar so'zga yig'iladi» qizardi.
 */
afterEach(async () => {
  cleanup();
  globalThis.fetch = realFetch;
  await settle();
  nav.__resetNavForTests();
});

const realFetch = globalThis.fetch;
const TOKEN = "abcdefghijklmnopqrstuv";

function docFor(kind: PublicGameKind): AcademicDoc {
  return kind === "quiz" ? sampleTeacherDoc("test") : sampleGameDoc(kind);
}

function viewOf(kind: PublicGameKind): PublicGameView {
  const v = publicGameView(docFor(kind), kind, { seed: TOKEN });
  assert.ok(v, `${kind}: ko'rinish qurilmadi`);
  return v!;
}

type Call = { url: string; method: string; body?: Record<string, unknown> };

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/** `fetch` stub i: GET — ko'rinish, POST — HAQIQIY `scoreAnswers`. */
function stubApi(kind: PublicGameKind, view: PublicGameView, opts: { get?: number; submit?: number } = {}): Call[] {
  const calls: Call[] = [];
  const doc = docFor(kind);
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ url, method, body });
    if (method === "GET") {
      if (opts.get && opts.get !== 200) return json(opts.get, { error: "Topilmadi" });
      return json(200, { game: view, title: "Fotosintez", kind });
    }
    if (opts.submit && opts.submit !== 200) return json(opts.submit, { error: "server matni" });
    const scored = scoreAnswers(doc, kind, (body?.answers ?? {}) as Record<string, unknown>);
    return json(200, { score: scored.score, total: scored.total, percent: scorePercent(scored) });
  }) as typeof fetch;
  return calls;
}

async function openGame(kind: PublicGameKind, opts: { get?: number; submit?: number } = {}) {
  const view = viewOf(kind);
  const calls = stubApi(kind, view, opts);
  await act(async () => {
    render(h(GamePlayer, { token: TOKEN }));
  });
  return { view, calls, doc: docFor(kind) };
}

async function enterName(name = "Ali Valiyev") {
  const input = screen.getByLabelText("Ismingiz") as HTMLInputElement;
  fireEvent.change(input, { target: { value: name } });
  await act(async () => {
    fireEvent.click(screen.getByText("Boshlash"));
  });
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const qq = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];

async function clickFinish() {
  await act(async () => {
    fireEvent.click(q("[data-finish]")!);
  });
}

/** Oxirgi submit chaqiruvining tanasi. */
function lastSubmit(calls: Call[]): Record<string, unknown> {
  const post = [...calls].reverse().find((c) => c.method === "POST");
  assert.ok(post, "submit chaqirilmadi");
  return post!.body as Record<string, unknown>;
}

/* ────────────────────────── yuklash va darvoza ────────────────────────── */

test("404: havola topilmadi ekrani, ism darvozasi CHIQMAYDI", async () => {
  await openGame("quiz", { get: 404 });
  await waitFor(() => assert.ok(q("[data-game-error]")));
  assert.match(q("[data-game-error]")!.textContent ?? "", /Havola topilmadi yoki muddati tugagan/);
  assert.ok(!q("#player-name"), "o'yin yo'q — ism ham so'ralmaydi");
});

test("boshqa server xatosi ham o'zbekcha va o'yinni ochmaydi", async () => {
  await openGame("quiz", { get: 500 });
  await waitFor(() => assert.ok(q("[data-game-error]")));
  assert.match(q("[data-game-error]")!.textContent ?? "", /O‘yinni yuklab bo‘lmadi/);
});

test("ism darvozasi: bo'sh ism bilan boshlab bo'lmaydi, 40 belgi chegarasi", async () => {
  const { view } = await openGame("quiz");
  const input = (await screen.findByLabelText("Ismingiz")) as HTMLInputElement;
  assert.equal(input.maxLength, 40, "server ham 40 belgiga kesadi — o'quvchi buni HOZIR ko'rsin");
  const start = screen.getByText("Boshlash") as HTMLButtonElement;
  assert.equal(start.disabled, true, "ism yo'q — tugma o'chiq");

  fireEvent.change(input, { target: { value: "   " } });
  assert.equal((screen.getByText("Boshlash") as HTMLButtonElement).disabled, true, "faqat bo'shliq — ism emas");

  assert.match(document.body.textContent ?? "", new RegExp(`${view.total} ta topshiriq`), "topshiriq soni ko'rinadi");
  await enterName();
  assert.ok(q("[data-game='quiz']"), "o'yin ekrani ochildi");
  assert.ok(!q("#player-name"), "darvoza yopildi");
});

/* ────────────────────────── test (quiz) ────────────────────────── */

test("test: qadamma-qadam yuriladi, progress va «Orqaga» ishlaydi", async () => {
  const { view } = await openGame("quiz");
  await enterName();
  assert.equal(view.kind, "quiz");

  assert.match(q("[data-progress]")!.textContent ?? "", /^1 \/ \d+ · 0 \/ \d+ bajarildi/);
  assert.equal((q("[data-prev]") as HTMLButtonElement).disabled, true, "birinchi qadamda orqaga yo'q");

  const first = q("[data-qid]")!.getAttribute("data-qid");
  fireEvent.click(qq("[data-option]")[0]!);
  assert.match(q("[data-progress]")!.textContent ?? "", /1 \/ \d+ bajarildi/, "javob progressda sanaldi");

  fireEvent.click(q("[data-next]")!);
  assert.notEqual(q("[data-qid]")!.getAttribute("data-qid"), first, "keyingi savolga o'tdi");
  fireEvent.click(q("[data-prev]")!);
  assert.equal(q("[data-qid]")!.getAttribute("data-qid"), first, "orqaga qaytdi");
  assert.equal(qq("[data-option]")[0]!.getAttribute("aria-pressed"), "true", "tanlov saqlandi");
});

test("test: to'g'ri javoblar TO'LIQ ball beradi (indeks chalkashmaydi)", async () => {
  const { view, calls, doc } = await openGame("quiz");
  await enterName();
  if (view.kind !== "quiz") throw new Error("quiz emas");

  const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
  for (const [i, question] of view.questions.entries()) {
    if (i > 0) fireEvent.click(q("[data-next]")!);
    const model = doc.teacher!.test!.questions.find((m) => clean(m.id) === question.id)!;
    if (question.kind === "truefalse") {
      fireEvent.click(q(`[data-tf="${String(model.answer)}"]`)!);
    } else if (question.kind === "single") {
      const idx = question.options.indexOf(clean(model.options[model.answer as number]));
      fireEvent.click(q(`[data-option="${idx}"]`)!);
    } else {
      for (const a of model.answer as number[]) {
        const idx = question.options.indexOf(clean(model.options[a]));
        fireEvent.click(q(`[data-option="${idx}"]`)!);
      }
    }
  }

  await clickFinish();
  await waitFor(() => assert.ok(q("[data-game-result]")));
  assert.equal(q("[data-percent]")!.textContent, "100%", "to'liq ball — variant tartibi chalkashmagan");
  assert.equal(lastSubmit(calls).name, "Ali Valiyev", "ism submit tanasida ketadi");
  assert.equal(typeof lastSubmit(calls).seconds, "number", "vaqt o'lchandi");
});

/* ────────────────────────── krossvord ────────────────────────── */

test("krossvord: kataklar SO'Zga yig'ilib yuboriladi", async () => {
  const { view, calls } = await openGame("crossword");
  await enterName();
  if (view.kind !== "crossword") throw new Error("krossvord emas");

  const slot = crosswordSlots(view).find((s) => s.cells.length > 1)!;
  for (const c of slot.cells) {
    fireEvent.change(q(`[data-cell="${c.row}:${c.col}"]`)!, { target: { value: "A" } });
  }
  await clickFinish();
  await waitFor(() => assert.ok(q("[data-game-result]")));

  const answers = lastSubmit(calls).answers as Record<string, unknown>;
  assert.equal(answers[slot.wordId], "A".repeat(slot.cells.length), "so'z id → harflar satri");
});

test("krossvord: bitta ekran — «Keyingi» tugmasi yo'q", async () => {
  await openGame("crossword");
  await enterName();
  assert.ok(!q("[data-next]"), "krossvordda qadam yo'q");
  assert.ok(!q("[data-prev]"));
  assert.ok(q("[data-finish]"), "«Yakunlash» darrov ko'rinadi");
});

/* ────────────────────────── kartalar ────────────────────────── */

test("kartalar: ag'darilmaguncha baho tugmalari yo'q, «bildim» payloadga tushadi", async () => {
  const { view, calls } = await openGame("flashcards");
  await enterName();
  if (view.kind !== "flashcards") throw new Error("kartalar emas");

  assert.ok(!q("[data-know]"), "ag'darilmagan kartada baho so'ralmaydi");
  assert.ok(!q("[data-back]"), "ag'darilmagan kartada orqa yuz ko'rinmaydi");
  const cardId = q("[data-card]")!.getAttribute("data-card")!;
  const back = view.cards[0]!.back;
  fireEvent.click(q("[data-flip]")!);
  assert.ok(q("[data-know='true']"), "ag'darilgandan keyin ikki tugma");
  // MUTATSIYA (AUDIT-22 R): orqa yuz (`card.back`) endi ko'rinishi kerak —
  // «ag'darish» faqat javobni KO'RSATMAYDI degan eski xulq qaytarilsa qizaradi.
  assert.equal(q("[data-back]")!.textContent, back, "orqa yuz matni ko'rinmadi");
  fireEvent.click(q("[data-know='true']")!);

  fireEvent.click(q("[data-next]")!);
  assert.ok(!q("[data-know]"), "keyingi karta YOPIQ keladi");

  while (q("[data-next]")) fireEvent.click(q("[data-next]")!);
  await clickFinish();
  await waitFor(() => assert.ok(q("[data-game-result]")));
  assert.equal((lastSubmit(calls).answers as Record<string, unknown>)[cardId], true);
  assert.equal(q("[data-score]")!.textContent?.replace(/\s+/g, " ").trim(), `1 / ${view.total}`, "ball — «bildim» soni");
});

/* ────────────────────────── saralash ────────────────────────── */

test("saralash: element tanlanadi, toifaga qo'yiladi va qaytarib olinadi", async () => {
  const { view, calls } = await openGame("sorting");
  await enterName();
  if (view.kind !== "sorting") throw new Error("saralash emas");

  const item = view.items[0]!;
  const cat = view.categories[0]!;
  assert.equal((q(`[data-drop="${cat.id}"]`) as HTMLButtonElement).disabled, true, "qo'l bo'sh — toifa o'chiq");

  fireEvent.click(q(`[data-item="${item.id}"]`)!);
  fireEvent.click(q(`[data-drop="${cat.id}"]`)!);
  assert.ok(q(`[data-placed="${item.id}"]`), "element toifa ichida ko'rinadi");
  assert.ok(!q(`[data-item="${item.id}"]`), "taxtada qolmadi");

  fireEvent.click(q(`[data-placed="${item.id}"]`)!);
  assert.ok(q(`[data-item="${item.id}"]`), "bosilganda taxtaga qaytdi");

  fireEvent.click(q(`[data-item="${item.id}"]`)!);
  fireEvent.click(q(`[data-drop="${cat.id}"]`)!);
  await clickFinish();
  await waitFor(() => assert.ok(q("[data-game-result]")));
  assert.equal((lastSubmit(calls).answers as Record<string, unknown>)[item.id], cat.id, "element id → toifa id");
  assert.ok(publicItemId(item.text) === item.id, "id matndan — tartibdan emas");
});

/* ────────────────────────── tinglash ────────────────────────── */

test("tinglash: audio yo'qligi aytiladi, variant indeksi yuboriladi", async () => {
  const { view, calls } = await openGame("listening");
  await enterName();
  if (view.kind !== "listening") throw new Error("tinglash emas");

  // WP-A gacha TTS yo'q — ekran buni JIMGINA yutmaydi.
  assert.ok(q("[data-no-audio]"), "audio yo'qligi aytiladi");
  assert.ok(!q("[data-play]"), "ishlamaydigan «Tinglash» tugmasi chizilmaydi");
  // MUTATSIYA (AUDIT-22 R): audio yo'q holatda matn (`item.text`) ko'rinishi
  // kerak — «Tinglab bo'lmadi — o'qing» o'qish zaxirasi qulamasin.
  assert.equal(q("[data-text]")!.textContent, view.items[0]!.text, "audiosiz matn ko'rinmadi");

  const itemId = q("[data-item]")!.getAttribute("data-item")!;
  fireEvent.click(q('[data-option="1"]')!);
  while (q("[data-next]")) fireEvent.click(q("[data-next]")!);
  await clickFinish();
  await waitFor(() => assert.ok(q("[data-game-result]")));
  assert.equal((lastSubmit(calls).answers as Record<string, unknown>)[itemId], 1, "ochiq indeks o'zgarmasdan ketadi");
});

/* ────────────────────────── xatolar va qayta o'ynash ────────────────────────── */

test("429: o'zbekcha xato, javoblar YO'QOLMAYDI va qayta yuborish mumkin, submissionId O'ZGARMAYDI (C36 UX-06)", async () => {
  const { view, calls } = await openGame("quiz", { submit: 429 });
  await enterName();
  fireEvent.click(qq("[data-option]")[0]!);
  const qid = q("[data-qid]")!.getAttribute("data-qid")!;

  while (q("[data-next]")) fireEvent.click(q("[data-next]")!);
  await clickFinish();
  await waitFor(() => assert.ok(q("[data-send-error]")));
  assert.match(q("[data-send-error]")!.textContent ?? "", /Juda ko‘p urinish/);
  assert.ok(!q("[data-game-result]"), "natija ekrani ochilmadi");
  assert.equal(q("[data-finish]")!.textContent, "Qayta yuborish");

  // Javob joyida: birinchi savolga qaytsak tanlov turibdi.
  while (q("[data-prev]") && !(q("[data-prev]") as HTMLButtonElement).disabled) fireEvent.click(q("[data-prev]")!);
  assert.equal(q("[data-qid]")!.getAttribute("data-qid"), qid);
  assert.equal(qq("[data-option]")[0]!.getAttribute("aria-pressed"), "true", "tanlov saqlandi");
  assert.ok(calls.some((c) => c.method === "POST"), "urinish bo'lgan");
  assert.ok(view.total > 0);

  const firstSubmissionId = lastSubmit(calls).submissionId;
  assert.ok(typeof firstSubmissionId === "string" && firstSubmissionId.length > 0, "submissionId yuborilmadi");

  // «Qayta yuborish» tugmasi FAQAT oxirgi savolda ko'rinadi — orqaga
  // qaytgan edik (tanlov saqlanganini tekshirish uchun), yana oxirigacha boramiz.
  while (q("[data-next]")) fireEvent.click(q("[data-next]")!);
  // «Qayta yuborish» — AYNI urinish, AYNI submissionId (server shu bilan dedupe qiladi).
  await clickFinish();
  await waitFor(() => assert.equal(calls.filter((c) => c.method === "POST").length, 2));
  // MUTATSIYA: har `submit()` chaqiruvida YANGI id yaratilsa — server
  // takroriy yuborishni "yangi urinish" deb yozib qo'yardi (UX-06).
  assert.equal(lastSubmit(calls).submissionId, firstSubmissionId, "qayta yuborishda submissionId o'zgardi");
});

test("natija ekrani va «Yana o'ynash» yangi urinish boshlaydi, YANGI submissionId bilan", async () => {
  const { calls } = await openGame("sorting");
  await enterName("Zulfiya");
  await clickFinish();
  await waitFor(() => assert.ok(q("[data-game-result]")));

  assert.match(q("[data-game-result]")!.textContent ?? "", /Zulfiya/, "ism natijada ko'rinadi");
  assert.equal(q("[data-percent]")!.textContent, "0%", "javobsiz o'yin — 0 %");
  assert.ok(!/toifa/i.test(q("[data-game-result]")!.textContent ?? ""), "qaysi topshiriq xato ekani KO'RSATILMAYDI");

  const firstSubmissionId = lastSubmit(calls).submissionId;
  assert.ok(typeof firstSubmissionId === "string" && firstSubmissionId.length > 0, "submissionId yuborilmadi");

  await act(async () => {
    fireEvent.click(q("[data-again]")!);
  });
  assert.ok(!q("[data-game-result]"), "natija yopildi");
  assert.ok(q("[data-game='sorting']"), "o'yin qaytadan ochildi");
  assert.ok(!q("#player-name"), "ism qayta so'ralmaydi");

  await clickFinish();
  await waitFor(() => assert.ok(q("[data-game-result]")));
  assert.equal(calls.filter((c) => c.method === "POST").length, 2, "ikkinchi urinish YANGI qator sifatida ketdi");
  // MUTATSIYA: «Yana o'ynash» ESKI submissionId'ni qayta ishlatsa — server
  // ikkinchi urinishni BIRINCHISINING TAKRORI deb hisoblab, yozib qo'yardi.
  assert.notEqual(lastSubmit(calls).submissionId, firstSubmissionId, "yangi urinish ESKI submissionId bilan ketdi");
});

/* ────────────────────────── `crypto.randomUUID` zaxirasi (Sharh R4) ────────────────────────── */

/*
 * TO'G'RIDAN-TO'G'RI birlik testi, React/jsdom RENDERSIZ (`newSubmissionId`
 * eksport qilingan) — render orqali (`fireEvent` → `onSubmit` → `start()`)
 * tekshirish ISHONCHSIZ chiqdi: Node'ning Web Crypto implementatsiyasida
 * `randomUUID` INSTANSIYaning o'z xususiyati emas, `Crypto.prototype` da
 * turadi — `delete crypto.randomUUID` HECH NARSA O'CHIRMAYDI (prototip
 * usuli zanjir orqali ko'rinib qoladi), va bu holat faqat funksiyani
 * TO'G'RIDAN-TO'G'RI chaqirganda aniq ko'rinadi. Shuning uchun "yo'qligini"
 * taqlid qilish `crypto.randomUUID = undefined` (SOYA xususiyat) bilan.
 */
test("newSubmissionId: crypto.randomUUID YO'Q bo'lsa — `getRandomValues` zaxirasi v4 UUID beradi, TASHLAMAYDI", () => {
  const original = crypto.randomUUID;
  /*
   * Real brauzerda funksiya umuman YO'Q yoki xavfsiz kontekst emasligi
   * uchun mavjud emas — shuni taqlid qilamiz. `delete` YETARLI EMAS:
   * Node'da `randomUUID` `Crypto.prototype` da turadi (instansiyaning
   * O'Z xususiyati emas), `delete crypto.randomUUID` hech narsa
   * o'chirmaydi — prototip usuli zanjir orqali ko'rinib qoladi.
   * O'RNIGA (`undefined`) YOZISH instansiyada SOYA (shadow) xususiyat
   * yaratadi va prototipni yashiradi — xuddi eski brauzerdagidek.
   */
  crypto.randomUUID = undefined as unknown as typeof crypto.randomUUID;
  try {
    const id = newSubmissionId();
    // MUTATSIYA: zaxira generator olib tashlansa — bu yerda `TypeError`
    // (`crypto.randomUUID is not a function`) otilardi.
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "getRandomValues zaxirasi v4 UUID shaklini bermadi");
    const id2 = newSubmissionId();
    assert.notEqual(id, id2, "zaxira generator bir xil id qaytardi — TAKRORLANMASLIK buzildi");
  } finally {
    crypto.randomUUID = original;
  }
});

test("newSubmissionId: crypto BUTUNLAY yo'q (juda eski WebView) — Math.random so'nggi zaxirasi ham v4 shaklini beradi", () => {
  const g = globalThis as { crypto?: Crypto };
  const original = g.crypto;
  delete g.crypto;
  try {
    const id = newSubmissionId();
    // MUTATSIYA: so'nggi (Math.random) zaxira olib tashlansa — bu yerda
    // `crypto is not defined`/`TypeError` otilardi.
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "so'nggi zaxira v4 shaklini bermadi");
  } finally {
    g.crypto = original;
  }
});

test("newSubmissionId: crypto.randomUUID BOR bo'lsa — o'shani ishlatadi (asosiy yo'l)", () => {
  const id = newSubmissionId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

/* ────────────────────────── chiqish tasdiqlash (N4) ──────────────────────────
 *
 * HAQIQIY tarix mexanizmi (lib/nav/history.ts) bilan: «orqaga» bosilishi
 * `window.history.back()`. Brauzerdagi to'liq ketma-ketlik (Chromium, touch +
 * desktop, Telegram stub) `scratchpad/n4b/smoke.cjs` da yuritilgan.
 *
 * MUTATSIYALAR (tasdiqlangan):
 *   1. `playing` sharti `state !== null` ga (natijani hisobga olmay) — «tugagach
 *      qo'riqchi yo'q» qizardi;
 *   2. `playing` sharti doim 0 — «o'yin davomida orqaga dialog ochadi» qizardi;
 *   3. `onCancel` da `leaveResolveRef.current?.(false)` olib tashlandi — «Qolish
 *      qo'riqchini qayta o'rnatadi» qizardi;
 *   4. `LeaveGameDialog` da `useDialog(open, close, { history: false })` —
 *      «dialog ochiqligida orqaga uni yopadi» qizardi.
 */

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 2));
  });
}

const tree = (href: string) => ["", { children: [href] }];
const router = {
  push(href: string) {
    window.history.pushState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree(href) }, "", href);
  },
  replace(href: string) {
    window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree(href) }, "", href);
  },
  refresh() {},
  back() {},
  forward() {},
  prefetch() {},
} as unknown as AppRouterInstance;

const sx = () => (window.history.state as { sx?: { i: number; o?: string } } | null)?.sx;
const here = () => window.location.pathname;
const GAME_PATH = `/o/${TOKEN}`;
const leaveText = "O'yindan chiqasizmi?";

/** Oldingi sahifa + o'yin sahifasi; `inApp: false` — QR koddan (ilovadan oldingi yozuv yo'q). */
async function openAt(inApp: boolean) {
  nav.__resetNavForTests();
  window.sessionStorage.clear();
  if (inApp) {
    window.history.pushState(null, "", "/uz");
    nav.installNav();
    nav.setNavRouter(router);
    router.push(GAME_PATH);
  } else {
    window.history.pushState(null, "", "/somewhere-before");
    window.history.pushState(null, "", GAME_PATH);
    nav.installNav();
    nav.setNavRouter(router);
  }
  const view = viewOf("quiz");
  const calls = stubApi("quiz", view);
  await act(async () => {
    render(h(AppRouterContext.Provider, { value: router }, h(GamePlayer, { token: TOKEN })));
  });
  return { view, calls };
}

async function startAndAnswer() {
  await enterName();
  fireEvent.click(qq("[data-option]")[0]!);
  await settle();
}

const dialogText = () => q("[role='dialog']")?.textContent ?? "";
const answered = () => qq("[data-option]")[0]?.getAttribute("aria-pressed") === "true";

async function pressBack() {
  await act(async () => {
    window.history.back();
  });
  await settle();
}

test("N4: o'yin boshlanmagan — qo'riqchi yo'q, orqaga dialogsiz chiqadi", async () => {
  await openAt(true);
  await waitFor(() => assert.ok(q("#player-name")));
  assert.equal(sx()?.o, undefined, "tarix yozuvi qo'shilmadi");
  assert.equal(nav.getNavSnapshot().guardPending, false);
  await pressBack();
  assert.equal(here(), "/uz");
  assert.ok(!q("[role='dialog']"));
});

test("N4: o'yin davomida orqaga — dialog, URL va javob saqlanadi", async () => {
  await openAt(true);
  await startAndAnswer();
  assert.ok(sx()?.o, "o'yin boshlangach qo'riqchi yozuvi bor");
  assert.equal(nav.getNavSnapshot().guardPending, true, "Telegram: yopish tasdig'i yoqiladi");
  const before = window.history.length;
  await pressBack();
  assert.equal(here(), GAME_PATH, "URL o'zgarmadi");
  assert.ok(q("[role='dialog']"), "dialog chiqdi");
  assert.ok(dialogText().includes(leaveText) && dialogText().includes("Javoblaringiz saqlanmaydi"), dialogText());
  assert.ok(q("[data-stay]") && q("[data-leave]"));
  assert.ok(answered(), "javob saqlanib qoldi");
  assert.equal(window.history.length, before, "yozuvlar ko'paymadi");
});

test("N4: «Qolish» — dialog yopiladi, qo'riqchi qayta o'rnatiladi, keyingi orqaga yana so'raydi", async () => {
  await openAt(true);
  await startAndAnswer();
  await pressBack();
  await act(async () => {
    fireEvent.click(q("[data-stay]")!);
  });
  await settle();
  assert.ok(!q("[role='dialog']"), "dialog yopildi");
  assert.equal(here(), GAME_PATH);
  assert.ok(answered());
  assert.ok(sx()?.o, "qo'riqchi yozuvi qayta turibdi (aks holda keyingi orqaga indamay chiqib ketadi)");
  await pressBack();
  assert.ok(q("[role='dialog']"), "yana so'radi");
  assert.equal(here(), GAME_PATH);
});

test("N4: Escape = «Qolish»", async () => {
  await openAt(true);
  await startAndAnswer();
  await pressBack();
  await act(async () => {
    fireEvent.keyDown(window, { key: "Escape" });
  });
  await settle();
  assert.ok(!q("[role='dialog']"));
  assert.equal(here(), GAME_PATH);
  assert.ok(sx()?.o, "qo'riqchi qayta o'rnatildi");
  await pressBack();
  assert.ok(q("[role='dialog']"));
});

test("N4: dialog ochiqligida orqaga — dialog yopiladi (Qolish), sahifadan chiqmaydi, qo'riqchi qayta o'rnatiladi", async () => {
  await openAt(true);
  await startAndAnswer();
  await pressBack();
  assert.ok(q("[role='dialog']"));
  await pressBack();
  assert.ok(!q("[role='dialog']"), "ikkinchi orqaga dialogni yopdi");
  assert.equal(here(), GAME_PATH, "sahifa joyida");
  assert.ok(sx()?.o, "qo'riqchi qayta o'rnatildi");
  await pressBack();
  assert.ok(q("[role='dialog']"), "uchinchi orqaga yana so'raydi");
});

/**
 * «Chiqish»: engine qancha qadam orqaga yurganini yozib boradi. jsdom `history.go`
 * deltasini CHAQIRUV paytida hisoblaydi (brauzer — bajarilganda), shuning uchun
 * oxirgi URL ni bu yerda tekshirib bo'lmaydi; Chromium da to'liq yurish smoke
 * (`scratchpad/n4b/smoke.cjs`, 5-ketma-ketlik) da tasdiqlangan. Bu yerda esa
 * «bitta harakat» = dialog yozuvi + sahifaning o'zi, jami -2 qadam.
 */
function recordSteps(): { steps: () => number; stop: () => void } {
  const h = window.history;
  const go = h.go.bind(h);
  const back = h.back.bind(h);
  let total = 0;
  h.go = (d?: number) => {
    total += d ?? 0;
    go(d);
  };
  h.back = () => {
    total -= 1;
    back();
  };
  return {
    steps: () => total,
    stop: () => {
      delete (h as unknown as Record<string, unknown>).go;
      delete (h as unknown as Record<string, unknown>).back;
    },
  };
}

test("N4: «Chiqish» — bitta harakat: dialog yozuvi + sahifa (ilovadan oldingi sahifaga)", async () => {
  await openAt(true);
  await startAndAnswer();
  await pressBack();
  const rec = recordSteps();
  try {
    await act(async () => {
      fireEvent.click(q("[data-leave]")!);
    });
    await settle();
    await settle();
    assert.ok(!q("[role='dialog']"));
    assert.equal(rec.steps(), -2, "dialog yozuvi + o'yin sahifasi: ikkinchi bosish kerak emas");
  } finally {
    rec.stop();
  }
});

test("N4: «Chiqish» QR koddan ochilgan sahifada (ilova tarixi yo'q) — dialog yozuvi + haqiqiy orqaga", async () => {
  await openAt(false);
  await startAndAnswer();
  await pressBack();
  assert.ok(q("[role='dialog']"));
  const rec = recordSteps();
  try {
    await act(async () => {
      fireEvent.click(q("[data-leave]")!);
    });
    await settle();
    await settle();
    assert.ok(!q("[role='dialog']"));
    assert.equal(rec.steps(), -2, "ikkinchi bosish talab qilinmadi");
  } finally {
    rec.stop();
  }
});

test("N4: o'yin tugagach — qo'riqchi yo'q, orqaga dialogsiz chiqadi", async () => {
  await openAt(true);
  await startAndAnswer();
  while (q("[data-next]")) fireEvent.click(q("[data-next]")!);
  await clickFinish();
  await waitFor(() => assert.ok(q("[data-game-result]")));
  await settle();
  assert.equal(nav.getNavSnapshot().guardPending, false);
  assert.equal(sx()?.o, undefined, "qo'riqchi yozuvi olib tashlandi");
  await pressBack();
  assert.equal(here(), "/uz");
  assert.ok(!q("[role='dialog']"));
});
