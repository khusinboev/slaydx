import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { SLIDE_IMAGE_STYLES } from "../lib/generation/slide-params.ts";
import { composeSlideImagePrompt } from "../lib/generation/slide-image-prompts.ts";
import { photoSlot, slotPixels } from "../lib/generation/slide-layout.ts";
import { attachSlideImages, plannedImageSlots, imageBudget, PRO_IMAGE_LANES } from "../lib/generation/slide-images.ts";
import { pickProvider, requestBudget } from "../lib/generation/image-provider.ts";
import { aspectFor, requestGeminiImage, GEMINI_ASPECTS, GEMINI_IMAGE_CAP_MS } from "../lib/generation/image-provider-gemini.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";

/**
 * RASM PROVAYDERI VA USLUBLARI (AUDIT-9 WP-E).
 *
 * Hech bir test JONLI rasm chaqiruvi qilmaydi — har biri $0.067 turadi.
 * `fetch` stub qilinadi, ya'ni bu yerda MANTIQ sinaladi: provayder
 * tanlash, javob shaklini o'qish, xato tasnifi, uslubning promptga
 * yetib borishi. Rasmning KO'RINISHI faqat `npm run image-lab` da
 * o'lchanadi.
 */

const pro = TOOL_BY_ID["pro-slide"];
const slide = TOOL_BY_ID.slide;
const meta = (v: FormValues = {}, tool = pro) => extractMeta(tool, { topic: "Suv aylanishi", ...v });

const bulletSlide = (i: number): SlideModel => ({ id: `s${i}`, layout: "bullets", title: `Slayd ${i + 1}` });
const bulletDeck = (n: number): SlideModel[] => Array.from({ length: n }, (_, i) => bulletSlide(i));

const WIDE = slotPixels(photoSlot("quote", "classic")!);
const TALL = slotPixels(photoSlot("bullets", "classic")!);

// ───────────────────────────────────────────── 1. Uslub promptga yetadi

/**
 * AYNAN WP-E ning sababi. `slide-image-prompts.ts` da qat'iy
 *
 *   "Photorealistic presentation photograph. No illustration unless …"
 *
 * turardi. Ya'ni foydalanuvchi formada «Doska» yoki «Illustratsiya»
 * tanlasa ham, slayd rasmi HAR DOIM foto so'rardi va `slideImageStyle`
 * maydoni bezakka aylanardi — `slide-params.ts` reyestri esa uni
 * `impacts: ["images"]` deb E'LON qilgan edi.
 */
test("4 slayd uslubi 4 xil rasm prompti beradi va fotorealizm qat'iyligi yo'qoladi", () => {
  const prompts = SLIDE_IMAGE_STYLES.map((id) =>
    composeSlideImagePrompt("Suv aylanishi", bulletSlide(0), TALL, {
      slideImageStyle: id,
      localExamples: false,
    }),
  );

  assert.equal(new Set(prompts).size, SLIDE_IMAGE_STYLES.length, "har uslub o'z promptini berishi kerak");
  for (const [i, p] of prompts.entries()) {
    assert.doesNotMatch(
      p,
      /Photorealistic presentation photograph/,
      `${SLIDE_IMAGE_STYLES[i]}: eski qat'iy foto qatori qolib ketgan`,
    );
  }

  const byId = Object.fromEntries(SLIDE_IMAGE_STYLES.map((id, i) => [id, prompts[i]]));
  assert.match(byId.chalk, /chalk/i, "«Doska» uslubi bo'r/doska lug'atini olib kelishi kerak");
  assert.match(byId.chalk, /NOT a photograph/, "foto bo'lmagan uslub aniq inkor bilan yozilishi kerak");
  assert.match(byId.illustration, /VECTOR ILLUSTRATION/, "illyustratsiya o'z vositasini olishi kerak");
  assert.doesNotMatch(byId.chalk, /VECTOR ILLUSTRATION/, "uslublar bir-biriga oqib ketmasin");

  // Meta berilmagan eski chaqiruv — `photo` standarti, regressiya yo'q.
  const bare = composeSlideImagePrompt("Suv aylanishi", bulletSlide(0), TALL);
  assert.equal(bare, byId.photo, "meta'siz chaqiruv `photo` uslubi bilan bir xil bo'lishi kerak");
});

