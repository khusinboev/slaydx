import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { buildArtifact } from "../lib/generation/index.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { buildAudioArtifact } from "../lib/generation/audio/engine.ts";
import { resetBreakers } from "../lib/generation/llm/breaker.ts";
import { resetLimiters } from "../lib/generation/llm/limiter.ts";
import { GROUNDING_USD, IMAGE_PRICES, JobCost } from "../lib/generation/job-cost.ts";
import { setSafeFetchLookup } from "../lib/generation/safe-fetch.ts";
import type { TtsProvider } from "../lib/generation/tts/types.ts";

/**
 * DVIGATEL MUDDATI VA SARF TELEMETRIYASI — `buildArtifact` darajasida
 * (audit EXT-03 qolgani, EXT-11).
 *
 * MUDDAT: ish muddati o'tgan holda HAR dvigatel `DeadlineError` bilan
 * yiqilishi (worker uni «vaqt tugadi» + to'liq pul qaytarish deb o'qiydi)
 * va yarim hujjat QAYTARMASLIGI, provayderga so'rov ham ketmasligi kerak.
 * Stub qilingan `complete` emas — HAQIQIY `llm-roles`/`llm.ts` yo'li
 * (soxta kalit + `fetch` stub), ya'ni `deadline` ning dvigateldan zanjirgacha
 * yetib borishi sinaladi. Istisno — rezyume: uning ataylab qo'yilgan
 * zaxirasi foydalanuvchi faktlaridan TO'LIQ hujjat (yarim emas).
 *
 * SARF: ilgari `cost_json` yozmagan yo'llar (rasm, pro-slayd, rezyume)
 * endi `BuiltFile.cost` beradi — manbada yozilgan token/rasm/grounding.
 *
 * Tarmoq YO'Q: `.env.local` dagi haqiqiy kalitlar va `LLM_*` rollari
 * test davomida olib tashlanadi, `fetch` stub, DNS stub.
 */

const STRIP = [
  "GEMINI_API_KEY", "XAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY",
  "LLM_WRITER", "LLM_RESEARCHER", "LLM_JUDGE", "LLM_FAST", "LLM_STREAM",
  "PEXELS_API_KEY", "PIXABAY_API_KEY", "FAL_KEY", "OPENALEX_API_KEY", "GOOGLE_BOOKS_API_KEY",
  "AZURE_TTS_KEY", "AZURE_SPEECH_KEY", "AISHA_API_KEY", "WORK_ENGINE", "TEACHER_ENGINE",
];

type Hit = { url: string; body: string };

