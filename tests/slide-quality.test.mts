import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { extractMeta } from "../lib/generation/meta.ts";
import { resetBreakers } from "../lib/generation/llm/breaker.ts";
import { bodyRules } from "../lib/generation/slide-audience.ts";
import { SLIDE_LIMITS, clipTo, limitsFor } from "../lib/generation/slide-limits.ts";
import {
  CHARS_PER_WORD,
  COL_MIN_ITEMS,
  COL_MIN_WORDS,
  PROCESS_MIN_STEPS,
  QUOTE_MIN_WORDS,
  REPAIR_MIN_MS,
  SECTION_SUBTITLE_MIN_WORDS,
  STEP_MIN_WORDS,
  THIN_BULLET_K,
  CLIP_FLOOR_CHARS,
  bulletMaxWords,
  bulletMinWords,
  clipLimit,
  fmtRange,
  wordTargetLines,
  fitChars,
  layoutWordTargets,
  repairThinSlides,
  thinSlides,
  type ThinReason,
} from "../lib/generation/slide-quality.ts";
import { resolveSlideTemplate } from "../lib/generation/slide-templates.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";

/**
 * AUDIT-25 P3 — matn ZICHLIGI: `thinSlides` detektori va
 * `repairThinSlides` (bitta qo'shimcha LLM chaqiruvi).
 *
 * Jonli dekalarda (Orol dengizi, Kasr sonlar) mazmun slaydlarida 2–3
 * qisqa band, process kartasida 3–4 so'z, bo'sh bo'lim subtitle va «…»
 * bilan kesilgan test variantlari chiqdi (AUDIT-25 S4). Hech bir test
 * JONLI chaqiruv qilmaydi — `fetch` stub qilinadi.
 */

// ───────────────────────────────────────────── yordamchilar

const POOL =
  "suv resurslari mintaqaning iqlimi va aholining sog‘lig‘iga bevosita ta’sir qiladi shuning uchun ularni tejash hamda zamonaviy sug‘orish usullarini joriy etish muhim vazifa hisoblanadi".split(
    " ",
  );
/** `n` so'zli gap — real o'zbekcha so'zlar. */
const sent = (n: number, from = 0) => Array.from({ length: n }, (_, i) => POOL[(from + i) % POOL.length]).join(" ");

const bachelor = bodyRules({ slideAudience: "students_bachelor", textVolume: "standart", planItems: 5 }, "lecture");
const VIS = "classic" as const;

/** Reja MAZMUN slaydi (`plan: 1`) — bandlar/ustun/bosqich qoidalari faqat shularga. Blok slaydi uchun `plan: undefined`. */
const S = (o: Partial<SlideModel> & Pick<SlideModel, "layout"> & { plan?: number }): SlideModel =>
  ({ id: "s", title: "Sarlavha", plan: 1, ...o }) as SlideModel;

const healthy: SlideModel[] = [
  S({ layout: "bullets", bullets: [sent(14), sent(14, 3), sent(14, 6)] }),
  S({ layout: "process", steps: [1, 2, 3].map((n) => ({ n: String(n), title: `Bosqich ${n}`, text: sent(9, n) })) }),
  S({ layout: "twoCol", leftTitle: "Chap", rightTitle: "O‘ng", left: [sent(9), sent(9, 2), sent(9, 4)], right: [sent(9, 1), sent(9, 3), sent(9, 5)] }),
  S({ layout: "compare", leftTitle: "A", rightTitle: "B", left: [sent(8), sent(8, 2)], right: [sent(8, 1), sent(8, 3)] }),
  S({ layout: "section", subtitle: sent(22) }),
  S({ layout: "quote", quote: sent(15), quoteBy: "Muallif" }),
  S({ layout: "quiz", quiz: [{ q: "Qaysi usul suvni tejaydi?", options: ["Tomchilatib sug‘orish", "Egatlab sug‘orish", "Bostirib sug‘orish", "Yomg‘irlatish"], answer: 0 }] }),
];

const reasonsOf = (s: SlideModel, rules = bachelor, visual: Parameters<typeof thinSlides>[2] = VIS) =>
  thinSlides([s], rules, visual)[0]?.reasons ?? [];

// ───────────────────────────────────────────── 1. thinSlides — har sabab

test("thinSlides: sog'lom slaydlar yupqa EMAS", () => {
  assert.deepEqual(thinSlides(healthy, bachelor, VIS), []);
});

test("few-bullets: minBullets dan kam band (uzun bo'lsa ham)", () => {
  assert.deepEqual(reasonsOf(S({ layout: "bullets", bullets: [sent(16), sent(16, 2)] })), ["few-bullets"]);
});

test("short-bullets: o'rtacha so'z THIN_BULLET_K × bulletChars/8 dan kam", () => {
  const min = bulletMinWords(bachelor);
  assert.equal(min, Math.floor((bachelor.bulletChars * THIN_BULLET_K) / 8));
  // Chegaradan BITTA so'z kam — yupqa; aynan chegarada — sog'lom.
  const below = S({ layout: "bullets", bullets: [sent(min - 1), sent(min - 1, 2), sent(min - 1, 4)] });
  const at = S({ layout: "bullets", bullets: [sent(min), sent(min, 2), sent(min, 4)] });
  assert.deepEqual(reasonsOf(below), ["short-bullets"]);
  assert.deepEqual(reasonsOf(at), []);
  // Jonli dekadagi naqsh: 2 ta 3 so'zli band — ikkala sabab.
  assert.deepEqual(reasonsOf(S({ layout: "bullets", bullets: ["Suv tanqisligi.", "Iqlim o‘zgarishi."] })), ["few-bullets", "short-bullets"]);
  // 1–4 sinf: 80 × 0.55 / 8 = 5.5 → 5 (round 6 edi — 5 so'zli bolalar bandi «yupqa» chiqardi).
  const kids = bodyRules({ slideAudience: "school_1_4", textVolume: "standart", planItems: 5 }, "lesson");
  assert.equal(bulletMinWords(kids), 5);
  assert.deepEqual(reasonsOf(S({ layout: "bullets", bullets: [sent(5), sent(5, 2), sent(5, 4)] }), kids, "classic"), []);
});