/**
 * `localExamples` ham `impacts: ["images"]` bilan e'lon qilingan, lekin
 * WP-E gacha rasm promptiga UMUMAN tegmasdi: bayroq faqat matn briefiga
 * borardi. «O'zbekiston misollari» yozilgan taqdimotda matn mahalliy,
 * rasm esa umumiy chet el sahnasi bo'lib chiqardi.
 */
test("localExamples rasm promptini o'zgartiradi — tanilmagan mavzuda ham", () => {
  const off = composeSlideImagePrompt("Suv aylanishi", bulletSlide(0), TALL, {
    slideImageStyle: "photo",
    localExamples: false,
  });
  const on = composeSlideImagePrompt("Suv aylanishi", bulletSlide(0), TALL, {
    slideImageStyle: "photo",
    localExamples: true,
  });
  assert.notEqual(on, off, "bayroq rasm promptiga yetmagan — bezak maydon");
  assert.match(on, /Uzbekistan/);
  assert.doesNotMatch(off, /Uzbekistan/);

  /*
   * Gazetteer tanigan mavzuda ANIQ vizual faktlar ham qo'shiladi —
   * aks holda «Registon» modelning xayolidagi umumiy «sharqona»
   * maydonga aylanib ketardi (mustaqil «Rasm» vositasidagi bilan
   * bitta manba: `groundUzbekScene`).
   */
  const known = composeSlideImagePrompt("Registon maydoni", bulletSlide(0), TALL, {
    slideImageStyle: "photo",
    localExamples: true,
  });
  assert.match(known, /Known visual facts about this exact subject/);
  assert.doesNotMatch(on, /Known visual facts/, "tanilmagan mavzuda faktlar to'qib chiqarilmaydi");
});

// ───────────────────────────────────────────── 2. Provayder tanlash

test("pickProvider: pro-slide → gemini, slide → fal, meta yo'q → fal", () => {
  assert.equal(pickProvider(meta({}, pro)).id, "gemini");
  assert.equal(pickProvider(meta({}, slide)).id, "fal");
  // Eski (meta'siz) chaqiruv yo'li o'zgarmaydi — regressiya qulfi.
  assert.equal(pickProvider().id, "fal");
  assert.equal(pickProvider(undefined).id, "fal");
  assert.equal(pickProvider(null).id, "fal");
  // Slayd bo'lmagan vosita ham fal da qoladi.
  assert.equal(pickProvider(extractMeta(TOOL_BY_ID.image, { topic: "olma" })).id, "fal");
});

// ───────────────────────────────────────────── 3. Gemini nisbat tanlash

/**
 * Slot nisbati ixtiyoriy son, provayder esa faqat 10 ta nisbatni
 * qabul qiladi — mos kelmasa 400 qaytaradi. Eng yaqini LOGARIFMDA
 * o'lchanadi: chiziqli ayirma tik slotlarni sun'iy ravishda 1:1 ga
 * tortardi.
 */
test("aspectFor haqiqiy slaydlar slotidan ruxsat etilgan eng yaqin nisbatni beradi", () => {
  // To'la ekran (quote/closing/magazine) — 13.333 × 7.5 dyuym.
  assert.equal(aspectFor(WIDE), "16:9");
  // Klassik o'ng ustun — 5.233 × 7.5 dyuym → 712×1024 px.
  assert.equal(TALL.width, 712);
  assert.equal(TALL.height, 1024);
  assert.equal(aspectFor(TALL), "2:3");

  assert.equal(aspectFor({ width: 1024, height: 1024 }), "1:1");
  assert.equal(aspectFor({ width: 576, height: 1024 }), "9:16");
  assert.equal(aspectFor({ width: 1024, height: 768 }), "4:3");
  // Buzuq kirish yiqilmaydi va ro'yxatdan chiqmaydi.
  assert.ok(GEMINI_ASPECTS.includes(aspectFor({ width: 0, height: 0 })));
});

