import test from "node:test";
import assert from "node:assert/strict";
import { buildFlashcardsDoc, cardSections, clipWords, frontKey, pickCards, CARDS_FLOOR } from "../lib/generation/games/flashcards/engine.ts";
import { flashcardsInputFromValues } from "../lib/generation/games/flashcards/input.ts";
import { cardsRewritePrompt, cardsSystemPrompt, cardsUserPrompt } from "../lib/generation/games/flashcards/prompts.ts";
import { buildGameDoc, type GameBuildOpts } from "../lib/generation/games/engine.ts";
import { gameDefaultTypeId, gameTypeOf } from "../lib/generation/games/registry.ts";
import { GAME_LIMITS } from "../lib/generation/games/types.ts";
import { gameLayoutLabels } from "../lib/generation/games/layout.ts";
import type { DocMeta } from "../lib/generation/types.ts";
import type { FormValues } from "../lib/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";

/**
 * FLESH KARTALAR DVIGATELI (AUDIT-21 WP-B).
 *
 * Tarmoq CHAQIRILMAYDI: LLM `complete` seam i bilan almashtiriladi
 * (`crossword/engine` va `teacher/test/engine` naqshi).
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `pickCards` dublikat tekshiruvini tashlab ketdi — «dublikat
 *      old yuz tushib qoladi» testi;
 *   2. yetishmaganda qo'shimcha so'rov qilinmadi — «ikkinchi so'rov»
 *      testi;
 *   3. `clipWords` chegaradan uzun orqa yuzni kesmadi — «matn
 *      katakdan chiqmaydi» testi;
 *   4. `cardSections` misol qatorini tashlab ketdi — «nasr modeldan
 *      quriladi» testi;
 *   5. `includeExample` standarti formadan emas, qattiq `false` dan
 *      olindi — «reyestr standarti» testi;
 *   6. `delivered` so'ralgan sonni qaytardi (chiqqanini emas) —
 *      «delivered kamomadni ko'rsatadi» testi.
 */

/* ────────────────────────── yordamchilar ────────────────────────── */

const meta = (over: Partial<DocMeta> = {}): DocMeta =>
  ({
    toolId: "flashcards",
    topic: "Hujayra tuzilishi",
    language: "uz",
    subject: "Biologiya",
    grade: 7,
    extra: "",
    ...over,
  }) as DocMeta;

const values = (over: FormValues = {}): FormValues => ({ ...over });

const specOf = (id?: string) => gameTypeOf("flashcards", id ?? gameDefaultTypeId("flashcards"));

/** Yaroqli karta juftliklari — old yuz 5–50, orqa yuz 20–200 belgi. */
const PAIRS: [string, string][] = Array.from({ length: 24 }, (_, i) => [
  `Atama ${i + 1}`,
  `Bu ${i + 1}-atamaning ta'rifi: u nima ekani va nimasi bilan boshqalardan ajralib turishi bir jumlada aytilgan.`,
]);

const USAGE = { provider: "gemini", model: "gemini-2.5-flash", inputTokens: 700, outputTokens: 800 };

type MockOpts = {
  /** Birinchi javobda nechta karta qaytsin (standart: so'ralgancha). */
  first?: number;
  /** Har javobga qo'shiladigan buzuq elementlar. */
  junk?: unknown[];
  judge?: Record<string, number>;
  /** Misol qatori qaytarilsinmi (standart: so'ralgan bo'lsa — ha). */
  withExample?: boolean;
};

