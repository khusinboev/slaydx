import test from "node:test";
import assert from "node:assert/strict";
import {
  attachAudio,
  buildListeningDoc,
  clipWords,
  listeningSections,
  pickItems,
  stableOrder,
  textKey,
  LISTENING_FLOOR,
} from "../lib/generation/games/listening/engine.ts";
import { listeningInputFromValues, LISTENING_FALLBACK_TARGET } from "../lib/generation/games/listening/input.ts";
import { listeningRewritePrompt, listeningSystemPrompt, listeningUserPrompt } from "../lib/generation/games/listening/prompts.ts";
import { buildGameDoc, type GameBuildOpts } from "../lib/generation/games/engine.ts";
import { gameDefaultTypeId, gameTypeOf } from "../lib/generation/games/registry.ts";
import { GAME_LIMITS } from "../lib/generation/games/types.ts";
import { gameLayoutLabels } from "../lib/generation/games/layout.ts";
import type { TtsProvider } from "../lib/generation/tts/types.ts";
import type { DocMeta } from "../lib/generation/types.ts";
import type { FormValues } from "../lib/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";

/**
 * TINGLASH O'YINI DVIGATELI (AUDIT-22 WP-D).
 *
 * Tarmoq ham, TTS ham CHAQIRILMAYDI: `complete` va `tts`/`putAsset`
 * seam lari bilan almashtiriladi. Ikkala shox ham sinaladi — bugungi
 * ISHLAB TURGAN yo'l aynan audiosiz (kalitlar yo'q, `tts.md` §6).
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `pickItems` javobni indeks o'rniga 0 qoldirdi — «to'g'ri javob
 *      aralashtirilgan variantlarga ergashadi» testi;
 *   2. variantlar aralashtirilmadi (javob doim birinchi) — o'sha test;
 *   3. `listeningSections` eshitiladigan matnni topshiriq betiga
 *      chiqardi — «matn bosilmaydi» testi;
 *   4. TTS seam i e'tiborsiz qoldirildi — «mock provayder → asset id»
 *      testi;
 *   5. dispatch tinglashni `null` qoldirdi (R0 stubi) — «buildGameDoc»
 *      testi.
 */

/* ────────────────────────── yordamchilar ────────────────────────── */

const meta = (over: Partial<DocMeta> = {}): DocMeta =>
  ({
    toolId: "listening",
    topic: "Shahardagi joylar",
    language: "uz",
    grade: 6,
    extra: "",
    ...over,
  }) as DocMeta;

const values = (over: FormValues = {}): FormValues => ({ nativeLanguage: "uz", targetLanguage: "en", ...over });

const specOf = (id?: string) => gameTypeOf("listening", id ?? gameDefaultTypeId("listening"));

const USAGE = { provider: "gemini", model: "gemini-2.5-flash", inputTokens: 600, outputTokens: 700 };

type MockOpts = { first?: number; junk?: unknown[]; judge?: Record<string, number>; wrong?: number };

function mockComplete(o: MockOpts = {}) {
  const calls: { role: string; system: string; user: string }[] = [];
  let at = 0;
  const fn = async (role: LlmRole, system: string, user: string) => {
    calls.push({ role, system, user });
    if (role === "judge") {
      const scores = o.judge ?? { wordChoice: 3, distractorQuality: 3, translationAccuracy: 3, gradeLevel: 3, pronounceability: 2 };
      return { text: JSON.stringify({ ...scores, notes: ["yaxshi"], fixes: [] }), usage: USAGE };
    }
    const asked = Number(/^(\d+) tasks on/m.exec(user)?.[1] ?? /EXACTLY (\d+) tasks/.exec(user)?.[1] ?? 10);
    const writers = calls.filter((c) => c.role === "writer").length;
    const take = writers === 1 && o.first !== undefined ? o.first : asked;
    const wrong = o.wrong ?? 3;
    const items = Array.from({ length: take }, () => {
      at++;
      return {
        text: `word${at}`,
        answer: `soz${at}`,
        distractors: Array.from({ length: wrong }, (_, k) => `boshqa${at}-${k}`),
      };
    });
    return { text: JSON.stringify({ items: [...items, ...(o.junk ?? [])] }), usage: USAGE };
  };
  return { fn: fn as unknown as NonNullable<GameBuildOpts["complete"]>, calls };
}