// ───────────────────────────────────────────── 4. Gemini javob shakli

function geminiEnv() {
  const saved = { gemini: process.env.GEMINI_API_KEY, xai: process.env.XAI_API_KEY, fetch: globalThis.fetch };
  process.env.GEMINI_API_KEY = "test-gemini-key";
  delete process.env.XAI_API_KEY;
  return () => {
    globalThis.fetch = saved.fetch;
    if (saved.gemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved.gemini;
    if (saved.xai !== undefined) process.env.XAI_API_KEY = saved.xai;
  };
}

/** 1×1 px JPEG — `fetchImageBytes` ning sniff tekshiruvidan o'tadigan haqiqiy baytlar. */
const JPEG_1PX =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

/**
 * JONLI TASDIQLANGAN javob (2026-09-08, bitta pullik chaqiruv):
 * rasm `$.steps[1].content[0]` da `{ data, mime_type }` bo'lib keladi.
 * Indeks QATTIQ YOZILMAGAN — model bitta qadam qo'shsa (masalan
 * xavfsizlik filtri) rasm surilib ketardi va qattiq yo'l jimgina
 * `failed` bera boshlardi.
 */
const geminiOkBody = (data = JPEG_1PX) => ({
  created: 1,
  id: "int_1",
  model: "gemini-3.1-flash-image",
  object: "interaction",
  status: "completed",
  steps: [
    { type: "reasoning", content: [{ type: "text", text: "thinking" }] },
    { type: "message", content: [{ data, mime_type: "image/jpeg" }] },
  ],
  usage: { output_tokens: 1550 },
});

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as never;
}

test("gemini provayderi jonli javob shaklidan data: URL yasaydi", async () => {
  const restore = geminiEnv();
  let seen: { url: string; body: Record<string, unknown>; key: string } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen = {
      url: String(url),
      body: JSON.parse(String(init.body)),
      key: String((init.headers as Record<string, string>)["x-goog-api-key"]),
    };
    return jsonRes(200, geminiOkBody());
  }) as unknown as typeof fetch;

  try {
    const res = await requestGeminiImage(
      { prompt: "chalk drawing of the water cycle", size: WIDE, styleId: "chalk" },
      Date.now() + 60_000,
    );
    assert.ok(res.ok, "jonli shakldagi javob `ok` bo'lishi kerak");
    assert.ok(res.ok && res.image.url.startsWith("data:image/jpeg;base64,"), res.ok ? res.image.url.slice(0, 40) : "");

    const req = seen!;
    assert.equal(req.url, "https://generativelanguage.googleapis.com/v1beta/interactions");
    assert.equal(req.key, "test-gemini-key", "kalit `x-goog-api-key` sarlavhasida — URL da emas");
    assert.equal(req.body.model, "gemini-3.1-flash-image", "model TANADA yuboriladi, URL da emas");
    assert.deepEqual(req.body.input, [{ type: "text", text: "chalk drawing of the water cycle" }]);
    assert.deepEqual(req.body.response_format, {
      type: "image",
      mime_type: "image/jpeg",
      aspect_ratio: "16:9",
      image_size: "1K",
    });
  } finally {
    restore();
  }
});

