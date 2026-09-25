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
  TITLE_CHARS,
  TITLE_WORDS,
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
  // P14d N4: barcha vizual (magazine/bold iqtibosi «7–10» edi — `QUOTE_MIN_WORDS` dan past).
  for (const visual of [...LEGACY_VISUALS, ...DESIGN_VISUALS]) {
    const t = layoutWordTargets(bachelor, visual);
    const cap = (f: Parameters<typeof fitChars>[0], n?: number) => Math.max(CHARS_PER_WORD, fitChars(f, bachelor, visual, n));
    // GAP maydonlari — yozuvchi chegarasi RASMSIZ quti (P11; rasmli quti ≤ 5 so'z bersa maqsad rasmsizdan).
    const capNo = (f: Parameters<typeof fitChars>[0], n?: number) => Math.max(CHARS_PER_WORD, fitChars(f, bachelor, visual, n, NO_IMAGE));
    for (const [n, r] of Object.entries(t.stepTextBy)) assert.ok(r.max * CHARS_PER_WORD <= capNo("stepText", Number(n)), `${visual}: stepText×${n}`);
    assert.ok(t.colItem.max * CHARS_PER_WORD <= capNo("colItem", t.maxColItems), `${visual}: colItem×${t.maxColItems}`);
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
  // Jonli dalil sonlari: 8–9 sinf `circle` 2 bandli ustun — rasmli 60 belgi → AYNAN 5 so'z = gap poli (zaxirasiz
  // maqsad: model 4 yozadi, detektor 5 kutadi) → maqsad RASMSIZ 104 belgidan (9 so'z), rasm joy beradi (yakuniy jonli tuzatish).
  const g89 = bodyRules({ slideAudience: "school_8_9", textVolume: "standart", planItems: 5 }, "lesson");
  const t89 = layoutWordTargets(g89, "circle");
  assert.equal(clipLimit("colItem", g89, "circle", 2), 60, "sinov asosi: rasmli ustun bandi 60");
  assert.equal(clipLimit("colItem", g89, "circle", 2, undefined, NO_IMAGE), 104, "sinov asosi: rasmsiz 104");
  assert.equal(t89.maxColItems, 2);
  assert.equal(t89.colItem.max, Math.floor((0.85 * 104) / CHARS_PER_WORD));
  assert.equal(t89.colItem.max, 9);
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
  assert.match(wordTargetLines(g89, "circle").join("\n"), /har ustunda 2 band, har band 6–9 so‘z/);
});

/*
 * P11 (c) — prompt maqsadi GAP maydonlarida (bosqich matni, ustun bandi, band) `PROSE_MIN_WORDS`
 * (5) so'zdan KO'P, YOKI — rasmsiz quti ham shuncha ko'tarmasa — aynan rasmsiz sig'im × zaxira.
 * Rasmli qutidan 3 so'z so'rash yolg'on maqsad edi: model 5–6 so'z yozdi. AYNAN 5 ham yaramaydi
 * (yakuniy jonli tuzatish): prompt «5», detektor «< 5 yupqa» — zaxira yo'q, 4 so'zli o'zbekcha gap
 * yupqa chiqib, ta'mir ham rad etilardi (5–7 sinf `circle` 2 bandli ustun, bakalavr `academic` 4 bandli).
 * MUTATSIYA: `fitWords` dagi qoida olib tashlansa (doim rasmli quti) yoki «>» «≥» ga qaytsa — qizaradi.
 */
test("P11 (c): bosqich/ustun bandi/band maqsadi > 5 so'z yoki rasmsiz sig'imga teng — har auditoriya × vizual", () => {
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
          // Auditoriya istagi (`want`, masalan `bulletMaxWords`) 5 dan kam bo'lsa — o'sha; aks holda > 5 yoki rasmsiz sig'im.
          if (got <= PROSE_MIN_WORDS && got !== capWords && got !== want) bad.push(`${aud}/${vol}/${visual} ${name}: ${got} so'z (rasmsiz ${capWords})`);
        };
        for (const [n, x] of Object.entries(t.stepTextBy)) check(`stepText×${n}`, x.max, noImg("stepText", Number(n)));
        check(`colItem×${t.maxColItems}`, t.colItem.max, noImg("colItem", t.maxColItems));
        check("bullet", t.bullet.max, noImg("bullets"), bulletMaxWords(r));
        // Ustun soni: 3 ta TO'LIQROQ band 4 ta 5 so'zlidan afzal — tanlangan sonda rasmli quti zaxira bilan > 5 so'z, yoki son poldа (2).
        const imgWords = words(fitChars("colItem", r, visual, t.maxColItems), fieldCap("colItem", r, visual, t.maxColItems));
        if (t.maxColItems > COL_MIN_ITEMS && imgWords <= PROSE_MIN_WORDS) bad.push(`${aud}/${vol}/${visual} maxColItems=${t.maxColItems}: rasmli ${imgWords} so'z`);
        if (t.maxColItems < SLIDE_LIMITS.colItems) {
          const more = words(fitChars("colItem", r, visual, t.maxColItems + 1), fieldCap("colItem", r, visual, t.maxColItems + 1));
          if (more > PROSE_MIN_WORDS) bad.push(`${aud}/${vol}/${visual} maxColItems=${t.maxColItems}: ${t.maxColItems + 1} band ham ${more} so'z ko'tarardi`);
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} ta 5 so'zdan kam maqsad`);
  // Jonli holat: 8–9 sinf circle 3 bosqich — rasmsiz 121 → 11 so'z (rasm joy beradi); rail — 85 → 8.
  const g89 = bodyRules({ slideAudience: "school_8_9", textVolume: "standart", planItems: 5 }, "lesson");
  assert.equal(layoutWordTargets(g89, "circle").stepTextBy[3].max, 11);
  assert.equal(layoutWordTargets(g89, "rail").stepTextBy[3].max, 8);
  // Rasmli quti AYNAN 5 so'z bersa — maqsad RASMSIZ qutidan (rasm joy beradi): 8–9 sinf circle 2 bandli ustun 60 → 5, rasmsiz 104 → 9.
  assert.equal(layoutWordTargets(g89, "circle").colItem.max, 9);
  // Bakalavr `academic`: 4 band × 5 so'z (rasmli 60) o'rniga 3 band × 10 so'z (rasmli 111).
  assert.equal(layoutWordTargets(bachelor, "academic").maxColItems, 3);
  assert.ok(layoutWordTargets(bachelor, "academic").colItem.max >= 8, String(layoutWordTargets(bachelor, "academic").colItem.max));
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

test("P8 (4): ta'mir RASMSIZ chegarada qabul qiladi — to'liq ustunning rasmli qutidan uzun bandi kesilmaydi", async () => {
  /*
   * Sinov asosi: 8–9 sinf `circle` `maxColItems` (2) bandli ustun — rasmli 60, rasmsiz 104.
   * (Ilgari bakalavr `academic` 4 band: 60 / 110; endi u yerda 3 band — ikkala chegara ham
   * `SLIDE_LIMITS.colItem` shiftida (110), farq yo'q.)
   */
  const m89 = extractMeta(TOOL_BY_ID["pro-slide"], { topic: "Orol dengizi fojiasi", slideAudience: "school_8_9" } as never);
  const t89 = resolveSlideTemplate("lesson", m89.topic);
  const r89 = bodyRules(m89, t89.id);
  const n = layoutWordTargets(r89, t89.visual).maxColItems;
  const withImage = clipLimit("colItem", r89, t89.visual, n);
  const noImage = clipLimit("colItem", r89, t89.visual, n, undefined, NO_IMAGE);
  const len = withImage + Math.floor((noImage - withImage) / 2);
  assert.ok(t89.visual === "circle" && n === 2 && withImage < len && len <= noImage, `asos: ${n} band, ${withImage} < ${len} ≤ ${noImage}`);
  const thin = { id: "s0", layout: "twoCol", title: "Ikki yondashuv", leftTitle: "Eski", rightTitle: "Yangi", left: ["Bir."], right: ["Ikki."], plan: 1 } as SlideModel;
  const items = (k: number) => Array.from({ length: n }, (_, i) => upTo(len, k + i * 3));
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, left: items(0), right: items(1) }] }),
    async () => {
      const [out] = await repairThinSlides([thin], m89, t89, {}, later(), later());
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
  // Ta'mir aynan shu chegarada o'lchaydi — lekin qutiga sig'maydigan javob «…» bilan qirqilardi → `clipped-text` → RAD (asl qoladi).
  const thin = { id: "s0", layout: "bullets", title: "Sabablar", bullets: ["Qurg‘oqchilik."], plan: 1 } as SlideModel;
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, bullets: raw }] }),
    async () => {
      const [out] = await repairThinSlides([thin], m5, t5, {}, later(), later());
      assert.deepEqual(out.bullets, thin.bullets, "qutiga sig'maydigan (qirqiladigan) ta'mir qabul qilindi");
    },
  );
  // Qutiga sig'adigan javob — «…» siz qabul qilinadi (yozuvchi ham shu chegarada qirqmaydi).
  const fit = [upTo(box, 1), upTo(box, 5), upTo(box, 9)];
  assert.ok(fit.every((b) => b.length <= box && b.split(" ").length >= layoutWordTargets(r5, t5.visual).bullet.min), fit.map((b) => b.length).join(","));
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, bullets: fit }] }),
    async () => {
      const [out] = await repairThinSlides([thin], m5, t5, {}, later(), later());
      assert.deepEqual(out.bullets, fit);
      const [w2] = extractNewSlides(JSON.stringify({ slides: [{ layout: "bullets", title: "Sabablar", bullets: fit }] }), 0, "F", r5, { final: true }, t5.visual).map((x) => x.slide);
      assert.deepEqual(w2.bullets, fit, "yozuvchi sig'adigan bandni qirqdi");
    },
  );
});