test("blok slaydlari (plan yo'q) bandlar/ustun/bosqich qoidasidan ozod; bo'sh subtitle va kesilgan variant — hamma slaydga", () => {
  // «Dars maqsadlari» — qisqa maqsadlar tabiiy (P5 bilan bir qoida).
  const goals = S({ layout: "bullets", plan: undefined, title: "Dars maqsadlari", bullets: ["Orol muammosini tushuntirish", "Sabablarni ajratish"] });
  assert.deepEqual(reasonsOf(goals), []);
  assert.deepEqual(reasonsOf({ ...goals, plan: 2 } as SlideModel), ["few-bullets", "short-bullets"]);
  const steps = S({ layout: "process", plan: undefined, steps: [1, 2, 3].map((n) => ({ n: String(n), title: "B", text: "Qisqa" })) });
  assert.deepEqual(reasonsOf(steps), []);
  const cols = S({ layout: "twoCol", plan: undefined, left: ["A"], right: ["B"] });
  assert.deepEqual(reasonsOf(cols), []);
  assert.deepEqual(reasonsOf(S({ layout: "section", plan: undefined })), ["empty-subtitle"]);
});

test("short-steps: bosqich matni STEP_MIN_WORDS dan kam yoki bosqich PROCESS_MIN_STEPS dan kam", () => {
  const steps = (w: number, k = 3) => Array.from({ length: k }, (_, i) => ({ n: String(i + 1), title: "Bosqich", text: sent(w, i) }));
  assert.deepEqual(reasonsOf(S({ layout: "process", steps: steps(STEP_MIN_WORDS - 1) })), ["short-steps"]);
  assert.deepEqual(reasonsOf(S({ layout: "process", steps: steps(STEP_MIN_WORDS) })), []);
  assert.deepEqual(reasonsOf(S({ layout: "process", steps: steps(10, PROCESS_MIN_STEPS - 1) })), ["short-steps"]);
  // Skelet (`beatToSlide`) naqshi: «Boshlash / O'zgarish / Natija» + rol.
  const skeleton = S({
    layout: "process",
    steps: [
      { n: "1", title: "Boshlash", text: "Ketma-ketlik" },
      { n: "2", title: "O‘zgarish", text: "Orol dengizi" },
      { n: "3", title: "Natija", text: "Kuzatiladigan yakun" },
    ],
  });
  assert.deepEqual(reasonsOf(skeleton), ["short-steps"]);
  // Ko'pchilik qoidasi: bitta 5 so'zli sog'lom bosqich butun slaydni «yupqa» qilmaydi…
  const mostly = S({ layout: "process", steps: [sent(9), sent(9, 3), "Natijani baholash va xulosa chiqarish"].map((text, i) => ({ n: String(i + 1), title: "B", text })) });
  assert.deepEqual(reasonsOf(mostly), []);
  // …lekin yorliq-bosqich (≤ 3 so'z) — yupqa.
  const label = S({ layout: "process", steps: [sent(9), sent(9, 3), "Natija"].map((text, i) => ({ n: String(i + 1), title: "B", text })) });
  assert.deepEqual(reasonsOf(label), ["short-steps"]);
  // Ortiqcha son o'z chegarasini pasaytirmaydi: 1–4 sinfga 5 × 3 so'z — `stepsMax` (3) dagi chegara bilan yupqa.
  const kids = bodyRules({ slideAudience: "school_1_4", textVolume: "standart", planItems: 5 }, "lesson");
  const five = S({ layout: "process", steps: Array.from({ length: 5 }, (_, i) => ({ n: String(i + 1), title: "B", text: sent(3, i) })) });
  assert.deepEqual(reasonsOf(five, kids, "classic"), ["short-steps"]);
});

test("short-columns: ustunda COL_MIN_ITEMS dan kam band yoki o'rtacha COL_MIN_WORDS dan kam so'z", () => {
  const col = (k: number, w: number) => Array.from({ length: k }, (_, i) => sent(w, i));
  assert.deepEqual(reasonsOf(S({ layout: "twoCol", left: col(COL_MIN_ITEMS - 1, 9), right: col(3, 9) })), ["short-columns"]);
  assert.deepEqual(reasonsOf(S({ layout: "compare", left: col(3, COL_MIN_WORDS - 1), right: col(3, COL_MIN_WORDS - 1) })), ["short-columns"]);
  // Mutlaq holat: jonli dekadagi yorliq-ustunlar (2–3 so'z) — yupqa.
  const labels = ["Suv tanqisligi", "Tuproq sho‘rlanishi", "Chang bo‘ronlari"];
  assert.deepEqual(reasonsOf(S({ layout: "twoCol", left: labels, right: labels })), ["short-columns"]);
  assert.deepEqual(reasonsOf(S({ layout: "compare", left: col(3, COL_MIN_WORDS), right: col(3, COL_MIN_WORDS) })), []);
});

test("empty-subtitle: bo'lim subtitle bo'sh yoki SECTION_SUBTITLE_MIN_WORDS dan kam (skelet: faqat mavzu nomi) yoki sarlavhaning o'zi", () => {
  const long = sent(8);
  assert.deepEqual(reasonsOf(S({ layout: "section", title: long, subtitle: long })), ["empty-subtitle"]);
  assert.deepEqual(reasonsOf(S({ layout: "section" })), ["empty-subtitle"]);
  assert.deepEqual(reasonsOf(S({ layout: "section", subtitle: "Orol dengizi" })), ["empty-subtitle"]);
  assert.deepEqual(reasonsOf(S({ layout: "section", subtitle: sent(SECTION_SUBTITLE_MIN_WORDS - 1) })), ["empty-subtitle"]);
  assert.deepEqual(reasonsOf(S({ layout: "section", subtitle: sent(SECTION_SUBTITLE_MIN_WORDS) })), []);
});

