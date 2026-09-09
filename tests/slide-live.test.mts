import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import {
  buildSlideAcademicDoc,
  deckBeats,
  extractNewSlides,
  resolveDeckTemplate,
  wantSlides,
  writeSlidesWithLlm,
} from "../lib/generation/slide-write.ts";
import { bodyRules } from "../lib/generation/slide-audience.ts";
import type { SlideBeat } from "../lib/generation/slide-templates.ts";
import type { SlideProgressEvent } from "../lib/generation/slide-progress.ts";

/**
 * L2 — DVIGATEL HODISALARI.
 *
 * Bu yerda qulflanadigan narsa — «ko'rdim = oldim» ning jonli tomoni:
 *
 *  1. YARIM SLAYD CHIQMASIN. `parseLlmJson` kesilgan javobdan yarim
 *     to'ldirilgan oxirgi elementni ATAYIN saqlaydi (matn hujjatlarida
 *     u foydali). Jonli slaydda esa u sarlavhasi bor-u bandsiz slayd
 *     bo'lib ekranga chiqar va bir soniyadan keyin jimgina almashardi.
 *     `extractNewSlides` shu sababli `length - 1` gacha o'qiydi.
 *  2. INDEKS ABSOLYUT. 16 slaydli deka ikki bo'lakdan yig'iladi;
 *     ikkinchi bo'lakning ichki `0` i — dekaning `8` i. `from +` siz
 *     ikkinchi bo'lak birinchisining ustiga yozilardi.
 *  3. TAKROR YO'Q. `llmStream` ichidagi `withRetry` oqimni BOSHIDAN
 *     boshlaydi, `writeSlidesWithLlm` esa kam slayd qaytgan bo'lakni
 *     ikkinchi marta so'raydi. `emittedAbs` siz bir indeks ikki xil
 *     matn bilan kelib, ko'ruvchida slayd «orqaga» yozilardi.
 *  4. OQIM MAJBURIY EMAS. `LLM_STREAM=false` (yoki oqimni
 *     qo'llamaydigan provayder) da ham slaydlar HODISA bo'lib chiqadi —
 *     faqat bo'lak oxirida, guruh bo'lib. Aks holda kill-switch jonli
 *     ko'rinishni butunlay o'chirardi.
 *  5. HODISA — NUSXA. `attachSlideImages` slaydlarni JOYIDA
 *     o'zgartiradi; hodisa obyekti keyin o'zgarsa, worker allaqachon
 *     yozib yuborgan `live_json` bilan farq qilardi.
 *
 * Hech bir test JONLI chaqiruv qilmaydi — `fetch` stub qilinadi.
 */

const slideTool = TOOL_BY_ID.slide;
const proTool = TOOL_BY_ID["pro-slide"];
const footer = "Test · 2026";
const rules = bodyRules(extractMeta(slideTool, { topic: "Suv aylanishi" }), "lecture");

/** Bitta slayd obyekti — modeldan kelgan shakl (normalizatsiyadan OLDIN). */
const rawSlide = (n: number) => ({
  layout: "bullets",
  title: `Slayd ${n}`,
  bullets: [`Band A${n}`, `Band B${n}`],
});

const deckJson = (objs: unknown[]) => JSON.stringify({ slides: objs });

// ───────────────────────────────────────────── 1. extractNewSlides

test("extractNewSlides: yarim to'ldirilgan oxirgi element TAYYOR sanalmaydi", () => {
  // Ikki to'liq slayd + uchinchisining boshi — aynan oqim o'rtasidagi holat.
  const partial = `{"slides":[${JSON.stringify(rawSlide(1))},${JSON.stringify(rawSlide(2))},{"layout":"bullets","title":"Slayd 3`;
  const got = extractNewSlides(partial, 0, footer, rules, { final: false });
  assert.equal(got.length, 2, "yarim slayd chiqib ketdi");
  assert.deepEqual(
    got.map((x) => x.index),
    [0, 1],
  );
  assert.equal(got[0].slide.title, "Slayd 1");
  assert.equal(got[0].slide.footer, footer, "footer normalizatsiyada qo'yiladi");
  assert.deepEqual(got[1].slide.bullets, ["Band A2", "Band B2"]);
});