/*
 * Yakuniy jonli tuzatish — KESILGAN gap maydoni ta'mir nomzodi (`clipped-text`): jonli 8–9 sinf
 * `circle` maqsadlar slaydi (blok, `plan` yo'q) 87 belgida «…» bilan kesilgan edi — model 8 so'z
 * o'rniga 9–10 yozdi, hech kim qisqartirmasdi. Endi ta'mir ma'nosini saqlab qisqartiradi; yana
 * sig'masa — rad (asl kesik qoladi, yomonlashmaydi). MUTATSIYA: `thinReasons` dagi
 * `clippedText` chaqiruvi olib tashlansa — birinchi va uchinchi test qizaradi.
 */
test("clipped-text: «…» bilan qirqilgan band/ustun bandi/bosqich — blok slaydida ham; qisqa «…» savol emas", () => {
  const cap3 = bulletClipLimit(bachelor, VIS, 3);
  const cut = clipTo(sent(40), cap3);
  assert.ok(cut.endsWith("…") && cut.length > 0.6 * cap3);
  const okB = [sent(14), sent(14, 3)];
  assert.deepEqual(reasonsOf(S({ layout: "bullets", bullets: [...okB, cut] })), ["clipped-text"]);
  assert.deepEqual(reasonsOf(S({ layout: "bullets", bullets: [...okB, cut], plan: undefined })), ["clipped-text"], "blok slaydi (maqsadlar) ham");
  assert.deepEqual(reasonsOf(S({ layout: "bullets", bullets: [...okB, "1/2 + 1/4 = …"] })), [], "bo'sh joyli savol — kesilgan emas");
  const colCap = clipLimit("colItem", bachelor, VIS, 3, undefined, NO_IMAGE);
  const cutCol = clipTo(sent(40, 2), colCap);
  assert.deepEqual(reasonsOf(S({ layout: "twoCol", leftTitle: "A", rightTitle: "B", left: [sent(9), sent(9, 2), cutCol], right: [sent(9, 1), sent(9, 3), sent(9, 5)] })), ["clipped-text"]);
  assert.deepEqual(reasonsOf(S({ layout: "compare", leftTitle: "A", rightTitle: "B", left: [sent(9), sent(9, 2), sent(9, 4)], right: [sent(9, 1), cutCol, sent(9, 5)] })), ["clipped-text"]);
  const stepCap = clipLimit("stepText", bachelor, VIS, 3, undefined, NO_IMAGE);
  const cutStep = clipTo(sent(40, 4), stepCap);
  assert.deepEqual(reasonsOf(S({ layout: "process", steps: [1, 2, 3].map((n) => ({ n: String(n), title: `Bosqich ${n}`, text: n === 2 ? cutStep : sent(9, n) })) })), ["clipped-text"]);
  // Yupqa VA kesilgan — ikkala sabab (kesilgan band + 2 ta juda qisqa band).
  assert.deepEqual(reasonsOf(S({ layout: "bullets", bullets: ["Bir.", "Ikki.", cut] })), ["clipped-text", "short-bullets"]);
});

test("clipped-text: REJASIZ slayd sarlavhasi «…» bilan kesilgan — nomzod; reja slaydi sarlavhasi (agenda bandi) — emas", () => {
  const cutTitle = clipTo(sent(20), SLIDE_LIMITS.title);
  assert.ok(cutTitle.endsWith("…") && cutTitle.length <= SLIDE_LIMITS.title);
  assert.deepEqual(reasonsOf({ id: "r", layout: "references", title: cutTitle, references: [] } as unknown as SlideModel), ["clipped-text"]);
  assert.deepEqual(reasonsOf({ id: "c", layout: "closing", title: cutTitle, subtitle: sent(10) } as unknown as SlideModel), ["clipped-text"]);
  assert.deepEqual(reasonsOf(S({ layout: "bullets", title: cutTitle, bullets: [sent(14), sent(14, 3), sent(14, 6)] })), [], "reja slaydi sarlavhasi shartnoma — tegilmaydi");
  assert.deepEqual(reasonsOf(S({ layout: "bullets", title: cutTitle, bullets: [sent(14), sent(14, 3), sent(14, 6)], plan: undefined })), ["clipped-text"]);
  // Prompt: sarlavha qoidasi belgi chegarasi bilan, yozuvchi qopqog'idan ≥ 15 % past (P8 qoidasi).
  // C8 (P14 sharhi): so'z chegarasi belgi chegarasidan KELIB CHIQADI — max × CHARS_PER_WORD ≤ TITLE_CHARS
  // (7 × 9 = 63 > 61 edi) va bu eng katta shunday son (o'zboshimcha past emas). MUTATSIYA: max = 7 — qizaradi.
  // P14d N8: xulq — TITLE_WORDS.max so'zli o'rtacha sarlavha (CHARS_PER_WORD belgi/so'z) yozuvchi qopqog'ida kesilmaydi.
  const maxTitle = Array.from({ length: TITLE_WORDS.max }, () => "a".repeat(CHARS_PER_WORD - 1)).join(" ");
  assert.equal(clipTo(maxTitle, SLIDE_LIMITS.title), maxTitle, `${TITLE_WORDS.max} so'zli sarlavha kesildi`);
  assert.ok(TITLE_WORDS.max * CHARS_PER_WORD <= TITLE_CHARS, `${TITLE_WORDS.max} so'z × ${CHARS_PER_WORD} > ${TITLE_CHARS}`);
  assert.ok((TITLE_WORDS.max + 1) * CHARS_PER_WORD > TITLE_CHARS, "so'z chegarasi belgi chegarasidan bir necha so'z past");
  assert.ok(TITLE_WORDS.min < TITLE_WORDS.max);
});

test("clipped-text ta'miri: rejasiz sarlavha qisqartiriladi (manbalar/yakun ham), reja sarlavhasi hech qachon almashmaydi", async () => {
  const cutTitle = clipTo(sent(20), SLIDE_LIMITS.title);
  const refs = { id: "r", layout: "references", title: cutTitle, references: [{ title: "A", source: "B" }] } as unknown as SlideModel;
  const shortTitle = sent(5, 2);
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, title: shortTitle }] }),
    async (calls) => {
      const [out] = await repairThinSlides([refs], meta, tpl, {}, later(), later());
      assert.match(calls[0].user, /title ≤ 6 so‘z va ≤ 61 belgi/);
      assert.match(calls[0].user, /"index":0,"title":""/);
      assert.equal(out.title, shortTitle);
      assert.deepEqual({ ...out, title: refs.title }, refs, "sarlavhadan boshqa maydon o'zgardi");
    },
  );
  // Yana uzun sarlavha — rad (asl qoladi).
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, title: sent(25) }] }),
    async () => assert.deepEqual(await repairThinSlides([refs], meta, tpl, {}, later(), later()), [refs]),
  );
  // Reja slaydi: bandlar yupqa, model sarlavhani ham yuboradi — bandlar qabul, sarlavha ASL.
  const plan = S({ layout: "bullets", title: cutTitle, bullets: ["Bir.", "Ikki.", "Uch."] });
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, title: shortTitle, bullets: [sent(14), sent(14, 3), sent(14, 6)] }] }),
    async () => {
      const [out] = await repairThinSlides([plan], meta, tpl, {}, later(), later());
      assert.equal(out.title, cutTitle);
      assert.equal(out.bullets!.length, 3);
    },
  );
});

