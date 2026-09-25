import { safeSlice } from "./safe-text";
import type { BodyRules } from "./slide-audience";
/*
 * AUDIT-25 P11: o'lchov (`fitChars`) shu faylda — `planSlide` ni o'qiydi.
 * `slide-layout.ts` va uning bog'liqliklari KLIENT uchun xavfsiz (ko'ruvchi
 * `SlideCanvas` ham shuni chizadi); `llm.ts`/`server-only` ga yo'l yo'q.
 * Sikl bor: `slide-layout` → `slide-layout-extra` → `slide-quiz` → shu fayl.
 * Shuning uchun bu fayl modul darajasida `slide-layout` bog'lamalarini
 * O'QIMAYDI — faqat funksiya ichida (`probeLayers`, `layerFits`), tema va
 * vizual ro'yxati ham dangasa (`probeTheme`, `allVisuals`).
 */
import { CHAR_EM, LAYOUT_KIT, planSlide, type SlideLayer } from "./slide-layout";
import type { SlideVisual } from "./slide-templates";
import { getSlideTheme } from "./slide-themes";
import type { SlideModel, SlideSrc, SlideStep } from "./slide-types";
import { DESIGN_VISUALS, LEGACY_VISUALS } from "./visuals/spec";
/**
 * Slayd matn chegaralari — YAGONA jadval.
 *
 * Bu fayl ATAYLAB bog'liqliksiz: uni ham dvigatel (`normalizeSlide`,
 * server tomonida), ham ko'ruvchidagi tahrir mantig'i (`slide-edit.ts`,
 * klient bundle'da) import qiladi. Shuning uchun bu yerda `llm.ts`,
 * `server-only` yoki React ga olib boradigan bironta import bo'lmasin.
 *
 * Raqamlar MAKETDAN o'lchangan (`slide-layout.ts` qutilari va
 * `fitSize`/`fitLines` pollari) — promptdagi so'z sonidan emas. O'lchov
 * izohlari `slide-write.ts` dagi asl joylarida qoldirilgan; bu yerda
 * faqat qiymat turadi, chunki endi ikki joyda ikki nusxa emas, bitta
 * manba bo'lishi kerak: tahrirda qirqilgan matn PPTX da ham aynan shu
 * chegara bilan chizilishi shart («ko'rdim = oldim»).
 *
 * ── AUDIT-25 O'LCHOVI (2026-09-24) ─────────────────────────────────────
 *
 * Har qirqiladigan KO'RINADIGAN maydon `planSlide` orqali o'lchandi
 * (`fitChars`, `slide-quality.ts`; P2 `c7a1c82` maketi — process/stats/
 * table ham auditoriya POLIDA, A2-04): 17 vizual, har vizualda rasmsiz
 * VA rasm tasmasi bilan holatning kichigi, real o'zbekcha so'zlar (so'z
 * bo'yicha qatorlash). Katak = pol shriftida sig'adigan belgi,
 * «eng tor / 17 vizual medianasi». Pol (minPt): 15 talaba/pedagog,
 * 16 rahbariyat/umumiy/kattalar, 18 10–11 sinf/o'smir/keng, 20 8–9 sinf,
 * 22 5–7 sinf/bolalar markazi, 24 1–4 sinf.
 *
 *   (process/stats/table son bo'yicha aniq jadvali — `COUNT_LIMITS` pastda)
 *   maydon        qopqoq   15pt      16pt      18pt      20pt      22pt      24pt     qaror
 *   title          80→72   72/139    72/139    72/139    72/139    72/139    72/139   72 (rasmli section, classic);
 *                          P2 dan keyin qalin o'lchovda bo'lim sarlavhasi circle 16/editorial 24 — P2 ga
 *   kicker            40   42/72     42/72     42/72     42/72     42/72     42/72    qoldi
 *   bullets ×max  bulletChars 135/234  97/222  85/135   60/173    60/152    24/111   auditoriya jadvali; `cards` — P2
 *   colTitle       40→24   16/24     16/24     16/24     16/24     16/24     16/24    24 (mediana)
 *   colItem ×3    120→110  75/165    53/165    53/165    42/165    24/165    16/165   ┐ 110 (×4 mediana);
 *   colItem ×4    120→110  36/111    36/111    36/111    36/111    24/111    16/111   ┘ aniq — clipLimit (vizual)
 *   stepText ×3      160   53/139    36/121    36/85     24/53     24/36     24/36    ┐ 160 qoldi (slide-chart
 *   stepText ×4      160   24/111    24/85     24/60     16/42     16/36     16/36    │ testi ≥135); aniq —
 *   stepText ×5      160   24/72     16/42     16/36     4/16      4/4       4/4      ┘ limitsFor + maxSteps
 *   stepTitle ×4/5    40   24/53     24/53     16/24     4/24      4/16      4/16     qoldi; limitsFor
 *   statLabel ×2     110   129/234   111/222   85/165    75/129    72/97     42/85    ┐ 110 qoldi; aniq —
 *   statLabel ×4     110   42/85     42/60     24/53     24/53     24/24     16/16    ┘ limitsFor + maxStats
 *   tableCell ×3      60   53/53     53/53     24/24     24/24     16/16     16/16    ┐ 60 qoldi (tahrir);
 *   tableCell ×5      60   24/24     24/24     4/4       4/4       4/4       4/4      ┘ limitsFor + maxTableCols
 *   tableHeader 3/5 40/26  36 / 16   36 / 16   16 / 4    16 / 4    4 / 4     4 / 4    qoldi; limitsFor
 *   subtitleSection 300→250 258/383 (hamma pol — shrift qat'iy)                      250
 *   subtitleClosing 160→135 139/339 (hamma pol)                                       135 (A4: defense-14 kesilgan)
 *   quote        220→280   383/383 (hamma pol)                                       280 (prompt 30 so'zgacha)
 *   quoteBy       60→50    53/85   (hamma pol)                                       50 + prompt «faqat muallif»
 *   quizQ        120→100   104/121 (qalin, P2 dan keyin; hamma pol)                  100
 *   quizOption    60→130   129/195   85/185    75/121    53/111    53/75     24/60    130 (15 pt eng tor); aniq — clipLimit (vizual)
 *   refTitle / refSource 90 / 200 — 241 / 673, `planReferences` o'zi qisqartiradi     qoldi
 *
 * QAROR QOIDASI — uch qatlam:
 *  (1) `SLIDE_LIMITS` — STATIK qopqoq: eng past pol (15 pt) da eng tor
 *      holat tipikdan uzoq bo'lmasa — shu sig'im, aks holda TIPIK vizual
 *      (mediana). Hech qachon oshib ketmaydigan yuqori chegara.
 *  (2) `limitsFor(rules, {steps, stats, cols, rows})` — auditoriya POLI ×
 *      element SONI jadvali (P2 o'lchovi × 0.88) soni o'zgaruvchi
 *      maydonlar uchun (bosqich, karta, jadval), va son chegaralari
 *      (`countRules`: yosh auditoriyaga kam bosqich/karta/ustun). Klient
 *      uchun xavfsiz: `normalizeSlide` (P1) VA `slide-edit.ts` shuni
 *      chaqiradi.
 *  (3) `clipLimit(field, rules, visual, count)` (`slide-quality.ts`,
 *      server) — generatsiyada deka VIZUALI va rasm tasmasi bilan jonli
 *      o'lchov; (2) dan hech qachon oshmaydi.
 * «Qirqmasdan fitSize» varianti YO'Q: `fitSize` pol ostiga tushmaydi,
 * sig'magan matn qutidan chiqadi. Maket avval polgacha kichraytiradi,
 * keyin ortig'i SO'Z CHEGARASIDA (`clipTo`) qirqiladi. Qirqish kamdan-kam
 * bo'lsin: prompt aynan shu sig'imdan so'z oralig'i va ELEMENT SONI
 * oladi (`layoutWordTargets`, `brief.ts`).
 *
 * SIG'MAYDIGAN KOMBINATSIYALAR (prompt maqsadiga aylandi, qolgani P2):
 * 20–24 pt da process kartasi 3 bosqichda ham 6 so'z ko'tarmaydi
 * (mediana 36–53 belgi), 4–5 bosqich 1–2 so'z; 18–24 pt da 5 ustunli
 * jadval katagiga bitta so'z sig'maydi, 3 ustunda ~2 so'z; 22–24 pt da
 * 4 karta stats yorlig'i ~2 so'z; `cards` 1–4 sinf bandi/test varianti
 * 24 belgi; `rail`/`dashboard`/`circle`/`split` ustun va bosqich qutilari
 * — mediana yaxshi, eng tor holatlar P2 da.
 */
