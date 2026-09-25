import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { extractMeta } from "../lib/generation/meta.ts";
import { resetBreakers } from "../lib/generation/llm/breaker.ts";
import { SLIDE_AUDIENCES, bodyRules } from "../lib/generation/slide-audience.ts";
import { DESIGN_VISUALS, LEGACY_VISUALS } from "../lib/generation/visuals/spec.ts";
import { SLIDE_LIMITS, clipTo, limitsFor } from "../lib/generation/slide-limits.ts";
import {
  CHARS_PER_WORD,
  PROMPT_HEADROOM,
  NO_IMAGE,
  imageYieldField,
  bulletClipLimit,
  COL_MIN_ITEMS,
  COL_MIN_WORDS,
  PROCESS_MIN_STEPS,
  QUOTE_MIN_WORDS,
  REPAIR_MIN_MS,
  SECTION_SUBTITLE_MIN_WORDS,
  STEP_MIN_WORDS,
  THIN_BULLET_K,
  CLIP_FLOOR_CHARS,
  PROSE_MIN_WORDS,
  fieldCap,
  bulletMaxWords,
  bulletMinWords,
  clipLimit,
  fmtRange,
  tableCellMinWords,
  wordTargetLines,
  fitChars,
  layoutWordTargets,
  repairThinSlides,
  thinSlides,
  type ThinReason,
} from "../lib/generation/slide-quality.ts";
import { resolveSlideTemplate } from "../lib/generation/slide-templates.ts";
import { CHAR_EM, LAYOUT_KIT, planSlide } from "../lib/generation/slide-layout.ts";
import { getSlideTheme } from "../lib/generation/slide-themes.ts";
import { extractNewSlides } from "../lib/generation/slide-write.ts";
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
  // Ortiqcha son o'z chegarasini pasaytirmaydi: 1–4 sinfga 5 × 2 so'z — `stepsMax` (3) dagi chegara bilan yupqa
  // (P8: 15 % zaxira bilan 3 bosqichli bolalar kartasiga prompt 3 so'z so'raydi — chegara ham 3; 5 bosqichda ~1 bo'lardi).
  const kids = bodyRules({ slideAudience: "school_1_4", textVolume: "standart", planItems: 5 }, "lesson");
  const five = S({ layout: "process", steps: Array.from({ length: 5 }, (_, i) => ({ n: String(i + 1), title: "B", text: sent(2, i) })) });
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

/*
 * P8 (a) — «matn rasmdan ustun»: prompt maksimumi qirqish chegarasidan kamida 15 % past.
 *
 * Jonli 7 dekaning 4 tasida model limitdan bir necha belgiga oshdi va band «…» bilan
 * kesildi (8–9 sinf `circle` ustun bandi 54–58 / 60, bosqich 32–39 / 42): prompt
 * maksimumi = limit edi. Endi har maydon uchun max × CHARS_PER_WORD ≤ 0.85 × YOZUVCHI
 * QO'LLAYDIGAN chegara (P11: `clipLimit(…, NO_IMAGE)` — deka vizualining rasmsiz qutisi;
 * bandlarda `bulletClipLimit`). Qisqa YORLIQ maydonlari (ustun sarlavhasi, stats yorlig'i,
 * jadval, iqtibos muallifi, test) rasmni saqlaydi — ular RASMLI qutiga ham ≤ 0.85 ×.
 * Istisno — poldagi son (1 so'z; test varianti 2): quti bir so'zga ham zo'rg'a yetadigan
 * joyda «0 so'z» so'ralmaydi.
 */