test("iqtibos HECH QACHON yupqa emas — haqiqiy qisqa iqtibosni uzaytirish uydirma (sharh 3-band)", () => {
  assert.deepEqual(reasonsOf(S({ layout: "quote", quote: "Bilim — kuch.", quoteBy: "F. Bekon" })), []);
  assert.deepEqual(reasonsOf(S({ layout: "quote", quote: "Orol nega qurib qoldi?" })), []);
  assert.deepEqual(reasonsOf(S({ layout: "quote", quote: sent(QUOTE_MIN_WORDS - 1) })), []);
});

test("clipped-option: «…» bilan tugagan variant/savol, yoki auditoriya qutisiga sig'maydigan variant", () => {
  const quiz = (options: string[], q = "Savol?") => S({ layout: "quiz", quiz: [{ q, options, answer: 1 }] });
  // Jonli dekadagi naqsh: qopqoqda kesilgan variant («…me'yor…»).
  const cap = clipLimit("quizOption", bachelor, VIS);
  const cut = clipTo(`Suv sarfi me’yorlari ${sent(30)}`, cap);
  assert.ok(cut.endsWith("…"));
  assert.deepEqual(reasonsOf(quiz(["Birinchi", cut, "Uchinchi", "To‘rtinchi"])), ["clipped-option"]);
  assert.deepEqual(reasonsOf(quiz(["A", "B", "C", "D"], clipTo(sent(40), SLIDE_LIMITS.quizQ))), ["clipped-option"]);
  // Bo'sh joyli savol / qisqa «…» — qirqilgan EMAS (sharh 12-band).
  assert.deepEqual(reasonsOf(quiz(["1/2", "3/4", "1/4", "2/3"], "1/2 + 1/4 = …")), []);
  assert.deepEqual(reasonsOf(quiz(["Va hokazo…", "B", "C", "D"])), []);
  // 60 belgilik variant talabaga sig'adi, 1–4 sinf `cards` qutisiga (pol 24 pt) — yo'q.
  const long = ["a", "b", "c", "d"].map((x) => `${x}) ${sent(7)}`);
  assert.ok(long[0].length > fitChars("quizOption", bodyRules({ slideAudience: "school_1_4", textVolume: "standart", planItems: 5 }, "lesson"), "cards"));
  assert.deepEqual(reasonsOf(quiz(long), bachelor, "cards"), []);
  const kids = bodyRules({ slideAudience: "school_1_4", textVolume: "standart", planItems: 5 }, "lesson");
  assert.deepEqual(reasonsOf(quiz(long), kids, "cards"), ["clipped-option"]);
});

test("nomzod EMAS: title/agenda/closing/answers/references/stats/table/quote bo'sh bo'lsa ham", () => {
  const never: SlideModel[] = (["title", "agenda", "closing", "answers", "references", "stats", "table", "quote"] as const).map((layout) =>
    S({ layout, bullets: [] }),
  );
  assert.deepEqual(thinSlides(never, bachelor, VIS), []);
});

test("thinSlides: indeks deka tartibida, faqat yupqalar", () => {
  const thinSteps = S({ layout: "process", steps: [1, 2, 3].map((n) => ({ n: String(n), title: "B", text: "Qisqa" })) });
  const deck = [healthy[0], S({ layout: "section" }), healthy[1], S({ layout: "quote", quote: "Qisqa." }), thinSteps];
  assert.deepEqual(thinSlides(deck, bachelor, VIS), [
    { index: 1, reasons: ["empty-subtitle"] as ThinReason[] },
    { index: 4, reasons: ["short-steps"] as ThinReason[] },
  ]);
});

test("chegara auditoriya × matn hajmiga ergashadi (BodyRules)", () => {
  // Bitta slayd: 4 ta 9 so'zli band (magistrant × ko'p da minBullets 4).
  const s = S({ layout: "bullets", bullets: [sent(9), sent(9, 2), sent(9, 4), sent(9, 6)] });
  const kop = bodyRules({ slideAudience: "students_master", textVolume: "kop", planItems: 5 }, "defense");
  const kids = bodyRules({ slideAudience: "school_5_7", textVolume: "standart", planItems: 5 }, "lesson");
  assert.deepEqual(reasonsOf(s, kop), ["short-bullets"], "magistrant × ko'p: 9 so'z — yupqa");
  assert.deepEqual(reasonsOf(s, kids), [], "5–7 sinf: 9 so'z — yetarli");
  // Band SONI ham: magistrant × ko'p da minBullets 4.
  assert.equal(kop.minBullets, 4);
  assert.deepEqual(reasonsOf(S({ layout: "bullets", bullets: [sent(20), sent(20, 2), sent(20, 4)] }), kop), ["few-bullets"]);
});

// ───────────────────────────────────────────── 2. maket sig'imi va so'z oraliqlari