export const SLIDE_LIMITS = {
  /**
   * Har maketda sarlavha. Tahrirda bo'sh qoldirib bo'lmaydi. 80 da
   * rasmli `section`/`title` (classic) pol shriftida chiqib ketardi (72/75).
   */
  title: 72,
  /** Sarlavha ustidagi mayda yorliq. */
  kicker: 40,
  /** Standart maketlar uchun izoh matni. */
  subtitle: 140,
  /**
   * `section` subtitle. AUDIT-25 o'lchovi (`fitChars("subtitleSection")`,
   * 17 vizual, real o'zbekcha so'zlar): eng tor — `story`, ~258 belgi.
   * 300 da `story` bo'lim slaydi qutidan chiqardi; 250 hamma vizualga
   * sig'adi va promptdagi «≤ 27 so'z» (250 / 9) ni kesmaydi.
   */
  subtitleSection: 250,
  /**
   * `closing` subtitle. Eski izoh «8.95 × 0.85", 16 pt → ~160» edi, lekin
   * qayta o'lchovda `classic` pol shriftida 139 belgi ko'taradi; jonli
   * `defense-14` da yakun matni so'z o'rtasidan kesilgan (A4). 135.
   */
  subtitleClosing: 135,
  /**
   * `twoCol`/`compare` ustun sarlavhasi. Median quti ~36 belgi, rasmli
   * `circle`/`split` da 16, p25 24 — qopqoq 24 («Afzalliklar»,
   * «Zamonaviy yondashuv» sig'adi).
   */
  colTitle: 24,
  /**
   * Ustundagi bitta band. Eski «4 × 120 → 16 pt» faqat `classic`
   * rasmsiz edi; rasm tasmasi bilan 4 bandli ustun tipik holda (p25)
   * ~111 belgi ko'taradi. Jonli `lecture-12` da 6 bandning 5 tasi
   * so'z o'rtasidan kesilgan: prompt «10–15 so'z» (~135) so'rardi.
   * Endi 110 + prompt oralig'i maketdan (`layoutWordTargets.colItem`).
   * P2 dan keyin (pol shriftida, rasm bilan): 3 bandli ustun mediana 111,
   * 4 bandli — 60; 4 bandda aniq qirqish `clipLimit("colItem", …, 4)`.
   */
  colItem: 110,
  /** Bitta ustunda eng ko'p band. */
  colItems: 4,
  /**
   * Iqtibos matni. AUDIT-25 o'lchovi: eng tor quti (`magazine`) ~383
   * belgi ko'taradi. 220 promptdagi «12–30 so'z» ning yuqori qismini
   * «…» bilan kesardi; 280 = 31 so'z, har vizualga sig'adi.
   */
  quote: 280,
  /**
   * Iqtibos muallifi — bitta qator, shrift o'zgarmaydi: `notebook` 53
   * belgi. Jonli dekada «Adam Smit — Shotlandiyalik faylasuf va
   * iqtisodchi olim, zam…» — model tavsif yozgan; prompt endi «faqat
   * muallif» deydi, qopqoq 50.
   */
  quoteBy: 50,
  /** `stats` katta raqami. */
  statValue: 24,
  /**
   * Yorliq — STATIK qopqoq (talaba poli 15 pt da 2–3 karta medianasi
   * ≥ 111). P2 A2-04 dan keyin yorliq auditoriya polida: 1–4 sinf 4
   * karta ~16 belgi — model matni `clipLimit("statLabel", …, count)`
   * bilan qirqiladi, prompt esa `maxStats` kartadan ko'p so'ramaydi.
   */
  statLabel: 110,
  /** `stats` kartalari soni. */
  statsMax: 4,
  /** Bosqich raqami («1», «I», «01»). */
  stepN: 8,
  /** Bosqich sarlavhasi. */
  stepTitle: 40,
  /**
   * Bosqich matni — STATIK qopqoq 160 QOLDI (bir qatorli rasmsiz karta
   * 11 pt da ~255; `tests/slide-chart.test.mts` ≥ 135 ni qulflaydi).
   * Lekin rasm tasmasi bilan 4–5 bosqich IKKI qatorga tushadi (A1-01):
   * talaba polida 4 bosqich mediana ~111, 5 bosqich ~72, maktab polida
   * 4–36 belgi (jadval yuqorida). Model matni `clipLimit("stepText", …,
   * steps.length)` bilan qirqiladi, prompt `maxSteps` va so'z oralig'ini
   * shu sig'imdan oladi.
   */
  stepText: 160,
  /** `process` bosqichlari soni. */
  stepsMax: 5,
  /** Jadval sarlavhasi — ustun soni ≤3 bo'lganda (keng ustun). */
  tableHeaderWide: 40,
  /** Jadval sarlavhasi — 4+ ustun (tor ustun). */
  tableHeader: 26,
  /** Model javobidagi xom sarlavha (keyin ustun soniga qarab qisqaradi). */
  tableHeaderRaw: 60,
  /**
   * Jadval katagi — STATIK qopqoq (tahrir). Model matni
   * `clipLimit("tableCell", …, cols)` bilan: 3 ustun talaba polida ~53,
   * 18–24 pt da 16–24 — prompt `maxTableCols` dan ko'p ustun so'ramaydi.
   */
  tableCell: 60,
  /** Jadval ustunlari soni. */
  tableCols: 5,
  /** Jadval qatorlari soni. */
  tableRows: 6,
  /**
   * Test savoli — QALIN. P2 birlashgandan keyin qalin shrift kengligi
   * (`CHAR_EM_BOLD` 0.60) bilan qayta o'lchandi: eng tor `classic`/`lab`/
   * `academic`/`notebook` ~104 belgi, mediana 121 (oddiy 0.55 bilan
   * 290 ko'ringan edi — noto'g'ri). 100 ≈ 11 so'z, hamma vizualga sig'adi.
   */
  quizQ: 100,
  /**
   * Test varianti — QIRQISH qopqog'i, maket o'lchovidan.
   *
   * Jonli dekada variantlar «…me'yor…» bilan kesilgan chiqdi: 60 belgi
   * (~6 so'z) to'liq javobga yetmasdi. Variant qutisi shriftni AUDITORIYA
   * oralig'ida (`bodyPt` → `minPt`) siqadi, ya'ni sig'im auditoriyaga
   * bog'liq. O'lchov (`fitChars("quizOption")`, `planQuiz` ning 6 oilasi
   * + 10 dizayn vizuali, real so'zlar) — ENG TOR quti `cards` (5.34 ×
   * 0.81"; `circle`/`editorial` ham shu):
   *
   *   pol 15 pt (talaba, pedagog)   → 129 belgi
   *   pol 16 pt (rahbariyat, umumiy) →  85
   *   pol 18 pt (10–11 sinf)        →  75
   *   pol 20–22 pt (5–9 sinf)       →  53
   *   pol 24 pt (1–4 sinf)          →  24
   *
   * `fitSize` pol ostiga tushmaydi, shuning uchun «kesmasdan shriftni
   * kichraytirish» varianti o'qiladigan matn bermaydi — sig'magan matn
   * qutidan chiqadi. Tanlov: qopqoq = eng past poldagi eng tor quti
   * sig'imi (130), aniq auditoriya hajmini esa prompt beradi («≤ N so'z»,
   * `layoutWordTargets`), undan oshgan variantni `thinSlides`
   * «clipped-option» deb topib, ta'mirga yuboradi.
   */
  quizOption: 130,
  /** Variantlar soni — AYNAN shuncha (A/B/C/D kartalari). */
  quizOptions: 4,
  /** Deka bo'ylab savollar soni (formadagi `quizCount` chegarasi). */
  quizMax: 10,
  /** Manba nomi. */
  refTitle: 90,
  /** Manba havolasi — TO'LIQ saqlanadi, `planReferences` o'zi qisqartiradi. */
  refSource: 200,
  /** `references` bandlari soni. */
  refsMax: 6,
  /** `answers` slaydidagi bitta qator («1 — B»). */
  answersItem: 40,
  /** Rasm uchun ko'rsatma (rasm prompti manbasi). */
  imageHint: 180,
  /** Rasmning `alt` matni. */
  imageAlt: 180,
  /** Modeldan kelgan notiq izohi. */
  notes: 700,
  /**
   * Tahrirdagi notiq izohi — modelnikidan uzunroq: foydalanuvchi o'z
   * nutqini yozadi va uni PPTX «Speaker notes» maydoni ko'taradi.
   */
  notesEdit: 2000,
  /**
   * Dekadagi slaydlar soni — XAVFSIZLIK chegarasi, narx chegarasi EMAS.
   * Narx bo'yicha yuqori chegara `slide-params.ts` da (`SLIDE_MAX`) va
   * uni server qatlami qo'llaydi; bu yerda faqat «cheksiz o'smasin».
   */
  maxSlides: 60,
} as const;