const buildOpts = (over: Partial<GameBuildOpts> = {}): GameBuildOpts => ({
  deadline: Date.now() + 300_000,
  complete: mockComplete().fn,
  judge: false,
  polish: false,
  now: new Date("2026-09-17T10:00:00Z"),
  ...over,
});

/** Soxta TTS provayderi — baytlar shartli, MUHIMI seam ning chaqirilishi. */
function mockTts(over: Partial<TtsProvider> = {}) {
  const said: { text: string; lang: string; voice?: string }[] = [];
  const provider: TtsProvider = {
    id: "azure",
    configured: () => true,
    synthesize: async (text, opts) => {
      said.push({ text, lang: opts.lang, voice: opts.voice });
      return { mp3: new Uint8Array([1, 2, 3, text.length]), seconds: 0.8, chars: text.length };
    },
    ...over,
  };
  return { provider, said };
}

/* ══════════════════════════ kirish ══════════════════════════ */

test("standart qiymatlar: 10 topshiriq, 4 variant, `sozlar` turi", () => {
  const got = listeningInputFromValues(meta(), values());
  assert.equal(got.type, gameDefaultTypeId("listening"));
  assert.equal(got.itemCount, GAME_LIMITS.listeningCountDefault);
  assert.equal(got.optionCount, GAME_LIMITS.listeningOptionsDefault);
  assert.equal(got.nativeLanguage, "uz");
  assert.equal(got.targetLanguage, "en");
  assert.equal(got.grade, 6);
});

test("diapazon QAYTA tekshiriladi; IKKI til teng kelsa o'rganiladigan til almashadi", () => {
  assert.equal(listeningInputFromValues(meta(), values({ itemCount: 7 })).itemCount, GAME_LIMITS.listeningCountDefault);
  assert.equal(listeningInputFromValues(meta(), values({ itemCount: 20 })).itemCount, 20);
  assert.equal(listeningInputFromValues(meta(), values({ listeningType: "yoq" })).type, gameDefaultTypeId("listening"));
  /*
   * «library» → «library» mashq emas: teng kelgan juftlikda
   * o'rganiladigan til zaxiraga tushadi (`languagePair` bandi ham
   * shuni tekshiradi).
   */
  const same = listeningInputFromValues(meta(), values({ nativeLanguage: "en", targetLanguage: "en" }));
  assert.notEqual(same.targetLanguage, same.nativeLanguage);
  const uz = listeningInputFromValues(meta(), values({ nativeLanguage: "uz", targetLanguage: "uz" }));
  assert.equal(uz.targetLanguage, LISTENING_FALLBACK_TARGET);
});

/* ══════════════════════════ promptlar ══════════════════════════ */

test("tizim prompti: variantlar ONA tilida, eshitiladigan matn O'RGANILADIGAN tilda", () => {
  const ctx = { spec: specOf(), input: listeningInputFromValues(meta(), values()) };
  const s = listeningSystemPrompt(ctx);
  assert.match(s, /OUTPUT LANGUAGE: Uzbek/, "variantlar tili ko'rsatilmagan");
  assert.match(s, /EXCEPTION to the line above/, "ikki tillilik istisnosi yo'q — model hammasini bitta tilga o'girardi");
  assert.match(s, /the field «text» is the word the pupil HEARS and must be written in English/);
  assert.match(s, /DISTRACTORS FROM THE SAME FIELD/);
  assert.match(s, /no digits, no abbreviations/, "TTS talaffuz qoidasi yo'q");
  for (const g of specOf().guidance) assert.ok(s.includes(g), `tur qoidasi tushib qoldi: ${g.slice(0, 40)}`);
});