test("fitChars: sig'im maketdan — bolalar shrifti torroq, rasm tasmasi va element soni hisobda", () => {
  assert.ok(
    fitChars("quizOption", bodyRules({ slideAudience: "school_1_4", textVolume: "standart", planItems: 5 }, "lesson"), "cards") < fitChars("quizOption", bachelor, "cards"),
    "pol 24 pt < pol 15 pt",
  );
  // Eng tor (vizual berilmagan) har bir vizualdan kichik yoki teng.
  const all = fitChars("colItem", bachelor);
  for (const v of ["classic", "cards", "academic", "dashboard"] as const) assert.ok(all <= fitChars("colItem", bachelor, v), v);
  // A1-01: rasmli 4 bosqichli process ikki qatorga tushadi — 3 bosqichnikidan ancha tor.
  assert.ok(fitChars("stepText", bachelor, "classic", 4) < 135, "rasm tasmasi 4 bosqichni ikki qatorga tushiradi");
  assert.ok(fitChars("stepText", bachelor, "classic", 5) <= fitChars("stepText", bachelor, "classic", 4));
  assert.ok(fitChars("stepText", bachelor, "classic", 4) < fitChars("stepText", bachelor, "classic", 3));
  assert.ok(fitChars("statLabel", bachelor, "classic", 4) < fitChars("statLabel", bachelor, "classic", 2));
  // Qalin qatlam `CHAR_EM_BOLD` bilan (P2): savol qalin — 0.55 bilan ~290 ko'ringan, aslida ~104.
  assert.ok(fitChars("quizQ", bachelor, "classic") < 150, `quizQ ${fitChars("quizQ", bachelor, "classic")}`);
  // Slide Law poli: P2 `bodyFit` polda sig'masa shriftni poldan PAST tushiradi — bu «sig'di» emas.
  const kids = bodyRules({ slideAudience: "school_1_4", textVolume: "standart", planItems: 5 }, "lesson");
  assert.ok(fitChars("stepText", kids, undefined, 5, { images: "none" }) <= 16, `1–4 sinf 5 bosqich ${fitChars("stepText", kids, undefined, 5, { images: "none" })}`);
});

test("layoutWordTargets: oraliqlar sig'imdan oshmaydi va detektor chegarasidan past emas", () => {
  for (const visual of ["classic", "cards", "academic", "rail", "story"] as const) {
    const t = layoutWordTargets(bachelor, visual);
    const cap = (f: Parameters<typeof fitChars>[0], n?: number) => Math.max(CHARS_PER_WORD, fitChars(f, bachelor, visual, n));
    assert.ok(t.colItem.max * CHARS_PER_WORD <= cap("colItem"), `${visual}: colItem`);
    for (const [n, r] of Object.entries(t.stepTextBy)) assert.ok(r.max * CHARS_PER_WORD <= cap("stepText", Number(n)), `${visual}: stepText×${n}`);
    assert.ok(t.colItem.max * CHARS_PER_WORD <= cap("colItem", t.maxColItems), `${visual}: colItem×${t.maxColItems}`);
    assert.ok(t.statLabelMax * CHARS_PER_WORD <= cap("statLabel", t.maxStats), `${visual}: statLabel`);
    assert.ok(t.tableCellMax * CHARS_PER_WORD <= Math.max(CHARS_PER_WORD, fitChars("tableCell", bachelor, visual, t.maxTableCols, { rows: t.maxTableRows })), `${visual}: tableCell`);
    assert.ok(t.sectionSubtitle.max * CHARS_PER_WORD <= cap("subtitleSection"), `${visual}: section`);
    assert.ok(t.closingSubtitle.max * CHARS_PER_WORD <= cap("subtitleClosing"), `${visual}: closing`);
    assert.ok(t.quote.max * CHARS_PER_WORD <= cap("quote"), `${visual}: quote`);
    assert.ok(t.quoteByMax * CHARS_PER_WORD <= cap("quoteBy"), `${visual}: quoteBy`);
    assert.ok(t.quizOptionMax * CHARS_PER_WORD <= cap("quizOption"), `${visual}: quiz`);
    assert.ok(t.sectionSubtitle.min >= SECTION_SUBTITLE_MIN_WORDS, `${visual}: section min`);
    assert.ok(t.quote.min >= QUOTE_MIN_WORDS, `${visual}: quote min`);
    for (const r of [t.bullet, t.colItem, t.stepText, t.sectionSubtitle, t.closingSubtitle, t.quote]) assert.ok(r.min <= r.max);
  }
});

test("element soni auditoriyaga ergashadi: yosh auditoriyaga kam bosqich/karta/ustun (P2 A2-04 pol)", () => {
  const kids = bodyRules({ slideAudience: "school_1_4", textVolume: "standart", planItems: 5 }, "lesson");
  const a = layoutWordTargets(bachelor, "classic");
  const k = layoutWordTargets(kids, "classic");
  assert.ok(k.maxSteps <= a.maxSteps && k.maxStats <= a.maxStats && k.maxTableCols <= a.maxTableCols);
  assert.ok(a.maxSteps >= PROCESS_MIN_STEPS && a.maxSteps <= SLIDE_LIMITS.stepsMax);
  // (1) Auditoriya ruxsati — yuqori chegara: sig'im yetsa ham `stepsMax` dan oshmaydi.
  assert.equal(layoutWordTargets({ ...bachelor, stepsMax: 3 }, "classic").maxSteps, 3);
  // (2) Sig'im — ruxsat 5 bo'lsa ham, matn STEP_MIN_WORDS ga yetmaydigan son taklif qilinmaydi.
  const wide = layoutWordTargets({ ...kids, stepsMax: 5 }, "classic");
  assert.ok(wide.maxSteps < 5, `1–4 sinfga ${wide.maxSteps} bosqich`);
  for (let n = wide.maxSteps + 1; n <= 5; n += 1) {
    assert.ok(Math.floor(Math.min(fitChars("stepText", kids, "classic", n), limitsFor(kids, { steps: n }).stepText) / CHARS_PER_WORD) < STEP_MIN_WORDS);
  }
  // Band yuqori chegarasi qirqishdan oshmaydi (ilgari bulletChars/8 → 21 so'z ≈ 190 belgi > 165).
  for (const r of [bachelor, kids]) assert.ok(bulletMaxWords(r) * CHARS_PER_WORD <= r.bulletChars);
});