export type SlideLimits = typeof SLIDE_LIMITS;

/**
 * Auditoriya POLI qatorlari (pt) — `limitsFor` jadvalining ustunlari.
 * Jadvalda yo'q pol keyingi KATTAroq (qattiqroq) qatorga tushadi.
 */
export const LIMIT_FLOORS = [15, 16, 18, 20, 22, 24] as const;

/**
 * Soni o'zgaruvchi maydonlar uchun qirqish chegarasi — pol × son.
 *
 * Manba (AUDIT-25, P2 maketi `d05550e` birlashtirilgandan keyin): har
 * katak = min(P2 o'lchovi, jonli `fitChars(…, {images: "none"})`) × 0.88
 * (qalin shrift kengligi taxmini optimistik — 12 % zaxira), 5 ga pastga
 * yaxlitlangan (kamida 5) va statik `SLIDE_LIMITS` qopqog'idan oshmaydi.
 * Jonli o'lchov P2 jadvalidan past chiqqan joylarda (tor kartada 10–11
 * harfli o'zbekcha so'z polda sig'maydi — «so'z butun» qoidasi) o'sha
 * olindi. Kalit — element soni: bosqich (3/4/5), karta (2/3/4); jadval —
 * ustun × qator (`countRules` ruxsat bergan 3×3, 3×4, 4×4, 4×5 va eski/
 * tahrir uchun 5×6). `tests/slide-quality.test.mts` jadvalni jonli
 * o'lchovga qarshi qulflaydi — P2 qutini o'zgartirsa, eskirgan katak chiqadi.
 *
 * 5 ga teng kataklar — shu pol × son sig'maydi: bunday son shu
 * auditoriyaga ruxsat etilmaydi (`countRules`), `normalizeSlide` AVVAL
 * sonni qisadi (P1 W3).
 *
 *   maydon ×son       15pt 16pt 18pt 20pt 22pt 24pt
 */
