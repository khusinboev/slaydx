import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { searchQueryFor } from "../lib/generation/image-search-query.ts";
import { chainProvider, pickProvider, photoOrientation, type ImageProvider, type ImageResult } from "../lib/generation/image-provider.ts";
import { requestPexelsImage, pexelsProvider } from "../lib/generation/image-provider-pexels.ts";
import { requestPixabayImage, pixabayProvider } from "../lib/generation/image-provider-pixabay.ts";
import { attachSlideImages } from "../lib/generation/slide-images.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";

/**
 * BEPUL FOTO ZANJIRI (AUDIT-9 P3): Pexels → Pixabay → fal.
 *
 * Hech bir test JONLI so'rov qilmaydi — `fetch` stub qilinadi
 * (`tests/slide-images.test.mts` bilan bir xil naqsh). Bu yerda MANTIQ
 * sinaladi: qidiruv so'rovi yasash, HTTP javob shakli, xato tasnifi,
 * zanjir tartibi/qaytish, takrorlanmaslik (`seen`), uslub bo'yicha
 * to'g'ridan-to'g'ri fal ga o'tish.
 */

const slide = TOOL_BY_ID.slide;
const meta = (v: FormValues = {}) => extractMeta(slide, { topic: "Suv aylanishi", ...v });

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, statusText: `status-${status}`, json: async () => body } as never;
}

function keysEnv() {
  const saved = {
    pexels: process.env.PEXELS_API_KEY,
    pixabay: process.env.PIXABAY_API_KEY,
    fal: process.env.FAL_KEY,
    gemini: process.env.GEMINI_API_KEY,
    xai: process.env.XAI_API_KEY,
    fetch: globalThis.fetch,
  };
  return (next: Partial<{ pexels: string; pixabay: string; fal: string }> = {}) => {
    if (next.pexels !== undefined) process.env.PEXELS_API_KEY = next.pexels;
    else delete process.env.PEXELS_API_KEY;
    if (next.pixabay !== undefined) process.env.PIXABAY_API_KEY = next.pixabay;
    else delete process.env.PIXABAY_API_KEY;
    if (next.fal !== undefined) process.env.FAL_KEY = next.fal;
    else delete process.env.FAL_KEY;
    // Matn LLM (rasm PROMPTINI yozadigan `writeSlideImagePrompts`) shu
    // testlarga umuman aloqasi yo'q — kalit turib qolsa har chaqiruvda
    // real Gemini matn manziliga so'rov ketardi (stub uni 500 deb
    // qaytaradi, natija baribir zaxiraga tushadi, lekin shovqin va
    // ortiqcha tarmoq qatlami qo'shardi).
    delete process.env.GEMINI_API_KEY;
    delete process.env.XAI_API_KEY;
    return () => {
      globalThis.fetch = saved.fetch;
      const restore = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
      restore("PEXELS_API_KEY", saved.pexels);
      restore("PIXABAY_API_KEY", saved.pixabay);
      restore("FAL_KEY", saved.fal);
      restore("GEMINI_API_KEY", saved.gemini);
      restore("XAI_API_KEY", saved.xai);
    };
  };
}

/** 1×1 px JPEG — `fetchImageBytes` ning sniff tekshiruvidan o'tadigan haqiqiy baytlar. */
const JPEG_1PX_BYTES = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);
/*
 * `fetchImageBytes` 800 baytdan kichik javobni «rasm emas» deb tashlaydi
 * (SSRF/bo'sh javob himoyasi) — 1 pikselli JPEG shundan kichik edi va
 * butun zanjir «hech narsa yetkazilmadi» bo'lib chiqardi. Haqiqiy rasm
 * kabi to'ldiramiz (JPEG sarlavhasi saqlanadi, sniff o'tadi).
 */
const JPEG_PADDED = Buffer.concat([Buffer.from(JPEG_1PX_BYTES), Buffer.alloc(1200, 0)]);

/**
 * `fetchImageBytes` ning IKKINCHI bosqichi — Pexels/Pixabay/fal `https:`
 * URL qaytarsa, `persistImage` uni HAQIQATAN yuklab olishga urinadi
 * (`slide-images.ts`). Shu javob shu ikkinchi so'rovni simulyatsiya
 * qiladi — haqiqiy JPEG baytlar bilan, aks holda `sniffImageType` rad
 * etadi va rasm «saqlanmadi» bo'lib chiqadi.
 */
