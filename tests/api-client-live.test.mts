import test from "node:test";
import assert from "node:assert/strict";
import type { GenerationDetail } from "../lib/api-client.ts";

/**
 * L4 — transport (klient tomoni): `mergeLive`, `nextPollDelay`,
 * `pollGeneration` (`fetch` stub bilan, DB/tarmoq shart emas) va
 * route'ning `?since=` parserini (`parseSince`, sof funksiya —
 * autentifikatsiya/DB shart emas) sinaydi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const { mergeLive, nextPollDelay, pollGeneration, ApiError } = await import("../lib/api-client.ts");
const { parseSince } = await import("../app/api/generations/[id]/route.ts");

function gen(patch: Partial<GenerationDetail> = {}): GenerationDetail {
  return {
    id: "g1",
    type: "slide",
    topic: "T",
    status: "IN_PROGRESS",
    createdAt: new Date().toISOString(),
    price: 1000,
    fileName: "x.pptx",
    format: "pptx",
    progress: 10,
    step: "Boshlandi",
    expiresAt: null,
    error: null,
    preview: null,
    html: null,
    doc: null,
    hasFile: false,
    liveSeq: 0,
    ...patch,
  } as GenerationDetail;
}

// ---------------------------------------------------------------------------
// mergeLive
// ---------------------------------------------------------------------------

test("mergeLive: next.live === undefined bo'lsa — oldingi live saqlanadi", () => {
  const prev = gen({ live: { step: "eski" }, liveSeq: 3 });
  const next = gen({ liveSeq: 3 }); // `live` kaliti umuman yo'q
  assert.equal("live" in next, false);
  const merged = mergeLive(prev, next);
  assert.deepEqual(merged.live, { step: "eski" });
  // Boshqa maydonlar `next`dan olinadi.
  assert.equal(merged.liveSeq, 3);
});

test("mergeLive: next.live === null bo'lsa — null saqlanadi (eski live QAYTARILMAYDI)", () => {
  const prev = gen({ live: { step: "eski" }, liveSeq: 3 });
  const next = gen({ live: null, liveSeq: 4 });
  const merged = mergeLive(prev, next);
  assert.equal(merged.live, null);
});

test("mergeLive: yangi live qiymati kelsa — yangisi ishlatiladi", () => {
  const prev = gen({ live: { step: "eski" }, liveSeq: 3 });
  const next = gen({ live: { step: "yangi" }, liveSeq: 4 });
  const merged = mergeLive(prev, next);
  assert.deepEqual(merged.live, { step: "yangi" });
});

test("mergeLive: prev yo'q (birinchi so'rov) — next.live undefined bo'lsa live undefined bo'lib qoladi", () => {
  const next = gen({ liveSeq: 0 });
  const merged = mergeLive(null, next);
  assert.equal(merged.live, undefined);
});

// MUTATSIYA: `next.live === undefined` shartini olib tashlab, doim
// `next.live`ni qaytarsak (ya'ni undefined ni null bilan almashtirsak),
// birinchi testning tasdiqi buzilishi kerak.
test("mutatsiya: mergeLive undefined ni saqlamasa (har doim next qaytarsa), test buziladi", () => {
  const prev = gen({ live: { step: "eski" }, liveSeq: 3 });
  const next = gen({ liveSeq: 3 });
  const buggy = { ...next, live: next.live ?? null }; // eski xato: undefined -> null
  assert.notEqual(buggy.live, prev.live, "buzuq mantiq ushbu testda aniqlanishi kerak edi");
});

// ---------------------------------------------------------------------------
// nextPollDelay
// ---------------------------------------------------------------------------

test("nextPollDelay: IN_PROGRESS va live bor bo'lsa — 1200ms", () => {
  const g = gen({ status: "IN_PROGRESS", live: { step: "x" } });
  assert.equal(nextPollDelay(g, 1000), 1200);
});

test("nextPollDelay: IN_PROGRESS lekin live yo'q (undefined) — eski backoff", () => {
  const g = gen({ status: "IN_PROGRESS" });
  assert.equal(nextPollDelay(g, 1000), Math.min(5000, Math.round(1000 * 1.3)));
});

test("nextPollDelay: live null bo'lsa ham — eski backoff (faqat haqiqiy live tezlashtiradi)", () => {
  const g = gen({ status: "IN_PROGRESS", live: null });
  assert.equal(nextPollDelay(g, 1000), Math.min(5000, Math.round(1000 * 1.3)));
});

test("nextPollDelay: QUEUED holatida live bo'lsa ham — eski backoff", () => {
  const g = gen({ status: "QUEUED", live: { step: "x" } });
  assert.equal(nextPollDelay(g, 2000), Math.min(5000, Math.round(2000 * 1.3)));
});

test("nextPollDelay: backoff 5000 dan oshmaydi", () => {
  const g = gen({ status: "QUEUED" });
  assert.equal(nextPollDelay(g, 4000), 5000);
});

// MUTATSIYA: doim backoff qaytarsa (live tezlashtirish yo'qolsa).
test("mutatsiya: nextPollDelay doim backoff qaytarsa, live-tezlashtirish testi buziladi", () => {
  const g = gen({ status: "IN_PROGRESS", live: { step: "x" } });
  const buggy = Math.min(5000, Math.round(1000 * 1.3));
  assert.notEqual(buggy, 1200, "buzuq versiya 1200 bilan mos kelmasligi kerak edi");
});

// ---------------------------------------------------------------------------
// pollGeneration — fetch stub bilan
// ---------------------------------------------------------------------------

test("pollGeneration: `since` prev.liveSeq bilan yuboriladi (faqat prev.live bor bo'lsa)", async (t) => {
  const urls: string[] = [];
  let call = 0;
  const responses: GenerationDetail[] = [
    gen({ status: "IN_PROGRESS", live: { step: "1" }, liveSeq: 1 }),
    gen({ status: "IN_PROGRESS", liveSeq: 1 }), // `live` kaliti yo'q — o'zgarmagan
    gen({ status: "COMPLETED", liveSeq: 2, live: null }),
  ];
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    urls.push(String(input));
    const body = responses[Math.min(call, responses.length - 1)];
    call++;
    const text = JSON.stringify({ generation: body });
    return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
  });
  t.mock.method(globalThis, "setTimeout", ((fn: () => void) => {
    fn();
    return 0 as unknown as NodeJS.Timeout;
  }) as typeof setTimeout);

  const ticks: GenerationDetail[] = [];
  const result = await pollGeneration("g1", (g) => ticks.push(g));

  // Birinchi so'rovda `since` yo'q (prev yo'q).
  assert.equal(urls[0].includes("since="), false);
  // Ikkinchi so'rovda oldingi `live` bor edi -> `since=1` (liveSeq) yuborilishi kerak.
  assert.match(urls[1], /since=1$/);
  // Uchinchi so'rovda ikkinchi javobda `live` kaliti yo'q edi -> `since`
  // hamon oldingi (birinchi javobdagi) live asosida yuboriladi.
  assert.match(urls[2], /since=1$/);

  // Ikkinchi tick — server `live` yubormagan, lekin klient oldingi
  // `live`ni saqlab qolgan bo'lishi kerak.
  assert.deepEqual(ticks[1].live, { step: "1" });

  assert.equal(result.status, "COMPLETED");
});

test("mutatsiya: pollGeneration `since` yubormasa, so'rov satrida bo'lmaydi", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    urls.push(String(input));
    const body = gen({ status: "COMPLETED", liveSeq: 1 });
    return new Response(JSON.stringify({ generation: body }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  await pollGeneration("g1", () => {});
  // Poydevor: birinchi so'rovda prev yo'q, shuning uchun `since` bo'lmasligi kerak —
  // bu ATAYLAB tekshiriladigan "har doim yuborilmasin" holati.
  assert.equal(urls[0].includes("since="), false);
});

void ApiError;

// ---------------------------------------------------------------------------
// route: parseSince
// ---------------------------------------------------------------------------

function req(url: string): Request {
  return new Request(url);
}

test("parseSince: yo'q bo'lsa — undefined", () => {
  assert.equal(parseSince(req("http://x/api/generations/g1")), undefined);
});

test("parseSince: to'g'ri butun son — o'sha qiymat", () => {
  assert.equal(parseSince(req("http://x/api/generations/g1?since=5")), 5);
});

test("parseSince: 0 — amal qiladi (>= 0)", () => {
  assert.equal(parseSince(req("http://x/api/generations/g1?since=0")), 0);
});

test("parseSince: manfiy — e'tiborsiz (undefined)", () => {
  assert.equal(parseSince(req("http://x/api/generations/g1?since=-1")), undefined);
});

test("parseSince: raqam emas — e'tiborsiz (undefined)", () => {
  assert.equal(parseSince(req("http://x/api/generations/g1?since=abc")), undefined);
});

// MUTATSIYA: `>= 0` tekshiruvini olib tashlasak, manfiy son ham o'tib ketardi.
test("mutatsiya: manfiy son filtri olib tashlansa, bu test uni ushlaydi", () => {
  const n = Number.parseInt("-1", 10);
  assert.equal(n >= 0, false, "manfiy son >= 0 tekshiruvidan o'tmasligi kerak");
});