const COUNT_LIMITS = {
  stepText: {
    3: [90, 75, 65, 45, 40, 40],
    4: [55, 55, 30, 30, 20, 5],
    5: [30, 30, 5, 5, 5, 5],
  },
  stepTitle: {
    3: [40, 40, 30, 20, 20, 10],
    4: [35, 30, 20, 10, 5, 5],
    5: [20, 5, 5, 5, 5, 5],
  },
  statLabel: {
    2: [110, 110, 110, 95, 95, 65],
    3: [110, 95, 65, 65, 45, 35],
    4: [70, 65, 40, 30, 30, 20],
  },
  tableCell: {
    "3x3": [60, 60, 60, 45, 45, 40],
    "3x4": [60, 60, 50, 45, 30, 30],
    "4x4": [60, 45, 35, 30, 10, 10],
    "4x5": [45, 45, 20, 20, 10, 10],
    "5x6": [20, 20, 10, 10, 5, 5],
  },
  tableHeader: {
    "3x3": [40, 40, 20, 10, 10, 10],
    "3x4": [40, 40, 20, 10, 10, 10],
    "4x4": [26, 26, 10, 10, 5, 5],
    "4x5": [26, 26, 10, 10, 5, 5],
    "5x6": [20, 20, 5, 5, 5, 5],
  },
  /** Test varianti — songa bog'liq emas (doim 4); eng tor quti `cards`/`circle`/`editorial`. */
  quizOption: [110, 70, 65, 45, 45, 20],
} as const;

/** O'lchangan jadval kombinatsiyalari — kichikdan kattaga. */
const TABLE_KEYS = [
  [3, 3, "3x3"],
  [3, 4, "3x4"],
  [4, 4, "4x4"],
  [4, 5, "4x5"],
  [5, 6, "5x6"],
] as const;
type TableKey = (typeof TABLE_KEYS)[number][2];

/** (ustun, qator) ni QAMRAYDIGAN eng kichik o'lchangan jadval — ikkalasi ham ≥; yo'q bo'lsa 5×6. */
export function tableKey(cols: number, rows: number): TableKey {
  for (const [c, r, key] of TABLE_KEYS) if (cols <= c && rows <= r) return key;
  return "5x6";
}

/** Slaydning element soni — `limitsFor` kaliti. Berilmasa — auditoriya ruxsat bergan eng katta son (qattiqroq). */
export type LimitCounts = { steps?: number; stats?: number; cols?: number; rows?: number };

/** Auditoriya × element soni bo'yicha chegaralar — `SLIDE_LIMITS` shakli, soni o'zgaruvchi maydonlar almashtirilgan. */
export type SlideLimitsFor = Omit<SlideLimits, "stepText" | "stepTitle" | "statLabel" | "tableCell" | "tableHeader" | "tableHeaderWide" | "stepsMax" | "statsMax" | "tableCols" | "tableRows" | "quizOption"> & {
  stepText: number;
  stepTitle: number;
  statLabel: number;
  tableCell: number;
  /** Shu (ustun × qator) dagi sarlavha — `tableHeaderWide` ham shu qiymat. */
  tableHeader: number;
  tableHeaderWide: number;
  /** Test varianti — auditoriya poli bo'yicha (tahrir ham shuni o'qisin). */
  quizOption: number;
  stepsMax: number;
  statsMax: number;
  tableCols: number;
  tableRows: number;
};