test("clipped-text ta'miri: prompt qisqartirishni so'raydi (blok slaydi ham), sig'adigan javob «…» siz qabul, sig'maydigani rad", async () => {
  const cap3 = bulletClipLimit(rules, tpl.visual, 3);
  const cut = clipTo(sent(40), cap3);
  const goals = { id: "g", layout: "bullets", title: "Dars maqsadlari", bullets: [sent(12), sent(12, 3), cut] } as SlideModel;
  const t = layoutWordTargets(rules, tpl.visual);
  const short = [sent(12), sent(12, 3), sent(Math.min(t.bullet.max, 12), 6)];
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, bullets: short }] }),
    async (calls) => {
      const [out] = await repairThinSlides([goals], meta, tpl, {}, later(), later());
      assert.equal(calls.length, 1);
      assert.match(calls[0].user, /kesilgan/);
      assert.match(calls[0].user, new RegExp(`har band ≤ ${t.bullet.max} so‘z va ≤ ${Math.floor(0.85 * cap3)} belgi`));
      assert.match(calls[0].system, /qisqartirasiz/);
      assert.deepEqual(out.bullets, short);
      assert.ok(out.bullets!.every((b) => !b.endsWith("…")));
      assert.equal(out.title, goals.title);
    },
  );
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, bullets: [sent(12), sent(12, 3), sent(40, 6)] }] }),
    async () => {
      const [out] = await repairThinSlides([goals], meta, tpl, {}, later(), later());
      assert.deepEqual(out, goals, "yana sig'maydigan javob qabul qilindi");
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

// ───── P14c-B (detektor zaxirasi)

import { CLIP_WORD_MIN_SHARE } from "../lib/generation/slide-limits.ts";
import { colMinWords, slackMin, stepMinWords } from "../lib/generation/slide-quality.ts";

/*
 * P14c-B — detektor zaxirasi. Jonli (8–9 sinf `lesson`/`circle`, 3 band, quti 87 belgi):
 * `bulletCap` = ⌊0.85 × 87 / 9⌋ = 8, `bulletMinWords` = 8 — prompt «8 so'z», detektor
 * «o'rtacha < 8 — yupqa»: NOL zaxira. ~11 belgilik o'zbekcha fan so'zlari bilan qutiga 7 so'z
 * sig'adi — sig'adigan band «yupqa», ta'mir kesilgan bandni qutiga qisqartiradi (7 so'z) va
 * «0 / 1» rad etiladi. Endi quti qissa, detektor round(0.75 × quti) dan qabul qiladi (`slackMin`, P14d: round),
 * prompt oralig'i «8–8» ga yopilmaydi (`range` ham `slackMin` bilan).
 * MUTATSIYA: `bullet.min` eski formulaga (min(bulletMinWords, bulletCap)) qaytsa yoki `range`
 * dagi `slackMin` olib tashlansa — xossa testi qizaradi.
 */
test("P14c-B: slackMin — quti qissa, chegara round(0.75 × quti); quti keng — pol o'zgarmaydi", () => {
  // P14d N8: ta'rifni takrorlash (`DETECTOR_SHARE === 0.75`) o'rniga xulq — har quti o'lchamida chegara.
  assert.equal(slackMin(8, 8), 6, "jonli: 8 so'zlik qutida 6 dan");
  // P14d N2: yaxlitlash — 5 so'zlik quti 3 so'zli bandni qabul qilmaydi. MUTATSIYA: Math.floor — 5 → 3, 6 → 4, qizaradi.
  assert.equal(slackMin(8, 5), 4, "5 so'zlik quti: 4 dan (⌊3.75⌋ = 3 emas)");
  assert.equal(slackMin(8, 6), 5, "6 so'zlik quti: 5 dan");
  assert.equal(slackMin(12, 12), 9, "bakalavr academic: 12 so'zlik quti, 9 dan");
  assert.equal(slackMin(8, 3), 2, "3 so'zlik quti — oraliq ochiq «2–3»");
  assert.equal(slackMin(8, 20), 8, "keng quti — auditoriya poli");
  assert.equal(slackMin(6, 7), 5);
  assert.equal(slackMin(8, 1), 1, "kamida 1");
});

test("P14c-B: xossa — har auditoriya × hajm × shablon × vizual: band/ustun bandi/bosqich oralig'i ochiq (max ≥ 3 da min < max), detektor ≤ prompt min", () => {
  const bad: string[] = [];
  let checked = 0;
  for (const aud of SLIDE_AUDIENCES) {
    for (const vol of ["qisqa", "standart", "kop"] as const) {
      for (const tplId of ["lecture", "lesson"] as const) {
        const r = bodyRules({ slideAudience: aud, textVolume: vol, planItems: 5 }, tplId);
        for (const visual of [...LEGACY_VISUALS, ...DESIGN_VISUALS]) {
          const t = layoutWordTargets(r, visual);
          const at = `${aud}/${vol}/${tplId}/${visual}`;
          const open = (name: string, w: { min: number; max: number }) => {
            if (w.max >= 3 && w.min >= w.max) bad.push(`${at} ${name}: «${w.min}–${w.max}» yopiq`);
          };
          const le = (name: string, det: number, w: { min: number; max: number }) => {
            if (det > w.min) bad.push(`${at} ${name}: detektor ${det} > prompt min ${w.min}`);
          };
          // Band: detektor chegarasi AYNAN `t.bullet.min` (`thinReasons`); xulq — min so'zli bandlar yupqa emas.
          open("bullet", t.bullet);
          const bullets = Array.from({ length: r.maxBullets }, (_, i) => sent(t.bullet.min, i * 3));
          if (reasonsOf(S({ layout: "bullets", bullets }), r, visual).includes("short-bullets")) bad.push(`${at} bullet: ${t.bullet.min} so'z «yupqa»`);
          // Ustun bandi: prompt oralig'i `maxColItems` bo'yicha, model esa kamroq band yozishi mumkin —
          // kamroq bandda quti kengroq, detektor yuqoriroq (P14d N8: har son COL_MIN_ITEMS..maxColItems).
          open(`colItem×${t.maxColItems}`, t.colItem);
          for (let n = COL_MIN_ITEMS; n <= t.maxColItems; n += 1) {
            le(`colItem×${n}`, colMinWords(r, visual, n), t.colItem);
            const col = (k: number) => Array.from({ length: n }, (_, i) => sent(t.colItem.min, k + i * 2));
            if (reasonsOf(S({ layout: "twoCol", leftTitle: "A", rightTitle: "B", left: col(0), right: col(1) }), r, visual).includes("short-columns")) {
              bad.push(`${at} colItem×${n}: ${t.colItem.min} so'z «yupqa»`);
            }
          }
          // Bosqich matni — har son uchun.
          for (const [k, w] of Object.entries(t.stepTextBy)) {
            const n = Number(k);
            open(`stepText×${n}`, w);
            le(`stepText×${n}`, stepMinWords(r, visual, n), w);
            const steps = Array.from({ length: n }, (_, i) => ({ n: String(i + 1), title: "Bosqich", text: sent(w.min, i * 2) }));
            if (reasonsOf(S({ layout: "process", steps }), r, visual).includes("short-steps")) bad.push(`${at} stepText×${n}: ${w.min} so'z «yupqa»`);
          }
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked >= 1500, `probe: ${checked} kombinatsiya`);
  assert.deepEqual(bad.slice(0, 12), [], `${bad.length} ta nol zaxira`);
  // Uch jonli deka (sinov asosi — raqamlar hisobotda).
  const live = (aud: string, tplId: "lesson" | "lecture") => {
    const m = extractMeta(TOOL_BY_ID["pro-slide"], { topic: "Orol dengizi fojiasi", slideAudience: aud } as never);
    const tp = resolveSlideTemplate(tplId, m.topic);
    return { r: bodyRules(m, tp.id), visual: tp.visual };
  };
  const g57 = live("school_5_7", "lesson");
  assert.equal(g57.visual, "circle");
  assert.deepEqual(layoutWordTargets(g57.r, g57.visual).stepTextBy[3], { min: 6, max: 8 }, "5–7 sinf circle 3 bosqich: «8» emas, «6–8»");
  const ba = live("students_bachelor", "lecture");
  assert.equal(ba.visual, "academic");
  assert.deepEqual(layoutWordTargets(ba.r, ba.visual).bullet, { min: 9, max: 12 }, "bakalavr academic: quti 12 so'z, detektor 9 dan");
});

test("P14c-B: jonli holat — 8–9 sinf lesson circle, 3 band (quti 87): t.bullet = {6, 8}, 7 so'zli uch band yupqa EMAS", () => {
  const m = extractMeta(TOOL_BY_ID["pro-slide"], { topic: "Fotosintez", slideAudience: "school_8_9" } as never);
  const tp = resolveSlideTemplate("lesson", m.topic);
  const r = bodyRules(m, tp.id);
  assert.equal(tp.visual, "circle");
  assert.equal(bulletClipLimit(r, "circle", 3), 87, "sinov asosi: 3 bandli quti 87 belgi");
  assert.equal(bulletMinWords(r), 8, "sinov asosi: auditoriya poli 8");
  assert.deepEqual(layoutWordTargets(r, "circle").bullet, { min: 6, max: 8 });
  // Haqiqiy o'zbekcha fan matni (~10 belgilik so'zlar): 7 so'z, qutiga sig'adi.
  const bullets = [
    "Yashil o‘simliklar quyosh energiyasini kimyoviy energiyaga aylantiradi",
    "Xlorofill pigmenti yorug‘lik nurlarini yutib fotosintezni boshlaydi",
    "Karbonat angidrid va suvdan organik moddalar sintezlanadi",
  ];
  for (const b of bullets) {
    assert.equal(b.split(" ").length, 7, b);
    assert.ok(b.length <= 87, `${b.length} > 87`);
  }
  assert.deepEqual(reasonsOf(S({ layout: "bullets", bullets }), r, "circle"), []);
  assert.deepEqual(wordTargetLines(r, "circle").join("\n").match(/har band \d+–\d+ so‘z/)?.[0], "har band 6–9 so‘z", "ustun bandi oralig'i o'zgarmadi (quti keng)");
});

test("P14c-B: jonli ta'mir — kesilgan uch band qutiga (7 so'z) qisqartirildi → qabul (ilgari «short-bullets» bilan rad, 0 / 1)", async () => {
  const m = extractMeta(TOOL_BY_ID["pro-slide"], { topic: "Fotosintez", slideAudience: "school_8_9" } as never);
  const tp = resolveSlideTemplate("lesson", m.topic);
  const r = bodyRules(m, tp.id);
  const short = [
    "Yashil o‘simliklar quyosh energiyasini kimyoviy energiyaga aylantiradi",
    "Xlorofill pigmenti yorug‘lik nurlarini yutib fotosintezni boshlaydi",
    "Karbonat angidrid va suvdan organik moddalar sintezlanadi",
  ];
  const cap = bulletClipLimit(r, tp.visual, 3);
  const clipped = short.map((b) => clipTo(`${b} hamda bu jarayon yer yuzidagi barcha tirik organizmlar uchun hayotiy ahamiyatga ega`, cap));
  for (const c of clipped) assert.ok(c.endsWith("…"), c);
  const slide = { id: "s1", layout: "bullets", title: "Fotosintez qanday kechadi", bullets: clipped, plan: 1 } as SlideModel;
  assert.deepEqual(reasonsOf(slide, r, tp.visual), ["clipped-text"]);
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, bullets: short }] }),
    async () => {
      const [out] = await repairThinSlides([slide], m, tp, {}, later(), later());
      assert.deepEqual(out.bullets, short, "qutiga sig'adigan 7 so'zli bandlar rad etildi");
    },
  );
});