test("jadval: prompt va qirqish BIR kalitda (ustun × qator) — promptga rioya qilgan katak kesilmaydi (sharh 5-band)", () => {
  for (const aud of ["students_bachelor", "general", "school_10_11", "school_5_7", "school_1_4"] as const) {
    const r = bodyRules({ slideAudience: aud, textVolume: "standart", planItems: 5 }, "lecture");
    for (const visual of ["classic", "academic"] as const) {
      const t = layoutWordTargets(r, visual);
      const lim = limitsFor(r, { cols: t.maxTableCols, rows: t.maxTableRows }).tableCell;
      assert.ok(t.tableCellMax * CHARS_PER_WORD <= Math.max(CHARS_PER_WORD, lim), `${aud}/${visual}: katak ${t.tableCellMax} so'z > ${lim}`);
      assert.ok(clipLimit("tableCell", r, visual, t.maxTableCols, t.maxTableRows) <= lim);
    }
  }
  // Talaba: 4 × 5 jadval (auditoriya ruxsati) — 5×6 ning 20 belgisi emas.
  assert.ok(limitsFor(bachelor).tableCell >= 40, `talaba katak ${limitsFor(bachelor).tableCell}`);
});

test("prompt oraliqlari: «N–N» yo'q, bosqich matni har son uchun, «yozilsa» (sharh 8-band)", () => {
  for (const aud of ["school_1_4", "school_5_7", "students_bachelor", "students_master"] as const) {
    for (const visual of ["classic", "circle", "academic", "rail"] as const) {
      const r = bodyRules({ slideAudience: aud, textVolume: "qisqa", planItems: 5 }, "lecture");
      const text = wordTargetLines(r, visual).join("\n");
      for (const m of text.matchAll(/(\d+)–(\d+)/g)) assert.notEqual(m[1], m[2], `${aud}/${visual}: «${m[0]}»`);
      assert.match(text, /3 bosqichda /);
      assert.match(text, /kam yozilsa .* ko‘p yozilsa kesiladi/);
    }
  }
  assert.equal(fmtRange({ min: 4, max: 4 }), "4");
  assert.equal(fmtRange({ min: 4, max: 6 }), "4–6");
});

test("clipLimit: statik qopqoqdan oshmaydi, pol shriftidagi sig'imgacha tushadi, CLIP_FLOOR_CHARS dan past emas", () => {
  const kids = bodyRules({ slideAudience: "school_1_4", textVolume: "standart", planItems: 5 }, "lesson");
  for (const [field, cap] of [
    ["quizOption", SLIDE_LIMITS.quizOption],
    ["stepText", SLIDE_LIMITS.stepText],
    ["statLabel", SLIDE_LIMITS.statLabel],
    ["tableCell", SLIDE_LIMITS.tableCell],
    ["colItem", SLIDE_LIMITS.colItem],
  ] as const) {
    for (const rules of [bachelor, kids]) {
      const lim = clipLimit(field, rules, "classic");
      assert.ok(lim <= cap, `${field}: ${lim} > ${cap}`);
      // Pol faqat O'LCHOVNI qisadi; pol × son jadvali (`limitsFor`, P2 o'lchovi) undan ham past bo'lishi mumkin.
      const table = field === "colItem" ? cap : limitsFor(rules)[field];
      assert.ok(lim >= Math.min(CLIP_FLOOR_CHARS, table), `${field}: ${lim} < pol`);
      assert.ok(lim <= Math.max(CLIP_FLOOR_CHARS, fitChars(field, rules, "classic")), `${field}: qutidan katta`);
    }
  }
  // Variant — pol bo'yicha jadvaldan (`limitsFor.quizOption`, sharh 7-band); 1–4 sinfga — ancha tor.
  assert.equal(clipLimit("quizOption", bachelor, "classic"), limitsFor(bachelor).quizOption);
  assert.ok(clipLimit("quizOption", kids, "cards") < clipLimit("quizOption", bachelor, "cards"));
  // Rasmli 5 bosqich: 160 emas (A1-01) — qirqish quti sig'imigacha.
  assert.ok(clipLimit("stepText", bachelor, "classic", 5) < SLIDE_LIMITS.stepText);
});

// ───────────────────────────────────────────── 3. repairThinSlides (stub fetch)

type Reply = (url: string, body: { system: string; user: string }) => unknown;

async function withLlm(reply: Reply, fn: (calls: { system: string; user: string }[]) => Promise<void>) {
  const saved = { fetch: globalThis.fetch, gemini: process.env.GEMINI_API_KEY, xai: process.env.XAI_API_KEY };
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.XAI_API_KEY;
  const calls: { system: string; user: string }[] = [];
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    const b = JSON.parse(String(init?.body ?? "{}")) as {
      system_instruction?: { parts?: { text?: string }[] };
      contents?: { parts?: { text?: string }[] }[];
    };
    const call = { system: b.system_instruction?.parts?.[0]?.text ?? "", user: b.contents?.[0]?.parts?.[0]?.text ?? "" };
    calls.push(call);
    return reply(String(url), call) as never;
  }) as unknown as typeof fetch;
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.gemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved.gemini;
    if (saved.xai !== undefined) process.env.XAI_API_KEY = saved.xai;
  }
}

afterEach(() => resetBreakers());

const jsonReply = (obj: unknown) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }),
});

const meta = extractMeta(TOOL_BY_ID["pro-slide"], { topic: "Orol dengizi fojiasi", slideAudience: "students_bachelor" } as never);
const tpl = resolveSlideTemplate("lecture", meta.topic);
const rules = bodyRules(meta, tpl.id);
const later = () => Date.now() + 120_000;

/** Deka: 0 sog'lom, 1 yupqa bandlar, 2 bo'sh bo'lim, 3 sog'lom process, 4 yupqa process. */
function deck(): SlideModel[] {
  const img = { url: "/api/generations/x/assets/abc", alt: "Orol" };
  return [
    { ...healthy[0], id: "s0" },
    { id: "s1", layout: "bullets", title: "Qurish sabablari", bullets: ["Sug‘orish.", "Iqlim."], image: img, imageHint: "dry sea", notes: "Izoh", plan: 1 } as SlideModel,
    { id: "s2", layout: "section", title: "Oqibatlar", subtitle: "Orol dengizi", plan: 2 } as SlideModel,
    { ...healthy[1], id: "s3" },
    { id: "s4", layout: "process", title: "Tiklash", plan: 3, steps: [1, 2, 3].map((n) => ({ n: String(n), title: `Qadam ${n}`, text: "Qisqa" })) } as SlideModel,
  ];
}