test("extractNewSlides: `final` da oxirgi element ham chiqadi", () => {
  const whole = deckJson([rawSlide(1), rawSlide(2), rawSlide(3)]);
  const live = extractNewSlides(whole, 0, footer, rules, { final: false });
  assert.equal(live.length, 2, "oqim rejimida oxirgisi hali TAYYOR emas");
  const final = extractNewSlides(whole, 0, footer, rules, { final: true });
  assert.equal(final.length, 3);
  assert.equal(final[2].index, 2);
  assert.equal(final[2].slide.title, "Slayd 3");
});

test("extractNewSlides: `emitted` dan oldingilari qayta chiqmaydi", () => {
  const whole = deckJson([rawSlide(1), rawSlide(2), rawSlide(3)]);
  const got = extractNewSlides(whole, 2, footer, rules, { final: true });
  assert.equal(got.length, 1, "faqat 3-chi qolishi kerak");
  assert.equal(got[0].index, 2);
});

test("extractNewSlides: buzuq/bo'sh javobda bo'sh ro'yxat, throw yo'q", () => {
  for (const bad of ["", "salom", "{}", `{"slides":"emas"}`, "[1,2,3]"]) {
    assert.deepEqual(extractNewSlides(bad, 0, footer, rules, { final: true }), [], bad);
  }
});

// ───────────────────────────────────────────── 2. SSE stub infratuzilmasi

type Reply = (url: string, index: number) => unknown;

/** `globalThis.fetch` + kalitlarni almashtiradi va oxirida TIKLAYDI. */
async function withLlm(reply: Reply, fn: (urls: string[]) => Promise<void>, stream?: string) {
  const saved = {
    fetch: globalThis.fetch,
    gemini: process.env.GEMINI_API_KEY,
    xai: process.env.XAI_API_KEY,
    fal: process.env.FAL_KEY,
    stream: process.env.LLM_STREAM,
  };
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.XAI_API_KEY;
  delete process.env.FAL_KEY;
  if (stream === undefined) delete process.env.LLM_STREAM;
  else process.env.LLM_STREAM = stream;
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    return reply(String(url), urls.length - 1) as never;
  }) as unknown as typeof fetch;
  try {
    await fn(urls);
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [name, v] of [
      ["GEMINI_API_KEY", saved.gemini],
      ["XAI_API_KEY", saved.xai],
      ["FAL_KEY", saved.fal],
      ["LLM_STREAM", saved.stream],
    ] as const) {
      if (v === undefined) delete process.env[name];
      else process.env[name] = v;
    }
  }
}