/*
 * C7 (P14 sharhi): `clipTo` «…» dan oldin oxirgi tinish belgisi/probelni olib tashlaydi — «so'z —»
 * da kesilsa natija ⌈0.6·(qopqoq−1)⌉ − 1 belgi, ilgari chegara ⌈0.6·(qopqoq−1)⌉ edi: kesik
 * «qirqilmagan» deb o'tib ketardi. MUTATSIYA: `CLIP_TAIL_SLACK` = 0 — qizaradi.
 */
test("P14c-B C7: «so‘z —» da kesilgan band (⌈0.6·(qopqoq−1)⌉ − 1 belgi) — clipped-text", () => {
  const cap = bulletClipLimit(bachelor, VIS, 3);
  const k = Math.ceil(CLIP_WORD_MIN_SHARE * (cap - 1));
  let head = sent(40).slice(0, k - 2);
  if (/[\s,;:.!?–—-]$/u.test(head)) head = `${head.slice(0, -1)}a`;
  const text = `${head} — ${"suvxo‘jaligi".repeat(Math.ceil(cap / 10))}`;
  const cut = clipTo(text, cap);
  assert.equal(cut, `${head}…`, "sinov asosi: clipTo « —» ni olib tashlaydi");
  assert.equal(cut.length, k - 1);
  const s = S({ layout: "bullets", plan: undefined, title: "Dars maqsadlari", bullets: [sent(14), sent(14, 3), cut] });
  assert.deepEqual(reasonsOf(s), ["clipped-text"]);
  // Qisqa bo'sh joyli savol hali ham kesilgan emas.
  assert.deepEqual(reasonsOf(S({ layout: "bullets", plan: undefined, bullets: [sent(14), "1/2 + 1/4 = …"] })), []);
});

test("P14c-B: muqova (`title` maketi) sarlavhasi hech qachon clipped-text nomzodi emas (slide-write uni meta.topic bilan almashtiradi)", () => {
  const cutTitle = clipTo(sent(20), SLIDE_LIMITS.title);
  assert.ok(cutTitle.endsWith("…"));
  assert.deepEqual(reasonsOf({ id: "c", layout: "title", title: cutTitle, subtitle: "Ma’ruza" } as unknown as SlideModel), []);
  // Nazorat: xuddi shu sarlavha yakun slaydida — nomzod.
  assert.deepEqual(reasonsOf({ id: "z", layout: "closing", title: cutTitle, subtitle: sent(10) } as unknown as SlideModel), ["clipped-text"]);
});
// ───── P14c-A (ta'mir merge)
/*
 * AUDIT-25 P14 sharhi C1/C2/C3/C5/C6 — `clipped-text` ta'miri yaxshi matnni o'chirmasin:
 *   — C1: faqat kesilgan slayd O'RNI bo'yicha birlashtiriladi (son qulf, kesilmagan band asl,
 *     sarlavha tanadan mustaqil, `qaytaring:` da faqat kesilgan maydonlar);
 *   — C2: muqova (`layout:"title"`) sarlavhasi hech qachon so'ralmaydi;
 *   — C3: tizim prompti «title O‘ZGARMAYDI» / «chuqurlashtiring» ziddiyatisiz;
 *   — C5: ustunlar har tomon O'Z soni bilan qirqiladi (yozuvchi `col()` kabi);
 *   — C6: rad etilgan har slayd `console.warn` da sababi bilan.
 */

/** 10–11 sinf ma'ruza, `bold` vizuali: 3 bandli ustun 75 belgi, 2 bandli 110 — C5 farqi reja slaydida ham. */
const m1011 = extractMeta(TOOL_BY_ID["pro-slide"], { topic: "Orol dengizi fojiasi", slideAudience: "school_10_11" } as never);
const tBold = { ...resolveSlideTemplate("lecture", m1011.topic), visual: "bold" } as ReturnType<typeof resolveSlideTemplate>;
const rBold = bodyRules(m1011, tBold.id);

async function captureWarn(fn: () => Promise<void>): Promise<string[]> {
  const saved = console.warn;
  const lines: string[] = [];
  console.warn = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.warn = saved;
  }
  return lines;
}