function imgRes() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    arrayBuffer: async () => JPEG_PADDED,
  } as unknown as Response;
}

// ───────────────────────────────────────────── 1. searchQueryFor

test("searchQueryFor: o'zbekcha mavzu → qisqa inglizcha so'rov", () => {
  const q = searchQueryFor("Suv aylanishi", { title: "" }, { slideImageStyle: "photo", localExamples: false });
  assert.equal(q, "water cycle", "lug'at orqali 2 so'zli ingliz so'rov chiqishi kerak");
});

test("searchQueryFor: determinizm — bir xil kirish bir xil so'rov beradi", () => {
  const a = searchQueryFor("Suv aylanishi", { title: "Tabiatdagi jarayon" }, { slideImageStyle: "photo", localExamples: false });
  const b = searchQueryFor("Suv aylanishi", { title: "Tabiatdagi jarayon" }, { slideImageStyle: "photo", localExamples: false });
  assert.equal(a, b);
  assert.ok(a && a.split(" ").length >= 2 && a.split(" ").length <= 5, `so'rov 2-5 so'zli bo'lishi kerak: «${a}»`);
});

test("searchQueryFor: localExamples yoqilsa «Uzbekistan» qo'shiladi", () => {
  const off = searchQueryFor("Suv aylanishi", { title: "" }, { slideImageStyle: "photo", localExamples: false });
  const on = searchQueryFor("Suv aylanishi", { title: "" }, { slideImageStyle: "photo", localExamples: true });
  assert.notEqual(on, off);
  assert.match(String(on), /Uzbekistan/);
  assert.doesNotMatch(String(off), /Uzbekistan/);
  assert.ok(String(on).split(" ").length <= 5);
});

test("searchQueryFor: illustration/chalk/minimal uslubida null (fal ga to'g'ridan-to'g'ri)", () => {
  for (const styleId of ["illustration", "chalk", "minimal"] as const) {
    const q = searchQueryFor("Suv aylanishi", { title: "" }, { slideImageStyle: styleId, localExamples: false });
    assert.equal(q, null, `${styleId}: bepul manba so'ralmasligi kerak`);
  }
  // `photo` (yoki meta yo'q) — normal ishlaydi.
  assert.notEqual(searchQueryFor("Suv aylanishi", { title: "" }, { slideImageStyle: "photo", localExamples: false }), null);
  assert.notEqual(searchQueryFor("Suv aylanishi", { title: "" }), null, "meta yo'q — standart `photo` deb olinadi");
});

test("searchQueryFor: gazetteer tanigan mavzuda aniq inglizcha nom ustunlik qiladi", () => {
  const q = searchQueryFor("Registon maydoni", { title: "" }, { slideImageStyle: "photo", localExamples: false });
  assert.ok(q, "so'rov bo'sh bo'lmasligi kerak");
  assert.match(String(q).toLowerCase(), /registan/, "gazetteer manbasidan «Registan» so'zi kelishi kerak");
});

test("searchQueryFor: imageHint sarlavhadan USTUN turadi va allaqachon ingliz bo'lsa to'g'ridan-to'g'ri ishlatiladi", () => {
  const q = searchQueryFor(
    "Mashinasozlik tarixi",
    { title: "Ignore this uzbek title", imageHint: "engine assembly line factory" },
    { slideImageStyle: "photo", localExamples: false },
  );
  assert.match(String(q), /\bengine\b/);
  assert.match(String(q), /\bassembly\b/);
});

test("searchQueryFor: stop-so'zlar chiqarib tashlanadi", () => {
  const q = searchQueryFor(
    "Suv aylanishi",
    { title: "This is a picture of the sun and the water" },
    { slideImageStyle: "photo", localExamples: false },
  );
  const words = String(q).toLowerCase().split(" ");
  for (const stop of ["is", "a", "of", "the", "and"]) {
    assert.ok(!words.includes(stop), `stop-so'z «${stop}» so'rovda qolib ketdi: «${q}»`);
  }
  assert.ok(words.includes("picture") || words.includes("sun") || words.includes("water"));
});