const clampKey = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/**
 * Auditoriya × element soni bo'yicha qirqish chegaralari — YAGONA
 * funksiya: `normalizeSlide` (P1, model javobi) VA `slide-edit.ts`
 * (ko'ruvchi tahriri) shuni chaqiradi, statik `SLIDE_LIMITS` o'rniga.
 *
 *   limitsFor(rules)                              — son berilmasa auditoriya maksimumi
 *   limitsFor(rules, { steps: s.steps.length })   — process
 *   limitsFor(rules, { stats: s.stats.length })   — stats
 *   limitsFor(rules, { cols, rows })              — table (qator ham kalitda)
 *
 * `stepsMax`/`statsMax`/`tableCols`/`tableRows` — auditoriya ruxsat
 * bergan son (`countRules`), statik qopqoqdan oshmaydi. `quizOption` —
 * pol bo'yicha. Qolgan maydonlar `SLIDE_LIMITS` bilan bir xil. Klient
 * uchun xavfsiz (bog'liqliksiz).
 */
export function limitsFor(
  rules: Pick<BodyRules, "minPt" | "stepsMax" | "statsMax" | "tableCols" | "tableRows">,
  counts: LimitCounts = {},
): SlideLimitsFor {
  let col = LIMIT_FLOORS.findIndex((f) => f >= rules.minPt);
  if (col < 0) col = LIMIT_FLOORS.length - 1;
  const stepsMax = Math.min(SLIDE_LIMITS.stepsMax, rules.stepsMax);
  const statsMax = Math.min(SLIDE_LIMITS.statsMax, rules.statsMax);
  const tableCols = Math.min(SLIDE_LIMITS.tableCols, rules.tableCols);
  const tableRows = Math.min(SLIDE_LIMITS.tableRows, rules.tableRows);
  const steps = clampKey(counts.steps ?? stepsMax, 3, 5) as 3 | 4 | 5;
  const stats = clampKey(counts.stats ?? statsMax, 2, 4) as 2 | 3 | 4;
  const cols = counts.cols ?? tableCols;
  const table = tableKey(cols, counts.rows ?? tableRows);
  const header = Math.min(COUNT_LIMITS.tableHeader[table][col], cols <= 3 ? SLIDE_LIMITS.tableHeaderWide : SLIDE_LIMITS.tableHeader);
  return {
    ...SLIDE_LIMITS,
    stepText: Math.min(SLIDE_LIMITS.stepText, COUNT_LIMITS.stepText[steps][col]),
    stepTitle: Math.min(SLIDE_LIMITS.stepTitle, COUNT_LIMITS.stepTitle[steps][col]),
    statLabel: Math.min(SLIDE_LIMITS.statLabel, COUNT_LIMITS.statLabel[stats][col]),
    tableCell: Math.min(SLIDE_LIMITS.tableCell, COUNT_LIMITS.tableCell[table][col]),
    tableHeader: header,
    tableHeaderWide: header,
    quizOption: Math.min(SLIDE_LIMITS.quizOption, COUNT_LIMITS.quizOption[col]),
    stepsMax,
    statsMax,
    tableCols,
    tableRows,
  };
}

/** Foydalanuvchi yuklaydigan slayd rasmi (PNG/JPEG) uchun yuqori chegara. */
export const SLIDE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Klientdagi bekor qilish (Ctrl+Z) stegi chuqurligi. */
export const UNDO_DEPTH = 100;

/** Oxirgi tahrirdan keyin PPTX qayta yasalgunicha kutish (ms). */
export const REBUILD_DEBOUNCE_MS = 3000;

/**
 * Qirqish SO'Z CHEGARASIDA bo'ladi, agar chegara shu ulushdan keyin
 * uchrasa. Undan oldin bo'lsa (bitta uzun so'z, URL) — qattiq kesiladi:
 * aks holda 110 belgilik joyga 20 belgi qolardi.
 */
export const CLIP_WORD_MIN_SHARE = 0.6;

/**
 * Matnni bitta qatorga keltirib chegaraga qisqartiradi.
 *
 * Ketma-ket ODDIY bo'shliqlar bittaga tushadi, chetlari kesiladi.
 * Bo'linmas bo'shliq (NBSP, U+00A0) SAQLANADI va chegara hisoblanmaydi:
 * «5 %», «12 km» ikki qatorga/ikki bo'lakka ajralmasin. Chegaradan uzun
 * matn «…» bilan tugaydi, natija uzunligi ≤ `n`. AUDIT-25: kesish SO'Z
 * CHEGARASIDA — ilgari «…imkonini ber…», «…olim, zam…» kabi so'z
 * o'rtasidan kesilardi (jonli `lecture-12`). Oxiridagi tinish belgisi
 * tashlanadi («…olim…», «…olim,…» ham «…dengizi.…» ham emas). Bitta uzun
 * so'z (URL, `"a".repeat(n)`) — qattiq kesiladi, uzunlik aynan `n`.
 * Ko'p qatorli matn (notiq izohi) uchun EMAS — u qatorlarni yo'qotadi.
 */
export function clipTo(text: string, n: number): string {
  const t = String(text ?? "").replace(/[ \t\n\r\f\v]+/g, " ").trim();
  if (t.length <= n) return t;
  const head = safeSlice(t, n - 1);
  // `t[n-1]` bo'shliq bo'lsa `head` o'zi to'liq so'z bilan tugaydi.
  const cut = t[head.length] === " " ? head.length : head.lastIndexOf(" ");
  const body = cut >= Math.ceil((n - 1) * CLIP_WORD_MIN_SHARE) ? head.slice(0, cut) : head;
  return `${body.replace(/[\s,;:.!?–—-]+$/u, "")}…`;
}

