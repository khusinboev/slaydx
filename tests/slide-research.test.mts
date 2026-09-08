import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { llmGrounded } from "../lib/generation/llm.ts";
import { runSlideResearch } from "../lib/generation/slide-research.ts";
import type { SlideResearch } from "../lib/generation/slide-research.ts";
import { slideSystem } from "../lib/generation/slide-prompt/index.ts";
import { SLIDE_TEMPLATE_BY_ID } from "../lib/generation/slide-templates.ts";

/**
 * INTERNET TADQIQOTI (AUDIT-9 WP-D) — Gemini grounding.
 *
 * Bu yerda qulflanadigan narsa uchta:
 *
 *  1. PUL va MAXFIYLIK. Qidiruv yoqilmagan bo'lsa tarmoqqa CHIQMASLIK
 *     kerak: har qidiruv pullik (5 000 dan keyin $14/1000) va
 *     foydalanuvchi mavzusi tashqariga ketmasligi shart.
 *  2. SO'ROV SHAKLI. `tools:[{google_search:{}}]` BO'LSIN,
 *     `responseMimeType` BO'LMASIN — jonli tasdiqlangan (2026-09-08):
 *     ikkovi birga kelsa Gemini bo'sh kandidat qaytaradi va xato ham
 *     bermaydi.
 *  3. YIQILISH — HALOKAT EMAS. Timeout, 5xx, `groundingMetadata` yo'q:
 *     hech biri throw bo'lmasin, deck tadqiqotsiz yozilaversin.
 */

const pro = TOOL_BY_ID["pro-slide"];
const lecture = SLIDE_TEMPLATE_BY_ID.lecture;
const meta = (v: FormValues = {}) => extractMeta(pro, { topic: "Orol dengizi muammosi", ...v });

/** Bitta tutilgan so'rov. */
type Caught = { url: string; body: string; method: string };

/**
 * `globalThis.fetch` ni almashtiradi va oxirida TIKLAYDI.
 *
 * Naqsh `generation.test.mts` dan: kalit ham vaqtincha qo'yiladi,
 * chunki `llmProvider()` env'ni o'qiydi va kalitsiz chaqiruv umuman
 * ketmaydi — test hech narsani tekshirmagan bo'lardi.
 */
async function withFetch(
  reply: (req: Caught) => unknown,
  fn: (calls: Caught[]) => Promise<void>,
): Promise<void> {
  const realFetch = globalThis.fetch;
  const savedGemini = process.env.GEMINI_API_KEY;
  const savedXai = process.env.XAI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.XAI_API_KEY;
  const calls: Caught[] = [];
  globalThis.fetch = (async (url: string, init?: { body?: string; method?: string }) => {
    const req = { url: String(url), body: String(init?.body ?? ""), method: init?.method ?? "GET" };
    calls.push(req);
    return reply(req) as never;
  }) as typeof fetch;
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
    if (savedGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedGemini;
    if (savedXai === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = savedXai;
  }
}

/** Gemini javobi — grounding metadata bilan yoki usiz. */
function geminiReply(text: string, grounding?: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: { parts: [{ text }] },
          ...(grounding ? { groundingMetadata: grounding } : {}),
        },
      ],
    }),
  };
}

const FACTS = [
  "Orol dengizi 1960-yilda 68 900 km² maydonga ega edi.",
  "2014-yilga kelib sharqiy havza butunlay qurib qoldi.",
  "2018-yilda O‘zbekiston Orolbo‘yida 500 ming gektar saksovul ekdi.",
].join("\n");