function mockComplete(o: MockOpts = {}) {
  const calls: { role: string; system: string; user: string }[] = [];
  let at = 0;
  const fn = async (role: LlmRole, system: string, user: string) => {
    calls.push({ role, system, user });
    if (role === "judge") {
      const scores = o.judge ?? { termClarity: 3, definitionCompleteness: 3, languageLevel: 3, exampleRelevance: 2, memorability: 3 };
      return { text: JSON.stringify({ ...scores, notes: ["yaxshi"], fixes: [] }), usage: USAGE };
    }
    const asked = Number(/^(\d+) cards on/m.exec(user)?.[1] ?? 10);
    const first = calls.filter((c) => c.role === "writer").length === 1;
    const take = first && o.first !== undefined ? o.first : asked;
    const list = PAIRS.slice(at, at + take);
    at += list.length;
    const wantExample = o.withExample ?? user.includes('"example"');
    const cards = list.map(([front, back]) => ({ front, back, ...(wantExample ? { example: `${front} jumlada shunday ishlatiladi.` } : {}) }));
    return { text: JSON.stringify({ cards: [...cards, ...(o.junk ?? [])] }), usage: USAGE };
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

/* ══════════════════════════ kirish ══════════════════════════ */

test("standart qiymatlar: 10 karta, atama–ta'rif turi, meta dan fan/sinf/til", () => {
  const got = flashcardsInputFromValues(meta(), values());
  assert.equal(got.cardCount, GAME_LIMITS.countDefault);
  assert.equal(got.type, gameDefaultTypeId("flashcards"), "standart tur reyestrdan");
  assert.equal(got.cardType, "term-def");
  assert.equal(got.subject, "Biologiya");
  assert.equal(got.grade, 7);
  assert.equal(got.language, "uz");
});

test("diapazon QAYTA tekshiriladi: reyestrdan tashqari karta soni standartga tushadi", () => {
  // Mijoz nima yuborishidan qat'i nazar — chip bo'lmagan qiymat qabul qilinmaydi.
  assert.equal(flashcardsInputFromValues(meta(), values({ cardCount: 13 })).cardCount, GAME_LIMITS.countDefault);
  assert.equal(flashcardsInputFromValues(meta(), values({ cardCount: 999 })).cardCount, GAME_LIMITS.countDefault);
  assert.equal(flashcardsInputFromValues(meta(), values({ cardCount: 20 })).cardCount, 20);
  // Noma'lum tur — kindning standart turi.
  assert.equal(flashcardsInputFromValues(meta(), values({ cardType: "image-word" })).type, gameDefaultTypeId("flashcards"));
  assert.equal(flashcardsInputFromValues(meta(), values({ cardType: "qa" })).cardType, "qa");
});

test("`includeExample` standarti REYESTRDAN, qattiq `false` dan emas", () => {
  const spec = specOf();
  // Maydonga tegilmagan forma — reyestr standarti.
  assert.equal(flashcardsInputFromValues(meta(), values()).includeExample, spec.limits.includeExampleDefault);
  // Forma aniq javob bergan holatlar.
  assert.equal(flashcardsInputFromValues(meta(), values({ includeExample: "ha" })).includeExample, true);
  assert.equal(flashcardsInputFromValues(meta(), values({ includeExample: "yoq" })).includeExample, false);
});

/* ══════════════════════════ promptlar ══════════════════════════ */

test("tizim prompti: chiqish tili, halollik va UZUNLIK FIZIK chegara ekani", () => {
  const ctx = { spec: specOf(), input: flashcardsInputFromValues(meta(), values()) };
  const s = cardsSystemPrompt(ctx);
  assert.match(s, /OUTPUT LANGUAGE: Uzbek/);
  assert.match(s, /HONESTY/);
  assert.match(s, /LENGTH IS PHYSICAL/, "uzunlik chegarasi «uslub tavsiyasi» bo'lib qolgan");
  assert.match(s, /8 per A4 sheet/, "maket sharti promptda yo'q");
  // Tur qoidalari REYESTRDAN.
  for (const g of specOf().guidance) assert.ok(s.includes(g), `tur qoidasi tushib qoldi: ${g.slice(0, 40)}`);
});

test("foydalanuvchi prompti: tur bo'yicha boshqacha (savol belgisi ↔ atama), chegaralar aytiladi", () => {
  const [frontMin, frontMax] = specOf().limits.frontChars;
  const [backMin, backMax] = specOf().limits.backChars;
  const td = cardsUserPrompt({ spec: specOf(), input: flashcardsInputFromValues(meta(), values()) }, 10, []);
  assert.match(td, new RegExp(`front: the TERM only, ${frontMin}–${frontMax}`), "atama turida old yuz qoidasi yo'q");
  assert.match(td, new RegExp(`${backMin}–${backMax} characters`), "orqa yuz chegarasi yo'q");
  assert.ok(!td.includes("question mark"), "atama turida savol qoidasi chiqib qoldi");

  const qa = cardsUserPrompt({ spec: specOf("qa"), input: flashcardsInputFromValues(meta(), values({ cardType: "qa" })) }, 10, []);
  assert.match(qa, /ending in a question mark/, "savol turida savol qoidasi yo'q");

  // Takrorlanmaslik ro'yxati — qo'shimcha so'rov uchun.
  assert.match(cardsUserPrompt({ spec: specOf(), input: flashcardsInputFromValues(meta(), values()) }, 4, ["Atama 1"]), /ALREADY WRITTEN/);
});

test("sayqal prompti kartani MODEL shaklida so'raydi (nasr sifatida emas)", () => {
  const ctx = { spec: specOf(), input: flashcardsInputFromValues(meta(), values()) };
  const p = cardsRewritePrompt(ctx, [{ front: "A", back: "B" }, { front: "C", back: "D" }], "Qisqartiring");
  assert.match(p, /"cards":\[\{"front":"","back":""/, "JSON sxemasi so'ralmadi — nasr qaytardi");
  assert.match(p, /EXACTLY 2 cards, in the SAME ORDER/, "karta soni va tartibi talab qilinmadi");
  assert.match(p, /WHAT TO FIX: Qisqartiring/);
});

/* ══════════════════════════ normalizatsiya ══════════════════════════ */

test("`clipWords` chegaradan uzun matnni SO'Z chegarasida kesadi (katakdan chiqmasin)", () => {
  assert.equal(clipWords("qisqa matn", 50), "qisqa matn");
  const long = "bir ikki uch to'rt besh olti yetti sakkiz to'qqiz o'n";
  const cut = clipWords(long, 20);
  assert.ok(cut.length <= 20, `kesilmadi: ${cut.length}`);
  assert.ok(!cut.endsWith(" "), "oxirida bo'shliq qoldi");
  assert.ok(long.startsWith(cut), "kesilgan matn asl matnning boshi bo'lishi kerak");
  assert.ok(!/\S$/.test(long.slice(cut.length, cut.length + 1)) || long[cut.length] === " ", "so'z o'rtasidan kesildi");
  assert.equal(clipWords(null, 10), "");
});

test("`pickCards`: buzuq element JIMGINA tashlanadi, dublikat old yuz o'tmaydi", () => {
  const seen = new Set<string>();
  const got = pickCards(
    [
      { front: "Fotosintez", back: "Yashil bargda organik modda hosil bo'lish jarayoni haqida to'liq ta'rif." },
      { front: "FOTOSINTEZ!", back: "Aynan shu atamaning boshqacha yozilgan takroriy ta'rifi, uzunligi yetarli." },
      { front: "qis", back: "Old yuzi juda qisqa — 5 belgidan kam, shuning uchun tashlanadi." },
      { front: "Xlorofill", back: "qisqa" },
      null,
      "matn emas",
      { front: "Xloroplast", back: "Fotosintez boradigan ikki membranali organoid haqida to'liq ta'rif." },
    ],
    { spec: specOf(), includeExample: false, seen },
  );
  assert.deepEqual(got.map((c) => c.front), ["Fotosintez", "Xloroplast"]);
  assert.deepEqual(got.map((c) => c.id), ["c1", "c2"], "id lar ketma-ket berilmadi");
  // Dublikat kaliti — tinish belgisi va katta-kichik harfga BOG'LIQ EMAS.
  assert.equal(frontKey("FOTOSINTEZ!"), frontKey("Fotosintez"));
});

test("atama turida old yuzdagi oxirgi nuqta olib tashlanadi, savol turida «?» SAQLANADI", () => {
  const td = pickCards([{ front: "Fotosintez.", back: "Yashil bargda organik modda hosil bo'lishi haqidagi to'liq ta'rif." }], {
    spec: specOf(),
    includeExample: false,
    seen: new Set(),
  });
  assert.equal(td[0].front, "Fotosintez");
  const qa = pickCards([{ front: "Fotosintez nima?", back: "Yashil bargda organik modda hosil bo'lishi haqidagi to'liq javob." }], {
    spec: specOf("qa"),
    includeExample: false,
    seen: new Set(),
  });
  assert.equal(qa[0].front, "Fotosintez nima?", "savol belgisi yo'qoldi");
});

test("misol qatori FAQAT so'ralganda olinadi va chegarasi bor", () => {
  const raw = [{ front: "Fotosintez", back: "Yashil bargda organik modda hosil bo'lishi haqidagi to'liq ta'rif.", example: "x".repeat(400) }];
  const off = pickCards(raw, { spec: specOf(), includeExample: false, seen: new Set() });
  assert.ok(!off[0].example, "misol so'ralmagan edi");
  const on = pickCards(raw, { spec: specOf(), includeExample: true, seen: new Set() });
  assert.ok(on[0].example!.length <= GAME_LIMITS.cardExampleCharsMax, `misol kesilmadi: ${on[0].example!.length}`);
});

/* ══════════════════════════ nasr ══════════════════════════ */

test("`cardSections`: har karta `h3` old yuz + `p` orqa yuz (+ `p` misol)", () => {
  const L = gameLayoutLabels("uz");
  const sections = cardSections({ type: "term-def", cards: [{ id: "c1", front: "A", back: "B", example: "C" }, { id: "c2", front: "D", back: "E" }], includeExample: true }, L);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].id, "cards", "bo'lim id si SHARTNOMA (hisobot/sayqal nishoni)");
  assert.deepEqual(
    sections[0].blocks.map((b) => `${b.kind}:${b.text}`),
    ["h3:A", "p:B", `p:${L.example}: C`, "h3:D", "p:E"],
  );
});

/* ══════════════════════════ dvigatel ══════════════════════════ */

test("buildFlashcardsDoc: model, nasr va `delivered` BITTA ro'yxatdan quriladi", async () => {
  const built = await buildFlashcardsDoc(meta(), values({ cardCount: 10, includeExample: "ha" }), buildOpts());
  assert.ok(built, "hujjat qurilmadi");
  const model = built!.doc.game!;
  assert.equal(model.kind, "flashcards");
  assert.equal(model.cards!.cards.length, 10);
  assert.equal(model.cards!.includeExample, true);
  assert.equal(built!.delivered!.got, 10);
  assert.equal(built!.delivered!.want, 10);
  assert.equal(built!.delivered!.unit, "karta");
  // Nasr MODELDAN: har kartaga 3 blok (misol bilan).
  assert.deepEqual(built!.doc.sections.map((s) => s.id), ["cards"]);
  assert.equal(built!.doc.sections[0].blocks.length, 30);
  // Titul beti ham, mundarija ham YO'Q — birinchi bet kartalarning o'zi.
  assert.equal(built!.doc.titlePage, false);
  assert.equal(built!.doc.toc, false);
});

test("yetishmasa QO'SHIMCHA so'rov — bir marta, takrorlanmaslik ro'yxati bilan", async () => {
  const mock = mockComplete({ first: 4 });
  const built = await buildFlashcardsDoc(meta(), values({ cardCount: 10 }), buildOpts({ complete: mock.fn }));
  const writers = mock.calls.filter((c) => c.role === "writer");
  assert.equal(writers.length, 2, "qo'shimcha so'rov qilinmadi");
  assert.match(writers[1].user, /ALREADY WRITTEN/, "takrorlanmaslik ro'yxati yo'q");
  assert.equal(built!.doc.game!.cards!.cards.length, 10);

  // Model baribir bermasa — UCHINCHI so'rov YO'Q (cheksiz tsikl bo'lmasin).
  const poor = mockComplete({ first: 6 });
  const only = async (role: LlmRole, s: string, u: string) => {
    const r = await poor.fn(role, s, u, { json: true, maxTokens: 10, timeoutMs: 10 });
    return poor.calls.filter((c) => c.role === "writer").length > 1 ? { text: JSON.stringify({ cards: [] }), usage: USAGE } : r;
  };
  await buildFlashcardsDoc(meta(), values({ cardCount: 20 }), buildOpts({ complete: only as unknown as NonNullable<GameBuildOpts["complete"]> }));
  assert.equal(poor.calls.filter((c) => c.role === "writer").length, 2, "ikkinchi marta qayta so'ralmasin");
});

test("`delivered` KAMOMADNI ko'rsatadi: chiqqani so'ralganidan kam bo'lsa farq qaytariladi", async () => {
  /*
   * Model 20 dan atigi 15 ta karta berdi (chegaradan yuqori, ya'ni
   * hujjat yaratiladi) — foydalanuvchi 20 taga to'lagan, farq
   * `refundPartial` bilan qaytadi.
   */
  const short = mockComplete({ first: 15 });
  const stop = async (role: LlmRole, s: string, u: string) => {
    const writers = short.calls.filter((c) => c.role === "writer").length;
    if (writers >= 1 && role === "writer") {
      short.calls.push({ role, system: s, user: u });
      return { text: JSON.stringify({ cards: [] }), usage: USAGE };
    }
    return short.fn(role, s, u, { json: true, maxTokens: 10, timeoutMs: 10 });
  };
  const built = await buildFlashcardsDoc(meta(), values({ cardCount: 20 }), buildOpts({ complete: stop as unknown as NonNullable<GameBuildOpts["complete"]> }));
  assert.ok(built, "15 karta chegaradan (70 %) yuqori — hujjat chiqishi kerak");
  assert.equal(built!.delivered!.got, 15);
  assert.equal(built!.delivered!.want, 20);
});

test("chegaradan kam karta — `null` (kredit qaytadi, yarim hujjat berilmaydi)", async () => {
  const floor = Math.ceil(20 * CARDS_FLOOR);
  const tooFew = mockComplete({ first: 3 });
  const stop = async (role: LlmRole, s: string, u: string) => {
    const writers = tooFew.calls.filter((c) => c.role === "writer").length;
    if (writers >= 1 && role === "writer") {
      tooFew.calls.push({ role, system: s, user: u });
      return { text: JSON.stringify({ cards: [] }), usage: USAGE };
    }
    return tooFew.fn(role, s, u, { json: true, maxTokens: 10, timeoutMs: 10 });
  };
  assert.ok(3 < floor, "sinov shartsiz o'tib ketmasin");
  const built = await buildFlashcardsDoc(meta(), values({ cardCount: 20 }), buildOpts({ complete: stop as unknown as NonNullable<GameBuildOpts["complete"]> }));
  assert.equal(built, null);
});

test("sarf telemetriyasi va bosqichlar: `onCost` bir marta, foiz kamaymaydi", async () => {
  const costs: unknown[] = [];
  const usages: unknown[] = [];
  const stages: { progress: number; step: string }[] = [];
  const built = await buildFlashcardsDoc(
    meta(),
    values({ cardCount: 10 }),
    buildOpts({ judge: true, onCost: (c) => costs.push(c), onUsage: (u) => usages.push(u), onStage: (e) => stages.push(e) }),
  );
  assert.ok(built);
  assert.equal(costs.length, 1, "`onCost` bir marta chaqirilsin");
  assert.ok(usages.length >= 2, `yozuvchi + baholovchi sarfi: ${usages.length}`);
  assert.ok(JSON.stringify(built!.cost).includes("gemini"), "provayder sarfda yo'q");
  assert.ok(stages.length >= 4, `bosqichlar: ${stages.length}`);
  for (let i = 1; i < stages.length; i++) assert.ok(stages[i].progress >= stages[i - 1].progress, "foiz kamaydi");
});

test("`buildGameDoc` flesh kartalarni SHU dvigatelga uzatadi (dispatch shartnomasi)", async () => {
  const built = await buildGameDoc(meta(), values({ cardCount: 5 }), buildOpts());
  assert.ok(built, "o'yin dispatchi kartalarni topmadi");
  assert.equal(built!.doc.game!.kind, "flashcards");
  assert.equal(built!.doc.game!.cards!.cards.length, 5);
});

test("LLM kalitisiz muhitda `complete` berilmasa — `null` (shablon hujjat chiqmaydi)", async () => {
  const opts = buildOpts();
  delete (opts as { complete?: unknown }).complete;
  const built = await buildFlashcardsDoc(meta(), values({ cardCount: 10 }), opts);
  assert.equal(built, null);
});