// ───────────────────────────────────────────────────────── maket sig'imi

/**
 * O'lchanadigan maydonlar. Soni o'zgaruvchi maydonlarda (`bullets`,
 * `colItem`, `stepText`, `stepTitle`, `statLabel`, `tableCell`,
 * `tableHeader`) sig'im elementlar SONIGA bog'liq — `fitChars` ning
 * `count` argumenti (jadvalda — ustunlar; qatorlar `opts.rows`).
 */
export type FitField =
  | "title"
  | "colTitle"
  | "bullets"
  | "colItem"
  | "stepText"
  | "stepTitle"
  | "statLabel"
  | "tableCell"
  | "tableHeader"
  | "subtitleSection"
  | "subtitleClosing"
  | "quote"
  | "quoteBy"
  | "quizQ"
  | "quizOption";

/**
 * Shrifti AUDITORIYA oralig'ida tanlanadigan maydonlar (`fitLines`/
 * `bodyFit` — `bodyPt` → `minPt`). P2 A2-04 dan keyin `bodyFit` matn
 * polda ham sig'masa shriftni polDAN PAST tushirib qutida saqlaydi —
 * shuning uchun bu maydonlarda «sig'di» = qutiga sig'di VA shrift
 * auditoriya polidan past emas (Slide Law). Qolgan maydonlarning
 * shrifti dizayndan (sarlavha, iqtibos) — ularda faqat quti.
 */
const AUDIENCE_FIELDS: ReadonlySet<FitField> = new Set([
  "bullets",
  "colItem",
  "stepText",
  "stepTitle",
  "statLabel",
  "tableCell",
  "tableHeader",
  "quizOption",
]);

/** 17 vizual — dangasa (modul sikli: yuqoridagi izoh). */
const allVisuals = (): SlideVisual[] => [...LEGACY_VISUALS, ...DESIGN_VISUALS];
const probeTheme = () => getSlideTheme("atlas");
/** Tasma rasmi — `twoCol`/`process`/`stats`/`table` da kontent zonasini toraytiradi (A1-01). */
const PROBE_IMAGE = { url: "data:image/png;base64,AAAA" };
/** Real o'zbekcha so'zlar — sig'im «ooo…» bilan emas, so'z bo'yicha qatorlashda o'lchanadi. */
const PROBE_WORDS =
  "Orol dengizining qurishi mintaqadagi iqlim sharoitini keskin o‘zgartirdi va aholining sog‘lig‘iga jiddiy ta’sir ko‘rsatdi shuning uchun suv resurslarini tejash hamda qishloq xo‘jaligida zamonaviy sug‘orish usullarini joriy etish muhim vazifa hisoblanadi".split(
    " ",
  );

function probeText(words: number): string {
  return Array.from({ length: words }, (_, i) => PROBE_WORDS[i % PROBE_WORDS.length]).join(" ");
}

type Probe = {
  /** Soni o'zgaruvchi maydonda standart son (auditoriya ruxsati). */
  count?: (rules: BodyRules) => number;
  slide: (t: string, n: number, rows: number) => SlideModel;
  match: (src: SlideSrc | undefined) => boolean;
};

const fill = (n: number, t: string) => Array.from({ length: n }, () => t);
const isSteps = (s: SlideSrc | undefined) => s?.f === "steps" && s.k === "text";
const stepsOf = (n: number, title: string, text: string): SlideStep[] =>
  Array.from({ length: n }, (_, i) => ({ n: String(i + 1), title, text }));
const tableOf = (cols: number, rows: number, head: string, cell: string) => ({
  headers: fill(cols, head),
  rows: Array.from({ length: rows }, () => fill(cols, cell)),
});