async function isolated(reply: (h: Hit, n: number) => Response | Promise<Response>, fn: (hits: Hit[]) => Promise<void>) {
  resetBreakers();
  resetLimiters();
  const saved = new Map(STRIP.map((k) => [k, process.env[k]]));
  const realFetch = globalThis.fetch;
  for (const k of STRIP) delete process.env[k];
  process.env.GEMINI_API_KEY = "test-key";
  const hits: Hit[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const h = { url: String(url instanceof Request ? url.url : url), body: String(init?.body ?? "") };
    hits.push(h);
    return reply(h, hits.length);
  }) as typeof fetch;
  setSafeFetchLookup(async () => ["104.18.1.1"]);
  try {
    await fn(hits);
  } finally {
    globalThis.fetch = realFetch;
    setSafeFetchLookup(null);
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const llmHits = (hits: Hit[]) => hits.filter((h) => h.url.includes("generativelanguage.googleapis.com"));
const isDeadline = (e: unknown) => e instanceof Error && e.name === "DeadlineError";
const refuse = () => new Response(JSON.stringify({ error: { message: "stub" } }), { status: 400 });

/* ═══════════════════════ muddat o'tgan — har dvigatel ═══════════════════════ */

const PAST: [string, FormValues][] = [
  ["referat", { topic: "Suv aylanishi", pages: "10-15" }],
  ["coursework", { topic: "Kichik biznes moliyasi", pages: "20-25" }],
  ["article", { topic: "Raqamli ta'lim samaradorligi" }],
  ["thesis", { topic: "Raqamli ta'lim samaradorligi" }],
  ["essay", { topic: "Ona tilim — faxrim" }],
  ["lesson-plan", { topic: "Kasrlarni qo'shish", subject: "Matematika", grade: "5" }],
  ["glossary", { topic: "Fotosintez atamalari", termCount: "20" }],
  ["test", { topic: "Kasrlar", subject: "Matematika", grade: "5" }],
  ["crossword", { topic: "Quyosh tizimi" }],
  ["flashcards", { topic: "Ingliz tili: hayvonlar" }],
  ["sorting", { topic: "Sutemizuvchilar va qushlar" }],
  ["listening", { topic: "Oila a'zolari" }],
  ["infographic", { topic: "Suv aylanishi" }],
  ["slide", { topic: "Fotosintez", slideCount: 8 }],
  ["pro-slide", { topic: "Fotosintez", slideCount: 6, internetSearch: true }],
  ["translation", { sourceText: "Assalomu alaykum. Bugun havo yaxshi.", language: "en" }],
  ["image", { prompt: "Registon maydoni kechqurun", imageCount: 1 }],
];

for (const [toolId, values] of PAST) {
  test(`${toolId}: ish muddati o'tgan — DeadlineError, provayderga so'rov yo'q, hujjat yo'q`, async () => {
    const tool = TOOL_BY_ID[toolId as keyof typeof TOOL_BY_ID];
    assert.ok(tool, toolId);
    await isolated(
      () => refuse(),
      async (hits) => {
        let file: unknown = null;
        await assert.rejects(
          (async () => {
            file = await buildArtifact(tool, values, { deadline: Date.now() - 1_000 });
          })(),
          (e: unknown) => {
            assert.ok(isDeadline(e), `${toolId}: DeadlineError kutilgan, keldi: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
            return true;
          },
        );
        assert.equal(file, null, "yarim hujjat qaytmasligi kerak");
        assert.equal(llmHits(hits).length, 0, `${toolId}: LLM ga so'rov ketdi: ${llmHits(hits).map((h) => h.url).join(", ")}`);
      },
    );
  });
}

test("audio (podkast): ish muddati o'tgan — DeadlineError, LLM/TTS chaqirilmaydi", async () => {
  let synth = 0;
  const tts: TtsProvider = {
    id: "azure",
    configured: () => true,
    async synthesize() {
      synth++;
      throw new Error("chaqirilmasligi kerak");
    },
  };
  await isolated(
    () => refuse(),
    async (hits) => {
      const tool = TOOL_BY_ID.podcast;
      const values = { topic: "Suv aylanishi" } as FormValues;
      await assert.rejects(buildAudioArtifact(tool, extractMeta(tool, values), values, { deadline: Date.now() - 1_000, tts }), (e: unknown) => isDeadline(e));
      assert.equal(llmHits(hits).length, 0);
      assert.equal(synth, 0);
    },
  );
});

test("rezyume: ish muddati o'tgan — LLM ga so'rov YO'Q, zaxira TO'LIQ hujjat (ataylab qo'yilgan degradatsiya)", async () => {
  await isolated(
    () => refuse(),
    async (hits) => {
      const file = await buildArtifact(TOOL_BY_ID.resume, { fullName: "Karimova Dilnoza", targetRole: "Moliya tahlilchisi", skills: "Excel,SQL" } as FormValues, {
        deadline: Date.now() - 1_000,
      });
      assert.ok(file.bytes.byteLength > 0);
      assert.equal(llmHits(hits).length, 0);
      assert.equal(file.cost, undefined, "chaqiruv bo'lmagan — sarf ham yo'q");
    },
  );
});

/* ═══════════════════════ muddat bor — eski xatti-harakat ═══════════════════════ */

for (const toolId of ["referat", "crossword", "slide", "image"] as const) {
  test(`${toolId}: muddat yetarli, model rad etadi — DeadlineError EMAS (eski «AI javob bermadi» yo'li)`, async () => {
    const values = PAST.find(([id]) => id === toolId)![1];
    await isolated(
      () => refuse(),
      async (hits) => {
        await assert.rejects(buildArtifact(TOOL_BY_ID[toolId], values, { deadline: Date.now() + 300_000 }), (e: unknown) => {
          assert.ok(!isDeadline(e), `${toolId}: vaqt bor edi, lekin DeadlineError keldi`);
          return true;
        });
        assert.ok(llmHits(hits).length > 0, "model haqiqatan chaqirilgan bo'lishi kerak");
      },
    );
  });
}

/* ═══════════════════════ sarf telemetriyasi ═══════════════════════ */

const JPEG_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7)]).toString("base64");
const usage = { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 50 };
const geminiText = (text: string, extra: Record<string, unknown> = {}) =>
  Response.json({ candidates: [{ content: { parts: [{ text }] }, ...extra }], usageMetadata: usage });
const geminiImage = () => Response.json({ steps: [{ type: "x" }, { content: [{ data: JPEG_B64, mime_type: "image/jpeg" }] }] });

test("sarf: rasm vositasi — LLM + pullik rasm `cost_json` ga (ilgari NULL)", async () => {
  await isolated(
    (h) => (h.url.includes("/interactions") ? geminiImage() : geminiText(JSON.stringify({ scene: "Registan square at dusk, three madrasas, blue domes" }))),
    async () => {
      const file = await buildArtifact(TOOL_BY_ID.image, { prompt: "Registon maydoni kechqurun", imageCount: 2 } as FormValues, { deadline: Date.now() + 90_000 });
      assert.ok(file.cost, "cost_json bo'lishi kerak");
      const img = file.cost.parts?.find((p) => p.kind === "image");
      assert.equal(img?.units, 2, "ikki rasm");
      assert.equal(img?.usd, 2 * IMAGE_PRICES["gemini-3.1-flash-lite-image"]);
      const llm = file.cost.parts?.find((p) => p.kind === "llm");
      assert.equal(llm?.calls, 1);
      assert.equal(file.cost.outputTokens, 250, "o'ylash tokenlari chiqishga qo'shiladi");
      assert.equal(file.cost.provider, "gemini");
      assert.equal(file.cost.calls, 3);
      assert.ok(file.cost.usd > img!.usd);
    },
  );
});

test("sarf: pro-slayd — deka matni + grounding + rasmlar `cost_json` ga (ilgari NULL)", async () => {
  const slides = Array.from({ length: 6 }, (_, i) => ({ layout: "bullets", title: `Fotosintez ${i + 1}`, bullets: ["Yorug'lik energiyasi.", "Xlorofill."] }));
  await isolated(
    (h) => {
      if (h.url.includes("/interactions")) return geminiImage();
      if (h.body.includes("google_search")) return geminiText("Fotosintez 1771-yilda kashf etilgan.", { groundingMetadata: { webSearchQueries: ["fotosintez"], groundingChunks: [{ web: { uri: "https://a.uz/x", title: "a.uz" } }] } });
      return geminiText(JSON.stringify({ slides }));
    },
    async () => {
      const file = await buildArtifact(TOOL_BY_ID["pro-slide"], { topic: "Fotosintez", slideCount: 6, internetSearch: true } as FormValues, { deadline: Date.now() + 240_000 });
      assert.ok(file.cost, "cost_json bo'lishi kerak");
      const kinds = new Set(file.cost.parts?.map((p) => p.kind));
      assert.ok(kinds.has("llm") && kinds.has("grounding") && kinds.has("image"), [...kinds].join(","));
      assert.equal(file.cost.parts?.find((p) => p.kind === "grounding")?.usd, GROUNDING_USD);
      assert.ok((file.cost.parts?.find((p) => p.kind === "image")?.units ?? 0) >= 1, "kamida bitta rasm");
    },
  );
});

test("sarf: rezyume — model javobi yaroqsiz bo'lsa ham chaqiruvlar `cost_json` ga (ilgari NULL)", async () => {
  await isolated(
    () => geminiText("{}"),
    async () => {
      const file = await buildArtifact(TOOL_BY_ID.resume, { fullName: "Karimova Dilnoza", targetRole: "Moliya tahlilchisi", skills: "Excel,SQL" } as FormValues, {
        deadline: Date.now() + 120_000,
      });
      assert.ok(file.cost, "cost_json bo'lishi kerak");
      assert.ok(file.cost.calls >= 1);
      assert.equal(file.cost.inputTokens, 1000 * file.cost.calls);
    },
  );
});

test("JobCost: provayder/model — eng ko'p chiqish tokenli LLM; LLM yo'q bo'lsa eng qimmat bo'lak; TTS belgilari tokenga aralashmaydi", () => {
  const c = new JobCost();
  c.addLlm({ provider: "gemini", model: "gemini-3.7-flash", inputTokens: 100, outputTokens: 3000 });
  c.addLlm({ provider: "anthropic", model: "claude-sonnet-5", inputTokens: 100, outputTokens: 1500 });
  c.addTts("azure", "azure:uz-UZ-MadinaNeural", 4000, 0.064);
  const j = c.toJson();
  assert.equal(j.provider, "gemini");
  assert.equal(j.outputTokens, 4500, "TTS belgilari token ustuniga qo'shilmaydi");
  assert.equal(j.calls, 3);
  assert.ok(Math.abs(j.usd - j.parts!.reduce((a, p) => a + p.usd, 0)) < 1e-6);

  // Grounding — QIDIRUV bo'yicha (review N6): 3 qidiruv = 3 birlik; qidiruvsiz javob ham kamida 1.
  const g = new JobCost();
  g.addGrounding(3);
  g.addGrounding(0);
  assert.equal(g.toJson().parts?.[0].units, 4);
  assert.equal(g.toJson().usd, Number((4 * GROUNDING_USD).toFixed(6)));

  const only = new JobCost();
  only.addImage("gemini", "gemini-3.1-flash-image", 3);
  assert.equal(only.toJson().provider, "gemini");
  assert.equal(only.toJson().model, "gemini-3.1-flash-image");
  assert.equal(only.toJson().usd, Number((3 * 0.067).toFixed(6)));
});