// ───────────────────────────────────────────── 2. Pexels javob shakli

test("Pexels: photos[].src.large2x → https URL, alt bilan", async () => {
  const restore = keysEnv()({ pexels: "test-pexels-key" });
  let seenUrl = "";
  globalThis.fetch = (async (url: string) => {
    seenUrl = String(url);
    return jsonRes(200, {
      photos: [{ src: { large2x: "https://images.pexels.com/photos/1/pexels-photo-1.jpeg?w=712&h=1024" }, alt: "Water cycle" }],
    });
  }) as unknown as typeof fetch;
  try {
    const res = await requestPexelsImage({ prompt: "x", size: { width: 712, height: 1024 }, styleId: "photo", searchQuery: "water cycle" });
    assert.ok(res.ok);
    assert.ok(res.ok && res.image.url === "https://images.pexels.com/photos/1/pexels-photo-1.jpeg?w=712&h=1024");
    assert.ok(res.ok && res.image.alt === "Water cycle");
    assert.match(seenUrl, /^https:\/\/api\.pexels\.com\/v1\/search\?query=water(%20|\+)cycle/);
    assert.match(seenUrl, /orientation=portrait/, "712x1024 — tik slot");
  } finally {
    restore();
  }
});

test("Pexels: large2x yo'q bo'lsa large ga tushadi", async () => {
  const restore = keysEnv()({ pexels: "test-pexels-key" });
  globalThis.fetch = (async () =>
    jsonRes(200, { photos: [{ src: { large: "https://images.pexels.com/photos/2/pexels-photo-2.jpeg" } }] })) as unknown as typeof fetch;
  try {
    const res = await requestPexelsImage({ prompt: "x", size: { width: 1600, height: 900 }, styleId: "photo", searchQuery: "water" });
    assert.ok(res.ok && res.image.url === "https://images.pexels.com/photos/2/pexels-photo-2.jpeg");
  } finally {
    restore();
  }
});

// ───────────────────────────────────────────── 3. Pixabay javob shakli

test("Pixabay: hits[].largeImageURL ishlatiladi", async () => {
  const restore = keysEnv()({ pixabay: "test-pixabay-key" });
  let seenUrl = "";
  globalThis.fetch = (async (url: string) => {
    seenUrl = String(url);
    return jsonRes(200, { hits: [{ largeImageURL: "https://pixabay.com/get/abc-large.jpg", tags: "water, cycle" }] });
  }) as unknown as typeof fetch;
  try {
    const res = await requestPixabayImage({ prompt: "x", size: { width: 1600, height: 900 }, styleId: "photo", searchQuery: "water cycle" });
    assert.ok(res.ok && res.image.url === "https://pixabay.com/get/abc-large.jpg");
    assert.match(seenUrl, /^https:\/\/pixabay\.com\/api\/\?key=test-pixabay-key/);
    assert.match(seenUrl, /orientation=horizontal/);
  } finally {
    restore();
  }
});

// ───────────────────────────────────────────── 4. Kalitsiz / qidiruvsiz — tarmoqqa chiqmaydi

test("kalitsiz manba: no-key, tarmoqqa chiqmaydi", async () => {
  const restore = keysEnv()();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return jsonRes(200, { photos: [] });
  }) as unknown as typeof fetch;
  try {
    const p = await requestPexelsImage({ prompt: "x", size: { width: 100, height: 100 }, styleId: "photo", searchQuery: "water" });
    assert.equal(!p.ok && p.reason, "no-key");
    const b = await requestPixabayImage({ prompt: "x", size: { width: 100, height: 100 }, styleId: "photo", searchQuery: "water" });
    assert.equal(!b.ok && b.reason, "no-key");
    assert.equal(calls, 0);
  } finally {
    restore();
  }
});

test("qidiruv so'rovi yo'q (searchQuery null) bo'lsa kalit bo'lsa ham tarmoqqa chiqmaydi", async () => {
  const restore = keysEnv()({ pexels: "k", pixabay: "k" });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return jsonRes(200, { photos: [] });
  }) as unknown as typeof fetch;
  try {
    const p = await requestPexelsImage({ prompt: "x", size: { width: 100, height: 100 }, styleId: "chalk", searchQuery: null });
    assert.equal(!p.ok && p.reason, "failed");
    const b = await requestPixabayImage({ prompt: "x", size: { width: 100, height: 100 }, styleId: "chalk", searchQuery: undefined });
    assert.equal(!b.ok && b.reason, "failed");
    assert.equal(calls, 0, "so'rov bo'lmasa HTTP chaqiruvi ketmasligi kerak");
  } finally {
    restore();
  }
});