const GROUNDING = {
  webSearchQueries: ["Orol dengizi maydoni", "Orol dengizi qurishi statistika", "Orolbo‘yi saksovul"],
  groundingChunks: [
    { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/aaa", title: "president.uz" } },
    { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/bbb", title: "daryo.uz" } },
    // AYNAN bir xil domen — dedup shuni yeyishi kerak.
    { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/ccc", title: "daryo.uz" } },
    { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/ddd", title: "kapital.uz" } },
  ],
  searchEntryPoint: { renderedContent: "<div class=\"search-entry\">Google qidiruv takliflari</div>" },
};

/** Redirect ochilishini o'chirib turadigan variant — manbalar to'g'ridan-to'g'ri. */
const GROUNDING_DIRECT = {
  ...GROUNDING,
  groundingChunks: [
    { web: { uri: "https://president.uz/uz/lists/view/1", title: "president.uz" } },
    { web: { uri: "https://daryo.uz/2018/01/01/orol", title: "daryo.uz" } },
  ],
};

// ───────────────────────────────────────── qidiruv yoqilmagan bo'lsa

test("internetSearch: false — tarmoqqa UMUMAN chiqmaydi", async () => {
  await withFetch(
    () => {
      throw new Error("qidiruv yoqilmagan, lekin so'rov ketdi");
    },
    async (calls) => {
      const res = await runSlideResearch(meta({ internetSearch: false }), Date.now() + 60_000);
      assert.equal(res, null, "qidiruvsiz tadqiqot bo'lmaydi");
      assert.equal(calls.length, 0, "bitta ham so'rov ketmasligi kerak");
    },
  );
});

test("internetSearch belgilanmagan — standart o'chiq, so'rov yo'q", async () => {
  await withFetch(
    () => geminiReply(FACTS, GROUNDING),
    async (calls) => {
      assert.equal(await runSlideResearch(meta(), Date.now() + 60_000), null);
      assert.equal(calls.length, 0, "standart holatda pul sarflanmaydi");
    },
  );
});

// ───────────────────────────────────────── so'rov shakli

test("internetSearch: true — AYNAN bitta so'rov, tanasida google_search bor, responseMimeType yo'q", async () => {
  await withFetch(
    () => geminiReply(FACTS, GROUNDING_DIRECT),
    async (calls) => {
      const res = await runSlideResearch(meta({ internetSearch: true }), Date.now() + 60_000);
      assert.ok(res, "tadqiqot natijasi kelishi kerak");
      assert.equal(calls.length, 1, `aynan bitta so'rov kutilgan, ketdi ${calls.length}`);

      const body = calls[0].body;
      assert.ok(body.includes("google_search"), "tanada `tools:[{google_search:{}}]` bo'lishi shart");
      assert.ok(
        !body.includes("responseMimeType"),
        "JSON rejimi grounding bilan ishlamaydi — `responseMimeType` bo'lmasligi shart",
      );
      assert.ok(calls[0].url.includes(":generateContent"), "mavjud endpoint ishlatilsin");

      // Prompt haqiqatan mavzuni olib ketadi — bo'sh so'rov yuborilmasin.
      assert.ok(body.includes("Orol dengizi muammosi"), "mavzu promptga kirishi kerak");
      // O'ylash byudjeti nol emas: nolda model qidirmay javob yozadi.
      const parsed = JSON.parse(body) as { generationConfig?: { thinkingConfig?: { thinkingBudget?: number } } };
      assert.ok(
        (parsed.generationConfig?.thinkingConfig?.thinkingBudget ?? 0) > 0,
        "grounding uchun o'ylash byudjeti nol bo'lmasin",
      );
    },
  );
});

test("keyIdeas va localExamples so'rovga yetib boradi — bezak maydon emas", async () => {
  await withFetch(
    () => geminiReply(FACTS, GROUNDING_DIRECT),
    async (calls) => {
      await runSlideResearch(
        meta({ internetSearch: true, keyIdeas: "suv taqsimoti, saksovul", localExamples: true }),
        Date.now() + 60_000,
      );
      const body = calls[0].body;
      assert.ok(body.includes("suv taqsimoti"), "asosiy g'oya qidiruv topshirig'iga kirsin");
      assert.ok(body.includes("saksovul"), "ikkinchi g'oya ham kirsin");
      assert.ok(/O‘zbekiston bo‘yicha ma’lumot USTUVOR/.test(body), "mahalliy misol ustuvorligi aytilsin");
    },
  );
});

test("localExamples o'chiq bo'lsa mahalliy ustuvorlik so'ralmaydi", async () => {
  await withFetch(
    () => geminiReply(FACTS, GROUNDING_DIRECT),
    async (calls) => {
      await runSlideResearch(meta({ internetSearch: true, localExamples: false }), Date.now() + 60_000);
      assert.ok(!/USTUVOR/.test(calls[0].body), "o'chiq bayroq promptni o'zgartirmasligi kerak");
    },
  );
});

// ───────────────────────────────────────── javobni ajratish

test("groundingMetadata to'g'ri ajratiladi: faktlar, so'rovlar, entryPoint", async () => {
  await withFetch(
    () => geminiReply(FACTS, GROUNDING_DIRECT),
    async () => {
      const res = await runSlideResearch(meta({ internetSearch: true }), Date.now() + 60_000);
      assert.ok(res);
      assert.equal(res.facts, FACTS, "faktlar matni o'zgartirilmasin");
      assert.deepEqual(res.queries, GROUNDING.webSearchQueries, "model so'rovlari saqlansin");
      assert.ok(res.entryPoint?.includes("search-entry"), "Google ToS bloki saqlansin");
      assert.deepEqual(
        res.sources,
        [
          { title: "president.uz", uri: "https://president.uz/uz/lists/view/1" },
          { title: "daryo.uz", uri: "https://daryo.uz/2018/01/01/orol" },
        ],
        "manbalar juft-juft ajratilsin",
      );
    },
  );
});

test("manbalar `title` bo'yicha noyob — bir domen ikki marta chiqmaydi", async () => {
  await withFetch(
    (req) =>
      req.method === "HEAD"
        ? { ok: true, status: 302, headers: { get: () => null } }
        : geminiReply(FACTS, GROUNDING),
    async () => {
      const res = await runSlideResearch(meta({ internetSearch: true }), Date.now() + 60_000);
      assert.ok(res);
      const titles = res.sources.map((s) => s.title);
      assert.deepEqual(titles, ["president.uz", "daryo.uz", "kapital.uz"], "takror domen tashlansin");
      assert.equal(new Set(titles).size, titles.length, "sarlavhalar noyob bo'lsin");
    },
  );
});

test("manbalar 8 tadan oshmaydi — references slaydi sig'imi", async () => {
  const many = Array.from({ length: 14 }, (_, i) => ({
    web: { uri: `https://site${i}.uz/a`, title: `site${i}.uz` },
  }));
  await withFetch(
    () => geminiReply(FACTS, { ...GROUNDING, groundingChunks: many }),
    async () => {
      const res = await runSlideResearch(meta({ internetSearch: true }), Date.now() + 60_000);
      assert.equal(res?.sources.length, 8, "8 ta bilan cheklansin");
    },
  );
});

test("bo'sh yoki nuqsonli chunk tashlanadi — `uri` yoki `title` yo'q", async () => {
  await withFetch(
    () =>
      geminiReply(FACTS, {
        ...GROUNDING,
        groundingChunks: [
          { web: { uri: "https://ok.uz/a", title: "ok.uz" } },
          { web: { uri: "", title: "bosh-uri.uz" } },
          { web: { title: "faqat-sarlavha.uz" } },
          { web: { uri: "https://faqat-uri.uz/a" } },
          {},
        ],
      }),
    async () => {
      const res = await runSlideResearch(meta({ internetSearch: true }), Date.now() + 60_000);
      assert.deepEqual(res?.sources, [{ title: "ok.uz", uri: "https://ok.uz/a" }]);
    },
  );
});

// ───────────────────────────────────────── redirect ochish

test("Google redirect HEAD bilan haqiqiy manzilga ochiladi", async () => {
  const real: Record<string, string> = {
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/aaa": "https://president.uz/uz/lists/view/1",
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/bbb": "https://daryo.uz/2018/01/01/orol",
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/ccc": "https://daryo.uz/boshqa",
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/ddd": "https://kapital.uz/news/7",
  };
  await withFetch(
    (req) =>
      req.method === "HEAD"
        ? { ok: true, status: 302, headers: { get: (h: string) => (h === "location" ? real[req.url] : null) } }
        : geminiReply(FACTS, GROUNDING),
    async (calls) => {
      const res = await runSlideResearch(meta({ internetSearch: true }), Date.now() + 60_000);
      assert.ok(res);
      assert.deepEqual(
        res.sources.map((s) => s.uri),
        ["https://president.uz/uz/lists/view/1", "https://daryo.uz/2018/01/01/orol", "https://kapital.uz/news/7"],
        "redirect ochilib, haqiqiy manzil qolishi kerak",
      );
      // Dedupdan KEYIN ochiladi: 4 chunk emas, 3 ta HEAD.
      assert.equal(calls.filter((c) => c.method === "HEAD").length, 3, "faqat noyob manbalar ochilsin");
    },
  );
});

test("redirect ochilmasa domen QOLADI — tadqiqot yiqilmaydi", async () => {
  await withFetch(
    (req) => {
      if (req.method === "HEAD") throw new Error("ECONNRESET");
      return geminiReply(FACTS, GROUNDING);
    },
    async () => {
      const res = await runSlideResearch(meta({ internetSearch: true }), Date.now() + 60_000);
      assert.ok(res, "HEAD yiqilsa ham natija qaytsin");
      assert.equal(res.sources.length, 3, "manbalar saqlansin");
      assert.ok(
        res.sources.every((s) => s.uri.includes("vertexaisearch")),
        "ochilmagan bo'lsa boshlang'ich redirect qoladi",
      );
    },
  );
});

test("redirect javobida `location` bo'lmasa ham eski `uri` qoladi", async () => {
  await withFetch(
    (req) =>
      req.method === "HEAD"
        ? { ok: true, status: 200, headers: { get: () => null } }
        : geminiReply(FACTS, GROUNDING),
    async () => {
      const res = await runSlideResearch(meta({ internetSearch: true }), Date.now() + 60_000);
      assert.equal(res?.sources.length, 3);
      assert.ok(res?.sources[0].uri.includes("vertexaisearch"));
    },
  );
});

test("redirect bo'lmagan manbaga HEAD yuborilmaydi — ortiqcha so'rov yo'q", async () => {
  await withFetch(
    () => geminiReply(FACTS, GROUNDING_DIRECT),
    async (calls) => {
      await runSlideResearch(meta({ internetSearch: true }), Date.now() + 60_000);
      assert.equal(calls.filter((c) => c.method === "HEAD").length, 0, "to'g'ri havolani ochishning hojati yo'q");
    },
  );
});

// ───────────────────────────────────────── xato yo'llari

test("groundingMetadata umuman kelmasa — faktlar bor, sources bo'sh", async () => {
  await withFetch(
    () => geminiReply(FACTS),
    async () => {
      const res = await runSlideResearch(meta({ internetSearch: true }), Date.now() + 60_000);
      assert.ok(res, "model qidirmagan bo'lsa ham matn qaytsin");
      assert.equal(res.facts, FACTS);
      assert.deepEqual(res.sources, [], "manba yo'q");
      assert.deepEqual(res.queries, []);
    },
  );
});

test("4xx — `null`, throw emas", async () => {
  await withFetch(
    () => ({ ok: false, status: 400, json: async () => ({ error: { message: "bad request" } }) }),
    async (calls) => {
      const res = await runSlideResearch(meta({ internetSearch: true }), Date.now() + 60_000);
      assert.equal(res, null, "4xx da tadqiqotsiz davom etamiz");
      assert.equal(calls.length, 1, "4xx qayta urinishga arzimaydi");
    },
  );
});

test("5xx — qayta urinadi, keyin `null`", async () => {
  await withFetch(
    () => ({ ok: false, status: 503, json: async () => ({ error: { message: "overloaded" } }) }),
    async (calls) => {
      const res = await runSlideResearch(meta({ internetSearch: true }), Date.now() + 60_000);
      assert.equal(res, null);
      assert.ok(calls.length > 1, `5xx o'tkinchi — qayta urinilsin, ketdi ${calls.length}`);
    },
  );
});

test("tarmoq uzilishi — throw emas, `null`", async () => {
  await withFetch(
    () => {
      throw new Error("fetch failed");
    },
    async () => {
      const res = await runSlideResearch(meta({ internetSearch: true }), Date.now() + 60_000);
      assert.equal(res, null);
    },
  );
});

test("bo'sh kandidat (grounding + JSON belgisi) — `null`", async () => {
  await withFetch(
    () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [] } }] }) }),
    async () => {
      assert.equal(await runSlideResearch(meta({ internetSearch: true }), Date.now() + 60_000), null);
    },
  );
});