test("P8 (a): prompt oraliqlari har auditoriya × vizual × hajmda ≥ 15 % zaxirali (≤ 0.85 × yozuvchi chegarasi)", () => {
  assert.equal(PROMPT_HEADROOM, 0.85);
  const bad: string[] = [];
  for (const aud of SLIDE_AUDIENCES) {
    for (const vol of ["qisqa", "standart", "kop"] as const) {
      const r = bodyRules({ slideAudience: aud, textVolume: vol, planItems: 5 }, "lecture");
      for (const visual of [...LEGACY_VISUALS, ...DESIGN_VISUALS]) {
        const t = layoutWordTargets(r, visual);
        const room = (words: number, chars: number, floor = 1) => {
          if (words > floor && words * CHARS_PER_WORD > PROMPT_HEADROOM * chars) bad.push(`${aud}/${vol}/${visual}: ${words} so'z > 0.85 × ${chars}`);
        };
        // Yozuvchi chegarasi — rasmsiz quti (`normalizeSlide`).
        const w = (f: Parameters<typeof clipLimit>[0], n?: number, rows?: number) => clipLimit(f, r, visual, n, rows, NO_IMAGE);
        room(t.bullet.max, bulletClipLimit(r, visual, r.maxBullets));
        room(t.colItem.max, w("colItem", t.maxColItems));
        for (const [n, x] of Object.entries(t.stepTextBy)) room(x.max, w("stepText", Number(n)));
        room(t.sectionSubtitle.max, w("subtitleSection"));
        room(t.closingSubtitle.max, w("subtitleClosing"));
        room(t.quote.max, w("quote"));
        // Yorliq maydonlari — rasm qoladi: rasmli qutiga ham (u rasmsizdan tor yoki teng).
        room(t.colTitleMax, clipLimit("colTitle", r, visual));
        room(t.statLabelMax, clipLimit("statLabel", r, visual, t.maxStats));
        room(t.tableCellMax, clipLimit("tableCell", r, visual, t.maxTableCols, t.maxTableRows));
        room(t.quoteByMax, clipLimit("quoteBy", r, visual));
        room(t.quizQMax, clipLimit("quizQ", r, visual));
        room(t.quizOptionMax, clipLimit("quizOption", r, visual), 2);
        // Quyi chegara yuqoridan oshmaydi (zaxira bilan ham).
        for (const w of [t.bullet, t.colItem, t.stepText, t.sectionSubtitle, t.closingSubtitle, t.quote]) if (w.min > w.max) bad.push(`${aud}/${vol}/${visual}: min ${w.min} > max ${w.max}`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} ta zaxirasiz maqsad`);
  // Jonli dalil sonlari: 8–9 sinf `circle` 2 bandli ustun — rasmli 60 belgi → 5 so'z (ilgari 6 ≈ 54 → 58 «…»).
  const g89 = bodyRules({ slideAudience: "school_8_9", textVolume: "standart", planItems: 5 }, "lesson");
  const t89 = layoutWordTargets(g89, "circle");
  assert.equal(clipLimit("colItem", g89, "circle", 2), 60, "sinov asosi: rasmli ustun bandi 60");
  assert.equal(t89.maxColItems, 2);
  assert.equal(t89.colItem.max, 5);
  // Bosqich (3 ta): rasmli 42 belgi → 3 so'z < 5 — P11: maqsad RASMSIZ qutidan (121 → 11 so'z), rasm joy beradi.
  // (P8 da «3 so'z» so'ralardi; model 5–6 so'z yozib, jadval 45 da HAMMA bosqich «…» bilan kesilardi.)
  assert.equal(clipLimit("stepText", g89, "circle", 3), 42, "sinov asosi: rasmli bosqich qutisi 42");
  assert.equal(clipLimit("stepText", g89, "circle", 3, undefined, NO_IMAGE), 121, "sinov asosi: rasmsiz 121");
  assert.equal(t89.stepTextBy[3].max, Math.floor((0.85 * 121) / CHARS_PER_WORD));
  assert.equal(t89.stepTextBy[3].max, 11);
  // Bakalavr «qisqa» bandi 119 belgi → 11 so'z (ilgari 13 = 117 → 111–114 «…»).
  const bq = bodyRules({ slideAudience: "students_bachelor", textVolume: "qisqa", planItems: 5 }, "lecture");
  assert.equal(bq.bulletChars, 119);
  assert.equal(bulletMaxWords(bq), 11);
  assert.match(wordTargetLines(g89, "circle").join("\n"), /har band \d+(–5)? so‘z/);
});

/*
 * P11 (c) — prompt maqsadi GAP maydonlarida (bosqich matni, ustun bandi, band) kamida
 * `PROSE_MIN_WORDS` (5) so'z, YOKI — rasmsiz quti ham undan kam ko'tarsa — aynan rasmsiz
 * sig'im × zaxira. Rasmli qutidan 3 so'z so'rash yolg'on maqsad edi: model 5–6 so'z yozdi.
 * MUTATSIYA: `fitWords` dagi 5 so'z qoidasi olib tashlansa (doim rasmli quti) — qizaradi
 * (8–9 sinf `circle` 3 bosqich: 3 so'z, rasmsiz 11).
 */
test("P11 (c): bosqich/ustun bandi/band maqsadi ≥ 5 so'z yoki rasmsiz sig'imga teng — har auditoriya × vizual", () => {
  assert.equal(PROSE_MIN_WORDS, 5);
  const bad: string[] = [];
  const words = (chars: number, cap: number) => Math.max(1, Math.floor((PROMPT_HEADROOM * Math.min(chars, cap)) / CHARS_PER_WORD));
  for (const aud of SLIDE_AUDIENCES) {
    for (const vol of ["qisqa", "standart", "kop"] as const) {
      const r = bodyRules({ slideAudience: aud, textVolume: vol, planItems: 5 }, "lecture");
      for (const visual of [...LEGACY_VISUALS, ...DESIGN_VISUALS]) {
        const t = layoutWordTargets(r, visual);
        const noImg = (f: Parameters<typeof fitChars>[0], n?: number) => words(fitChars(f, r, visual, n, NO_IMAGE), fieldCap(f, r, visual, n));
        const check = (name: string, got: number, capWords: number, want = Number.POSITIVE_INFINITY) => {
          // Auditoriya istagi (`want`, masalan `bulletMaxWords`) 5 dan kam bo'lsa — o'sha; aks holda ≥ 5 yoki rasmsiz sig'im.
          if (got < PROSE_MIN_WORDS && got !== capWords && got !== want) bad.push(`${aud}/${vol}/${visual} ${name}: ${got} so'z (rasmsiz ${capWords})`);
        };
        for (const [n, x] of Object.entries(t.stepTextBy)) check(`stepText×${n}`, x.max, noImg("stepText", Number(n)));
        check(`colItem×${t.maxColItems}`, t.colItem.max, noImg("colItem", t.maxColItems));
        check("bullet", t.bullet.max, noImg("bullets"), bulletMaxWords(r));
      }
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} ta 5 so'zdan kam maqsad`);
  // Jonli holat: 8–9 sinf circle 3 bosqich — rasmsiz 121 → 11 so'z (rasm joy beradi); rail — 85 → 8.
  const g89 = bodyRules({ slideAudience: "school_8_9", textVolume: "standart", planItems: 5 }, "lesson");
  assert.equal(layoutWordTargets(g89, "circle").stepTextBy[3].max, 11);
  assert.equal(layoutWordTargets(g89, "rail").stepTextBy[3].max, 8);
  // Rasmli quti 5 so'zga yetsa — maqsad o'sha (rasm saqlanadi): 8–9 sinf circle 2 bandli ustun 60 → 5.
  assert.equal(layoutWordTargets(g89, "circle").colItem.max, 5);
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
      // P11: chegara deka vizualidan (`limitsFor` + visual) — yozuvchi (`clipLimit`, rasmsiz) bilan AYNAN bir kalit.
      const lim = limitsFor(r, { cols: t.maxTableCols, rows: t.maxTableRows }, { visual, images: "none" }).tableCell;
      assert.ok(t.tableCellMax * CHARS_PER_WORD <= Math.max(CHARS_PER_WORD, lim), `${aud}/${visual}: katak ${t.tableCellMax} so'z > ${lim}`);
      assert.equal(clipLimit("tableCell", r, visual, t.maxTableCols, t.maxTableRows, NO_IMAGE), lim);
    }
  }
  // Talaba: 4 × 5 jadval (auditoriya ruxsati) — 5×6 ning 20 belgisi emas.
  assert.ok(limitsFor(bachelor).tableCell >= 40, `talaba katak ${limitsFor(bachelor).tableCell}`);
});