// ───────────────────────────────────────────── 5. Xato tasnifi

test("Pexels/Pixabay xato tasnifi: 401/403 blocked, 429 rate, boshqasi failed", async () => {
  const restore = keysEnv()({ pexels: "k", pixabay: "k" });
  const call = async (fn: typeof requestPexelsImage, status: number) => {
    globalThis.fetch = (async () => jsonRes(status, {})) as unknown as typeof fetch;
    return fn({ prompt: "x", size: { width: 100, height: 100 }, styleId: "photo", searchQuery: "water" });
  };
  try {
    for (const fn of [requestPexelsImage, requestPixabayImage]) {
      assert.equal((await call(fn, 401) as { reason?: string }).reason, "blocked");
      assert.equal((await call(fn, 403) as { reason?: string }).reason, "blocked");
      assert.equal((await call(fn, 429) as { reason?: string }).reason, "rate");
      assert.equal((await call(fn, 500) as { reason?: string }).reason, "failed");
    }
    // Natija bo'sh — ham `failed`.
    globalThis.fetch = (async () => jsonRes(200, { photos: [], hits: [] })) as unknown as typeof fetch;
    const empty1 = await requestPexelsImage({ prompt: "x", size: { width: 100, height: 100 }, styleId: "photo", searchQuery: "water" });
    assert.equal(!empty1.ok && empty1.reason, "failed");
    const empty2 = await requestPixabayImage({ prompt: "x", size: { width: 100, height: 100 }, styleId: "photo", searchQuery: "water" });
    assert.equal(!empty2.ok && empty2.reason, "failed");
  } finally {
    restore();
  }
});

// ───────────────────────────────────────────── 6. photoOrientation

test("photoOrientation: kvadrat/tik/keng slotlarni to'g'ri belgilaydi", () => {
  assert.equal(photoOrientation({ width: 100, height: 100 }), "square");
  assert.equal(photoOrientation({ width: 1600, height: 900 }), "landscape");
  assert.equal(photoOrientation({ width: 712, height: 1024 }), "portrait");
});

// ───────────────────────────────────────────── 7. chainProvider — zanjir mantig'i

function fakeProvider(id: "pexels" | "pixabay" | "fal", impl: ImageProvider["fetchImage"], key = true): ImageProvider {
  return { id, minMs: 1, hasKey: () => key, fetchImage: impl };
}

test("chainProvider: kalitsiz bo'g'in sinab ko'rilmaydi, keyingisi ishlaydi", async () => {
  let pexelsCalls = 0;
  let falCalls = 0;
  const pexels = fakeProvider(
    "pexels",
    async () => {
      pexelsCalls += 1;
      return { ok: false, reason: "no-key", detail: "" };
    },
    false, // kalitsiz
  );
  const fal = fakeProvider("fal", async () => {
    falCalls += 1;
    return { ok: true, image: { url: "https://fal.example/x.jpg" } };
  });
  const chain = chainProvider([pexels, fal]);
  assert.equal(chain.id, "fal", "zanjir identifikatori regressiya uchun `fal` bo'lib qolishi kerak");
  assert.equal(chain.hasKey(), true, "hech bo'lmasa bitta bo'g'in kalitga ega bo'lsa true");
  const res = await chain.fetchImage({ prompt: "x", size: { width: 1, height: 1 }, styleId: "photo" });
  assert.ok(res.ok);
  assert.equal(pexelsCalls, 0, "kalitsiz bo'g'in HECH chaqirilmasligi kerak");
  assert.equal(falCalls, 1);
});