test("vaqt 8 soniyadan kam — tarmoqqa chiqmaydi", async () => {
  await withFetch(
    () => {
      throw new Error("vaqt yo'q edi, lekin so'rov ketdi");
    },
    async (calls) => {
      const res = await runSlideResearch(meta({ internetSearch: true }), Date.now() + 5_000);
      assert.equal(res, null, "vaqt yetmasa tadqiqot yo'q");
      assert.equal(calls.length, 0, "matn bosqichidan vaqt o'g'irlanmasin");
    },
  );
});

test("o'tib ketgan muddat — `null`", async () => {
  await withFetch(
    () => {
      throw new Error("muddat o'tgan edi");
    },
    async (calls) => {
      assert.equal(await runSlideResearch(meta({ internetSearch: true }), Date.now() - 1_000), null);
      assert.equal(calls.length, 0);
    },
  );
});

// ───────────────────────────────────────── llmGrounded qulfi

test("llmGrounded + json — QULF, throw", async () => {
  const saved = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  try {
    await assert.rejects(
      () => llmGrounded("s", "u", 2048, { grounding: true, json: true }),
      /grounding JSON rejimi bilan mos emas/,
      "grounding + JSON bo'sh kandidat beradi — dastur xatosi sifatida otilsin",
    );
  } finally {
    if (saved === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved;
  }
});

test("qulf kalitsiz ham otiladi — dastur xatosi provayderga bog'liq emas", async () => {
  const savedGemini = process.env.GEMINI_API_KEY;
  const savedXai = process.env.XAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.XAI_API_KEY;
  try {
    await assert.rejects(() => llmGrounded("s", "u", 2048, { json: true }), /mos emas/);
  } finally {
    if (savedGemini !== undefined) process.env.GEMINI_API_KEY = savedGemini;
    if (savedXai !== undefined) process.env.XAI_API_KEY = savedXai;
  }
});

test("xAI yo'lida grounding yo'q — `null`, tarmoqqa chiqmaydi", async () => {
  const realFetch = globalThis.fetch;
  const savedGemini = process.env.GEMINI_API_KEY;
  const savedXai = process.env.XAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  process.env.XAI_API_KEY = "test-xai";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("xAI da grounding yo'q, so'rov ketmasligi kerak");
  }) as typeof fetch;
  try {
    /*
     * Ataylab `null`: grounding'siz javob oddiy model bilimi bo'lardi va
     * uni promptga «internetdan, TEKSHIRILGAN» sarlavhasi bilan qo'yish
     * uydirma raqamni ishonchli qilib ko'rsatgan bo'lardi — ustiga
     * references slaydi uchun manba ham bo'lmaydi.
     */
    assert.equal(await llmGrounded("s", "u"), null);
    assert.equal(await runSlideResearch(meta({ internetSearch: true }), Date.now() + 60_000), null);
    assert.equal(calls, 0, "xAI ga tadqiqot so'rovi yuborilmasin");
  } finally {
    globalThis.fetch = realFetch;
    if (savedGemini !== undefined) process.env.GEMINI_API_KEY = savedGemini;
    if (savedXai === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = savedXai;
  }
});