const good = {
  slides: [
    { index: 1, bullets: [sent(14), sent(14, 2), sent(14, 5)] },
    { index: 2, subtitle: sent(22) },
    { index: 4, steps: [1, 2, 3].map((n) => ({ n: String(n), title: `Qadam ${n}`, text: sent(9, n) })) },
  ],
};

test("repair: BITTA chaqiruv, yupqalar to'ldiriladi, sog'lomlarga tegilmaydi, kirish o'zgarmaydi", async () => {
  const input = deck();
  const snapshot = JSON.stringify(input);
  await withLlm(
    () => jsonReply(good),
    async (calls) => {
      const out = await repairThinSlides(input, meta, tpl, {}, later(), later());
      assert.equal(calls.length, 1, "aynan bitta LLM chaqiruvi");
      assert.notEqual(out, input, "YANGI massiv");
      assert.equal(JSON.stringify(input), snapshot, "kirish o'zgarmadi");
      assert.equal(out[0], input[0], "sog'lom slayd — o'sha obyekt");
      assert.equal(out[3], input[3], "sog'lom process — o'sha obyekt");
      assert.deepEqual(thinSlides(out, rules, tpl.visual), [], "ta'mirdan keyin yupqa slayd qolmadi");
      assert.deepEqual(out[1].bullets, good.slides[0].bullets);
      assert.equal(out[2].subtitle, good.slides[1].subtitle);
      assert.equal(out[4].steps?.[0].text, good.slides[2].steps![0].text);
      // Promptda FAQAT yupqa slaydlar so'raladi.
      assert.match(calls[0].user, /index=1 layout=bullets/);
      assert.match(calls[0].user, /index=2 layout=section/);
      assert.match(calls[0].user, /index=4 layout=process/);
      assert.doesNotMatch(calls[0].user, /index=0 |index=3 /);
      assert.match(calls[0].system, /MAKET HAJMI/);
      // «Boshqa slaydlarni takrorlamang» — deka tarkibi ko'rsatiladi (sharh 13-band).
      assert.match(calls[0].user, /Dekadagi slaydlar: .*3\) Sarlavha/);
    },
  );
});

test("repair: id/layout/title/plan/rasm/izoh maydonlari asl slayddan qoladi", async () => {
  const input = deck();
  const hostile = {
    slides: [{ index: 1, id: "x", layout: "quote", title: "Boshqa", plan: 9, image: null, bullets: good.slides[0].bullets }],
  };
  await withLlm(
    () => jsonReply(hostile),
    async () => {
      const out = await repairThinSlides(input, meta, tpl, {}, later(), later());
      const s = out[1] as SlideModel & { plan?: number };
      assert.deepEqual(s.bullets, good.slides[0].bullets, "bandlar almashdi");
      assert.equal(s.id, "s1");
      assert.equal(s.layout, "bullets");
      assert.equal(s.title, "Qurish sabablari");
      assert.equal(s.plan, 1);
      assert.deepEqual(s.image, input[1].image);
      assert.equal(s.imageHint, "dry sea");
      assert.equal(s.notes, "Izoh");
    },
  );
});

test("repair: hali ham yupqa javob RAD etiladi, so'ralmagan indeks e'tiborsiz", async () => {
  const input = deck();
  const weak = {
    slides: [
      { index: 1, bullets: ["Hali ham qisqa.", "Yana qisqa.", "Qisqa."] },
      { index: 2, subtitle: sent(22) },
      { index: 0, bullets: ["Buzuvchi."] },
    ],
  };
  await withLlm(
    () => jsonReply(weak),
    async () => {
      const out = await repairThinSlides(input, meta, tpl, {}, later(), later());
      assert.equal(out[1], input[1], "yupqa javob qabul qilinmadi — asl slayd");
      assert.equal(out[2].subtitle, weak.slides[1].subtitle, "yaxshi javob qabul qilindi");
      assert.equal(out[0], input[0], "so'ralmagan slayd tegilmadi");
    },
  );
});

test("repair: LLM xatosi (400) — kirish nusxasi, otmaydi", async () => {
  const input = deck();
  await withLlm(
    () => ({ ok: false, status: 400, headers: new Headers(), json: async () => ({ error: { message: "bad" } }) }),
    async (calls) => {
      const out = await repairThinSlides(input, meta, tpl, {}, later(), later());
      assert.equal(calls.length, 1);
      assert.notEqual(out, input);
      assert.deepEqual(out, input);
    },
  );
});

test("repair: timeout (abort) — kirish nusxasi; buzuq JSON — kirish nusxasi", async () => {
  const input = deck();
  await withLlm(
    () => Promise.reject(new DOMException("This operation was aborted", "AbortError")),
    async (calls) => {
      const out = await repairThinSlides(input, meta, tpl, {}, later(), later());
      assert.equal(calls.length, 1);
      assert.deepEqual(out, input);
    },
  );
  await withLlm(
    () => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ candidates: [{ content: { parts: [{ text: "{slides: [oops" }] } }] }) }),
    async () => assert.deepEqual(await repairThinSlides(input, meta, tpl, {}, later(), later()), input),
  );
});

test("repair: ish muddati tugasa (DeadlineError) ham OTMAYDI", async () => {
  const input = deck();
  const realNow = Date.now;
  try {
    await withLlm(
      () => {
        // Chaqiruv paytida soat 60 s oldinga — urinish ish muddatini kesdi.
        const t = realNow();
        Date.now = () => t + 60_000;
        return Promise.reject(new DOMException("This operation was aborted", "AbortError"));
      },
      async () => {
        const out = await repairThinSlides(input, meta, tpl, {}, realNow() + 120_000, realNow() + REPAIR_MIN_MS + 5_000);
        assert.deepEqual(out, input);
      },
    );
  } finally {
    Date.now = realNow;
  }
});