test("N2: kattalar (≤ 16 pt) jadvalida katak kamida 3 so'z — ustun soni shunga qarab; yoshlarga 2", () => {
  const kids = bodyRules({ slideAudience: "school_1_4", textVolume: "standart", planItems: 5 }, "lesson");
  const general = bodyRules({ slideAudience: "general", textVolume: "standart", planItems: 5 }, "lecture");
  assert.equal(tableCellMinWords(bachelor), 3);
  assert.equal(tableCellMinWords(general), 3);
  assert.equal(tableCellMinWords(kids), 2);
  for (const r of [bachelor, general]) {
    for (const visual of ["classic", "academic", "dashboard"] as const) {
      const t = layoutWordTargets(r, visual);
      // Tanlangan ustun sonida katak ≥ 3 so'z (yoki eng kam — 2 ustun); prompt «katak 3–N so'z».
      assert.ok(t.maxTableCols === 2 || t.tableCellMax >= 3, `${visual}: ${t.maxTableCols} ustun, katak ${t.tableCellMax} so'z`);
      const line = wordTargetLines(r, visual).find((l) => l.startsWith("— table:"))!;
      assert.match(line, /katak \d+(–\d+)? so‘z/);
      assert.doesNotMatch(line, /katak ≤/);
    }
  }
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
  // Variant — vizual NOMA'LUM: pol jadvalidan (`limitsFor.quizOption`, sharh 7-band); vizual MA'LUM (P11):
  // shu vizualning qutisidan, tahrir bilan bir funksiya (`limitsFor` + visual). 1–4 sinfga — ancha tor.
  assert.equal(clipLimit("quizOption", bachelor, undefined), limitsFor(bachelor).quizOption);
  assert.equal(clipLimit("quizOption", bachelor, "classic"), limitsFor(bachelor, {}, { visual: "classic" }).quizOption);
  assert.equal(clipLimit("quizOption", bachelor, "classic"), Math.min(SLIDE_LIMITS.quizOption, fitChars("quizOption", bachelor, "classic")));
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
  // N1: sig'maydigan uzun variantni «Am» ga «qisqartirish» — bosh mos bo'lsa ham RAD (≥ min(asl, ⌈cap/2⌉)).
  const longA = `Amudaryo va Sirdaryo suvini ${sent(40)}`;
  assert.ok(longA.length > cap, `shart: ${longA.length} > ${cap}`);
  const over = S({ id: "q2", layout: "quiz", quiz: [{ q: "Qaysi chora to‘g‘ri?", options: [longA, "B", "C", "D"], answer: 0 }] });
  assert.deepEqual(reasonsOf(over, rules, tpl.visual), ["clipped-option"]);
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, quiz: [{ q: "Qaysi chora to‘g‘ri?", options: ["Am", "B", "C", "D"], answer: 0 }] }] }),
    async () => assert.equal((await repairThinSlides([over], meta, tpl, {}, later(), later()))[0], over, "«Am» — rad"),
  );
  // To'liq qisqartma (bosh mos, yetarli uzun) — qabul.
  const shortA = clipTo(longA, Math.ceil(0.5 * cap) + 10);
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, quiz: [{ q: "Qaysi chora to‘g‘ri?", options: [shortA.replace(/…$/u, ""), "B", "C", "D"], answer: 0 }] }] }),
    async () => assert.notEqual((await repairThinSlides([over], meta, tpl, {}, later(), later()))[0], over, "to'liq qisqartma — qabul"),
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