test("grounding'siz oddiy chaqiruvda `tools` yuborilmaydi", async () => {
  await withFetch(
    () => geminiReply("oddiy matn"),
    async (calls) => {
      const { llmComplete } = await import("../lib/generation/llm.ts");
      await llmComplete("s", "u", 800);
      assert.equal(calls.length, 1);
      assert.ok(!calls[0].body.includes("google_search"), "qidiruv so'ralmagan — pul sarflanmasin");
    },
  );
});

// ───────────────────────────────────────── promptga ta'siri

const research: SlideResearch = {
  facts: FACTS,
  sources: [
    { title: "president.uz", uri: "https://president.uz/a" },
    { title: "daryo.uz", uri: "https://daryo.uz/b" },
  ],
  queries: ["Orol dengizi maydoni"],
  entryPoint: "<div>x</div>",
};

test("researchLines: tadqiqot bo'lsa prompt FARQ qiladi", () => {
  const m = meta({ internetSearch: true });
  const without = slideSystem(m, lecture);
  const with_ = slideSystem(m, lecture, { research });

  assert.notEqual(without, with_, "tadqiqot promptga yetib bormasa — bezak maydon");
  assert.ok(!without.includes("TADQIQOT NATIJASI"), "tadqiqotsiz blok bo'lmasin");
  assert.ok(with_.includes("TADQIQOT NATIJASI (internetdan, tekshirilgan):"));
  assert.ok(with_.includes("--- FAKTLAR BOSHI ---"));
  assert.ok(with_.includes("--- FAKTLAR OXIRI ---"));
  assert.ok(with_.includes("Orol dengizi 1960-yilda 68 900 km²"), "faktlar matni promptda bo'lsin");
  assert.ok(
    with_.includes("Bu faktlarga tayanib yozing. Faktda yo‘q raqamni o‘ylab topmang."),
    "uydirma taqiqi bo'lsin",
  );
});