test("P14c-A C1: blok bandlari — faqat tuzatilgan bandni qaytargan javob RAD (qolgan maqsadlar o'chmaydi); so'rovda faqat bandlar", async () => {
  const cap3 = bulletClipLimit(rules, tpl.visual, 3);
  const goals = { id: "g", layout: "bullets", title: "Dars maqsadlari", bullets: [sent(12), sent(12, 3), clipTo(sent(40), cap3)] } as SlideModel;
  assert.deepEqual(reasonsOf(goals, rules, tpl.visual), ["clipped-text"]);
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, bullets: [sent(10, 6)] }] }),
    async (calls) => {
      const [out] = await repairThinSlides([goals], meta, tpl, {}, later(), later());
      assert.equal(out, goals, "1 bandli javob qabul qilindi — ikki maqsad o'chdi");
      assert.match(calls[0].user, /qaytaring: \{"index":0,"bullets":\[""\]\}/);
      assert.match(calls[0].user, /SONI va TARTIBI o‘zgarmasin/);
    },
  );
  // Reja slaydi ham: 3 → 2 band (minBullets dan past emas bo'lsa ham) — rad.
  const plan = S({ layout: "bullets", bullets: [sent(14), sent(14, 3), clipTo(sent(40, 5), cap3)] });
  assert.deepEqual(reasonsOf(plan, rules, tpl.visual), ["clipped-text"]);
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, bullets: [sent(14), sent(12, 6)] }] }),
    async () => assert.equal((await repairThinSlides([plan], meta, tpl, {}, later(), later()))[0], plan),
  );
});

test("P14c-A C1: 3 bandli javobda model kesilmagan bandni ham «yaxshilasa» — u BAYTMA-BAYT asl, kesilgani almashadi", async () => {
  const cap3 = bulletClipLimit(rules, tpl.visual, 3);
  const goals = { id: "g", layout: "bullets", title: "Dars maqsadlari", bullets: [sent(12), sent(12, 3), clipTo(sent(40), cap3)] } as SlideModel;
  const fixed = sent(10, 6);
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, bullets: [`${sent(12)} va yana boshqa fikr`, sent(9, 1), fixed] }] }),
    async () => {
      const [out] = await repairThinSlides([goals], meta, tpl, {}, later(), later());
      assert.deepEqual(out.bullets, [goals.bullets![0], goals.bullets![1], fixed]);
      assert.equal(out.title, goals.title);
    },
  );
});

test("P14c-A C1+C5: twoCol 3+2, faqat o'ngda kesilgan — chap tegilmaydi, o'ng O'Z soni (2) qutisi bilan qirqiladi", async () => {
  const cap2 = clipLimit("colItem", rBold, "bold", 2, undefined, NO_IMAGE);
  const cap3 = clipLimit("colItem", rBold, "bold", 3, undefined, NO_IMAGE);
  assert.ok(layoutWordTargets(rBold, "bold").maxColItems === 3 && cap3 < cap2, `asos: 3 band, ${cap3} < ${cap2}`);
  const left = [upTo(60), upTo(60, 3), upTo(60, 6)];
  const slide = S({ layout: "twoCol", leftTitle: "Eski", rightTitle: "Yangi", left, right: [upTo(90, 1), clipTo(sent(40, 2), cap2)] });
  assert.deepEqual(reasonsOf(slide, rBold, "bold"), ["clipped-text"]);
  const shortened = upTo(Math.round((cap2 + cap3) / 2), 7);
  assert.ok(shortened.length > cap3 && shortened.length <= cap2, `asos: ${cap3} < ${shortened.length} ≤ ${cap2}`);
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, left: ["Model chapni o‘zgartirdi", upTo(60, 2)], right: [`${upTo(90, 1)} qo‘shimcha`, shortened] }] }),
    async (calls) => {
      const [out] = await repairThinSlides([slide], m1011, tBold, {}, later(), later());
      assert.deepEqual(out.left, left, "kesilmagan chap ustun o'zgardi");
      assert.deepEqual(out.right, [slide.right![0], shortened], "o'ng: kesilmagan asl, kesilgani 2 band qutisida qirqilmay");
      assert.match(calls[0].user, /qaytaring: \{"index":0,"right":\[""\]\}/, "faqat kesilgan tomon so'raladi");
    },
  );
  // O'ng tomonda son boshqa — rad.
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, right: [shortened] }] }),
    async () => assert.equal((await repairThinSlides([slide], m1011, tBold, {}, later(), later()))[0], slide),
  );
});

test("P14c-A C1: process — son qulf, kesilmagan bosqich asl, kesilgani almashadi (sarlavha/raqam asl)", async () => {
  const stepCap = clipLimit("stepText", rules, tpl.visual, 3, undefined, NO_IMAGE);
  const proc = S({
    layout: "process",
    steps: [1, 2, 3].map((n) => ({ n: String(n), title: `Bosqich ${n}`, text: n === 2 ? clipTo(sent(40, 4), stepCap) : sent(9, n) })),
  });
  assert.deepEqual(reasonsOf(proc, rules, tpl.visual), ["clipped-text"]);
  const fixed = sent(9, 7);
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, steps: [1, 2, 3].map((n) => ({ n: "9", title: "Boshqa", text: n === 2 ? fixed : `${sent(9, n)} yangi` })) }] }),
    async (calls) => {
      const [out] = await repairThinSlides([proc], meta, tpl, {}, later(), later());
      assert.deepEqual(out.steps, [proc.steps![0], { ...proc.steps![1], text: fixed }, proc.steps![2]]);
      assert.match(calls[0].user, /qaytaring: \{"index":0,"steps":\[/);
    },
  );
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, steps: [{ n: "1", title: "B", text: fixed }, { n: "2", title: "B", text: fixed }] }] }),
    async () => assert.equal((await repairThinSlides([proc], meta, tpl, {}, later(), later()))[0], proc, "2 bosqich — rad"),
  );
});

test("P14c-A C1+C3: faqat sarlavhasi kesilgan blok slaydi — so'rovda FAQAT title, bandlar tegilmaydi; prompt ziddiyatsiz", async () => {
  const cutTitle = clipTo(sent(20), SLIDE_LIMITS.title);
  const goals = { id: "g", layout: "bullets", title: cutTitle, bullets: [sent(12), sent(12, 3), sent(12, 6)] } as SlideModel;
  assert.deepEqual(reasonsOf(goals, rules, tpl.visual), ["clipped-text"]);
  const shortTitle = sent(5, 2);
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, title: shortTitle, bullets: ["Model bandlarni ham yubordi"] }] }),
    async (calls) => {
      const [out] = await repairThinSlides([goals], meta, tpl, {}, later(), later());
      assert.equal(out.title, shortTitle, "faqat sarlavhali javob qabul qilinishi kerak");
      assert.deepEqual({ ...out, title: goals.title }, goals, "sarlavhadan boshqa maydon o'zgardi");
      assert.match(calls[0].user, /qaytaring: \{"index":0,"title":""\}/);
      assert.doesNotMatch(calls[0].user, /"bullets":\[""\]/);
      // C3: sarlavha so'raladi — «title O‘ZGARMAYDI» yo'q; faqat kesilgan deka — «chuqurlashtiring» yo'q.
      assert.doesNotMatch(calls[0].system, /title O‘ZGARMAYDI/);
      assert.match(calls[0].system, /layout HECH QACHON o‘zgarmaydi; title faqat «qaytaring» qatorida "title" so‘ralgan/);
      assert.match(calls[0].system, /FAQAT qisqartiring — ma’no saqlansin/);
      assert.match(calls[0].system, /so‘zma-so‘z, o‘sha son va tartibda/);
      assert.doesNotMatch(calls[0].system, /chuqurlashtiring/);
    },
  );
  // Yupqa slayd bor dekada — chuqurlashtirish qoidasi bor.
  await withLlm(
    () => jsonReply(good),
    async (calls) => {
      await repairThinSlides(deck(), meta, tpl, {}, later(), later());
      assert.match(calls[0].system, /YUPQA slaydda .*chuqurlashtiring/);
    },
  );
});