test("repair: vaqt yetmasa (bosqich yoki ish muddati) — chaqiruv YO'Q", async () => {
  const input = deck();
  await withLlm(
    () => jsonReply(good),
    async (calls) => {
      assert.deepEqual(await repairThinSlides(input, meta, tpl, {}, Date.now() + REPAIR_MIN_MS - 1_000, later()), input);
      assert.deepEqual(await repairThinSlides(input, meta, tpl, {}, later(), Date.now() + REPAIR_MIN_MS - 1_000), input);
      assert.equal(calls.length, 0);
    },
  );
});

test("repair: LLM kalitsiz yoki yupqa slayd yo'q — chaqiruv YO'Q", async () => {
  const saved = { g: process.env.GEMINI_API_KEY, x: process.env.XAI_API_KEY };
  delete process.env.GEMINI_API_KEY;
  delete process.env.XAI_API_KEY;
  try {
    const input = deck();
    const out = await repairThinSlides(input, meta, tpl, {}, later(), later());
    assert.notEqual(out, input);
    assert.deepEqual(out, input);
  } finally {
    if (saved.g !== undefined) process.env.GEMINI_API_KEY = saved.g;
    if (saved.x !== undefined) process.env.XAI_API_KEY = saved.x;
  }
  await withLlm(
    () => jsonReply(good),
    async (calls) => {
      await repairThinSlides([healthy[0], healthy[1]], meta, tpl, {}, later(), later());
      assert.equal(calls.length, 0);
    },
  );
});

test("repair: test varianti — faqat belgilangan variant o'zgaradi, asli bilan bir boshli; javob o'rni saqlanadi", async () => {
  const cap = clipLimit("quizOption", rules, tpl.visual);
  const full = `Suv sarfi me’yorlarini buzgan korxonalarga ${sent(30)}`;
  const cutB = clipTo(full, cap);
  const quiz = S({ id: "q", layout: "quiz", quiz: [{ q: "Qaysi chora to‘g‘ri?", options: ["Jarima solish", cutB, "Soliqni oshirish", "Hech narsa qilmaslik"], answer: 1 }] });
  assert.deepEqual(reasonsOf(quiz, rules, tpl.visual), ["clipped-option"]);
  const fixedB = "Suv sarfi me’yorlarini buzgan korxonalarga jarima va cheklov qo‘llash";
  const fixed = ["Jarima solish (MODEL O'ZGARTIRDI)", fixedB, "Soliqni oshirish", "Hech narsa qilmaslik"];
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, quiz: [{ q: "Qaysi chora to‘g‘ri?", options: fixed, answer: 1 }] }] }),
    async () => {
      const out = await repairThinSlides([quiz], meta, tpl, {}, later(), later());
      const opts = out[0].quiz?.[0].options ?? [];
      assert.equal(opts[1], fixedB, "belgilangan variant to'ldirildi");
      assert.equal(opts[0], "Jarima solish", "belgilanmagan variant BAYTMA-BAYT asl");
      assert.equal(opts[2], "Soliqni oshirish");
      assert.equal(out[0].quiz?.[0].answer, 1);
    },
  );
  // Javobni «ko'chirish»: to'g'ri matn B dan boshqa joyga, B ga chalg'ituvchi — B asli bilan bir boshli emas → RAD.
  await withLlm(
    () =>
      jsonReply({
        slides: [{ index: 0, quiz: [{ q: "Qaysi chora to‘g‘ri?", options: [fixedB, "Yer silkinishi natijasida suv kamaydi", "Soliqni oshirish", "Hech narsa qilmaslik"], answer: 1 }] }],
      }),
    async () => assert.equal((await repairThinSlides([quiz], meta, tpl, {}, later(), later()))[0], quiz, "almashtirish — rad"),
  );
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, quiz: [{ q: "Qaysi chora to‘g‘ri?", options: fixed, answer: 2 }] }] }),
    async () => assert.equal((await repairThinSlides([quiz], meta, tpl, {}, later(), later()))[0], quiz, "javob siljidi — rad"),
  );
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, quiz: [{ q: "Qaysi chora to‘g‘ri?", options: fixed.slice(0, 3), answer: 1 }] }] }),
    async () => assert.equal((await repairThinSlides([quiz], meta, tpl, {}, later(), later()))[0], quiz, "3 variant — rad"),
  );
});

test("repair: process — son auditoriya ruxsatigacha qisiladi, matn shu sondagi quti bilan (sharh 1-band)", async () => {
  const kidsMeta = extractMeta(TOOL_BY_ID["pro-slide"], { topic: "Suv", slideAudience: "school_1_4" } as never);
  const kidsTpl = resolveSlideTemplate("lesson", kidsMeta.topic);
  const kr = bodyRules(kidsMeta, kidsTpl.id);
  assert.equal(kr.stepsMax, 3);
  const thin = S({ id: "p", layout: "process", title: "Tajriba", steps: [1, 2, 3].map((n) => ({ n: String(n), title: "B", text: "Qisqa" })) });
  // Model 5 bosqich qaytaradi — har biri 3 bosqichli quti sig'imidagi to'liq gap.
  const w = Math.max(3, Math.min(STEP_MIN_WORDS, Math.floor(clipLimit("stepText", kr, kidsTpl.visual, 3) / CHARS_PER_WORD)));
  const five = Array.from({ length: 5 }, (_, i) => ({ n: String(i + 1), title: "Qadam", text: sent(w, i) }));
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, steps: five }] }),
    async () => {
      const out = await repairThinSlides([thin], kidsMeta, kidsTpl, {}, later(), later());
      const steps = out[0].steps ?? [];
      assert.notEqual(out[0], thin, "ta'mir qabul qilinishi kerak edi (3 ta to'liq bosqich)");
      assert.deepEqual(steps.map((st) => st.text), five.slice(0, steps.length).map((st) => st.text), "matn qirqilmagan");
      assert.ok(steps.length <= kr.stepsMax, `${steps.length} bosqich > ${kr.stepsMax}`);
      assert.ok(steps.length >= PROCESS_MIN_STEPS);
      for (const st of steps) assert.ok(!st.text.endsWith("…"), `kesilgan: «${st.text}»`);
    },
  );
  // 3 dan kam bosqich — rad.
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, steps: five.slice(0, 2) }] }),
    async () => assert.equal((await repairThinSlides([thin], kidsMeta, kidsTpl, {}, later(), later()))[0], thin),
  );
});