test("foydalanuvchi prompti javobni MATN sifatida so'raydi (indeks emas)", () => {
  const input = listeningInputFromValues(meta(), values({ itemCount: 15 }));
  const p = listeningUserPrompt({ spec: specOf(), input }, 15, []);
  assert.match(p, /"items":\[\{"text":"","answer":"","distractors"/, "indeks so'ralib qolgan");
  assert.match(p, /EXACTLY 3 wrong meanings/);
  assert.match(p, /15 tasks on «Shahardagi joylar»/);
  assert.match(listeningUserPrompt({ spec: specOf(), input }, 5, ["library"]), /ALREADY WRITTEN/);
});

test("sayqal prompti to'plamni MODEL shaklida so'raydi va tartibni saqlaydi", () => {
  const ctx = { spec: specOf(), input: listeningInputFromValues(meta(), values()) };
  const p = listeningRewritePrompt(ctx, [{ text: "library", options: ["kutubxona", "muzey"], answer: 0 }], "Distraktorlarni yaxshilang");
  assert.match(p, /EXACTLY 1 tasks, in the SAME ORDER/);
  assert.match(p, /HEARD: library \| CORRECT: kutubxona/);
  assert.match(p, /WHAT TO FIX: Distraktorlarni yaxshilang/);
});

/* ══════════════════════════ normalizatsiya ══════════════════════════ */

test("`pickItems`: buzuq band tashlanadi, javob INDEKSGA aylanadi va variantlar aralashadi", () => {
  const seen = new Set<string>();
  const got = pickItems(
    [
      { text: "library", answer: "kutubxona", distractors: ["muzey", "dorixona", "bekat"] },
      { text: "LIBRARY!", answer: "kutubxona", distractors: ["a", "b", "c"] },
      { text: "", answer: "hech narsa", distractors: ["a", "b", "c"] },
      { text: "school", answer: "maktab", distractors: ["maktab", "muzey", "bozor"] },
      { text: "hospital", answer: "kasalxona", distractors: [] },
      null,
      "matn emas",
    ],
    { spec: specOf(), optionCount: 4, seen },
  );
  // `LIBRARY!` — dublikat; bo'sh matn va distraktorsiz band — yaroqsiz.
  assert.deepEqual(got.map((i) => i.text), ["library", "school"]);
  assert.deepEqual(got.map((i) => i.id), ["l1", "l2"]);

  const lib = got[0];
  assert.equal(lib.options.length, 4);
  assert.equal(lib.options[lib.answer], "kutubxona", "javob indeksi aralashtirilgan variantlarga ergashmadi");
  // `school` da takror distraktor («maktab» = javob) tashlangan — 3 variant qoldi
  // (eng kam chegara), ya'ni topshiriq yaroqli.
  assert.equal(got[1].options.length, 3);
  assert.equal(got[1].options[got[1].answer], "maktab");
  assert.equal(new Set(got[1].options).size, 3, "takror variant o'tib ketdi");
  assert.ok(!got[0].audioAssetId, "TTS seam siz audio paydo bo'ldi");
});

test("`stableOrder` BARQAROR va to'liq o'rin almashtirish beradi", () => {
  const a = stableOrder(4, "l1");
  assert.deepEqual(a, stableOrder(4, "l1"), "tartib tasodifiy — javob kaliti varaq bilan ajralib ketardi");
  assert.deepEqual([...a].sort(), [0, 1, 2, 3], "indeks yo'qoldi yoki takrorlandi");
  assert.notDeepEqual(stableOrder(4, "l2"), a);
  assert.equal(textKey("Kutubxona!"), textKey("kutubxona"));
  assert.equal(clipWords("bir ikki uch to'rt", 8).length <= 8, true);
});

/* ══════════════════════════ audio (TTS seam) ══════════════════════════ */

test("TTS seam: mock provayder → har topshiriqda `audioAssetId`", async () => {
  const tts = mockTts();
  const puts: { mime: string; size: number }[] = [];
  const items = [
    { id: "l1", text: "library", options: ["kutubxona", "muzey"], answer: 0 },
    { id: "l2", text: "school", options: ["maktab", "bozor"], answer: 0 },
  ];
  const got = await attachAudio(items, "en", {
    deadline: Date.now() + 300_000,
    tts: tts.provider,
    putAsset: async (bytes, mime) => {
      puts.push({ mime, size: bytes.byteLength });
      return `asset${puts.length}`;
    },
  });
  assert.deepEqual(got.map((i) => i.audioAssetId), ["asset1", "asset2"]);
  assert.deepEqual(tts.said.map((s) => s.text), ["library", "school"]);
  // Ovoz O'RGANILADIGAN til jadvalidan (`TTS_LANG_VOICES`) olinadi.
  assert.ok(tts.said.every((s) => s.lang === "en" && String(s.voice).startsWith("azure:en-")), `ovoz noto'g'ri: ${JSON.stringify(tts.said[0])}`);
  assert.deepEqual(puts.map((p) => p.mime), ["audio/mpeg", "audio/mpeg"]);
});

test("TTS seam BO'SH bo'lsa — audiosiz ishlaydi; bitta parcha yiqilsa qolganlari davom etadi", async () => {
  const items = [{ id: "l1", text: "library", options: ["kutubxona", "muzey"], answer: 0 }];
  // Kalit yo'q (bugungi ISHLAB TURGAN yo'l).
  assert.deepEqual(await attachAudio(items, "en", { deadline: Date.now() + 1000 }), items);
  // Provayder bor, lekin sozlanmagan.
  const off = mockTts({ configured: () => false });
  assert.deepEqual(await attachAudio(items, "en", { deadline: Date.now() + 1000, tts: off.provider, putAsset: async () => "x" }), items);
  assert.equal(off.said.length, 0, "sozlanmagan provayder chaqirildi");

  // Bitta parcha yiqildi — hujjat baribir chiqadi.
  let n = 0;
  const flaky = mockTts({
    synthesize: async (text: string) => {
      if (++n === 1) throw new Error("429");
      return { mp3: new Uint8Array([9]), seconds: 0.5, chars: text.length };
    },
  });
  const two = [...items, { id: "l2", text: "school", options: ["maktab", "bozor"], answer: 0 }];
  const got = await attachAudio(two, "en", { deadline: Date.now() + 300_000, tts: flaky.provider, putAsset: async () => "asset9" });
  assert.deepEqual(got.map((i) => i.audioAssetId), [undefined, "asset9"]);
});

/* ══════════════════════════ nasr ══════════════════════════ */

test("`listeningSections`: topshiriq betida MATN YO'Q, javob kalitida BOR", () => {
  const L = gameLayoutLabels("uz");
  const model = {
    items: [
      { id: "l1", text: "library", options: ["kutubxona", "muzey"], answer: 0 },
      { id: "l2", text: "school", options: ["bozor", "maktab"], answer: 1 },
    ],
    nativeLanguage: "uz",
    targetLanguage: "en",
  };
  const sections = listeningSections(model, L, "English");
  assert.deepEqual(sections.map((s) => s.id), ["intro", "items", "answers"]);
  assert.match(sections[0].blocks[0].text, /English/);

  const printed = sections[1].blocks.map((b) => b.text);
  assert.deepEqual(printed, ["1. A) kutubxona   B) muzey", "2. A) bozor   B) maktab"]);
  for (const line of printed) {
    assert.ok(!line.includes("library") && !line.includes("school"), `eshitiladigan matn varaqqa bosildi: ${line}`);
  }

  const key = sections[2].blocks.map((b) => b.text);
  assert.ok(key.some((t) => t.includes("library — kutubxona (A)")), "javob kalitida so'z va harfi yo'q");
  assert.ok(key.some((t) => t.includes("school — maktab (B)")));
});

/* ══════════════════════════ dvigatel ══════════════════════════ */

test("buildListeningDoc: model, nasr va `delivered` BITTA ro'yxatdan quriladi", async () => {
  const built = await buildListeningDoc(meta(), values({ itemCount: 10 }), buildOpts());
  assert.ok(built, "hujjat qurilmadi");
  const model = built!.doc.game!;
  assert.equal(model.kind, "listening");
  assert.equal(model.listening!.items.length, 10);
  assert.equal(model.listening!.targetLanguage, "en");
  assert.equal(model.listening!.nativeLanguage, "uz");
  assert.equal(model.language, "uz", "hujjat tili — ONA tili (variantlar shu tilda)");
  assert.deepEqual(built!.doc.sections.map((s) => s.id), ["intro", "items", "answers"]);
  assert.equal(built!.doc.sections[1].blocks.length, 10);
  assert.deepEqual(built!.delivered, { got: 10, want: 10, unit: "topshiriq" });
  assert.ok(model.listening!.items.every((i) => !i.audioAssetId), "TTS kalitsiz audio paydo bo'ldi");
});

test("dvigatel TTS seam ini uzatadi: hujjatdagi topshiriqlarda asset id lar", async () => {
  const tts = mockTts();
  let n = 0;
  const built = await buildListeningDoc(
    meta(),
    values({ itemCount: 10 }),
    buildOpts({ tts: tts.provider, putAsset: async () => `a${++n}` }),
  );
  assert.ok(built);
  const items = built!.doc.game!.listening!.items;
  assert.equal(items.length, 10);
  assert.ok(items.every((i) => i.audioAssetId), "audio id lar modelga yozilmadi");
  assert.equal(tts.said.length, 10);
  assert.deepEqual(tts.said.map((s) => s.text), items.map((i) => i.text), "sintez matni topshiriq matnidan ajralib ketdi");
});

test("yetishmasa QO'SHIMCHA so'rov; chegaradan kam bo'lsa `null` (kredit qaytadi)", async () => {
  const mock = mockComplete({ first: 4 });
  const built = await buildListeningDoc(meta(), values({ itemCount: 10 }), buildOpts({ complete: mock.fn }));
  const writers = mock.calls.filter((c) => c.role === "writer");
  assert.equal(writers.length, 2, "qo'shimcha so'rov qilinmadi");
  assert.match(writers[1].user, /ALREADY WRITTEN/);
  assert.equal(built!.doc.game!.listening!.items.length, 10);

  const floor = Math.ceil(20 * LISTENING_FLOOR);
  assert.ok(floor > 5);
  const poor = mockComplete({ first: 5 });
  const stop = async (role: LlmRole, s: string, u: string) => {
    if (role === "writer" && poor.calls.filter((c) => c.role === "writer").length >= 1) {
      poor.calls.push({ role, system: s, user: u });
      return { text: JSON.stringify({ items: [] }), usage: USAGE };
    }
    return poor.fn(role, s, u, { json: true, maxTokens: 10, timeoutMs: 10 });
  };
  const none = await buildListeningDoc(meta(), values({ itemCount: 20 }), buildOpts({ complete: stop as unknown as NonNullable<GameBuildOpts["complete"]> }));
  assert.equal(none, null);
});

test("sarf telemetriyasi va bosqichlar: `onCost` bir marta, foiz kamaymaydi", async () => {
  const costs: unknown[] = [];
  const stages: { progress: number; step: string }[] = [];
  const built = await buildListeningDoc(meta(), values({ itemCount: 10 }), buildOpts({ judge: true, onCost: (c) => costs.push(c), onStage: (e) => stages.push(e) }));
  assert.ok(built);
  assert.equal(costs.length, 1);
  assert.ok(stages.length >= 5, `bosqichlar: ${stages.length}`);
  for (let i = 1; i < stages.length; i++) assert.ok(stages[i].progress >= stages[i - 1].progress, "foiz kamaydi");
  assert.ok(built!.doc.game!.review!.checks.some((c) => c.id === "judge:distractorQuality"));
});

test("`buildGameDoc` tinglashni SHU dvigatelga uzatadi (statik dispatch shartnomasi)", async () => {
  const built = await buildGameDoc(meta(), values({ itemCount: 10 }), buildOpts());
  assert.ok(built, "o'yin dispatchi tinglashni topmadi (R0 stubi qolgan)");
  assert.equal(built!.doc.game!.kind, "listening");
  assert.equal(built!.doc.game!.listening!.items.length, 10);
});

test("LLM kalitisiz muhitda `complete` berilmasa — `null` (shablon hujjat chiqmaydi)", async () => {
  const keys = ["GEMINI_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  try {
    const opts = buildOpts();
    delete (opts as { complete?: unknown }).complete;
    assert.equal(await buildListeningDoc(meta(), values(), opts), null);
  } finally {
    for (const k of keys) if (saved[k] !== undefined) process.env[k] = saved[k];
  }
});