test("chainProvider: birinchi bo'g'in failed/rate bo'lsa keyingisiga o'tadi", async () => {
  let a = 0;
  let b = 0;
  const first = fakeProvider("pexels", async () => {
    a += 1;
    return { ok: false, reason: "failed", detail: "natija yo'q" };
  });
  const second = fakeProvider("pixabay", async () => {
    b += 1;
    return { ok: true, image: { url: "https://pixabay.example/y.jpg" } };
  });
  const chain = chainProvider([first, second]);
  const res = await chain.fetchImage({ prompt: "x", size: { width: 1, height: 1 }, styleId: "photo" });
  assert.ok(res.ok && res.image.url === "https://pixabay.example/y.jpg");
  assert.equal(a, 1);
  assert.equal(b, 1);
});

test("chainProvider: blocked bo'g'in DEKA OXIRIGACHA sakrab o'tiladi (qayta chaqirilmaydi)", async () => {
  let pexelsCalls = 0;
  const pexels = fakeProvider("pexels", async () => {
    pexelsCalls += 1;
    return { ok: false, reason: "blocked", detail: "403" };
  });
  const fal = fakeProvider("fal", async () => ({ ok: true, image: { url: "https://fal.example/x.jpg" } }));
  const chain = chainProvider([pexels, fal]);
  await chain.fetchImage({ prompt: "x", size: { width: 1, height: 1 }, styleId: "photo" }); // slayd 1
  await chain.fetchImage({ prompt: "x", size: { width: 1, height: 1 }, styleId: "photo" }); // slayd 2
  await chain.fetchImage({ prompt: "x", size: { width: 1, height: 1 }, styleId: "photo" }); // slayd 3
  assert.equal(pexelsCalls, 1, "bloklangan bo'g'in bitta sinovdan keyin butun deka davomida chaqirilmasligi kerak");
});

test("chainProvider: hammasi yiqilsa OXIRGI natija (odatda fal) qaytariladi", async () => {
  const pexels = fakeProvider("pexels", async () => ({ ok: false, reason: "failed", detail: "a" }));
  const pixabay = fakeProvider("pixabay", async () => ({ ok: false, reason: "failed", detail: "b" }));
  const fal = fakeProvider("fal", async () => ({ ok: false, reason: "blocked", detail: "403 hisob bloklangan" }));
  const chain = chainProvider([pexels, pixabay, fal]);
  const res = await chain.fetchImage({ prompt: "x", size: { width: 1, height: 1 }, styleId: "photo" });
  assert.equal(res.ok, false);
  assert.equal(!res.ok && res.reason, "blocked", "fal ning haqiqiy blok holati zanjirdan yo'qolmasligi kerak");
  assert.match(!res.ok ? res.detail : "", /403/);
});

test("chainProvider: hech bir bo'g'in kalitga ega bo'lmasa hasKey false", () => {
  const chain = chainProvider([
    fakeProvider("pexels", async () => ({ ok: false, reason: "no-key", detail: "" }), false),
    fakeProvider("pixabay", async () => ({ ok: false, reason: "no-key", detail: "" }), false),
  ]);
  assert.equal(chain.hasKey(), false);
});

test("chainProvider: bitta dekada bir xil foto takrorlanmaydi (seen)", async () => {
  const candidates = ["https://pexels.example/1.jpg", "https://pexels.example/2.jpg", "https://pexels.example/3.jpg"];
  const pexels = fakeProvider("pexels", async (ask) => {
    const pick = candidates.find((u) => !ask.seen?.has(u)) ?? candidates[0];
    return { ok: true, image: { url: pick } } as ImageResult;
  });
  const chain = chainProvider([pexels]);
  const r1 = await chain.fetchImage({ prompt: "x", size: { width: 1, height: 1 }, styleId: "photo" });
  const r2 = await chain.fetchImage({ prompt: "x", size: { width: 1, height: 1 }, styleId: "photo" });
  const r3 = await chain.fetchImage({ prompt: "x", size: { width: 1, height: 1 }, styleId: "photo" });
  assert.ok(r1.ok && r2.ok && r3.ok);
  const urls = [r1, r2, r3].map((r) => (r.ok ? r.image.url : ""));
  assert.equal(new Set(urls).size, 3, `har slaydga BOSHQA foto berilishi kerak: ${urls.join(", ")}`);
});

// ───────────────────────────────────────────── 8. pickProvider — regressiya

test("pickProvider: slide → FAQAT stock zanjiri (`stock`), meta'siz → eski zanjir (`fal`)", () => {
  assert.equal(pickProvider(meta()).id, "stock");
  assert.equal(pickProvider().id, "fal", "meta'siz chaqiruv yo'li o'zgarmaydi — regressiya qulfi");
});