/** `n` belgidan oshmaydigan, so'z bilan tugaydigan o'zbekcha gap. */
const upTo = (n: number, from = 0) => {
  let out = "";
  for (let i = 0; ; i += 1) {
    const next = out ? `${out} ${POOL[(from + i) % POOL.length]}` : POOL[(from + i) % POOL.length];
    if (next.length > n) return out;
    out = next;
  }
};

test("P8 (4): ta'mir RASMSIZ chegarada qabul qiladi — 4 bandli ustunning 90 belgilik bandi 60 da kesilmaydi", async () => {
  // Sinov asosi: bakalavr `academic` 4 bandli ustun — rasmli 60, rasmsiz 110.
  const withImage = clipLimit("colItem", rules, tpl.visual, 4);
  const noImage = clipLimit("colItem", rules, tpl.visual, 4, undefined, NO_IMAGE);
  assert.ok(withImage < 90 && noImage >= 90, `asos: ${withImage} / ${noImage}`);
  const thin = { id: "s0", layout: "twoCol", title: "Ikki yondashuv", leftTitle: "Eski", rightTitle: "Yangi", left: ["Bir."], right: ["Ikki."], plan: 1 } as SlideModel;
  const items = (k: number) => [0, 1, 2, 3].map((i) => upTo(90, k + i * 3));
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, left: items(0), right: items(1) }] }),
    async () => {
      const [out] = await repairThinSlides([thin], meta, tpl, {}, later(), later());
      assert.deepEqual(out.left, items(0), "ta'mirlangan band rasmli quti (60) bilan kesildi");
      assert.deepEqual(out.right, items(1));
      assert.ok(out.left!.every((x) => !x.endsWith("…") && x.length > withImage));
    },
  );
});