test("P14c-A C1: yupqa + kesilgan slayd — butun ro'yxat modelniki (hammasi qayta yoziladi)", async () => {
  const cap3 = bulletClipLimit(rules, tpl.visual, 3);
  const slide = S({ layout: "bullets", bullets: ["Bir.", "Ikki.", clipTo(sent(40), cap3)] });
  assert.deepEqual(reasonsOf(slide, rules, tpl.visual), ["clipped-text", "short-bullets"]);
  const n = Math.min(rules.maxBullets, 4);
  assert.notEqual(n, 3, "asos: javob soni asl sondan farq qilsin");
  const fresh = Array.from({ length: n }, (_, i) => sent(14, i * 3));
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, bullets: fresh }] }),
    async (calls) => {
      const [out] = await repairThinSlides([slide], meta, tpl, {}, later(), later());
      assert.deepEqual(out.bullets, fresh);
      assert.match(calls[0].user, /qaytaring: \{"index":0,"bullets":\[""\]\}/);
    },
  );
});

test("P14c-A C2: muqova sarlavhasi (uzun mavzu, «…») so'ralmaydi — yolg'iz bo'lsa chaqiruv ham yo'q", async () => {
  const topic = `${sent(12)} ${sent(4, 3)}`;
  assert.ok(topic.length >= 90, `asos: ${topic.length}`);
  const cover = { id: "c", layout: "title", title: clipTo(topic, SLIDE_LIMITS.title), subtitle: "Ma’ruza" } as SlideModel;
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, title: sent(5) }] }),
    async (calls) => {
      const out = await repairThinSlides([cover], meta, tpl, {}, later(), later());
      assert.equal(calls.length, 0, "muqova uchun ta'mir chaqiruvi");
      assert.equal(out[0], cover);
    },
  );
  const input = [cover, ...deck().slice(1)];
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, title: sent(5) }, ...good.slides] }),
    async (calls) => {
      const out = await repairThinSlides(input, meta, tpl, {}, later(), later());
      assert.doesNotMatch(calls[0].user, /index=0 /);
      assert.equal(out[0], cover, "muqova sarlavhasi almashdi");
    },
  );
});

test("P14c-A C5: 1–4 sinf circle blok ustuni 2+1 — o'ng (1 band) 110 qutisida, 60 da emas", async () => {
  const k = extractMeta(TOOL_BY_ID["pro-slide"], { topic: "Suv", slideAudience: "school_1_4" } as never);
  const kt = resolveSlideTemplate("lesson", k.topic);
  const kr = bodyRules(k, kt.id);
  const cap1 = clipLimit("colItem", kr, kt.visual, 1, undefined, NO_IMAGE);
  const cap2 = clipLimit("colItem", kr, kt.visual, 2, undefined, NO_IMAGE);
  assert.ok(kt.visual === "circle" && cap2 < cap1, `asos: ${cap2} < ${cap1}`);
  const slide = { id: "b", layout: "twoCol", title: "Ikki tomon", leftTitle: "A", rightTitle: "B", left: [upTo(cap2 - 10), upTo(cap2 - 10, 3)], right: [clipTo(sent(40, 2), cap1)] } as SlideModel;
  assert.deepEqual(reasonsOf(slide, kr, kt.visual), ["clipped-text"]);
  const fixed = upTo(cap1 - 10, 5);
  assert.ok(fixed.length > cap2, `asos: ${fixed.length} > ${cap2}`);
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, left: slide.left, right: [fixed] }] }),
    async () => {
      const [out] = await repairThinSlides([slide], k, kt, {}, later(), later());
      assert.deepEqual(out.right, [fixed], "o'ng band ikkinchi tomon soni bilan qirqildi");
      assert.deepEqual(out.left, slide.left);
    },
  );
});

test("P14c-A C5: yupqa reja twoCol 3+2 javobi — har tomon O'Z sonidagi qutida (bold: 75 / 110)", async () => {
  const cap2 = clipLimit("colItem", rBold, "bold", 2, undefined, NO_IMAGE);
  const cap3 = clipLimit("colItem", rBold, "bold", 3, undefined, NO_IMAGE);
  assert.ok(cap3 < cap2, `asos: ${cap3} < ${cap2}`);
  const thin = S({ layout: "twoCol", leftTitle: "Eski", rightTitle: "Yangi", left: ["Bir."], right: ["Ikki."] });
  const left = [upTo(cap3 - 5), upTo(cap3 - 5, 3), upTo(cap3 - 5, 6)];
  const right = [upTo(cap2 - 8, 1), upTo(cap2 - 8, 4)];
  assert.ok(right.every((x) => x.length > cap3), "asos: o'ng bandlar 3 band qutisidan uzun");
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, left, right }] }),
    async () => {
      const [out] = await repairThinSlides([thin], m1011, tBold, {}, later(), later());
      assert.deepEqual(out.left, left);
      assert.deepEqual(out.right, right, "o'ng ustun chap ustun soni (3) qutisida qirqildi");
    },
  );
});

test("P14c-A C6: rad etilgan har slayd — indeks, maket va qolgan sabab bilan bitta qator", async () => {
  const cap3 = bulletClipLimit(rules, tpl.visual, 3);
  const input = [...deck(), { id: "g", layout: "bullets", title: "Dars maqsadlari", bullets: [sent(12), sent(12, 3), clipTo(sent(40), cap3)] } as SlideModel];
  const lines = await captureWarn(() =>
    withLlm(
      () =>
        jsonReply({
          slides: [
            { index: 1, bullets: ["Hali ham qisqa.", "Yana qisqa.", "Qisqa."] },
            { index: 2, subtitle: sent(22) },
            { index: 5, bullets: [sent(10)] },
          ],
        }),
      async () => {
        await repairThinSlides(input, meta, tpl, {}, later(), later());
      },
    ),
  );
  const rejected = lines.filter((l) => l.startsWith("[slide-quality] ta’mir rad etildi"));
  assert.equal(rejected.length, 3, lines.join("\n"));
  assert.ok(rejected.some((l) => /index=1 layout=bullets — qolgan sabablar: .*short-bullets/.test(l)), lines.join("\n"));
  assert.ok(rejected.some((l) => /index=4 layout=process — javobda yo‘q/.test(l)), lines.join("\n"));
  assert.ok(rejected.some((l) => /index=5 layout=bullets — javob yaroqsiz/.test(l)), lines.join("\n"));
  assert.ok(lines.some((l) => /ta’mir qabul qilindi 1 \/ 4/.test(l)), lines.join("\n"));
});

// ───── P14d-B (zaxira yaxlitlash, detektorsiz maydonlar, reja nomi)

import { structureLines } from "../lib/generation/slide-prompt/structure.ts";

const ALL_VISUALS_D = [...LEGACY_VISUALS, ...DESIGN_VISUALS];

/*
 * P14d N2 — `slackMin` YAXLITLAYDI: ⌊0.75 × 5⌋ = 3 edi — 5 so'zlik quti (1–4 sinf `rail` bosqichi,
 * `circle` 2 bandli ustuni) 3 so'zli matnni qabul qilar va promptda «3–5» so'rardi.
 * HALOL INVARIANT: ≥ 5 so'zlik quti (ya'ni oraliq `max ≥ 5`) hech qachon ZAXIRA tufayli 4 dan past
 * quyi chegara bermaydi — prompt ham (band, ustun bandi, har bosqich soni), detektor ham (ustun bandi har
 * `COL_MIN_ITEMS..maxColItems` sonda, bosqich har sonda). Istisno — auditoriya POLI o'zi < 4:
 * 1–4 sinf «qisqa» `bulletMinWords` = ⌊0.55 × 58 / 8⌋ = 3 (P14c dan oldin ham «3–5») — bu zaxira emas,
 * shuning uchun band uchun chegara `min(4, bulletMinWords)`.
 * MUTATSIYA: `Math.round` → `Math.floor` — qizaradi.
 */
