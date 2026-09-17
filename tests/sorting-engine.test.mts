import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSortingDoc,
  clipWords,
  itemKey,
  numbered,
  pickCategories,
  shuffleStable,
  shuffledItems,
  sortingSections,
  SORTING_FLOOR,
} from "../lib/generation/games/sorting/engine.ts";
import { promisedItems, sortingInputFromValues, SORT_ITEMS_PER_CATEGORY_CAP } from "../lib/generation/games/sorting/input.ts";
import { sortingRewritePrompt, sortingSystemPrompt, sortingUserPrompt } from "../lib/generation/games/sorting/prompts.ts";
import { buildGameDoc, type GameBuildOpts } from "../lib/generation/games/engine.ts";
import { gameDefaultTypeId, gameTypeOf } from "../lib/generation/games/registry.ts";
import { GAME_LIMITS } from "../lib/generation/games/types.ts";
import { gameLayoutLabels } from "../lib/generation/games/layout.ts";
import type { DocMeta } from "../lib/generation/types.ts";
import type { FormValues } from "../lib/types.ts";
import type { LlmRole } from "../lib/generation/llm-roles.ts";

/**
 * SARALASH O'YINI DVIGATELI (AUDIT-22 WP-D).
 *
 * Tarmoq CHAQIRILMAYDI: LLM `complete` seam i bilan almashtiriladi
 * (`flashcards/engine` naqshi).
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `pickCategories` global dublikat tekshiruvini tashlab ketdi —
 *      «bir xil element ikki toifada» testi;
 *   2. ikki qutbli turda va'da saqlanmadi (2 × 5 qaytdi) — «va'da
 *      KO'PAYTMADAN» testi (darvoza hujjatni rad etardi);
 *   3. `shuffledItems` toifa tartibida qaytardi — «aralash ro'yxat
 *      javobni oshkor qilmaydi» testi;
 *   4. `sortingSections` javob kalitini tashlab ketdi — «uch bo'lim»
 *      testi;
 *   5. dispatch saralashni `null` qoldirdi (R0 stubi) — «buildGameDoc»
 *      testi.
 */

/* ────────────────────────── yordamchilar ────────────────────────── */

const meta = (over: Partial<DocMeta> = {}): DocMeta =>
  ({
    toolId: "sorting",
    topic: "Hayvonlar sinflari",
    language: "uz",
    subject: "Biologiya",
    grade: 7,
    extra: "",
    ...over,
  }) as DocMeta;

const values = (over: FormValues = {}): FormValues => ({ ...over });

const specOf = (id?: string) => gameTypeOf("sorting", id ?? gameDefaultTypeId("sorting"));

const USAGE = { provider: "gemini", model: "gemini-2.5-flash", inputTokens: 700, outputTokens: 800 };

type MockOpts = {
  /** Birinchi javobda nechta toifa qaytsin (standart: so'ralgancha). */
  first?: number;
  /** Har toifada nechta element (standart: so'ralgancha). */
  perCategory?: number;
  junk?: unknown[];
  judge?: Record<string, number>;
};

/**
 * Soxta model — nomlar va elementlar NOYOB: `pickCategories` global
 * dublikat filtri sinovni tasodifan qisqartirib qo'ymasin.
 */