test("P8 imageYieldField: rasmli qutidan uzun VA rasm joy yeydigan maydon — rasm joy beradi", () => {
  const g89 = bodyRules({ slideAudience: "school_8_9", textVolume: "standart", planItems: 5 }, "lesson");
  const withImage = clipLimit("colItem", g89, "circle", 2);
  const noImage = clipLimit("colItem", g89, "circle", 2, undefined, NO_IMAGE);
  assert.ok(withImage < noImage, `asos: ${withImage} < ${noImage}`);
  const two = (len: number) => S({ layout: "twoCol", leftTitle: "A", rightTitle: "B", left: [upTo(len), upTo(len, 2)], right: [upTo(40, 1), upTo(40, 3)] });
  assert.equal(imageYieldField(two(Math.round(0.9 * noImage)), g89, "circle"), "colItem");
  assert.equal(imageYieldField(two(withImage), g89, "circle"), null, "rasmli qutiga sig'adi — rasm qoladi");
  // Rasm joy yemaydigan maydon (`circle` bandlari: rasmli = rasmsiz) — rasmdan voz kechish hech narsa bermaydi.
  assert.equal(fitChars("bullets", g89, "circle", 3), fitChars("bullets", g89, "circle", 3, { images: "none" }));
  const longBullets = S({ layout: "bullets", bullets: [upTo(g89.bulletChars), upTo(g89.bulletChars, 3), upTo(60, 5)] });
  assert.ok(longBullets.bullets![0].length > fitChars("bullets", g89, "circle", 3), "asos: band rasmli qutidan uzun");
  assert.equal(imageYieldField(longBullets, g89, "circle"), null);
  // Bosqich, jadval, iqtibos/bo'lim — o'z maydoni bilan.
  const stepText = upTo(clipLimit("stepText", g89, "circle", 3, undefined, NO_IMAGE));
  const proc = S({ layout: "process", steps: [1, 2, 3].map((n) => ({ n: String(n), title: "Bosqich", text: stepText })) });
  assert.equal(imageYieldField(proc, g89, "circle"), fitChars("stepText", g89, "circle", 3) < stepText.length ? "stepText" : null);
  assert.equal(imageYieldField(S({ layout: "section", subtitle: sent(20) }), g89, "circle"), null, "bo'lim subtitle rasmli qutiga sig'adi");
  // N1: XOM sig'im bilan solishtiriladi — 4 ustunli `circle` jadvalida rasmli katak ~4 belgi; 20 belgilik katak
  // `clipLimit` ning 24 belgilik poli ostida «sig'adi» ko'rinardi, aslida sig'maydi.
  const cell = upTo(20);
  assert.ok(fitChars("tableCell", g89, "circle", 4, { rows: 3 }) < cell.length && cell.length <= CLIP_FLOOR_CHARS, `asos: ${fitChars("tableCell", g89, "circle", 4, { rows: 3 })} < ${cell.length} ≤ 24`);
  assert.ok(fitChars("tableCell", g89, "circle", 4, { rows: 3, images: "none" }) >= cell.length, "asos: rasmsiz qutiga sig'adi");
  const table = S({ layout: "table", table: { headers: ["A", "B", "C", "D"], rows: [0, 1, 2].map(() => [cell, cell, cell, cell]) } });
  assert.equal(imageYieldField(table, g89, "circle"), "tableCell");
});

/*
 * P8 sharhi CHANGES 1: `bullets` maketi bandi quti sig'imida qirqiladi (ilgari faqat `bulletChars`:
 * 5–7 sinf `circle` da 100 belgi, quti 85 — matn qutidan chiqardi). Yozuvchi va ta'mir BIR chegara.
 */
test("P8 CHANGES 1: bandlar quti sig'imida (5–7 sinf circle), so'z chegarasida; yozuvchi = ta'mir", async () => {
  const m5 = extractMeta(TOOL_BY_ID["pro-slide"], { topic: "Orol dengizi fojiasi", slideAudience: "school_5_7" } as never);
  const t5 = resolveSlideTemplate("lesson", m5.topic);
  const r5 = bodyRules(m5, t5.id);
  assert.equal(t5.visual, "circle");
  const box = bulletClipLimit(r5, t5.visual, 3);
  assert.ok(box < r5.bulletChars, `asos: quti ${box} < bulletChars ${r5.bulletChars}`);
  assert.equal(box, Math.min(r5.bulletChars, clipLimit("bullets", r5, t5.visual, 3, undefined, NO_IMAGE)));
  const raw = [upTo(100), upTo(100, 4), upTo(100, 8)];
  assert.ok(raw.every((b) => b.length > box), raw.map((b) => b.length).join(","));
  const [written] = extractNewSlides(JSON.stringify({ slides: [{ layout: "bullets", title: "Sabablar", bullets: raw }] }), 0, "F", r5, { final: true }, t5.visual).map((x) => x.slide);
  for (const [i, b] of written.bullets!.entries()) {
    assert.ok(b.length <= box && b.endsWith("…"), `${b.length} > ${box}: «${b}»`);
    assert.ok(raw[i].startsWith(b.slice(0, -1)));
    assert.match(raw[i][b.length - 1], /\s/, `so'z o'rtasidan kesildi: «${b}»`);
  }
  // Ta'mir aynan shu chegarada — yozuvchi bilan bir xil natija.
  const thin = { id: "s0", layout: "bullets", title: "Sabablar", bullets: ["Qurg‘oqchilik."], plan: 1 } as SlideModel;
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, bullets: raw }] }),
    async () => {
      const [out] = await repairThinSlides([thin], m5, t5, {}, later(), later());
      assert.deepEqual(out.bullets, written.bullets, "ta'mir va yozuvchi bandni har xil qirqdi");
    },
  );
});