test("gemini: rasm `steps` ning boshqa indeksiga surilsa ham topiladi", async () => {
  const restore = geminiEnv();
  globalThis.fetch = (async () =>
    jsonRes(200, {
      steps: [
        { content: [{ type: "text", text: "a" }] },
        { content: [{ type: "text", text: "b" }] },
        { content: [{ type: "text", text: "c" }, { data: JPEG_1PX, mime_type: "image/png" }] },
      ],
    })) as unknown as typeof fetch;
  try {
    const res = await requestGeminiImage({ prompt: "x", size: WIDE, styleId: "photo" });
    assert.ok(res.ok);
    assert.ok(res.ok && res.image.url.startsWith("data:image/png;base64,"));
  } finally {
    restore();
  }
});

/**
 * Xato TASNIFI shartnomaning bir qismi: `attachSlideImages` `blocked`
 * ni ko'rib qolgan so'rovlarni bekor qiladi, `rate`/`failed` ni esa
 * `failed` deb sanaydi va `timeout` ni `skipped`. Noto'g'ri tasniflansa
 * pul qaytarish jurnali yolg'on bo'lardi.
 */
test("gemini xato tasnifi: 403 blocked, 429 rate, 500/buzuq javob failed", async () => {
  const restore = geminiEnv();
  const call = async (status: number, body: unknown) => {
    globalThis.fetch = (async () => jsonRes(status, body)) as unknown as typeof fetch;
    return requestGeminiImage({ prompt: "x", size: WIDE, styleId: "photo" });
  };
  try {
    const blocked = await call(403, { error: { message: "Billing not enabled" } });
    assert.equal(blocked.ok, false);
    assert.equal(!blocked.ok && blocked.reason, "blocked");
    assert.match(!blocked.ok ? blocked.detail : "", /403 .*Billing not enabled/, "sabab hisobotga yetishi kerak");

    const badKey = await call(401, { error: { message: "API key not valid" } });
    assert.equal(!badKey.ok && badKey.reason, "blocked", "401 — kalit, qayta urinish ma'nosiz");

    const rate = await call(429, { error: { message: "Quota exceeded" } });
    assert.equal(!rate.ok && rate.reason, "rate", "429 vaqtinchalik — blok bilan aralashmasin");

    const server = await call(500, { error: { message: "internal" } });
    assert.equal(!server.ok && server.reason, "failed");

    // HTTP 200, lekin javobda rasm yo'q (faqat matn qaytdi).
    const noImage = await call(200, { steps: [{ content: [{ type: "text", text: "sorry" }] }] });
    assert.equal(!noImage.ok && noImage.reason, "failed");
    assert.match(!noImage.ok ? noImage.detail : "", /rasm yo‘q|rasm yo'q/);

    // Butunlay buzuq javob — yiqilmaydi, `failed` bo'ladi.
    const junk = await call(200, { steps: "not-an-array" });
    assert.equal(!junk.ok && junk.reason, "failed");
    const empty = await call(200, null);
    assert.equal(!empty.ok && empty.reason, "failed");
  } finally {
    restore();
  }
});

test("gemini: kalitsiz `no-key`, byudjetsiz `timeout` — tarmoqqa chiqmaydi", async () => {
  const restore = geminiEnv();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return jsonRes(200, geminiOkBody());
  }) as unknown as typeof fetch;
  try {
    // Byudjet 2 s dan kam — so'rov umuman yuborilmaydi.
    const late = await requestGeminiImage({ prompt: "x", size: WIDE, styleId: "photo" }, Date.now() + 500);
    assert.equal(!late.ok && late.reason, "timeout");
    assert.equal(calls, 0, "byudjet tugaganda pullik chaqiruv ketmasligi kerak");

    delete process.env.GEMINI_API_KEY;
    const noKey = await requestGeminiImage({ prompt: "x", size: WIDE, styleId: "photo" });
    assert.equal(!noKey.ok && noKey.reason, "no-key");
    assert.equal(calls, 0);
  } finally {
    restore();
  }
});

// ───────────────────────────────────────────── 5. Pro deka: shift yo'q