/** Sinov slaydi va shu maydon qatlamini taniydigan predikat. */
const PROBES: Record<FitField, Probe> = {
  title: {
    // Eng tor sarlavha — rasmli `section` (classic): sarlavha qutisi rasm yonida.
    slide: (t) => ({ id: "fit", layout: "section", title: t, subtitle: probeText(10) }),
    match: (s) => s?.f === "title",
  },
  colTitle: {
    slide: (t) => ({ id: "fit", layout: "twoCol", title: "Ikki tomon", leftTitle: t, rightTitle: t, left: ["Band matni."], right: ["Band matni."] }),
    match: (s) => s?.f === "leftTitle" || s?.f === "rightTitle",
  },
  bullets: {
    count: (r) => r.maxBullets,
    slide: (t, n) => ({ id: "fit", layout: "bullets", title: "Sarlavha", bullets: fill(n, t) }),
    match: (s) => s?.f === "bullets",
  },
  colItem: {
    count: () => SLIDE_LIMITS.colItems,
    slide: (t, n) => ({ id: "fit", layout: "twoCol", title: "Ikki tomon", leftTitle: "Chap", rightTitle: "O‘ng", left: fill(n, t), right: fill(n, t) }),
    match: (s) => s?.f === "left" || s?.f === "right",
  },
  stepText: {
    count: (r) => r.stepsMax,
    slide: (t, n) => ({ id: "fit", layout: "process", title: "Jarayon", steps: stepsOf(n, "Bosqich nomi", t) }),
    match: isSteps,
  },
  stepTitle: {
    count: (r) => r.stepsMax,
    slide: (t, n) => ({ id: "fit", layout: "process", title: "Jarayon", steps: stepsOf(n, t, probeText(5)) }),
    match: (s) => s?.f === "steps" && s.k === "title",
  },
  statLabel: {
    count: (r) => r.statsMax,
    slide: (t, n) => ({ id: "fit", layout: "stats", title: "Ko‘rsatkichlar", stats: Array.from({ length: n }, (_, i) => ({ value: `${i + 2}0 %`, label: t })) }),
    match: (s) => s?.f === "stats" && s.k === "label",
  },
  tableCell: {
    count: (r) => r.tableCols,
    slide: (t, n, rows) => ({ id: "fit", layout: "table", title: "Jadval", table: tableOf(n, rows, "Ustun", t) }),
    match: (s) => s?.f === "table" && s.k === "cell",
  },
  tableHeader: {
    count: (r) => r.tableCols,
    slide: (t, n, rows) => ({ id: "fit", layout: "table", title: "Jadval", table: tableOf(n, rows, t, "Katak") }),
    match: (s) => s?.f === "table" && s.k === "header",
  },
  subtitleSection: { slide: (t) => ({ id: "fit", layout: "section", title: "Bo‘lim sarlavhasi", subtitle: t }), match: (s) => s?.f === "subtitle" },
  subtitleClosing: { slide: (t) => ({ id: "fit", layout: "closing", title: "Xulosa", subtitle: t }), match: (s) => s?.f === "subtitle" },
  quote: { slide: (t) => ({ id: "fit", layout: "quote", title: "Iqtibos", quote: t, quoteBy: "Muallif" }), match: (s) => s?.f === "quote" },
  quoteBy: {
    slide: (t) => ({ id: "fit", layout: "quote", title: "Iqtibos", quote: probeText(15), quoteBy: t }),
    match: (s) => s?.f === "quoteBy",
  },
  quizQ: {
    slide: (t) => ({ id: "fit", layout: "quiz", title: "Nazorat savoli", quiz: [{ q: t, options: ["Bir", "Ikki", "Uch", "To‘rt"], answer: 0 }] }),
    match: (s) => s?.f === "quiz" && "k" in s && s.k === "q",
  },
  quizOption: {
    slide: (t) => ({ id: "fit", layout: "quiz", title: "Nazorat savoli", quiz: [{ q: probeText(12), options: fill(4, t), answer: 0 }] }),
    match: (s) => s?.f === "quiz" && "k" in s && s.k === "option",
  },
};

type TextLayer = Extract<SlideLayer, { t: "text" }>;

/**
 * Qatlam o'z shriftida qutiga sig'adimi — maketning O'Z o'lchovi bilan:
 * oddiy matn `LAYOUT_KIT.inkHeight` (qalin qatlamda `CHAR_EM_BOLD`,
 * P2 A2-04), ro'yxat `listRows` (band chekinishi bilan). Ikkala joyda
 * alohida formula bo'lmasin — aks holda o'lchov maketdan ajralib ketadi.
 * 1 pt bardosh: 0.2 pt «oshish» ko'zga ko'rinmaydi.
 */
function layerFits(l: TextLayer): boolean {
  const room = l.box.h * 72 + 1;
  if (l.lines) {
    const rows = LAYOUT_KIT.listRows(l.lines, l.box, l.size);
    // Oxirgi banddan keyingi oraliq ko'rinmaydi (matn tepadan boshlanadi) — n−1 ta oraliq.
    return rows * l.size * 1.3 + Math.max(0, l.lines.length - 1) * (l.paraSpace ?? 0) <= room;
  }
  const em = l.bold ? LAYOUT_KIT.CHAR_EM_BOLD : CHAR_EM;
  return LAYOUT_KIT.inkHeight(l.text ?? "", l.box.w, l.size, em) * 72 <= room;
}

function probeLayers(p: Probe, words: number, n: number, rows: number, rules: BodyRules, visual: SlideVisual, image: boolean): TextLayer[] {
  const slide = p.slide(probeText(words), n, rows);
  const plan = planSlide(image ? { ...slide, image: PROBE_IMAGE } : slide, probeTheme(), visual, 3, 10, "auto", "lecture", {
    bodyType: rules,
  });
  return plan.layers.filter(
    (l): l is TextLayer => l.t === "text" && (p.match(l.src) || (l.srcLines ?? []).some((s) => p.match(s))),
  );
}

/** 40 so'z ≈ 340 belgi — eng uzun qopqoqdan (quote 280) ham katta. */
const MAX_PROBE_WORDS = 40;
const fitCache = new Map<string, number>();

export type FitOpts = {
  /** Jadval qatorlari (faqat `tableCell`/`tableHeader`); berilmasa — auditoriya ruxsati `rules.tableRows`. */
  rows?: number;
  /** "both" — rasmli va rasmsizning kichigi (standart); "none" — faqat rasmsiz (`limitsFor` jadvali qulfi). */
  images?: "both" | "none";
};

/**
 * Maydon maketda auditoriya shrift POLIDA necha BELGI ko'taradi —
 * `planSlide` ning o'zidan o'lchanadi (yagona manba: P2 qutini yoki
 * polni o'zgartirsa, prompt, detektor va qirqish ham avtomatik
 * ergashadi). Rasmli VA rasmsiz holatning kichigi olinadi: rasm matn
 * yozilgandan KEYIN qo'shiladi (`attachSlideImages`), yozuv paytida
 * uning bo'lishi noma'lum. `visual` berilmasa — 17 vizualning ENG TORI.
 * `count` — elementlar soni (bosqich, karta, ustun, band).
 */