test("researchLines: manbalar RAQAMLANGAN, faqat sarlavha bilan", () => {
  const with_ = slideSystem(meta({ internetSearch: true }), lecture, { research });
  assert.ok(
    with_.includes("MANBALAR (references slaydi uchun, faqat shulardan): 1) president.uz 2) daryo.uz"),
    "manbalar raqamlangan ro'yxat bo'lsin",
  );
  // URL promptda YO'Q: references slaydini koordinator quradi.
  assert.ok(!with_.includes("https://president.uz/a"), "havola promptga tushmasin");
});

test("researchLines: `null` tadqiqot promptni O'ZGARTIRMAYDI — regressiya yo'q", () => {
  const m = meta({ internetSearch: true });
  assert.equal(slideSystem(m, lecture, { research: null }), slideSystem(m, lecture));
  assert.equal(slideSystem(m, lecture, {}), slideSystem(m, lecture));
});

test("researchLines: bo'sh faktlar bloki ochmaydi", () => {
  const m = meta({ internetSearch: true });
  const empty: SlideResearch = { facts: "   ", sources: research.sources, queries: [] };
  assert.equal(slideSystem(m, lecture, { research: empty }), slideSystem(m, lecture), "bo'sh matn blok ochmasin");
});

test("researchLines: manbasiz tadqiqotda MANBALAR qatori bo'lmaydi", () => {
  const m = meta({ internetSearch: true });
  const noSrc: SlideResearch = { facts: FACTS, sources: [], queries: [] };
  const out = slideSystem(m, lecture, { research: noSrc });
  assert.ok(out.includes("--- FAKTLAR BOSHI ---"), "faktlar baribir kirsin");
  assert.ok(!out.includes("MANBALAR"), "bo'sh manba ro'yxati va'da qilinmasin");
});

test("researchLines: yuklangan fayl bloki tadqiqot bilan BIRGA qoladi", () => {
  const m = meta({ internetSearch: true });
  m.sourceText = "Foydalanuvchi yuklagan hujjat matni.";
  const out = slideSystem(m, lecture, { research });
  assert.ok(out.includes("MANBA HUJJAT"), "foydalanuvchi fayli o'chib qolmasin");
  assert.ok(out.includes("TADQIQOT NATIJASI"), "tadqiqot ham qolsin");
});