/**
 * `imageBudget` SHIFTI `pro-slide` da qo'llanmaydi.
 *
 * Nuqson: foydalanuvchi har slaydga alohida to'laydi
 * (`PRO_SLIDE_PER_SLIDE`), lekin 30 slaydli dekada `imageBudget(30)`
 * 24 ta rasm bergani uchun oxirgi 6 slayd jimgina rasmsiz qolardi —
 * va'da (`doc.slideImages.want`) ham 24 deb yozilardi, ya'ni kamomad
 * hisobotga ham tushmasdi.
 */
test("pro deka: 30 slaydda va'da slot soniga teng, 8/10 shift yo'q", async () => {
  const slides = bulletDeck(30);
  const capped = plannedImageSlots(slides, "classic", false, false);
  const full = plannedImageSlots(slides, "classic", false, true);

  assert.equal(capped.length, imageBudget(30, false), "oddiy yo'lda shift saqlanadi (regressiya qulfi)");
  assert.equal(capped.length, 24);
  assert.equal(full.length, 30, "pro'da har mos slayd rasm oladi");

  const restore = geminiEnv();
  let calls = 0;
  globalThis.fetch = (async (url: string) => {
    // LLM prompt yozuvchisi shu stubga urilmasin — u alohida endpoint.
    if (!String(url).includes("/interactions")) return jsonRes(500, {});
    calls += 1;
    return jsonRes(200, geminiOkBody());
  }) as unknown as typeof fetch;
  try {
    const report = await attachSlideImages(bulletDeck(30), "Suv aylanishi", "classic", 60_000, {
      meta: meta({ slideCount: 30 }, pro),
    });
    assert.equal(report.want, 30, "hisobotdagi va'da ham 30 bo'lishi kerak");
    assert.equal(report.got, 30, "hamma slot yetkazilishi kerak");
    assert.equal(calls, 30, "har slot uchun bitta rasm chaqiruvi");
  } finally {
    restore();
  }
});

/**
 * Pro yo'li Gemini ga boradi, oddiy `slide` esa fal da QOLADI. Ikkinchisi
 * regressiya qulfi: WP-E oddiy vositaning rasm yo'liga tegmasligi kerak.
 */
test("attachSlideImages meta orqali provayderni almashtiradi", async () => {
  const restore = geminiEnv();
  const savedFal = process.env.FAL_KEY;
  process.env.FAL_KEY = "test-fal-key";
  const hits: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes("/interactions")) {
      hits.push("gemini");
      return jsonRes(200, geminiOkBody());
    }
    if (u.startsWith("https://fal.run/")) {
      hits.push("fal");
      return jsonRes(200, { images: [{ url: `data:image/jpeg;base64,${JPEG_1PX}` }] });
    }
    return jsonRes(500, {});
  }) as unknown as typeof fetch;

  try {
    await attachSlideImages(bulletDeck(4), "Suv aylanishi", "classic", 60_000, { meta: meta({}, pro) });
    assert.deepEqual(hits, ["gemini", "gemini", "gemini", "gemini"], "pro yo'li gemini ga borishi kerak");

    hits.length = 0;
    await attachSlideImages(bulletDeck(4), "Suv aylanishi", "classic", 60_000, { meta: meta({}, slide) });
    assert.deepEqual(hits, ["fal", "fal", "fal", "fal"], "oddiy slayd fal da QOLISHI kerak — regressiya qulfi");

    // Gemini kaliti yo'q bo'lsa pro deka rasm VA'DA QILMAYDI (pul ushlanmaydi).
    delete process.env.GEMINI_API_KEY;
    const dry = await attachSlideImages(bulletDeck(4), "Suv aylanishi", "classic", 60_000, { meta: meta({}, pro) });
    assert.equal(dry.want, 0, "kalitsiz gemini yo'lida va'da nol bo'lishi kerak");
  } finally {
    if (savedFal === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = savedFal;
    restore();
  }
});