/** SSE `data:` qatori (naqsh `tests/llm-stream.test.mts` dan). */
const sse = (text: string) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`;

/**
 * Oqim tanasi — bo'laklar berilgan tartibda, orasida ixtiyoriy kutish.
 *
 * `{ wait, at }` bo'lagi javob HALI TUGAMAGAN paytda o'lchov olish
 * imkonini beradi: `at()` kutishdan oldin, ya'ni oldingi bo'lak
 * to'liq qayta ishlangandan keyin chaqiriladi.
 */
type Chunk = string | { wait: number; at?: () => void };

function bodyOf(chunks: Chunk[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      while (i < chunks.length) {
        const next = chunks[i++];
        if (typeof next === "string") {
          c.enqueue(enc.encode(next));
          return;
        }
        next.at?.();
        await new Promise((r) => setTimeout(r, next.wait));
      }
      c.close();
    },
  });
}

const streamReply = (chunks: Chunk[]) => ({
  ok: true,
  status: 200,
  body: bodyOf(chunks),
  json: async () => ({}),
});

const jsonReply = (text: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
});

/** 16 ta bir xil rolli beat — ikki bo'lak (CHUNK=8) chiqadi. */
const beats16: SlideBeat[] = Array.from({ length: 16 }, (_, i) => ({
  layout: "bullets" as const,
  role: `Rol ${i + 1}`,
}));

const meta16 = extractMeta(slideTool, { topic: "Suv aylanishi" });
const tpl16 = resolveDeckTemplate(meta16);

/** Bo'lak javobi: `from`..`from+n` slaydlari (1 dan boshlab nomlangan). */
const chunkJson = (from: number, n: number) =>
  deckJson(Array.from({ length: n }, (_, i) => rawSlide(from + i + 1)));

function collect() {
  const events: SlideProgressEvent[] = [];
  return { events, sink: (ev: SlideProgressEvent) => events.push(ev) };
}

const slideEvents = (events: SlideProgressEvent[]) =>
  events.filter((e): e is Extract<SlideProgressEvent, { type: "slide" }> => e.type === "slide");

// ───────────────────────────────────────────── 3. writeSlidesWithLlm + oqim

test("oqim: 16 slayd / 2 bo'lak → 16 ta `slide` hodisasi, indeks o'sib boradi", async () => {
  /*
   * Har bo'lak IKKI SSE qatori bilan keladi: birinchisi 4 to'liq slayd
   * + beshinchisining boshi, ikkinchisi qolgani. Orasida 350 ms —
   * `askRange` throttle'i ≥300 ms talab qiladi, ya'ni ikkinchi qator
   * ham o'z navbatida tahlil qilinadi. Shu tuzilish «oqim ishladimi»
   * degan savolga javob beradi: 4 ta slayd javob TUGASHIDAN oldin
   * chiqishi kerak.
   */
  let midCount = -1;
  const { events, sink } = collect();
  const chunksFor = (from: number): Chunk[] => {
    const objs = Array.from({ length: 8 }, (_, i) => JSON.stringify(rawSlide(from + i + 1)));
    // `objs[4].slice(0, 19)` = `{"layout":"bullets"` — TUGALLANGAN
    // kalit-qiymat, lekin obyekt yopilmagan: `parseLlmJson` uni saqlaydi,
    // ya'ni massivda 5 element bo'ladi va 4 tasi TAYYOR deb sanaladi.
    const head = `{"slides":[${objs.slice(0, 4).join(",")},${objs[4].slice(0, 19)}`;
    const tail = `${objs[4].slice(19)},${objs.slice(5).join(",")}]}`;
    return [
      sse(head),
      // Javob HALI TUGAMAGAN paytdagi hodisa soni — oqimning isboti.
      // 350 ms `askRange` throttle'ining ≥300 ms shartidan ham katta.
      { wait: 350, at: () => { if (midCount < 0 && from === 0) midCount = slideEvents(events).length; } },
      sse(tail),
    ];
  };

  await withLlm(
    (url, i) => {
      assert.ok(url.includes(":streamGenerateContent"), url);
      return streamReply(chunksFor(i * 8));
    },
    async (urls) => {
      const out = await writeSlidesWithLlm(meta16, tpl16, beats16, Date.now() + 120_000, {}, sink);
      assert.ok(out, "deka yozilishi kerak");
      assert.equal(urls.length, 2, "16 slayd = 2 bo'lak");

      const slides = slideEvents(events);
      assert.equal(slides.length, 16, "har slayd AYNAN bir marta chiqishi kerak");
      assert.deepEqual(
        slides.map((e) => e.index),
        Array.from({ length: 16 }, (_, i) => i),
        "indekslar 0..15 tartibida",
      );
      // `from +` mutatsiyasining qulfi: ikkinchi bo'lak 8 dan boshlanadi
      // va uning matni ham 9-slaydniki.
      assert.equal(slides[8].index, 8);
      assert.equal(slides[8].slide.title, "Slayd 9");
      assert.equal(slides[0].slide.title, "Slayd 1");
      assert.equal(midCount, 4, `javob tugashidan oldin 4 slayd chiqishi kerak edi, chiqdi: ${midCount}`);
    },
  );
});

test("`LLM_STREAM=false`: oqim yo'q, lekin 16 `slide` hodisasi baribir chiqadi", async () => {
  const { events, sink } = collect();
  await withLlm(
    (url, i) => {
      assert.ok(url.includes(":generateContent"), `oqim endpointi chaqirilmasin: ${url}`);
      return jsonReply(chunkJson(i * 8, 8));
    },
    async () => {
      const out = await writeSlidesWithLlm(meta16, tpl16, beats16, Date.now() + 120_000, {}, sink);
      assert.ok(out);
      const slides = slideEvents(events);
      assert.equal(slides.length, 16, "kill-switch jonli ko'rinishni o'chirmasligi kerak");
      assert.deepEqual(
        slides.map((e) => e.index),
        Array.from({ length: 16 }, (_, i) => i),
      );
      assert.equal(slides[15].slide.title, "Slayd 16");
    },
    "false",
  );
});

test("retry: 5xx dan keyingi ikkinchi urinish TAKROR hodisa bermaydi", async () => {
  /*
   * Birinchi urinish 4 slaydni chiqarib, so'ng oqim ichida 503 beradi
   * (`withRetry` uchun qayta urinilsa bo'ladigan xato). Ikkinchi
   * urinish oqimni BOSHIDAN boshlaydi — `emittedAbs` bo'lmasa 0..3
   * ikkinchi marta chiqardi.
   */
  const { events, sink } = collect();
  const eight: SlideBeat[] = beats16.slice(0, 8);
  const objs = Array.from({ length: 8 }, (_, i) => JSON.stringify(rawSlide(i + 1)));
  const head = `{"slides":[${objs.slice(0, 4).join(",")},${objs[4].slice(0, 19)}`;

  await withLlm(
    (_url, i) =>
      i === 0
        ? streamReply([
            sse(head),
            { wait: 50 },
            `data: ${JSON.stringify({ error: { message: "backend error", code: 503 } })}\n\n`,
          ])
        : streamReply([deckJson(Array.from({ length: 8 }, (_, k) => rawSlide(k + 1)))].map((t) => sse(t))),
    async (urls) => {
      const out = await writeSlidesWithLlm(meta16, tpl16, eight, Date.now() + 120_000, {}, sink);
      assert.ok(out, "ikkinchi urinish dekani berishi kerak");
      assert.ok(urls.length >= 2, `qayta urinish bo'lishi kerak edi: ${urls.length}`);
      const slides = slideEvents(events);
      const indexes = slides.map((e) => e.index);
      assert.equal(new Set(indexes).size, indexes.length, `takror indeks: ${indexes.join(",")}`);
      assert.deepEqual(indexes, [0, 1, 2, 3, 4, 5, 6, 7], "8 slayd, har biri bir marta");
    },
  );
});