// ───────────────────────────────────────────── 4. qirqish qopqoqlari o'lchovga mos

test("SLIDE_LIMITS: qopqoqlar pol shriftidagi sig'imdan oshmaydi (o'lchov qulfi)", () => {
  // Eng past pol (15 pt) — eng katta sig'im. Qopqoq undan oshsa, hech bir auditoriyada sig'maydi.
  /*
   * `title` qulfda YO'Q: bo'lim sarlavhasi qalin o'lchovda (P2 dan keyin)
   * circle/editorial/story/academic/magazine da 16–24 belgidan toshadi —
   * bu sarlavha QUTISI muammosi (P2 ga so'rov), belgi chegarasi bilan
   * yechilmaydi (sarlavha 6–10 so'z bo'lishi kerak). `quote` — mediana.
   */
  const tight: [keyof typeof SLIDE_LIMITS, Parameters<typeof fitChars>[0]][] = [
    ["quizOption", "quizOption"],
    ["subtitleSection", "subtitleSection"],
    ["subtitleClosing", "subtitleClosing"],
    ["quoteBy", "quoteBy"],
    ["quizQ", "quizQ"],
  ];
  for (const [limit, field] of tight) {
    const cap = fitChars(field, bachelor);
    assert.ok(SLIDE_LIMITS[limit] <= cap + 1, `${limit}=${SLIDE_LIMITS[limit]} > eng tor quti ${cap}`);
  }
  // TIPIK vizual (17 vizual medianasi, rasm tasmasi bilan) qutisiga mos: ustun sarlavhasi va bandi.
  const median = (field: Parameters<typeof fitChars>[0], n?: number) => {
    const all = (["classic", "hero-split", "cards", "lab", "timeline", "magazine", "dense", "academic", "circle", "notebook", "formal", "story", "split", "bold", "dashboard", "rail", "editorial"] as const)
      .map((v) => fitChars(field, bachelor, v, n))
      .sort((a, b) => a - b);
    return all[Math.floor(all.length / 2)];
  };
  assert.ok(SLIDE_LIMITS.colTitle <= median("colTitle") + 1, `colTitle > mediana ${median("colTitle")}`);
  // Statik ustun bandi — 3 bandli ustun medianasi (rasm bilan); 4 band (P2 dan keyin pol shriftida ~60) — `clipLimit`/prompt.
  assert.ok(SLIDE_LIMITS.colItem <= median("colItem", 3) + 1, `colItem > mediana ${median("colItem", 3)}`);
  assert.ok(SLIDE_LIMITS.quote <= median("quote") + 1, `quote > mediana ${median("quote")}`);
});

test("limitsFor jadvali jonli o'lchovga mos: har katak ≤ max(5, ⌊0.88 × rasmsiz eng tor sig'im⌋₅)", async () => {

  // Jadval shu qoida bilan qurilgan (`COUNT_LIMITS` izohi): min(P2, jonli) × 0.88, 5 ga pastga, kamida 5.
  const derive = (x: number) => Math.max(5, Math.floor((x * 0.88) / 5) * 5);
  for (const aud of ["school_1_4", "school_5_7", "school_8_9", "school_10_11", "general", "students_bachelor"] as const) {
    const r = bodyRules({ slideAudience: aud, textVolume: "standart", planItems: 5 }, "lecture");
    const cap = (f: Parameters<typeof fitChars>[0], k: number, rows?: number) => derive(fitChars(f, r, undefined, k, { rows, images: "none" }));
    for (const n of [3, 4, 5]) {
      const l = limitsFor(r, { steps: n });
      assert.ok(l.stepText <= cap("stepText", n), `${aud} stepText×${n}: ${l.stepText} > ${cap("stepText", n)}`);
      assert.ok(l.stepTitle <= cap("stepTitle", n), `${aud} stepTitle×${n}`);
    }
    for (const n of [2, 3, 4]) assert.ok(limitsFor(r, { stats: n }).statLabel <= cap("statLabel", n), `${aud} statLabel×${n}`);
    for (const [c, w] of [[3, 3], [3, 4], [4, 4], [4, 5], [5, 6]] as const) {
      const l = limitsFor(r, { cols: c, rows: w });
      assert.ok(l.tableCell <= cap("tableCell", c, w), `${aud} tableCell ${c}×${w}: ${l.tableCell} > ${cap("tableCell", c, w)}`);
      assert.ok(l.tableHeader <= cap("tableHeader", c, w), `${aud} tableHeader ${c}×${w}`);
    }
    assert.ok(limitsFor(r).quizOption <= cap("quizOption", 1), `${aud} quizOption`);
  }
});

test("clipLimit soni o'zgaruvchi maydonda limitsFor dan oshmaydi (generatsiya ⊆ tahrir)", async () => {

  const kids = bodyRules({ slideAudience: "school_1_4", textVolume: "standart", planItems: 5 }, "lesson");
  for (const rules of [bachelor, kids]) {
    for (const n of [3, 4, 5]) {
      assert.ok(clipLimit("stepText", rules, "classic", n) <= limitsFor(rules, { steps: n }).stepText);
      assert.ok(clipLimit("stepTitle", rules, "classic", n) <= limitsFor(rules, { steps: n }).stepTitle);
    }
    for (const n of [2, 3, 4]) assert.ok(clipLimit("statLabel", rules, "classic", n) <= limitsFor(rules, { stats: n }).statLabel);
  }
});