/**
 * Gemini 403 bergan holat fal bilan BIR XIL ishlanishi kerak: hisobot
 * `blocked` bo'ladi, sabab `blockReason` da qoladi va qolgan so'rovlar
 * yuborilmaydi (jonli sinovda fal da 19 → 3 chaqiruv tejagan mexanizm).
 */
test("gemini bloklansa hisobot fal bilan bir xil to'ldiriladi va so'rov to'xtaydi", async () => {
  const restore = geminiEnv();
  let calls = 0;
  globalThis.fetch = (async (url: string) => {
    if (!String(url).includes("/interactions")) return jsonRes(500, {});
    calls += 1;
    return jsonRes(403, { error: { message: "Billing account is disabled" } });
  }) as unknown as typeof fetch;
  try {
    const slides = bulletDeck(12);
    const report = await attachSlideImages(slides, "Suv aylanishi", "classic", 60_000, { meta: meta({}, pro) });
    assert.equal(report.want, 12);
    assert.equal(report.got, 0);
    assert.equal(report.blocked, 12, "hamma slot bloklangan deb sanalishi kerak");
    assert.equal(report.skipped, 0, "bu vaqt muammosi EMAS");
    assert.match(String(report.blockReason), /Billing account is disabled/);
    assert.equal(slides.filter((s) => s.image).length, 0);
    // Yo'lak soni KONSTANTADAN o'qiladi — shuncha so'rov yo'lda bo'lishi
    // mumkin, ortig'i yo'q. Sehrli son yozilsa yo'laklik o'zgarganda test
    // kodni emas, o'zini sinagan bo'lardi.
    assert.ok(calls <= PRO_IMAGE_LANES, `blokdan keyin to'xtashi kerak, yuborilgani: ${calls}`);
    assert.ok(calls < report.want);
  } finally {
    restore();
  }
});

/*
 * X-2 (AUDIT-9, jonli sinovda topilgan): Gemini rasm so'rovining shifti
 * fal ga mo'ljallangan 45 s edi. O'lchov: sarlavha ~13 s + 2.3 MB tanani
 * o'qish ~20 s; uzunroq promptda 45 s dan oshadi va `res.json()` uzilib,
 * xato «javobda rasm yo'q» (failed) bo'lib ko'rinardi — jonli dekada
 * 7/7 rasm shu sabab yo'qolgan edi. Endi shift 120 s va uzilish
 * `timeout` (skipped) deb tasniflanadi.
 */
test("gemini rasm shifti fal nikidan katta va tana uzilishi timeout deb sanaladi", async () => {
  const restore = geminiEnv();
  try {
    assert.ok(GEMINI_IMAGE_CAP_MS >= 90_000, `shift juda kichik: ${GEMINI_IMAGE_CAP_MS}`);
    // Byudjet shiftni ham, muddatni ham hisobga oladi — kichigi yutadi.
    assert.equal(requestBudget(Date.now() + 300_000, GEMINI_IMAGE_CAP_MS), GEMINI_IMAGE_CAP_MS);

    // 200 keldi, lekin tana o'qilmadi (uzildi) → `timeout`, `failed` emas.
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => {
        const e = new Error("The operation was aborted due to timeout");
        e.name = "TimeoutError";
        throw e;
      },
    })) as unknown as typeof fetch;
    const res = await requestGeminiImage(
      { prompt: "test", size: { width: 1024, height: 576 }, styleId: "photo" },
      Date.now() + 120_000,
    );
    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.reason, "timeout");
    assert.match(res.ok === false ? res.detail : "", /tana/);

    // Hisobotda bu `skipped` — «failed» emas: pul/kalit muammosi emas.
    const slides = bulletDeck(2);
    const report = await attachSlideImages(slides, "Suv aylanishi", "classic", 60_000, { meta: meta({}, pro) });
    assert.equal(report.skipped, report.want);
    assert.equal(report.failed, 0);
  } finally {
    restore();
  }
});