function mockComplete(o: MockOpts = {}) {
  const calls: { role: string; system: string; user: string }[] = [];
  let catAt = 0;
  let itemAt = 0;
  const fn = async (role: LlmRole, system: string, user: string) => {
    calls.push({ role, system, user });
    if (role === "judge") {
      const scores = o.judge ?? { categoryClarity: 3, itemFit: 3, unambiguity: 3, gradeLevel: 3, balance: 2 };
      return { text: JSON.stringify({ ...scores, notes: ["yaxshi"], fixes: [] }), usage: USAGE };
    }
    const askedCats = Number(/EXACTLY (\d+) categories/.exec(user)?.[1] ?? 4);
    const askedItems = Number(/EXACTLY (\d+) items/.exec(user)?.[1] ?? 5);
    const writers = calls.filter((c) => c.role === "writer").length;
    const cats = writers === 1 && o.first !== undefined ? o.first : askedCats;
    const per = o.perCategory ?? askedItems;
    const out = Array.from({ length: cats }, () => {
      catAt++;
      return {
        name: `Toifa ${catAt}`,
        items: Array.from({ length: per }, () => `Element ${++itemAt}`),
      };
    });
    return { text: JSON.stringify({ categories: [...out, ...(o.junk ?? [])] }), usage: USAGE };
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

test("standart qiymatlar: 4 toifa × 5 element, `toifa` turi, meta dan fan/sinf/til", () => {
  const got = sortingInputFromValues(meta(), values());
  assert.equal(got.type, gameDefaultTypeId("sorting"));
  assert.equal(got.categoryCount, GAME_LIMITS.categoryCountDefault);
  assert.equal(got.itemsPerCategory, GAME_LIMITS.itemsPerCategoryDefault);
  assert.equal(got.subject, "Biologiya");
  assert.equal(got.grade, 7);
  assert.equal(got.language, "uz");
});

test("diapazon QAYTA tekshiriladi: chip bo'lmagan qiymat standartga tushadi", () => {
  assert.equal(sortingInputFromValues(meta(), values({ categoryCount: 7 })).categoryCount, GAME_LIMITS.categoryCountDefault);
  assert.equal(sortingInputFromValues(meta(), values({ categoryCount: 6 })).categoryCount, 6);
  assert.equal(sortingInputFromValues(meta(), values({ itemsPerCategory: 99 })).itemsPerCategory, GAME_LIMITS.itemsPerCategoryDefault);
  assert.equal(sortingInputFromValues(meta(), values({ sortingType: "yoq" })).type, gameDefaultTypeId("sorting"));
});

test("ikki qutbli turda toifa DOIM 2 ta, lekin VA'DA (toifa × element) saqlanadi", () => {
  /*
   * MUTATSIYA: agar dvigatel shunda 2 × 5 = 10 element bersa,
   * `gamePromisedCount` 4 × 5 = 20 deb hisoblab, darvoza (70 %)
   * hujjatni RAD ETARDI — standart forma bilan!
   */
  const v = values({ sortingType: "qarama-qarshi", categoryCount: 4, itemsPerCategory: 5 });
  const got = sortingInputFromValues(meta(), v);
  assert.equal(got.type, "qarama-qarshi");
  assert.equal(got.categoryCount, 2);
  assert.equal(got.categoryCount * got.itemsPerCategory, promisedItems(v), "va'da yo'qoldi");
  assert.equal(got.itemsPerCategory, 10);

  // Eng katta buyurtma ham chegaradan chiqmaydi.
  const big = sortingInputFromValues(meta(), values({ sortingType: "qarama-qarshi", categoryCount: 6, itemsPerCategory: 8 }));
  assert.ok(big.itemsPerCategory <= SORT_ITEMS_PER_CATEGORY_CAP, `chegaradan oshdi: ${big.itemsPerCategory}`);
  assert.equal(big.categoryCount * big.itemsPerCategory, 48);
});

/* ══════════════════════════ promptlar ══════════════════════════ */

test("tizim prompti: chiqish tili, BIR TOIFA qoidasi, halollik, reyestr qoidalari", () => {
  const ctx = { spec: specOf(), input: sortingInputFromValues(meta(), values()) };
  const s = sortingSystemPrompt(ctx);
  assert.match(s, /OUTPUT LANGUAGE: Uzbek/);
  assert.match(s, /ONE CATEGORY PER ITEM/, "markaziy qoida promptdan tushib qoldi");
  assert.match(s, /SAME level of abstraction/, "taksonomiya darajasi qoidasi yo'q");
  assert.match(s, /HONESTY/);
  for (const g of specOf().guidance) assert.ok(s.includes(g), `tur qoidasi tushib qoldi: ${g.slice(0, 40)}`);
});

test("foydalanuvchi prompti: aniq toifa/element soni, noyoblik va takrorlanmaslik ro'yxati", () => {
  const input = sortingInputFromValues(meta(), values({ categoryCount: 3, itemsPerCategory: 4 }));
  const p = sortingUserPrompt({ spec: specOf(), input }, 3, []);
  assert.match(p, /EXACTLY 3 categories/);
  assert.match(p, /EXACTLY 4 items in each/);
  assert.match(p, /belong to exactly ONE of the categories/);
  assert.match(sortingUserPrompt({ spec: specOf(), input }, 2, ["Mushuk"]), /ALREADY WRITTEN/);
});

test("sayqal prompti o'yinni MODEL shaklida so'raydi (nasr sifatida emas)", () => {
  const ctx = { spec: specOf(), input: sortingInputFromValues(meta(), values()) };
  const p = sortingRewritePrompt(ctx, [{ name: "A", items: ["x", "y"] }, { name: "B", items: ["z", "w"] }], "Aniqlashtiring");
  assert.match(p, /"categories":\[\{"name":"","items"/, "JSON sxemasi so'ralmadi — nasr qaytardi");
  assert.match(p, /EXACTLY 2 categories, in the SAME ORDER/);
  assert.match(p, /WHAT TO FIX: Aniqlashtiring/);
});

/* ══════════════════════════ normalizatsiya ══════════════════════════ */

test("`clipWords` va `itemKey`: katakdan chiqmaydi, taqqoslash tinish belgisiga bog'liq emas", () => {
  assert.equal(clipWords("qisqa", 40), "qisqa");
  const cut = clipWords("bir ikki uch to'rt besh olti", 12);
  assert.ok(cut.length <= 12 && !cut.endsWith(" "), `kesilmadi: «${cut}»`);
  assert.equal(itemKey("Mushuk!"), itemKey("mushuk"));
  // Apostrof ham tinish belgisi deb tashlanadi (`frontKey` bilan AYNI qoida):
  // «Ko‘k» va «Ko'k» bir xil element sanaladi — turli apostrof bilan yozilgan
  // takror hisobotda dublikat bo'lib ko'rinishi kerak.
  assert.equal(itemKey("  Ko‘k   qush "), "kok qush");
  assert.equal(itemKey("Ko'k qush"), itemKey("Ko‘k qush"));
});

test("`pickCategories`: buzuq band tashlanadi, element BUTUN o'yinda noyob, nom = element bo'lmaydi", () => {
  const seen = new Set<string>();
  const got = pickCategories(
    [
      { name: "Qushlar", items: ["Laylak", "Burgut", "qushlar", "Laylak"] },
      { name: "Baliqlar", items: ["Sazan", "laylak", "Laqqa"] },
      { name: "ab", items: ["Qisqa nom — tashlanadi"] },
      null,
      "matn emas",
      { name: "Bo‘sh", items: [] },
    ],
    { spec: specOf(), maxItems: 8, seen },
  );
  assert.deepEqual(got.map((c) => c.name), ["Qushlar", "Baliqlar"]);
  // «qushlar» — toifa nomining o'zi; ikkinchi «Laylak» — toifa ichida takror.
  assert.deepEqual(got[0].items, ["Laylak", "Burgut"]);
  // «laylak» — BOSHQA toifada allaqachon ishlatilgan (global noyoblik).
  assert.deepEqual(got[1].items, ["Sazan", "Laqqa"]);
  assert.deepEqual(numbered(got).map((c) => c.id), ["s1", "s2"], "id lar ketma-ket berilmadi");
});

test("`shuffleStable` BARQAROR: bir xil urug' — bir xil tartib, elementlar yo'qolmaydi", () => {
  const src = ["a", "b", "c", "d", "e", "f"];
  const a = shuffleStable(src, (x) => x, "seed");
  const b = shuffleStable(src, (x) => x, "seed");
  assert.deepEqual(a, b, "tartib tasodifiy — DOCX bilan ko'ruvchi ajralib ketardi");
  assert.deepEqual([...a].sort(), [...src].sort(), "element yo'qoldi yoki takrorlandi");
  assert.notDeepEqual(shuffleStable(src, (x) => x, "boshqa"), a, "urug' e'tiborsiz qolgan");
});

/* ══════════════════════════ nasr ══════════════════════════ */

test("`sortingSections`: uch bo'lim (ko'rsatma, ARALASH ro'yxat, javob kaliti)", () => {
  const L = gameLayoutLabels("uz");
  const model = {
    categories: [
      { id: "s1", name: "Qushlar", items: ["Laylak", "Burgut"] },
      { id: "s2", name: "Baliqlar", items: ["Sazan", "Laqqa"] },
    ],
  };
  const sections = sortingSections(model, L);
  assert.deepEqual(sections.map((s) => s.id), ["intro", "sorting", "answers"]);
  assert.equal(sections[0].blocks.length, 1);
  assert.match(sections[0].blocks[0].text, /4 ta elementni 2 ta toifaga/);

  const printed = sections[1].blocks.map((b) => b.text);
  assert.equal(printed.length, 4);
  assert.deepEqual([...printed].sort(), ["Burgut", "Laqqa", "Laylak", "Sazan"]);
  // ARALASH: toifa tartibida qolsa javob oshkor bo'lardi.
  assert.notDeepEqual(printed, ["Laylak", "Burgut", "Sazan", "Laqqa"]);
  assert.deepEqual(printed, shuffledItems(model), "maket va nasr boshqa tartibdan o'qiydi");

  const key = sections[2].blocks.map((b) => b.text);
  assert.ok(key.some((t) => t.includes("Qushlar: Laylak, Burgut")), "javob kalitida toifa qatori yo'q");
  assert.ok(key.some((t) => t.includes("Baliqlar: Sazan, Laqqa")));
});

/* ══════════════════════════ dvigatel ══════════════════════════ */

test("buildSortingDoc: model, nasr va `delivered` BITTA ro'yxatdan quriladi", async () => {
  const built = await buildSortingDoc(meta(), values({ categoryCount: 4, itemsPerCategory: 5 }), buildOpts());
  assert.ok(built, "hujjat qurilmadi");
  const model = built!.doc.game!;
  assert.equal(model.kind, "sorting");
  assert.equal(model.sorting!.categories.length, 4);
  for (const c of model.sorting!.categories) assert.equal(c.items.length, 5);
  assert.deepEqual(built!.doc.sections.map((s) => s.id), ["intro", "sorting", "answers"]);
  assert.equal(built!.doc.sections[1].blocks.length, 20, "bosma ro'yxatda hamma element bo'lishi kerak");
  assert.deepEqual(built!.delivered, { got: 20, want: 20, unit: "element" });
  assert.equal(built!.doc.titlePage, false);
  assert.equal(built!.doc.toc, false);
});

test("yetishmasa QO'SHIMCHA so'rov — bir marta, takrorlanmaslik ro'yxati bilan", async () => {
  const mock = mockComplete({ first: 2 });
  const built = await buildSortingDoc(meta(), values({ categoryCount: 4, itemsPerCategory: 3 }), buildOpts({ complete: mock.fn }));
  const writers = mock.calls.filter((c) => c.role === "writer");
  assert.equal(writers.length, 2, "qo'shimcha so'rov qilinmadi");
  assert.match(writers[1].user, /ALREADY WRITTEN/);
  assert.match(writers[1].user, /EXACTLY 2 categories/, "yetishmagan toifa soni so'ralmadi");
  assert.equal(built!.doc.game!.sorting!.categories.length, 4);
});

test("`delivered` KAMOMADNI ko'rsatadi va chegaradan past bo'lsa `null` (kredit qaytadi)", async () => {
  // 6 × 5 = 30 va'da, 4 × 5 = 20 natija (70 % = 21 dan past emas… 20 < 21).
  const floor = Math.ceil(30 * SORTING_FLOOR);
  assert.equal(floor, 21);
  const tooFew = mockComplete({ first: 2, perCategory: 5 });
  const stop = async (role: LlmRole, s: string, u: string) => {
    if (role === "writer" && tooFew.calls.filter((c) => c.role === "writer").length >= 1) {
      tooFew.calls.push({ role, system: s, user: u });
      return { text: JSON.stringify({ categories: [] }), usage: USAGE };
    }
    return tooFew.fn(role, s, u, { json: true, maxTokens: 10, timeoutMs: 10 });
  };
  const none = await buildSortingDoc(meta(), values({ categoryCount: 6, itemsPerCategory: 5 }), buildOpts({ complete: stop as unknown as NonNullable<GameBuildOpts["complete"]> }));
  assert.equal(none, null, "10 element 30 va'daga nisbatan chegaradan past — hujjat berilmasin");

  // 5 × 5 = 25 va'da, 4 × 5 = 20 natija — chegaradan yuqori, farq qaytariladi.
  const short = mockComplete({ first: 4, perCategory: 5 });
  const stop2 = async (role: LlmRole, s: string, u: string) => {
    if (role === "writer" && short.calls.filter((c) => c.role === "writer").length >= 1) {
      short.calls.push({ role, system: s, user: u });
      return { text: JSON.stringify({ categories: [] }), usage: USAGE };
    }
    return short.fn(role, s, u, { json: true, maxTokens: 10, timeoutMs: 10 });
  };
  const built = await buildSortingDoc(meta(), values({ categoryCount: 5, itemsPerCategory: 5 }), buildOpts({ complete: stop2 as unknown as NonNullable<GameBuildOpts["complete"]> }));
  assert.ok(built, "20 element 25 va'daga nisbatan chegaradan yuqori");
  assert.equal(built!.delivered!.got, 20);
  assert.equal(built!.delivered!.want, 25);
});

test("sarf telemetriyasi va bosqichlar: `onCost` bir marta, foiz kamaymaydi", async () => {
  const costs: unknown[] = [];
  const usages: unknown[] = [];
  const stages: { progress: number; step: string }[] = [];
  const built = await buildSortingDoc(
    meta(),
    values({ categoryCount: 3, itemsPerCategory: 4 }),
    buildOpts({ judge: true, onCost: (c) => costs.push(c), onUsage: (u) => usages.push(u), onStage: (e) => stages.push(e) }),
  );
  assert.ok(built);
  assert.equal(costs.length, 1);
  assert.ok(usages.length >= 2, `yozuvchi + baholovchi sarfi: ${usages.length}`);
  assert.ok(JSON.stringify(built!.cost).includes("gemini"));
  assert.ok(stages.length >= 4, `bosqichlar: ${stages.length}`);
  for (let i = 1; i < stages.length; i++) assert.ok(stages[i].progress >= stages[i - 1].progress, "foiz kamaydi");
  // Baholovchi bandlari hisobotga tushdi.
  assert.ok(built!.doc.game!.review!.checks.some((c) => c.id === "judge:unambiguity"));
});

test("`buildGameDoc` saralashni SHU dvigatelga uzatadi (statik dispatch shartnomasi)", async () => {
  const built = await buildGameDoc(meta(), values({ categoryCount: 2, itemsPerCategory: 3 }), buildOpts());
  assert.ok(built, "o'yin dispatchi saralashni topmadi (R0 stubi qolgan)");
  assert.equal(built!.doc.game!.kind, "sorting");
  assert.equal(built!.doc.game!.sorting!.categories.length, 2);
});

test("LLM kalitisiz muhitda `complete` berilmasa — `null` (shablon hujjat chiqmaydi)", async () => {
  const keys = ["GEMINI_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  try {
    const opts = buildOpts();
    delete (opts as { complete?: unknown }).complete;
    assert.equal(await buildSortingDoc(meta(), values(), opts), null);
  } finally {
    for (const k of keys) if (saved[k] !== undefined) process.env[k] = saved[k];
  }
});