test("P14d-B N2: ≥ 5 so'zlik quti zaxira bilan ham 4 dan past chegara bermaydi (har auditoriya × hajm × shablon × vizual)", () => {
  const bad: string[] = [];
  for (const aud of SLIDE_AUDIENCES) {
    for (const vol of ["qisqa", "standart", "kop"] as const) {
      for (const tplId of ["lecture", "lesson"] as const) {
        const r = bodyRules({ slideAudience: aud, textVolume: vol, planItems: 5 }, tplId);
        for (const visual of ALL_VISUALS_D) {
          const t = layoutWordTargets(r, visual);
          const at = `${aud}/${vol}/${tplId}/${visual}`;
          const floor4 = (name: string, w: { min: number; max: number }, low: number, lim = 4) => {
            if (w.max >= 5 && low < lim) bad.push(`${at} ${name}: «${fmtRange(w)}», chegara ${low}`);
          };
          floor4("bullet", t.bullet, t.bullet.min, Math.min(4, bulletMinWords(r)));
          floor4(`colItem×${t.maxColItems}`, t.colItem, t.colItem.min);
          for (let n = COL_MIN_ITEMS; n <= t.maxColItems; n += 1) floor4(`colItem det×${n}`, t.colItem, colMinWords(r, visual, n));
          for (const [k, w] of Object.entries(t.stepTextBy)) {
            floor4(`stepText×${k}`, w, w.min);
            floor4(`stepText det×${k}`, w, stepMinWords(r, visual, Number(k)));
          }
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 12), [], `${bad.length} ta 4 dan past chegara`);
});

test("P14d-B N2: aniq raqamlar — 1–4 sinf lesson rail/circle, 5–7 sinf lesson circle, bakalavr lecture academic", () => {
  const rulesOf = (aud: string, tplId: "lesson" | "lecture") => {
    const m = extractMeta(TOOL_BY_ID["pro-slide"], { topic: "Orol dengizi fojiasi", slideAudience: aud } as never);
    const tp = resolveSlideTemplate(tplId, m.topic);
    return { r: bodyRules(m, tp.id), visual: tp.visual };
  };
  const g14 = rulesOf("school_1_4", "lesson");
  assert.equal(g14.visual, "circle", "sinov asosi: 1–4 sinf lesson — circle");
  const c14 = layoutWordTargets(g14.r, "circle");
  assert.deepEqual(c14.bullet, { min: 4, max: 5 }, "1–4 circle band: «3–5» emas");
  assert.equal(c14.maxColItems, 2);
  assert.deepEqual(c14.colItem, { min: 4, max: 5 }, "1–4 circle 2 bandli ustun: «3–5» emas");
  assert.equal(colMinWords(g14.r, "circle", 2), 4);
  const rail = layoutWordTargets(g14.r, "rail");
  assert.deepEqual(rail.stepTextBy[3], { min: 4, max: 5 }, "1–4 rail 3 bosqich: «3–5» emas");
  assert.equal(stepMinWords(g14.r, "rail", 3), 4);
  // 3 so'zli bosqich endi yupqa (ilgari o'tardi).
  const steps = (w: number) => Array.from({ length: 3 }, (_, i) => ({ n: String(i + 1), title: "Bosqich", text: sent(w, i * 2) }));
  assert.ok(reasonsOf(S({ layout: "process", steps: steps(3) }), g14.r, "rail").includes("short-steps"));
  assert.deepEqual(reasonsOf(S({ layout: "process", steps: steps(4) }), g14.r, "rail"), []);
  const g57 = rulesOf("school_5_7", "lesson");
  assert.equal(g57.visual, "circle");
  const t57 = layoutWordTargets(g57.r, "circle");
  assert.deepEqual(t57.bullet, { min: 5, max: 6 });
  assert.deepEqual(t57.colItem, { min: 6, max: 8 });
  assert.deepEqual(t57.stepTextBy, { 3: { min: 6, max: 8 } });
  const ba = rulesOf("students_bachelor", "lecture");
  assert.equal(ba.visual, "academic");
  const tba = layoutWordTargets(ba.r, "academic");
  assert.deepEqual(tba.bullet, { min: 9, max: 12 });
  assert.deepEqual(tba.colItem, { min: 6, max: 10 });
  assert.deepEqual(tba.stepTextBy, { 3: { min: 8, max: 13 }, 4: { min: 8, max: 10 } });
});

/*
 * P14d N4 — zaxira faqat `slackMin` li detektori bor maydonda (ustun bandi, bosqich). Iqtibosning detektori
 * yo'q (`QUOTE_MIN_WORDS` — prompt poli), section subtitle detektori `slackMin` siz (< 6 — «empty-subtitle»):
 * ularda zaxira faqat prompt polini tushirardi (magazine/bold iqtibosi «10» → «7–10»).
 * MUTATSIYA: `range` da zaxira hamma maydonga (detFloor = floor) — qizaradi.
 */
test("P14d-B N4: iqtibos va section subtitle — quti polni ko'tarsa, prompt min poldan past emas (har auditoriya × hajm × vizual)", () => {
  const bad: string[] = [];
  for (const aud of SLIDE_AUDIENCES) {
    for (const vol of ["qisqa", "standart", "kop"] as const) {
      for (const tplId of ["lecture", "lesson"] as const) {
        const r = bodyRules({ slideAudience: aud, textVolume: vol, planItems: 5 }, tplId);
        for (const visual of ALL_VISUALS_D) {
          const t = layoutWordTargets(r, visual);
          const at = `${aud}/${vol}/${tplId}/${visual}`;
          if (t.quote.min < Math.min(QUOTE_MIN_WORDS, t.quote.max)) bad.push(`${at} quote «${fmtRange(t.quote)}»`);
          if (t.sectionSubtitle.min < Math.min(SECTION_SUBTITLE_MIN_WORDS, t.sectionSubtitle.max)) bad.push(`${at} section «${fmtRange(t.sectionSubtitle)}»`);
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 12), [], `${bad.length} ta`);
  // Jonli ko'rinish: bakalavr magazine/bold iqtibosi yana «10»/«9» (P14c: «7–10»/«6–9»).
  for (const visual of ["magazine", "bold"] as const) {
    const q = layoutWordTargets(bachelor, visual).quote;
    assert.ok(q.min >= QUOTE_MIN_WORDS && q.min === q.max, `${visual}: «${fmtRange(q)}»`);
  }
});

/*
 * P14d N3 — agenda yo'q dekada reja bandi nomi «3–7 so'z» edi: 7 × 9 = 63 > `TITLE_CHARS` (61), reja
 * sarlavhasi esa hech qachon ta'mirlanmaydi (`clippedFields`) — kesilgani qoladi. Endi yuqori chegara
 * `TITLE_WORDS.max`. MUTATSIYA: «3–7» qaytarilsa — qizaradi.
 */
test("P14d-B N3: agenda yo'q — reja bandi nomi 3–TITLE_WORDS.max so'z (umumiy sarlavha qopqog'ida)", () => {
  const pro = TOOL_BY_ID["pro-slide"];
  const tpl = resolveSlideTemplate("lecture", "Orol dengizi");
  const line = (agendaSlide: boolean) => {
    const meta = extractMeta(pro, { topic: "Orol dengizi", blocks: "reja", planItems: 5, agendaSlide } as never);
    return structureLines(meta, tpl, {}).find((l) => l.startsWith("REJA BANDLARI:")) ?? "";
  };
  const off = line(false);
  assert.doesNotMatch(off, /agenda bandlari AYNAN/, "sinov asosi: agenda yo'q");
  const m = off.match(/band nomini mavzudan o‘zingiz tuzing \((\d+)(?:–(\d+))? so‘z\)/);
  assert.ok(m, off);
  const hi = Number(m[2] ?? m[1]);
  assert.equal(Number(m[1]), 3);
  assert.equal(hi, TITLE_WORDS.max, `«${m[0]}»`);
  assert.ok(hi * CHARS_PER_WORD <= TITLE_CHARS, `${hi} so'z × ${CHARS_PER_WORD} > ${TITLE_CHARS}`);
  // Agenda bor — oraliq agenda qutisidan (o'zgarmagan).
  assert.match(line(true), /agenda bandlari AYNAN/);
});
// ───── P14d-A (ta'mir prompti va merge qoldiqlari)
/*
 * AUDIT-25 P14c sharhi N1/N5/N6:
 *   — N1: «son va tartib o‘zgarmasin» qulfi faqat FAQAT kesilgan slaydga — yupqa (+kesilgan) slayd
 *     ro'yxatni butunlay qayta yozadi, unga qulf aytilmaydi;
 *   — N5: kesilgan band/bosqich o'rniga kamida min(asl, ⌈0.5 · qopqoq⌉) belgili matn — «Ha.» rad;
 *   — N6: muqova filtri o'lik edi — olib tashlandi (C2 testi `clippedFields` qo'riqchisiga tayanadi).
 */

test("P14d-A N1: yupqa + kesilgan slayd — «son va tartib» qulfi yo'q, chuqurlashtirish bor; yupqa deka ham qulfsiz", async () => {
  const cap3 = bulletClipLimit(rules, tpl.visual, 3);
  const slide = S({ layout: "bullets", bullets: ["Bir.", "Ikki.", clipTo(sent(40), cap3)] });
  assert.deepEqual(reasonsOf(slide, rules, tpl.visual), ["clipped-text", "short-bullets"]);
  await withLlm(
    () => jsonReply({ slides: [] }),
    async (calls) => {
      await repairThinSlides([slide], meta, tpl, {}, later(), later());
      assert.doesNotMatch(calls[0].user, /SONI va TARTIBI/);
      assert.doesNotMatch(calls[0].user, /so‘zma-so‘z/);
      assert.match(calls[0].user, /kamchilik: matn kesilgan .*kesilgan bandni ham qutiga sig‘adigan qilib yozing: har band ≤ \d+ so‘z/);
      assert.match(calls[0].user, /bandlar juda qisqa/);
      assert.doesNotMatch(calls[0].system, /o‘sha son va tartib/);
      assert.match(calls[0].system, /YUPQA slaydda .*chuqurlashtiring/);
    },
  );
  // Kesilgansiz yupqa deka — tizim promptida ham qulf yo'q.
  await withLlm(
    () => jsonReply(good),
    async (calls) => {
      await repairThinSlides(deck(), meta, tpl, {}, later(), later());
      assert.doesNotMatch(calls[0].system, /o‘sha son va tartib/);
      assert.doesNotMatch(calls[0].user, /SONI va TARTIBI/);
      assert.match(calls[0].system, /chuqurlashtiring/);
    },
  );
});

test("P14d-A N1: faqat kesilgan slayd — qulf (tizim + sabab qatori) bor, chuqurlashtirish yo'q; aralash dekada har slaydga o'zi", async () => {
  const cap3 = bulletClipLimit(rules, tpl.visual, 3);
  const goals = { id: "g", layout: "bullets", title: "Dars maqsadlari", bullets: [sent(12), sent(12, 3), clipTo(sent(40), cap3)] } as SlideModel;
  assert.deepEqual(reasonsOf(goals, rules, tpl.visual), ["clipped-text"]);
  await withLlm(
    () => jsonReply({ slides: [] }),
    async (calls) => {
      await repairThinSlides([goals], meta, tpl, {}, later(), later());
      assert.match(calls[0].system, /FAQAT kesilgan slaydda tegilmagan \(kesilmagan\) bandlarni so‘zma-so‘z, o‘sha son va tartibda qaytaring/);
      assert.match(calls[0].user, /FAQAT shu maydonlarni ma’nosini saqlab QISQARTIRING: .*SONI va TARTIBI o‘zgarmasin/);
      assert.doesNotMatch(calls[0].system, /chuqurlashtiring/);
      assert.doesNotMatch(calls[0].user, /qutiga sig‘adigan qilib yozing/);
    },
  );
  // Aralash deka: 0 — faqat kesilgan (qulf), 1 — yupqa + kesilgan (qulfsiz).
  const mixed = S({ layout: "bullets", bullets: ["Bir.", "Ikki.", clipTo(sent(40, 2), cap3)] });
  await withLlm(
    () => jsonReply({ slides: [] }),
    async (calls) => {
      await repairThinSlides([goals, mixed], meta, tpl, {}, later(), later());
      const [, block0, block1] = calls[0].user.split(/\n\n(?=index=)/);
      assert.ok(block0?.startsWith("index=0") && block1?.startsWith("index=1"), calls[0].user);
      assert.match(block0, /SONI va TARTIBI o‘zgarmasin/);
      assert.doesNotMatch(block1, /SONI va TARTIBI/);
      assert.match(calls[0].system, /o‘sha son va tartib/);
      assert.match(calls[0].system, /chuqurlashtiring/);
    },
  );
});

test("P14d-A N5: kesilgan band o'rniga juda qisqa matn («Ha.») — RAD; chegara ⌈0.5 · so'z maqsadi max⌉ so'z", async () => {
  const cap3 = bulletClipLimit(rules, tpl.visual, 3);
  const cut = clipTo(sent(40), cap3);
  const goals = { id: "g", layout: "bullets", title: "Dars maqsadlari", bullets: [sent(12), sent(12, 3), cut] } as SlideModel;
  const need = Math.ceil(0.5 * layoutWordTargets(rules, tpl.visual).bullet.max);
  assert.ok(cut.length >= 80 && cut.split(" ").length - 1 > need, `asos: ${cut.length} belgi, chegara ${need} so'z`);
  const reply = (third: string) => () => jsonReply({ slides: [{ index: 0, bullets: [goals.bullets![0], goals.bullets![1], third] }] });
  await withLlm(reply("Ha."), async () => assert.equal((await repairThinSlides([goals], meta, tpl, {}, later(), later()))[0], goals, "3 belgili band qabul qilindi"));
  await withLlm(reply(sent(need - 1, 4)), async () => assert.equal((await repairThinSlides([goals], meta, tpl, {}, later(), later()))[0], goals, "chegaradan 1 so'z kam — qabul qilindi"));
  await withLlm(reply(sent(need, 4)), async () => {
    const [out] = await repairThinSlides([goals], meta, tpl, {}, later(), later());
    assert.deepEqual(out.bullets, [goals.bullets![0], goals.bullets![1], sent(need, 4)], "chegaradagi band rad etildi");
  });
  // Prompt oralig'idagi eng qisqa javob (min so'z) — qabul (belgi qoidasi ⌈0.5 · 165⌉ uni rad etardi).
  const minBullet = sent(layoutWordTargets(rules, tpl.visual).bullet.min, 2);
  assert.ok(minBullet.length < Math.ceil(0.5 * cap3), `asos: ${minBullet.length} < ${Math.ceil(0.5 * cap3)}`);
  await withLlm(reply(minBullet), async () => assert.equal((await repairThinSlides([goals], meta, tpl, {}, later(), later()))[0].bullets![2], minBullet));
});

test("P14d-A N5: process va ustun — kesilgan bosqich/band o'rniga qisqa matn RAD", async () => {
  const stepCap = clipLimit("stepText", rules, tpl.visual, 3, undefined, NO_IMAGE);
  const proc = S({
    layout: "process",
    steps: [1, 2, 3].map((n) => ({ n: String(n), title: `Bosqich ${n}`, text: n === 2 ? clipTo(sent(40, 4), stepCap) : sent(9, n) })),
  });
  assert.deepEqual(reasonsOf(proc, rules, tpl.visual), ["clipped-text"]);
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, steps: proc.steps!.map((st, i) => ({ ...st, text: i === 1 ? "Ha." : st.text })) }] }),
    async () => assert.equal((await repairThinSlides([proc], meta, tpl, {}, later(), later()))[0], proc),
  );
  const cap2 = clipLimit("colItem", rBold, "bold", 2, undefined, NO_IMAGE);
  const col = S({ layout: "twoCol", leftTitle: "Eski", rightTitle: "Yangi", left: [upTo(60), upTo(60, 3), upTo(60, 6)], right: [upTo(90, 1), clipTo(sent(40, 2), cap2)] });
  assert.deepEqual(reasonsOf(col, rBold, "bold"), ["clipped-text"]);
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, right: [col.right![0], "Yo‘q."] }] }),
    async () => assert.equal((await repairThinSlides([col], m1011, tBold, {}, later(), later()))[0], col),
  );
});

test("P14d-A N6: muqova hech qachon nomzod emas — kesilgan muqova sarlavhasi sababsiz (filtrsiz ham chaqiruv yo'q)", async () => {
  const cover = { id: "c", layout: "title", title: clipTo(`${sent(12)} ${sent(4, 3)}`, SLIDE_LIMITS.title), subtitle: "Ma’ruza" } as SlideModel;
  assert.ok(cover.title.endsWith("…"), "asos: sarlavha kesilgan");
  assert.deepEqual(reasonsOf(cover, rules, tpl.visual), []);
  await withLlm(
    () => jsonReply({ slides: [{ index: 0, title: sent(5) }] }),
    async (calls) => {
      assert.equal((await repairThinSlides([cover], meta, tpl, {}, later(), later()))[0], cover);
      assert.equal(calls.length, 0);
    },
  );
});