test("repair: process — son auditoriya ruxsatigacha qisiladi, matn shu sondagi quti bilan (sharh 1-band)", async () => {
  const kidsMeta = extractMeta(TOOL_BY_ID["pro-slide"], { topic: "Suv", slideAudience: "school_1_4" } as never);
  const kidsTpl = resolveSlideTemplate("lesson", kidsMeta.topic);
  const kr = bodyRules(kidsMeta, kidsTpl.id);
  assert.equal(kr.stepsMax, 3);
  const thin = S({ id: "p", layout: "process", title: "Tajriba", steps: [1, 2, 3].map((n) => ({ n: String(n), title: "B", text: "Qisqa" })) });
  // Model 5 bosqich qaytaradi — har biri 3 bosqichli prompt maqsadining YUQORI chegarasidagi to'liq gap
  // (P11: maqsad rasmli quti 5 so'zdan kam bo'lsa rasmsiz qutidan — detektor ham shu sig'imdan o'qiydi).
  const w = layoutWordTargets(kr, kidsTpl.visual).stepTextBy[3].max;
  assert.ok(w * CHARS_PER_WORD <= clipLimit("stepText", kr, kidsTpl.visual, 3, undefined, NO_IMAGE), "maqsad yozuvchi qirqishidan oshmaydi");
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

test("limitsFor ZAXIRA jadvali (vizual noma'lum) jonli o'lchovga mos: har katak ≤ max(5, ⌊0.88 × rasmsiz eng tor sig'im⌋₅)", async () => {
  // P11: jadval faqat vizual NOMA'LUM bo'lganda (`limitsFor(r, counts)` — ikki argument). Vizual ma'lum
  // bo'lganda o'sha vizualning o'lchovi — nuqtaviy tekshiruv `tests/slide-limits.test.mts` «P11» da
  // (8–9 sinf 3 bosqich rasmsiz: circle 121, academic 121, rail 85).
  const g89 = bodyRules({ slideAudience: "school_8_9", textVolume: "standart", planItems: 5 }, "lesson");
  for (const [visual, none] of [["circle", 121], ["academic", 121], ["rail", 85]] as const) {
    assert.equal(limitsFor(g89, { steps: 3 }, { visual, images: "none" }).stepText, none, visual);
    assert.ok(limitsFor(g89, { steps: 3 }).stepText < none, `${visual}: zaxira jadval vizual o'lchovidan tor`);
  }

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

/*
 * Generatsiya = tahrir (P11): vizual ma'lum bo'lsa ikkalasi BIR funksiyadan (`clipLimit` ↔
 * `limitsFor(rules, counts, { visual, images })`) — teng; vizual noma'lum bo'lsa `clipLimit`
 * jadvaldan (zaxira) oshmaydi.
 */
test("clipLimit soni o'zgaruvchi maydonda limitsFor bilan bir xil (vizual) / undan oshmaydi (zaxira)", async () => {
  const kids = bodyRules({ slideAudience: "school_1_4", textVolume: "standart", planItems: 5 }, "lesson");
  for (const rules of [bachelor, kids]) {
    for (const images of ["none", "both"] as const) {
      for (const n of [3, 4, 5]) {
        const l = limitsFor(rules, { steps: n }, { visual: "classic", images });
        assert.equal(clipLimit("stepText", rules, "classic", n, undefined, { images }), l.stepText);
        assert.equal(clipLimit("stepTitle", rules, "classic", n, undefined, { images }), l.stepTitle);
      }
      for (const n of [2, 3, 4]) assert.equal(clipLimit("statLabel", rules, "classic", n, undefined, { images }), limitsFor(rules, { stats: n }, { visual: "classic", images }).statLabel);
    }
    for (const n of [3, 4, 5]) {
      assert.ok(clipLimit("stepText", rules, undefined, n) <= limitsFor(rules, { steps: n }).stepText);
      assert.ok(clipLimit("stepTitle", rules, undefined, n) <= limitsFor(rules, { steps: n }).stepTitle);
    }
    for (const n of [2, 3, 4]) assert.ok(clipLimit("statLabel", rules, undefined, n) <= limitsFor(rules, { stats: n }).statLabel);
  }
});

// ───────────────────────────────────────────── 5. AUDIT-25 integratsiya sharhi (INT-04/05/07)

/*
 * INT-04: detektorning bosqich matni poli rasmli qutidan edi — `min(6, 3) = 3`, ya'ni 8–9 sinf
 * `circle` da 3 so'zli bosqich HECH QACHON «yupqa» deb topilmasdi (S4 saqlanardi). P11 qoidasi
 * (`fitWords`: rasmli quti < 5 so'z → rasmsiz quti) detektorga ham o'tadi: pol `min(6, 11) = 6`.
 * MUTATSIYA: `fitWords` dagi 5 so'z qoidasi olib tashlansa — qizaradi.
 */
test("INT-04: 8–9 sinf circle — 3 so'zli bosqichlar «short-steps» (detektor rasmsiz sig'imdan)", () => {
  const g89 = bodyRules({ slideAudience: "school_8_9", textVolume: "standart", planItems: 5 }, "lesson");
  const three = S({ layout: "process", steps: [1, 2, 3].map((n) => ({ n: String(n), title: `Bosqich ${n}`, text: sent(3, n) })) });
  assert.deepEqual(reasonsOf(three, g89, "circle"), ["short-steps"]);
  // Prompt oralig'iga rioya qilgan (≥ min) bosqich — yupqa emas.
  const min = layoutWordTargets(g89, "circle").stepTextBy[3].min;
  const ok = S({ layout: "process", steps: [1, 2, 3].map((n) => ({ n: String(n), title: `Bosqich ${n}`, text: sent(min, n) })) });
  assert.deepEqual(reasonsOf(ok, g89, "circle"), []);
});

/*
 * INT-05: band chegarasi bitta takrorlangan gap bilan o'lchangan edi — nol zaxira: boshqa so'z
 * tartibidagi haqiqiy band 101–149 % toshardi (10–11 sinf / ko'p / `lab`). Endi o'lchov so'z tartibi
 * AYLANMALARI bo'yicha (`PROBE_ROTATIONS`). Tekshiruv — o'lchovda ISHLATILMAGAN gaplar (held-out).
 * MUTATSIYA: `ROTATED_FIELDS` dan "bullets" olib tashlansa — lab 149 % qaytadi, qizaradi.
 */
const HELD_OUT = [
  "Fotosintez jarayonida yashil o‘simliklar quyosh nurini kimyoviy energiyaga aylantiradi, karbonat angidrid va suvdan glyukoza hosil qiladi hamda atmosferaga kislorod chiqaradi, bu esa yerdagi hayotning asosiy manbai bo‘lib xizmat qiladi",
  "Kasr sonlarni qo‘shishda avval umumiy maxraj topiladi, so‘ng suratlar qo‘shiladi va natija qisqartiriladi; masalan, ikki beshdan va bir uchdan yig‘indisi o‘n bir o‘n beshdan ga teng bo‘ladi, buni chizmada ham ko‘rsatish mumkin",
  "Amir Temur davlatida savdo yo‘llari xavfsizligi ta’minlandi, karvonsaroylar qurildi, hunarmandchilik va ilm-fan rivojlandi, Samarqand esa Sharq va G‘arbni bog‘lovchi yirik madaniy markazga aylandi hamda ko‘plab olimlarni o‘ziga jalb qildi",
];
type TL = { t: string; text?: string; lines?: string[]; box: { w: number; h: number }; size: number; bold?: boolean; paraSpace?: number; src?: { f: string }; srcLines?: { f: string }[] };
/** Qatlam siyohi / quti (layerFits bilan bir formula). */
function inkRatio(l: TL): number {
  const room = l.box.h * 72 + 1;
  if (l.lines) return (LAYOUT_KIT.listRows(l.lines, l.box as never, l.size) * l.size * 1.3 + Math.max(0, l.lines.length - 1) * (l.paraSpace ?? 0)) / room;
  return (LAYOUT_KIT.inkHeight(l.text ?? "", l.box.w, l.size, l.bold ? LAYOUT_KIT.CHAR_EM_BOLD : CHAR_EM) * 72) / room;
}
/** `field` qatlamlarining eng yomon siyoh nisbati — held-out gaplar, 12 xil so'z tartibi. */
function worstBullets(r: ReturnType<typeof bodyRules>, visual: (typeof LEGACY_VISUALS)[number] | (typeof DESIGN_VISUALS)[number], layout: "bullets" | "agenda", n: number, clip: number): number {
  let worst = 0;
  for (let rot = 0; rot < 12; rot += 1) {
    const items = Array.from({ length: n }, (_, i) => {
      const w = HELD_OUT[(rot + i) % HELD_OUT.length].split(" ");
      const k = (rot * 3 + i * 5) % w.length;
      return clipTo([...w.slice(k), ...w.slice(0, k)].join(" "), clip);
    });
    const plan = planSlide({ id: "x", layout, title: "Sarlavha", bullets: items }, getSlideTheme("atlas"), visual, 3, 10, "auto", "lecture", { bodyType: r });
    for (const l of plan.layers as unknown as TL[]) {
      if (l.t === "text" && (l.src?.f === "bullets" || (l.srcLines ?? []).some((s) => s.f === "bullets"))) worst = Math.max(worst, inkRatio(l));
    }
  }
  return worst;
}

test("INT-05: band chegarasi so'z tartibi aylanmalarida o'lchanadi — held-out gaplar hech bir auditoriya × vizualda toshmaydi", () => {
  // Qulf: 10–11 sinf / ko'p / lab (ilgari 149 %).
  const lab = bodyRules({ slideAudience: "school_10_11", textVolume: "kop", planItems: 5 }, "lecture");
  const labClip = bulletClipLimit(lab, "lab", lab.maxBullets);
  assert.ok(worstBullets(lab, "lab", "bullets", lab.maxBullets, labClip) <= 1.001, `lab ${labClip}`);
  const bad: string[] = [];
  for (const aud of SLIDE_AUDIENCES) {
    for (const vol of ["standart", "kop"] as const) {
      const r = bodyRules({ slideAudience: aud, textVolume: vol, planItems: 5 }, "lecture");
      for (const visual of [...LEGACY_VISUALS, ...DESIGN_VISUALS]) {
        const clip = bulletClipLimit(r, visual, r.maxBullets);
        const w = worstBullets(r, visual, "bullets", r.maxBullets, clip);
        if (w > 1.001) bad.push(`${aud}/${vol}/${visual}: ${Math.round(w * 100)} % (clip ${clip})`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} ta toshish`);
});

/*
 * INT-07 (ta'mir): twoCol ta'miri ustun bandlarini statik 4 ta emas, prompt/normalize bilan BIR
 * son (`layoutWordTargets.maxColItems`) bilan qoldiradi — 8–9 sinf `circle` da 2+2.
 * MUTATSIYA: `mergeRepair` twoCol da `SLIDE_LIMITS.colItems` ga qaytarilsa — qizaradi.
 */
test("INT-07: ta'mir twoCol bandlar soni = prompt = normalize (8–9 sinf circle: 2)", async () => {
  const m = extractMeta(TOOL_BY_ID["pro-slide"], { topic: "Orol dengizi fojiasi", slideAudience: "school_8_9" } as never);
  const t = resolveSlideTemplate("lesson", m.topic);
  const r = bodyRules(m, t.id);
  assert.equal(t.visual, "circle");
  const max = layoutWordTargets(r, t.visual).maxColItems;
  assert.equal(max, 2);
  const thin = { id: "s0", layout: "twoCol", title: "Ikki yondashuv", leftTitle: "Eski", rightTitle: "Yangi", left: ["Bir."], right: ["Ikki."], plan: 1 } as SlideModel;
  const items = (k: number) => [0, 1, 2, 3].map((i) => upTo(80, k + i * 3));
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, left: items(0), right: items(1) }] }),
    async () => {
      const [out] = await repairThinSlides([thin], m, t, {}, later(), later());
      assert.equal(out.left?.length, max, "ta'mir chap ustunda prompt sonidan ko'p band qoldirdi");
      assert.equal(out.right?.length, max);
      // Normalize ham aynan shu son.
      const [norm] = extractNewSlides(JSON.stringify({ slides: [{ layout: "twoCol", title: "T", leftTitle: "A", rightTitle: "B", left: items(0), right: items(1) }] }), 0, "F", r, { final: true }, t.visual).map((x) => x.slide);
      assert.equal(norm.left?.length, max);
      assert.deepEqual(out.left, norm.left, "ta'mir va normalize bandni har xil qirqdi");
    },
  );
});