// ───────────────────────────────────────────── 9. attachSlideImages — to'liq zanjir integratsiyasi

const bullet = (i: number, title = `Mavzu ${i}`): SlideModel => ({ id: `s${i}`, layout: "bullets", title });
const deck = (n: number): SlideModel[] => Array.from({ length: n }, (_, i) => bullet(i));

test("attachSlideImages: pexels ishlasa pixabay/fal umuman chaqirilmaydi", async () => {
  const restore = keysEnv()({ pexels: "k", pixabay: "k", fal: "k" });
  const hits: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.startsWith("https://api.pexels.com/")) {
      hits.push("pexels");
      return jsonRes(200, { photos: [{ src: { large2x: "https://images.pexels.com/photo.jpg" } }] });
    }
    if (u.startsWith("https://pixabay.com/api/")) {
      hits.push("pixabay");
      return jsonRes(200, { hits: [] });
    }
    if (u.startsWith("https://fal.run/")) {
      hits.push("fal");
      return jsonRes(200, { images: [{ url: "https://fal.example/z.jpg" }] });
    }
    return imgRes(); // rasm baytlarini yuklab olish bosqichi
  }) as unknown as typeof fetch;
  try {
    const report = await attachSlideImages(deck(3), "Suv aylanishi", "classic", 60_000, { meta: meta() });
    assert.equal(report.got, 3);
    assert.deepEqual(hits, ["pexels", "pexels", "pexels"], "pexels har safar yetkazsa boshqa manba kerak emas");
  } finally {
    restore();
  }
});

test("attachSlideImages: oddiy slayd stock kalitsiz bo'lsa RASMSIZ qoladi — fal chaqirilmaydi, va'da nol; meta'siz yo'l fal da qoladi", async () => {
  const restore = keysEnv()({ fal: "k" }); // faqat FAL_KEY
  const hits: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.startsWith("https://api.pexels.com/") || u.startsWith("https://pixabay.com/api/")) {
      hits.push("stock");
      return jsonRes(200, {});
    }
    if (u.startsWith("https://fal.run/")) {
      hits.push("fal");
      return jsonRes(200, { images: [{ url: "https://fal.example/z.jpg" }] });
    }
    return imgRes();
  }) as unknown as typeof fetch;
  try {
    const report = await attachSlideImages(deck(2), "Suv aylanishi", "classic", 60_000, { meta: meta() });
    // MUTATSIYA: `pickProvider` oddiy slayd zanjiriga `falProvider` qo'shsa — got 2, hits ["fal","fal"].
    assert.equal(report.got, 0, "oddiy slayd pullik fal ga tushmasin");
    assert.equal(report.want, 0, "kalitsiz stock — rasm VA'DA qilinmaydi (pul ushlanmaydi)");
    assert.deepEqual(hits, [], "na stock (kalit yo'q), na fal");
    // Meta'siz chaqiruv (eski yo'l, image-lab) — fal hamon ishlaydi.
    const legacy = await attachSlideImages(deck(2), "Suv aylanishi", "classic", 60_000, {});
    assert.equal(legacy.got, 2);
    assert.deepEqual(hits, ["fal", "fal"]);
  } finally {
    restore();
  }
});

test("attachSlideImages: oddiy slaydda `chalk` yuborilsa ham uslub foto — stock sinaladi, fal chaqirilmaydi", async () => {
  const restore = keysEnv()({ pexels: "k", pixabay: "k", fal: "k" });
  const hits: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.startsWith("https://api.pexels.com/")) {
      hits.push("stock");
      return jsonRes(200, { photos: [{ src: { large2x: "https://pexels.example/p.jpg" }, alt: "p" }] });
    }
    if (u.startsWith("https://fal.run/")) {
      hits.push("fal");
      return jsonRes(200, { images: [{ url: "https://fal.example/z.jpg" }] });
    }
    return imgRes();
  }) as unknown as typeof fetch;
  try {
    // `extractMeta` oddiy slaydda uslubni `photo` ga majburlaydi — `searchQueryFor` so'rov beradi.
    const m = meta({ slideImageStyle: "chalk" });
    assert.equal(m.slideImageStyle, "photo");
    const report = await attachSlideImages(deck(2), "Suv aylanishi", "classic", 60_000, { meta: m });
    assert.equal(report.got, 2);
    assert.deepEqual(hits, ["stock", "stock"], "oddiy slayd faqat bepul manbadan");
  } finally {
    restore();
  }
});