test("`onProgress` berilmasa oqim endpointi UMUMAN chaqirilmaydi", async () => {
  await withLlm(
    (url) => {
      assert.ok(!url.includes("streamGenerateContent"), `eski yo'l oqimga o'tib ketdi: ${url}`);
      return jsonReply(chunkJson(0, 8));
    },
    async (urls) => {
      const out = await writeSlidesWithLlm(meta16, tpl16, beats16.slice(0, 8), Date.now() + 120_000, {});
      assert.ok(out);
      assert.equal(urls.length, 1);
    },
  );
});

// ───────────────────────────────────────────── 4. buildSlideAcademicDoc tartibi

/** 1×1 px JPEG — `fetchImageBytes` sniff tekshiruvidan o'tadi. */
const JPEG_1PX =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

const geminiImageBody = {
  steps: [{ type: "message", content: [{ data: JPEG_1PX, mime_type: "image/jpeg" }] }],
};

test("buildSlideAcademicDoc: hodisalar tartibi va hodisalarning NUSXA ekani", async () => {
  const meta = extractMeta(proTool, { topic: "Suv aylanishi", slideCount: 8 });
  const tpl = resolveDeckTemplate(meta);
  const beats = deckBeats(meta, tpl);
  const want = wantSlides(meta, tpl);
  const { events, sink } = collect();

  await withLlm(
    (url) => {
      if (url.includes("/interactions")) return { ok: true, status: 200, json: async () => geminiImageBody };
      if (url.includes(":streamGenerateContent")) {
        return streamReply([sse(deckJson(beats.map((b, i) => ({ ...rawSlide(i + 1), layout: b.layout }))))]);
      }
      // Rasm promptlarini yozuvchi oqimsiz chaqiruv — bo'sh JSON,
      // `composeSlideImagePrompt` zaxirasi ishlaydi.
      return jsonReply("{}");
    },
    async () => {
      const doc = await buildSlideAcademicDoc(meta, Date.now() + 300_000, { onProgress: sink });

      const order = events.map((e) => (e.type === "stage" ? `stage:${e.stage}` : e.type));
      assert.equal(order[0], "plan", `birinchi hodisa reja bo'lishi kerak: ${order[0]}`);
      // `plan` LLM dan OLDIN: undan keyingi birinchi bosqich — matn
      // (internetSearch o'chiq, shuning uchun `stage:research` yo'q).
      assert.equal(order[1], "stage:text");
      const iDeck = order.indexOf("deck");
      const iImagesStage = order.indexOf("stage:images");
      const iImages = order.indexOf("images");
      const iImage = order.indexOf("image");
      const iAssembly = order.indexOf("stage:assembly");
      assert.ok(iDeck > 1, "deck matndan keyin");
      assert.ok(
        order.lastIndexOf("slide") < iDeck,
        "har `slide` hodisasi `deck` dan OLDIN kelishi kerak",
      );
      assert.ok(iImagesStage > iDeck, "`stage images` `deck` dan keyin");
      assert.ok(iImages > iImagesStage, "`images` (kutish ro'yxati) bosqichdan keyin");
      assert.ok(iImage > iImages, "`image` kutish ro'yxatidan keyin");
      assert.ok(iAssembly > iImage, "`stage assembly` oxirgi bosqich");
      assert.equal(order[order.length - 1], "stage:assembly");
      assert.ok(!order.includes("done"), "`done` ni `index.ts` beradi, dvigatel emas");

      const plan = events[0] as Extract<SlideProgressEvent, { type: "plan" }>;
      assert.equal(plan.slides.length, want, "skelet va'da qilingan slayd sonini berishi kerak");
      assert.equal(plan.roles.length, want);
      assert.equal(plan.theme, doc.slideTheme);
      assert.equal(plan.template, doc.slideTemplate);

      /*
       * NUSXA. `attachSlideImages` yakuniy `slides` ga `image` qo'yadi.
       * Hodisa obyekti o'sha massivga ISHORA qilsa, worker allaqachon
       * `live_json` ga yozib bo'lgan holat keyin o'zgarardi.
       */
      const deck = events[iDeck] as Extract<SlideProgressEvent, { type: "deck" }>;
      assert.ok(doc.slides!.some((s) => s.image), "test rasmsiz o'tsa hech narsa sinamaydi");
      assert.ok(!deck.slides.some((s) => s.image), "`deck` hodisasi keyin mutatsiya qilingan");
      assert.ok(!plan.slides.some((s) => s.image), "`plan` hodisasi keyin mutatsiya qilingan");
      assert.notEqual(deck.slides, doc.slides, "hodisa yakuniy massivga ishora qilmasin");

      const imageEv = events[iImage] as Extract<SlideProgressEvent, { type: "image" }>;
      assert.ok(imageEv.url.startsWith("data:image/"), imageEv.url.slice(0, 32));
      assert.equal(doc.slides![imageEv.index].image?.url, imageEv.url, "indeks yakuniy dekaga to'g'ri kelsin");
    },
  );
});