export function fitChars(field: FitField, rules: BodyRules, visual?: SlideVisual, count?: number, opts: FitOpts = {}): number {
  const p = PROBES[field];
  const n = Math.max(1, Math.round(count ?? p.count?.(rules) ?? 1));
  const rows = Math.max(1, Math.round(opts.rows ?? rules.tableRows));
  const images = opts.images ?? "both";
  const key = `${field}|${n}|${rows}|${visual ?? "*"}|${rules.bodyPt}|${rules.minPt}|${images}`;
  const hit = fitCache.get(key);
  if (hit !== undefined) return hit;
  const floored = AUDIENCE_FIELDS.has(field);
  let chars = Number.POSITIVE_INFINITY;
  for (const v of visual ? [visual] : allVisuals()) {
    for (const image of images === "none" ? [false] : [false, true]) {
      const base = probeLayers(p, 1, n, rows, rules, v, image);
      // Bu vizualda maydon chizilmaydi — cheklov yo'q.
      if (!base.length) continue;
      // Pol: auditoriya poli, lekin dizayn shrifti undan kichik bo'lsa — o'sha (1 so'zdagi o'lcham).
      const floors = base.map((l) => (floored ? Math.min(rules.minPt, l.size) : 0));
      const fits = (words: number) => {
        const ls = probeLayers(p, words, n, rows, rules, v, image);
        return ls.length === floors.length && ls.every((l, i) => layerFits(l) && l.size >= floors[i]);
      };
      /*
       * CHIZIQLI qidiruv — BIRINCHI sig'masligigacha. Ikkilik qidiruv
       * noto'g'ri edi: ba'zi vizuallar matn uzunligiga qarab boshqa
       * joylashuvga o'tadi (sig'im monoton emas) va u tasodifiy nuqtani
       * topardi (`dashboard` twoCol: 111 o'rniga 75).
       */
      let fit = 0;
      while (fit < MAX_PROBE_WORDS && fits(fit + 1)) fit += 1;
      chars = Math.min(chars, probeText(fit).length);
    }
  }
  if (!Number.isFinite(chars)) chars = probeText(MAX_PROBE_WORDS).length;
  fitCache.set(key, chars);
  return chars;
}

// ───────────────────────────────────────────────────────── qirqish chegarasi

/**
 * O'LCHOV shundan past qisilmaydi (~3 so'z): vizualning eng tor qutisi
 * bundan ham tor bo'lsa, qirqish ma'noni o'ldiradi — bu MAKET muammosi.
 * DIQQAT: bu faqat jonli o'lchovga tegishli. `limitsFor` jadvali
 * (auditoriya poli × son) undan PAST bo'lishi mumkin (1–4 sinf 5
 * bosqich — 10 belgi, 5×6 jadval — 5): bunday son yosh auditoriyaga
 * ruxsat etilmaydi (`countRules`), ya'ni `normalizeSlide` AVVAL sonni
 * qisadi (P1 W3), keyin uzunlikni — shunda bu kataklar ishlatilmaydi.
 */
export const CLIP_FLOOR_CHARS = 24;

/**
 * Mos qopqoq: bandlar — auditoriya `bulletChars`; soni o'zgaruvchi
 * maydonlar va test varianti — `limitsFor` (pol × son jadvali, klient
 * ham o'qiydi); qolgani — statik `SLIDE_LIMITS`.
 */
export function fieldCap(field: FitField, rules: BodyRules, _visual?: SlideVisual, count?: number, rows?: number): number {
  switch (field) {
    case "bullets":
      return rules.bulletChars;
    case "stepText":
    case "stepTitle":
      return limitsFor(rules, { steps: count })[field];
    case "statLabel":
      return limitsFor(rules, { stats: count })[field];
    case "tableCell":
    case "tableHeader":
      return limitsFor(rules, { cols: count, rows })[field];
    case "quizOption":
      return limitsFor(rules).quizOption;
    case "subtitleSection":
    case "subtitleClosing":
    case "quote":
    case "quoteBy":
    case "quizQ":
    case "title":
    case "colTitle":
    case "colItem":
      return SLIDE_LIMITS[field];
  }
}

/**
 * Model matnini QIRQISH chegarasi — auditoriya × vizual × element soni.
 *
 * = min(`limitsFor` (yoki statik qopqoq), max(`CLIP_FLOOR_CHARS`, deka
 * vizualidagi jonli sig'im)). Maket avval shriftni polgacha kichraytiradi,
 * pol shriftida ham sig'maydigan qismigina so'z chegarasida (`clipTo`)
 * qirqiladi. `limitsFor` dan hech qachon oshmaydi (generatsiya ⊆ tahrir).
 *
 * P1: `normalizeSlide` da AVVAL son (`rules.stepsMax`/`statsMax`/
 * `tableCols`/`tableRows`), keyin `clipTo(x, clipLimit("stepText",
 * rules, tpl.visual, steps.length, undefined, NO_IMAGE))`; jadvalda
 * `clipLimit("tableCell", rules, visual, cols, rows, NO_IMAGE)`.
 *
 * `opts.images` (AUDIT-25 P8, «matn rasmdan ustun»): "both" (standart) —
 * rasm tasmasi bilan va rasmsizning kichigi, ya'ni RASMLI quti; "none" —
 * faqat rasmsiz quti. Matn bosqichi (`normalizeSlide`, ta'mir) rasmni
 * hali bilmaydi — u RASMSIZ sig'imda qirqadi (`NO_IMAGE`); rasmli qutiga
 * sig'maydigan slayd keyin rasmdan voz kechadi (`imageYieldField`,
 * `slide-images.ts`), matn esa kesilmaydi.
 */
export function clipLimit(field: FitField, rules: BodyRules, visual?: SlideVisual, count?: number, rows?: number, opts: Pick<FitOpts, "images"> = {}): number {
  const cap = fieldCap(field, rules, visual, count, rows);
  return Math.min(cap, Math.max(CLIP_FLOOR_CHARS, fitChars(field, rules, visual, count, { rows, images: opts.images })));
}

/** Matn bosqichining qirqish rejimi — rasm hali yo'q, sig'im RASMSIZ qutidan. */
export const NO_IMAGE = { images: "none" } as const satisfies Pick<FitOpts, "images">;