/*
 * DIQQAT: `attachSlideImages` slaydlarni `IMAGE_LANES` bo'yicha
 * PARALLEL ishlaydi (`mapPool`) — ya'ni 2 ta slaydning HTTP so'rovlari
 * bir-biriga ARALASHIB ketishi mumkin. Shu sabab bu ikki test aniq
 * CHAQIRUV TARTIBI emas, faqat YAKUNIY SONLARNI tekshiradi (interleave
 * bilan ham barqaror).
 */
test("attachSlideImages: pexels rate bersa (blok emas) pixabay har slaydda qayta sinaladi va yetkazadi", async () => {
  const restore = keysEnv()({ pexels: "k", pixabay: "k", fal: "k" });
  const hits: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes("api.pexels.com")) {
      hits.push("pexels");
      return jsonRes(429, {}); // vaqtinchalik — blok EMAS, har slaydda qayta sinaladi
    }
    if (u.includes("pixabay.com")) {
      hits.push("pixabay");
      return jsonRes(200, { hits: [{ largeImageURL: "https://pixabay.example/ok.jpg" }] });
    }
    if (u.startsWith("https://fal.run/")) {
      hits.push("fal");
      return jsonRes(200, { images: [{ url: "https://fal.example/z.jpg" }] });
    }
    return imgRes(); // rasm baytlarini yuklab olish bosqichi (pixabay/fal URL'lari)
  }) as unknown as typeof fetch;
  try {
    const report = await attachSlideImages(deck(3), "Suv aylanishi", "classic", 60_000, { meta: meta() });
    assert.equal(report.got, 3, "pixabay har slaydda yetkazishi kerak");
    assert.equal(hits.filter((h) => h === "pexels").length, 3, "pexels HAR slaydda qayta sinaladi — 429 blok emas");
    assert.equal(hits.filter((h) => h === "pixabay").length, 3);
    assert.equal(hits.filter((h) => h === "fal").length, 0, "pixabay yetkazgach fal umuman kerak emas");
  } finally {
    restore();
  }
});

test("attachSlideImages: pexels va pixabay ikkalasi ham yiqilsa — oddiy slayd RASMSIZ (fal zaxira EMAS); meta'siz yo'lda fal zaxira", async () => {
  const restore = keysEnv()({ pexels: "k", pixabay: "k", fal: "k" });
  const hits: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes("api.pexels.com")) {
      hits.push("pexels");
      return jsonRes(429, {});
    }
    if (u.includes("pixabay.com")) {
      hits.push("pixabay");
      return jsonRes(500, {});
    }
    if (u.startsWith("https://fal.run/")) {
      hits.push("fal");
      return jsonRes(200, { images: [{ url: "https://fal.example/z.jpg" }] });
    }
    return imgRes(); // rasm baytlarini yuklab olish bosqichi (pixabay/fal URL'lari)
  }) as unknown as typeof fetch;
  try {
    const report = await attachSlideImages(deck(3), "Suv aylanishi", "classic", 60_000, { meta: meta() });
    assert.equal(report.got, 0, "oddiy slaydda fal zaxira emas — rasmsiz qoladi");
    assert.equal(hits.filter((h) => h === "fal").length, 0, "fal umuman chaqirilmaydi");
    assert.ok(hits.includes("pexels") && hits.includes("pixabay"), "ikkala bepul manba sinaladi");
    hits.length = 0;
    const legacy = await attachSlideImages(deck(3), "Suv aylanishi", "classic", 60_000, {});
    assert.equal(legacy.got, 3, "meta'siz (eski) yo'lda fal yakuniy zaxira bo'lib qoladi");
    assert.equal(hits.filter((h) => h === "fal").length, 3);
  } finally {
    restore();
  }
});

// Import qulaylik uchun — modul ichida ishlatilmagan eksportlarni tekshirish
void pexelsProvider;
void pixabayProvider;
