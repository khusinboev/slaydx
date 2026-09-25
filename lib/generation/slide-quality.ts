import { languageDirective } from "./i18n";
import { parseLlmJson } from "./json";
import { llmComplete, llmEnabled } from "./llm";
import { isDeadlineError } from "./deadline";
import { remainingMs } from "./quality";
import { bodyRules, type BodyRules } from "./slide-audience";
import { NO_IMAGE, SLIDE_LIMITS, clipLimit, clipTo, fieldCap, fitChars, type FitField } from "./slide-limits";
import type { SlidePromptCtx } from "./slide-prompt/ctx";
import { researchLines } from "./slide-prompt/research";
import type { SlideTemplate, SlideVisual } from "./slide-templates";
import type { SlideLayout, SlideModel, SlideStep } from "./slide-types";
import type { DocMeta } from "./types";

/**
 * Matn ZICHLIGI — «yupqa slayd» detektori va bitta chaqiruvli ta'mir
 * (AUDIT-25 S4 / 6-qaror).
 *
 * Jonli dekada (Orol dengizi, Kasr sonlar) mazmun slaydlarida 2–3 qisqa
 * band, process kartalarida 3–4 so'zli matn, bo'lim slaydida bo'sh
 * subtitle, test variantlari esa «…» bilan kesilgan chiqdi. Uch qatlam:
 *
 *   1) `layoutWordTargets` — har maket uchun SO'Z ORALIG'I. Raqamlar
 *      `BodyRules` dan (auditoriya × matn hajmi) va MAKETNING O'ZIDAN
 *      (`planSlide` qutisi, auditoriya shrift poli) hisoblanadi — prompt
 *      (`slide-prompt/brief.ts`) va detektor BIR manbadan o'qiydi;
 *   2) `thinSlides` — deterministik detektor (LLM yo'q);
 *   3) `repairThinSlides` — faqat yupqa slaydlar uchun BITTA qo'shimcha
 *      LLM chaqiruvi; javob faqat slayd endi yupqa bo'lmasa qabul
 *      qilinadi, aks holda asl slayd qoladi. Hech qachon otmaydi.
 */

// ───────────────────────────────────────────────────────── chegaralar

/**
 * Bandlar: o'rtacha so'z soni ⌊`THIN_BULLET_K × bulletChars/8`⌋ dan kam
 * bo'lsa — yupqa. Promptdagi QUYI chegara ham aynan shu son
 * (`bulletMinWords`), ya'ni ko'rsatmaga rioya qilgan model hech qachon
 * «yupqa» deb topilmaydi.
 */
export const THIN_BULLET_K = 0.55;
/** `process` bosqich matni shundan kam so'z bo'lsa — yupqa («Boshlash», «Natija» kabi yorliq). */
export const STEP_MIN_WORDS = 6;
/** `process` da shundan kam bosqich — jarayon emas, ro'yxat parchasi. */
export const PROCESS_MIN_STEPS = 3;
/** `twoCol`/`compare` ustunida shundan kam band — ustun bo'sh ko'rinadi. */
export const COL_MIN_ITEMS = 2;
/** Ustun bandlarining o'rtacha so'z soni shundan kam — yorliq, gap emas. */
export const COL_MIN_WORDS = 5;
/**
 * `section` subtitle shundan kam so'z — amalda BO'SH: skelet
 * (`beatToSlide`) subtitle ga faqat mavzu nomini yozadi («Orol dengizi»).
 */
export const SECTION_SUBTITLE_MIN_WORDS = 6;
/**
 * Iqtibos uchun PROMPT poli (so'z). Detektor iqtibosni o'lchamaydi:
 * haqiqiy qisqa iqtibosni («Bilim — kuch.») uzaytirish — uydirma.
 */
export const QUOTE_MIN_WORDS = 8;

/**
 * Sig'imni so'zga aylantirish koeffitsiyenti: o'zbekcha o'rtacha so'z +
 * probel ~9 belgi (`tests/slide-chart.test.mts` o'lchovi bilan bir xil).
 * Belgidan so'zga o'tishda ATAYLAB past baho — «≤ N so'z» ga rioya
 * qilgan javob qutiga albatta sig'sin.
 *
 * AUDIT-25 P8 qayta o'lchovi (slides-3 jonli 7 deka, `eval-out/live/
 * *.doc.json`, 202 matn maydoni, belgi+probel / so'z): o'rtacha 8.42
 * (band 9.00, ustun bandi 8.45, bosqich 8.01, jadval katagi 8.00, stats
 * yorlig'i 8.56, test varianti 7.17). O'RTACHA 9 dan past — 9 qoladi.
 * Lekin bitta matn bo'yicha p90 10.0–10.4 (ustun bandi 10.17, band 10.44):
 * maksimal so'z soniga rioya qilgan UZUN so'zli band 9 × N dan ~16 %
 * uzun chiqadi. Jonli «…» kesiklarning sababi shu — o'rtacha emas,
 * tarqoqlik. Uni `PROMPT_HEADROOM` yopadi (9 / 10.4 ≈ 0.87 ≥ 0.85).
 */
export const CHARS_PER_WORD = 9;

/**
 * Prompt ZAXIRASI (AUDIT-25 P8, «matn rasmdan ustun»): yuqori so'z
 * chegarasi = ⌊0.85 × belgi sig'imi / `CHARS_PER_WORD`⌋. Ilgari zaxira
 * 0 edi (prompt maksimumi = qirqish chegarasi): jonli 7 dekaning 4 tasida
 * model limitdan bir necha belgiga oshib, band so'z chegarasida «…» bilan
 * kesildi (8–9 sinf `circle` ustun bandi 54–58 / 60, bosqich 32–39 / 42,
 * bakalavr `qisqa` bandi 111–114 / 119). 15 % — o'lchangan p90 so'z
 * uzunligi (10.4) ni qoplaydi.
 */
export const PROMPT_HEADROOM = 0.85;

/** Bandning quyi chegarasi (so'z) — prompt ham, detektor ham shuni o'qiydi. */
export function bulletMinWords(rules: Pick<BodyRules, "bulletChars">): number {
  // `floor`: 1–4 sinfda 5.5 → 5 (round 6 ga chiqarib, 5 so'zli bolalar bandini «yupqa» derdi).
  // Yuqori chegaradan oshmaydi (zaxira bilan ham «min ≤ max»).
  return Math.min(bulletMaxWords(rules), Math.floor((rules.bulletChars * THIN_BULLET_K) / 8));
}

/**
 * Bandning yuqori chegarasi (so'z). Ilgari `bulletChars / 8` edi —
 * talabada 21 so'z ≈ 190 belgi, qirqish esa 165 da: ko'rsatmaga TO'LIQ
 * rioya qilgan band «…» bilan kesilardi. Endi `CHARS_PER_WORD` va 15 %
 * zaxira bilan (`PROMPT_HEADROOM`).
 */
export function bulletMaxWords(rules: Pick<BodyRules, "bulletChars">): number {
  return Math.max(1, Math.floor((PROMPT_HEADROOM * rules.bulletChars) / CHARS_PER_WORD));
}

// ───────────────────────────────────────────────────────── maket sig'imi va qirqish chegarasi

// O'lchov (`fitChars`) va qirqish chegarasi (`clipLimit`) `slide-limits.ts` ga ko'chdi (AUDIT-25 P11):
// ko'ruvchi tahriri (`slide-edit.ts`, klient) ham AYNAN shu funksiyadan o'qisin — ikki nusxa emas.
// Bu yerda qayta eksport: eski importlar (`slide-write.ts`, testlar) o'zgarmaydi.
export { CLIP_FLOOR_CHARS, NO_IMAGE, clipLimit, fieldCap, fitChars, type FitField, type FitOpts } from "./slide-limits";

/**
 * `bullets` maketidagi band chegarasi — yozuvchi (`normalizeSlide`) VA
 * ta'mir (`mergeRepair`) BIR funksiyadan o'qiydi (P8 sharhi, CHANGES 1).
 *
 * Ilgari yozuvchi faqat `rules.bulletChars` da qirqardi: 5–7 sinf
 * `circle` da 100 belgi, quti esa 85 (`kop` da 135 / 85, bakalavr `kop`
 * `circle` 223 / 121) — `fitLines` polda to'xtab, matn qutidan chiqardi
 * (ko'ruvchi `overflow: hidden` bilan yashiradi, PPTX to'kadi). Endi
 * min(`bulletChars`, rasmsiz quti sig'imi `count` bandda). Son AVVAL
 * (`maxBullets`), keyin shu SONDAGI chegara. Agenda/manbalar/kalit —
 * o'z chegaralari bilan (bu funksiya emas).
 */
export function bulletClipLimit(rules: BodyRules, visual: SlideVisual | undefined, count: number): number {
  return Math.min(rules.bulletChars, clipLimit("bullets", rules, visual, Math.max(1, count), undefined, NO_IMAGE));
}

/**
 * Rasm matnga JOY BERADIMI (AUDIT-25 P8, «matn rasmdan ustun»).
 *
 * Matn RASMSIZ qutiga qirqilgan (`NO_IMAGE`); rasm tasmasi esa kontent
 * zonasini toraytiradi. Qoida: slaydning birorta maydoni RASMLI
 * qutidan (`fitChars(…, {images: "both"})`, auditoriya poli, xom — 24
 * belgilik qirqish polisiz) uzun VA rasm haqiqatan joy yeydi (rasmli
 * sig'im < rasmsiz sig'im) — rasm
 * qo'yilmaydi, matn to'liq qoladi. Rasm joy yemaydigan maydonda (masalan
 * `bullets` `circle` da — ikkala holatda bir xil quti) rasmdan voz
 * kechish hech narsa bermaydi, shuning uchun u hisobga olinmaydi.
 *
 * Maydonlar: band (`bullets`), ustun bandi (`left`/`right`), bosqich
 * matni va sarlavhasi, stats yorlig'i, jadval katagi va sarlavhasi,
 * iqtibos, bo'lim/yakun subtitle. Son — slayddagi haqiqiy son (ustunda —
 * o'sha ustunniki). Qaytaradi: birinchi sig'maydigan maydon yoki `null`.
 * O'lchovning o'zi — `imageOverflowChars` (bitta manba).
 */
export function imageYieldField(s: SlideModel, rules: BodyRules, visual?: SlideVisual): FitField | null {
  // Kalitlar tekshiruv tartibida qo'shiladi — birinchisi = avvalgi «birinchi sig'maydigan maydon».
  for (const field of Object.keys(imageOverflowChars(s, rules, visual))) return field as FitField;
  return null;
}

/** Bitta o'lchov: maydon, matnlar, son va qator (maydon takrorlansa — alohida yozuv). */
type YieldCheck = [field: FitField, texts: (string | undefined)[], count?: number, rows?: number];

/**
 * «Matn rasmdan ustun» o'lchovining YAGONA jadvali (AUDIT-25 INT-03, P12
 * sharhi 4-band): maket → u o'qiydigan `SlideModel` kalitlari va shu
 * kalitlardan yig'iladigan tekshiruvlar. `checks` ga slaydning FAQAT
 * `keys` dagi maydonlari beriladi (`yieldView`) — ro'yxatda yo'q maydonni
 * o'qib bo'lmaydi, ya'ni server guard'ining «quti matni o'zgardimi»
 * kaliti (`imageYieldText`) va o'lchov hech qachon ajralib ketmaydi.
 */
export const IMAGE_YIELD_TABLE: Partial<Record<SlideLayout, { keys: readonly (keyof SlideModel)[]; checks: (s: SlideModel) => YieldCheck[] }>> = (() => {
  const cols = {
    keys: ["left", "right"] as const,
    checks: (s: SlideModel) => [s.left ?? [], s.right ?? []].filter((c) => c.length).map((c): YieldCheck => ["colItem", c, c.length]),
  };
  return {
    bullets: { keys: ["bullets"], checks: (s) => [["bullets", s.bullets ?? [], Math.max(1, s.bullets?.length ?? 1)]] },
    // INT-02 (P11): reja bandlari (sarlavhalar) rasmsiz qatorda qirqilgan — rasm yonida sig'masa, rasm joy beradi.
    agenda: { keys: ["bullets"], checks: (s) => [["agenda", s.bullets ?? [], Math.max(1, s.bullets?.length ?? 1)]] },
    twoCol: cols,
    compare: cols,
    process: {
      keys: ["steps"],
      checks: (s) => {
        const n = s.steps?.length ?? 0;
        return n ? [["stepText", s.steps!.map((x) => x.text), n], ["stepTitle", s.steps!.map((x) => x.title), n]] : [];
      },
    },
    stats: {
      keys: ["stats"],
      checks: (s) => {
        const n = s.stats?.length ?? 0;
        return n ? [["statLabel", s.stats!.map((x) => x.label), n]] : [];
      },
    },
    table: {
      keys: ["table"],
      checks: (s) => {
        const cols = s.table?.headers.length ?? 0;
        const rows = s.table?.rows.length ?? 0;
        return cols && rows ? [["tableCell", s.table!.rows.flat(), cols, rows], ["tableHeader", s.table!.headers, cols, rows]] : [];
      },
    },
    quote: { keys: ["quote"], checks: (s) => [["quote", [s.quote]]] },
    section: { keys: ["subtitle"], checks: (s) => [["subtitleSection", [s.subtitle]]] },
    closing: { keys: ["subtitle"], checks: (s) => [["subtitleClosing", [s.subtitle]]] },
  };
})();

/** Slaydning o'lchovga kiradigan qismi: `layout` + jadvaldagi kalitlar (boshqasi YO'Q). */
function yieldView(s: SlideModel): SlideModel {
  const view: Record<string, unknown> = { id: "", layout: s.layout, title: "" };
  for (const k of IMAGE_YIELD_TABLE[s.layout]?.keys ?? []) view[k] = s[k];
  return view as SlideModel;
}

/**
 * «Quti matni» kaliti — ikki slaydning `imageYieldText` i teng bo'lsa,
 * ularning `imageOverflowChars`/`imageOverflowRatio` si ham TENG (qurilishi
 * bo'yicha: o'lchov faqat `yieldView` ni ko'radi).
 */
export function imageYieldText(s: SlideModel): string {
  const keys = IMAGE_YIELD_TABLE[s.layout]?.keys ?? [];
  return JSON.stringify([s.layout, ...keys.map((k) => s[k] ?? null)]);
}

/** Rasm haqiqatan joy yeydigan va matn rasmli qutidan uzun maydonlar (tekshiruv tartibida). */
function imageOverflowEntries(s: SlideModel, rules: BodyRules, visual?: SlideVisual): { field: FitField; longest: number; withImage: number }[] {
  const out: { field: FitField; longest: number; withImage: number }[] = [];
  for (const [field, texts, count, rows] of IMAGE_YIELD_TABLE[s.layout]?.checks(yieldView(s)) ?? []) {
    const longest = Math.max(0, ...texts.map((t) => String(t ?? "").trim().length));
    if (!longest) continue;
    /*
     * XOM quti sig'imi (`fitChars`) — `clipLimit` emas (P8 sharhi, N1):
     * `clipLimit` ichidagi `CLIP_FLOOR_CHARS` (24) poli 4 belgilik rasmli
     * qutini (4 ustunli jadval `circle` da) «24 sig'adi» deb ko'rsatardi.
     */
    const withImage = fitChars(field, rules, visual, count, { rows });
    if (longest > withImage && withImage < fitChars(field, rules, visual, count, { rows, images: "none" })) out.push({ field, longest, withImage });
  }
  return out;
}

/**
 * `imageYieldField` ning SON o'lchovi (AUDIT-25 INT-03): har maydon uchun
 * eng uzun matn RASMLI qutidan necha belgi ortiq (faqat rasm haqiqatan
 * joy yeydigan va ortiqcha > 0 bo'lgan maydonlar; maydon ikki marta
 * tekshirilsa — ustunlar — kattasi). Kalitlar tekshiruv tartibida.
 */
export function imageOverflowChars(s: SlideModel, rules: BodyRules, visual?: SlideVisual): Partial<Record<FitField, number>> {
  const out: Partial<Record<FitField, number>> = {};
  for (const e of imageOverflowEntries(s, rules, visual)) out[e.field] = Math.max(out[e.field] ?? 0, e.longest - e.withImage);
  return out;
}

/**
 * Xuddi shu o'lchov NISBAT bilan (eng uzun / rasmli quti, > 1): turli
 * maydonlarni (turli qutilarni) solishtirish uchun — server guard'i maket
 * o'zgarganda (masalan twoCol → bullets) «ortiqcha kamaydimi» ni shu bilan
 * o'lchaydi (`edit-adapters.ts imageTextOverflow`, P12 sharhi 3-band).
 */
export function imageOverflowRatio(s: SlideModel, rules: BodyRules, visual?: SlideVisual): Partial<Record<FitField, number>> {
  const out: Partial<Record<FitField, number>> = {};
  for (const e of imageOverflowEntries(s, rules, visual)) {
    const r = e.withImage > 0 ? e.longest / e.withImage : Number.POSITIVE_INFINITY;
    out[e.field] = Math.max(out[e.field] ?? 0, r);
  }
  return out;
}

// ───────────────────────────────────────────────────────── so'z oraliqlari

export type WordRange = { min: number; max: number };

export type LayoutWordTargets = {
  bullet: WordRange;
  /** Ustundagi band soni yuqori chegarasi (band kamida `COL_MIN_WORDS` so'z sig'sin). */
  maxColItems: number;
  /** `maxColItems` bandli ustunda bitta band. */
  colItem: WordRange;
  /** Ustun sarlavhasi — faqat yuqori chegara (quti va `SLIDE_LIMITS.colTitle`). */
  colTitleMax: number;
  /** Bosqich soni yuqori chegarasi — auditoriya ruxsati, vizual sig'imi bilan qisilgan. */
  maxSteps: number;
  /** Bosqich matni — HAR SON uchun alohida (3 bosqichda keng, 4–5 da tor). */
  stepTextBy: Record<number, WordRange>;
  /** `maxSteps` bosqichdagi (eng tor) oraliq. */
  stepText: WordRange;
  /** Karta soni yuqori chegarasi (label kamida `STAT_LABEL_MIN_WORDS` so'z sig'sin). */
  maxStats: number;
  statLabelMax: number;
  /** Jadval ustunlari yuqori chegarasi (katak kamida `tableCellMinWords(rules)` so'z sig'sin). */
  maxTableCols: number;
  /** Jadval qatorlari — auditoriya ruxsati (`BodyRules.tableRows`). */
  maxTableRows: number;
  /** (`maxTableCols`, `maxTableRows`) jadvalidagi katak — `limitsFor`/`clipLimit` bilan BIR kalit. */
  tableCellMax: number;
  sectionSubtitle: WordRange;
  closingSubtitle: WordRange;
  quote: WordRange;
  quoteByMax: number;
  quizQMax: number;
  quizOptionMax: number;
};

/** Stats yorlig'i shundan kam so'z sig'adigan karta soni taklif qilinmaydi. */
export const STAT_LABEL_MIN_WORDS = 3;
/** Jadval katagi shundan kam so'z sig'adigan ustun soni taklif qilinmaydi (yosh auditoriya, pol ≥ 18 pt). */
export const TABLE_CELL_MIN_WORDS = 2;
/**
 * Kattalar (pol ≤ 16 pt) uchun katak poli: talaba jadvali 4 ta 2 so'zli
 * ustundan ko'ra 3 ta TO'LIQROQ ustunni afzal ko'radi (AUDIT-25 P3
 * qayta sharh N2 — «4 tagacha ustun, katak ≤ 2 so'z» chiqardi).
 */
export const TABLE_CELL_MIN_WORDS_ADULT = 3;

/** Auditoriya uchun katak poli (so'z) — ustun soni shunga qarab tanlanadi. */
export function tableCellMinWords(rules: Pick<BodyRules, "minPt">): number {
  return rules.minPt <= 16 ? TABLE_CELL_MIN_WORDS_ADULT : TABLE_CELL_MIN_WORDS;
}

/**
 * Belgi sig'imi → so'z, qopqoqdan oshmasdan. `headroom` — prompt zaxirasi
 * (`PROMPT_HEADROOM`); element SONINI tanlashda 1 (xom sig'im).
 */
function capWords(chars: number, limit: number, headroom = PROMPT_HEADROOM): number {
  return Math.max(1, Math.floor((headroom * Math.min(chars, limit)) / CHARS_PER_WORD));
}

/**
 * Prompt maqsadining quyi chegarasi (so'z) — RASMLI quti shundan kam so'z
 * ko'tarsa, maqsad RASMSIZ qutidan olinadi (AUDIT-25 P11, `fitWords`).
 */
export const PROSE_MIN_WORDS = 5;

/**
 * GAP maydonlari — rasm ularga joy beradi (`imageYieldField`) va 5 so'zdan
 * kam gap ma'no bermaydi. Qisqa YORLIQ maydonlari (bosqich sarlavhasi,
 * stats yorlig'i, jadval katagi/sarlavhasi, ustun sarlavhasi, test) —
 * tabiiy hajmi 1–3 so'z: ularda rasmli quti qoladi, rasm saqlanadi.
 */
const PROSE_FIELDS: ReadonlySet<FitField> = new Set(["bullets", "colItem", "stepText", "subtitleSection", "subtitleClosing", "quote"]);

/**
 * Maydonning so'zdagi sig'imi (qopqoq bilan, 15 % zaxira) — prompt
 * oralig'i va detektor chegarasi shundan.
 *
 * Qoida (AUDIT-25 P11):
 *   1) odatda RASMLI quti (`fitChars` standarti "both") × zaxira — rasm
 *      matndan keyin qo'shiladi, prompt rasmli slaydga ham sig'adigan
 *      hajmni so'raydi;
 *   2) GAP maydonida (`PROSE_FIELDS`) rasmli quti `PROSE_MIN_WORDS` (5)
 *      so'zdan kam bersa — RASMSIZ quti × zaxira. Bunday slaydda rasm
 *      joy beradi (P8, `imageYieldField`), matn esa to'liq gap bo'ladi.
 *      Ilgari 8–9 sinf `circle` 3 bosqichida rasmli 42 belgi → «3 so'z»
 *      so'ralardi; model 5–6 so'z yozar va qirqish (jadval 45) HAMMA
 *      bosqichni «…» bilan kesardi. Endi rasmsiz 121 → 11 so'z.
 * Qopqoq — `fieldCap` (vizual ma'lum: statik shift; noma'lum: jadval).
 * Yozuvchi qirqishi (`clipLimit(…, NO_IMAGE)`) doim rasmsiz quti — ya'ni
 * ikkala holatda ham «prompt ≤ 0.85 × qirqish».
 */
function fitWords(field: FitField, rules: BodyRules, visual?: SlideVisual, count?: number, rows?: number): number {
  const cap = fieldCap(field, rules, visual, count, rows);
  const withImage = capWords(fitChars(field, rules, visual, count, { rows }), cap);
  /*
   * Qat'iy «>»: rasmli quti AYNAN 5 so'z bersa ham rasmsiz quti olinadi
   * (AUDIT-25 yakuniy jonli tekshiruv). Aks holda prompt «5 so'z» so'raydi,
   * detektor esa 5 dan kamini yupqa deydi — nol zaxira: model o'zbekcha
   * 4 so'zli gap yozadi (5–7 sinf `circle` 2 bandli ustun 53 belgi),
   * ta'mir ham «5» bilan 4–5 qaytaradi va rad etiladi. 5 so'z — GAPNING
   * eng kami (`PROSE_MIN_WORDS`), maqsad emas.
   */
  if (withImage > PROSE_MIN_WORDS || !PROSE_FIELDS.has(field)) return withImage;
  return capWords(fitChars(field, rules, visual, count, { rows, ...NO_IMAGE }), cap);
}

/**
 * `from..to` oralig'idagi eng KATTA son, unda maydon kamida `minWords` so'z ko'taradi; yo'q bo'lsa `from`.
 * Son XOM sig'imdan (zaxirasiz) — P2/P3 son qarorlari zaxira bilan o'zgarmasin.
 */
function maxCount(field: FitField, rules: BodyRules, visual: SlideVisual | undefined, from: number, to: number, minWords: number, rows?: number, headroom = 1): number {
  for (let n = to; n > from; n -= 1) {
    if (capWords(fitChars(field, rules, visual, n, { rows }), fieldCap(field, rules, visual, n, rows), headroom) >= minWords) return n;
  }
  return from;
}

/**
 * Oraliq: yuqori = auditoriya istagi (`want`), lekin quti sig'imidan
 * (`cap`) oshmaydi; quyi = `floor` (detektor chegarasi) va yuqorining
 * `share` qismidan kattasi. Quti juda tor bo'lsa (bolalar shrifti) —
 * oraliq quti ichida qoladi: sig'maydigan hajmni so'ramaymiz.
 */
function range(want: number, floor: number, cap: number, share: number): WordRange {
  const max = Math.min(cap, Math.max(floor, want));
  const min = Math.min(max, Math.max(floor, Math.round(max * share)));
  return { min, max };
}

/** «6–9» yoki bitta son («6») — «1–1» kabi ma'nosiz oraliq chiqmasin. */
export function fmtRange(r: WordRange): string {
  return r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;
}

/**
 * Har maket uchun so'z oralig'i va element soni — `BodyRules`
 * (auditoriya × matn hajmi) va maket sig'imidan (auditoriya polida,
 * rasm tasmasi bilan). Prompt (`briefLines`), `thinSlides` va ta'mir
 * shu funksiyani o'qiydi.
 */
export function layoutWordTargets(rules: BodyRules, visual?: SlideVisual): LayoutWordTargets {
  // Bitta «to'liq band» so'z soni — auditoriya/hajm shu orqali hammasiga o'tadi.
  const unit = rules.bulletChars / 8;
  const bulletCap = fitWords("bullets", rules, visual);
  // Son: auditoriya ruxsati (`countRules`, P2 o'lchovi) — deka vizualining sig'imi bilan yana qisiladi.
  const maxSteps = maxCount("stepText", rules, visual, PROCESS_MIN_STEPS, Math.max(PROCESS_MIN_STEPS, rules.stepsMax), STEP_MIN_WORDS);
  const maxStats = maxCount("statLabel", rules, visual, 2, Math.max(2, rules.statsMax), STAT_LABEL_MIN_WORDS);
  const maxTableRows = rules.tableRows;
  const maxTableCols = maxCount("tableCell", rules, visual, 2, Math.max(2, rules.tableCols), tableCellMinWords(rules), maxTableRows);
  /*
   * Ustun soni — 3 ta TO'LIQROQ band 4 ta 5 so'zlidan afzal (P3 qoidasi):
   * son shunday tanlanadiki, rasmli quti PROMPT zaxirasi bilan ham GAPDAN
   * (`PROSE_MIN_WORDS`) KO'P so'z ko'tarsin. Ilgari xom sig'im ≥ 5 edi —
   * deyarli har auditoriya × vizualda (2 679 dan 429 kombinatsiya) 4 band ×
   * AYNAN 5 so'z chiqar, prompt bilan detektor orasida zaxira qolmasdi.
   */
  const maxColItems = maxCount("colItem", rules, visual, COL_MIN_ITEMS, SLIDE_LIMITS.colItems, PROSE_MIN_WORDS + 1, undefined, PROMPT_HEADROOM);
  const stepRange = (n: number) => range(Math.round(unit * 0.7), STEP_MIN_WORDS + 2, fitWords("stepText", rules, visual, n), 0.6);
  const stepTextBy: Record<number, WordRange> = {};
  for (let n = PROCESS_MIN_STEPS; n <= maxSteps; n += 1) stepTextBy[n] = stepRange(n);
  return {
    bullet: { min: Math.min(bulletMinWords(rules), bulletCap), max: Math.min(bulletMaxWords(rules), bulletCap) },
    maxColItems,
    colItem: range(Math.round(unit * 0.7), COL_MIN_WORDS + 1, fitWords("colItem", rules, visual, maxColItems), 0.6),
    colTitleMax: fitWords("colTitle", rules, visual),
    maxSteps,
    stepTextBy,
    stepText: stepTextBy[maxSteps],
    maxStats,
    statLabelMax: fitWords("statLabel", rules, visual, maxStats),
    maxTableCols,
    maxTableRows,
    tableCellMax: fitWords("tableCell", rules, visual, maxTableCols, maxTableRows),
    sectionSubtitle: range(Math.round(unit * 1.5), SECTION_SUBTITLE_MIN_WORDS + 6, fitWords("subtitleSection", rules, visual), 0.65),
    closingSubtitle: range(Math.round(unit * 0.8), 8, fitWords("subtitleClosing", rules, visual), 0.6),
    // Iqtibos — faqat PROMPT oralig'i; detektor iqtibosni «yupqa» demaydi (haqiqiy iqtibosni uzaytirib bo'lmaydi).
    quote: range(Math.round(unit * 1.3), QUOTE_MIN_WORDS + 4, fitWords("quote", rules, visual), 0.45),
    quoteByMax: fitWords("quoteBy", rules, visual),
    quizQMax: fitWords("quizQ", rules, visual),
    quizOptionMax: Math.max(2, fitWords("quizOption", rules, visual)),
  };
}

/**
 * Brif qatorlari — `slide-prompt/brief.ts` shu yerdan oladi (raqamlar
 * detektor bilan bitta manbadan). Ta'mir prompti ham aynan shu qatorlarni
 * beradi.
 */
export function wordTargetLines(rules: BodyRules, visual?: SlideVisual): string[] {
  const t = layoutWordTargets(rules, visual);
  const steps = t.maxSteps > PROCESS_MIN_STEPS ? `${PROCESS_MIN_STEPS}–${t.maxSteps}` : `AYNAN ${PROCESS_MIN_STEPS}`;
  const stepTexts = Object.entries(t.stepTextBy)
    .map(([n, r]) => `${n} bosqichda ${fmtRange(r)}`)
    .join(", ");
  const colItems = fmtRange({ min: Math.min(3, t.maxColItems), max: t.maxColItems });
  return [
    `MAKET HAJMI (so‘z; qutiga sig‘adigan oraliq — kam yozilsa slayd bo‘sh ko‘rinadi, ko‘p yozilsa kesiladi):`,
    `— twoCol/compare: har ustunda ${colItems} band, har band ${fmtRange(t.colItem)} so‘z; ustun sarlavhasi (leftTitle/rightTitle) ≤ ${t.colTitleMax} so‘z;`,
    `— process: ${steps} bosqich; har bosqich text: ${stepTexts} so‘z;`,
    `— stats: ${t.maxStats} tagacha karta, har label ≤ ${t.statLabelMax} so‘z;`,
    /*
     * Qator soni POLI 3 (AUDIT-8): faqat yuqori chegara («N tagacha»)
     * so'ralganda model 2 qatorli jadval qaytarar, jadval slaydning yuqori
     * uchdan birida qolardi (2 dan kami esa `normalizeSlide` da bandlarga
     * tushadi). `maxTableRows` har auditoriyada ≥ 4 — pol shift bilan zid emas.
     * Katak so'zi — P3 N2: kattalar uchun kamida 3 so'z (`tableCellMinWords`).
     */
    `— table: ${t.maxTableCols > 2 ? `2–${t.maxTableCols}` : "AYNAN 2"} ustun, ${t.maxTableRows > 3 ? `3–${t.maxTableRows}` : `AYNAN ${t.maxTableRows}`} qator, katak ${fmtRange({ min: Math.min(tableCellMinWords(rules), t.tableCellMax), max: t.tableCellMax })} so‘z;`,
    `— section: subtitle ${fmtRange(t.sectionSubtitle)} so‘z, bo‘sh qolmasin;`,
    `— closing: subtitle ${fmtRange(t.closingSubtitle)} so‘z;`,
    `— quote: ${fmtRange(t.quote)} so‘z (haqiqiy iqtibos bo‘lsa — aynan asl matn); quoteBy — faqat muallif (≤ ${t.quoteByMax} so‘z), tavsif emas;`,
    `— quiz: savol ≤ ${t.quizQMax} so‘z; har variant ≤ ${t.quizOptionMax} so‘z — qisqa, lekin tugallangan (kesilmasin).`,
  ];
}

// ───────────────────────────────────────────────────────── detektor

/**
 * `short-quote` YO'Q (AUDIT-25 P3 sharhi, 3-band): «Bilim — kuch.»
 * kabi haqiqiy qisqa iqtibosni «boyitish» — uydirma iqtibos; savol-
 * iqtibos («Orol nega qurib qoldi?») ham qisqa bo'lishi tabiiy.
 * `QUOTE_MIN_WORDS` faqat prompt poli.
 */
export type ThinReason = "few-bullets" | "short-bullets" | "short-steps" | "empty-subtitle" | "clipped-option" | "short-columns" | "clipped-text";

function words(s: string | undefined): number {
  return String(s ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function avgWords(list: string[]): number {
  return list.length ? list.reduce((a, s) => a + words(s), 0) / list.length : 0;
}

/**
 * Qirqilgan matn: «…» bilan tugaydi VA qirqish qopqog'iga yaqin uzun.
 * `clipTo` natijasi doim ≥ ⌈0.6·(qopqoq−1)⌉ belgi (so'z chegarasi 60 %
 * dan keyin, aks holda qattiq kesish). Qisqa «1/2 + 1/4 = …» — bo'sh
 * joyli savol, qirqilgan emas.
 */
function clippedAt(s: string | undefined, cap: number): boolean {
  const t = String(s ?? "").trimEnd();
  return t.endsWith("…") && t.length >= Math.ceil(0.6 * (cap - 1));
}

/** Reja MAZMUN slaydi — P1 `plan` maydoni (1-asosli reja bandi). Blok slaydlari (maqsadlar, uy vazifasi) qisqa bo'lishi tabiiy. */
function isPlanSlide(s: SlideModel): boolean {
  return typeof (s as SlideModel & { plan?: unknown }).plan === "number";
}

const norm = (s: string | undefined) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Yozuvchi «…» bilan QIRQQAN gap maydoni (AUDIT-25 yakuniy jonli
 * tekshiruv): band, ustun bandi, bosqich matni — chegara AYNAN
 * `normalizeSlide` niki (`bulletClipLimit`, `clipLimit(…, NO_IMAGE)`,
 * son — slayddagi haqiqiy son, ustunda o'shaniki). Bunday slayd — HAMMA
 * slaydga (blok slaydi ham: maqsadlar kesilgan chiqmasin) ta'mir nomzodi:
 * model matnni ma'nosini saqlab QISQARTIRADI; qisqartirilgani yana
 * sig'masa — `mergeRepair` yana qirqadi, «…» qoladi va javob rad etiladi
 * (asl kesik saqlanadi — yomonlashmaydi). Test varianti — `clipped-option`.
 */
function clippedText(s: SlideModel, rules: BodyRules, visual?: SlideVisual): boolean {
  if (s.layout === "bullets") {
    const list = (s.bullets ?? []).filter((b) => b.trim());
    const cap = bulletClipLimit(rules, visual, list.length);
    return list.some((b) => clippedAt(b, cap));
  }
  if (s.layout === "process") {
    const list = s.steps ?? [];
    const cap = clipLimit("stepText", rules, visual, list.length, undefined, NO_IMAGE);
    return list.some((st) => clippedAt(st.text, cap));
  }
  if (s.layout === "twoCol" || s.layout === "compare") {
    const side = (items: string[] | undefined) => {
      const list = (items ?? []).filter((x) => x.trim());
      const cap = clipLimit("colItem", rules, visual, list.length, undefined, NO_IMAGE);
      return list.some((x) => clippedAt(x, cap));
    };
    return side(s.left) || side(s.right);
  }
  return false;
}

/**
 * Bitta slaydning yupqalik sabablari.
 *
 *   — bandlar/ustunlar/bosqichlar qoidasi FAQAT reja mazmun slaydlariga
 *     (`plan` raqam) — blok slaydlari (maqsadlar, uy vazifasi) qisqa
 *     bo'lishi tabiiy (P5 bilan bir qoida);
 *   — `empty-subtitle` va `clipped-option` — hamma slaydga;
 *   — `title`/`agenda`/`closing`/`answers`/`references`/`stats`/`table`/
 *     `quote` — hech qachon nomzod emas.
 *
 * Chegara quti sig'imidan katta bo'lmaydi: bolalar shriftida ustun
 * bandiga 4 so'z sig'sa, 5 so'z talab qilinmaydi (`Math.min`).
 */
export function thinReasons(s: SlideModel, rules: BodyRules, visual?: SlideVisual): ThinReason[] {
  const out: ThinReason[] = [];
  if (clippedText(s, rules, visual)) out.push("clipped-text");
  if (s.layout === "bullets") {
    if (!isPlanSlide(s)) return out;
    const list = (s.bullets ?? []).filter((b) => b.trim());
    if (list.length < rules.minBullets) out.push("few-bullets");
    // `bullet.min` = `bulletMinWords`, quti torroq bo'lsa undan ham past (sig'maydiganini talab qilmaymiz).
    if (!list.length || avgWords(list) < layoutWordTargets(rules, visual).bullet.min) out.push("short-bullets");
    return out;
  }
  if (s.layout === "process") {
    if (!isPlanSlide(s)) return out;
    const list = s.steps ?? [];
    /*
     * Chegara AUDITORIYA ruxsat bergan sondagi quti sig'imida
     * (`min(soni, stepsMax)`): ortiqcha bosqichli ro'yxat o'z chegarasini
     * o'zi pasaytira olmaydi (5 bosqich × 2 so'z «sig'adi» ≠ to'liq).
     */
    const n = Math.max(PROCESS_MIN_STEPS, Math.min(list.length, rules.stepsMax));
    const minWords = Math.min(STEP_MIN_WORDS, fitWords("stepText", rules, visual, n));
    // Ko'pchilik qoidasi: o'rtacha past YOKI birorta bosqich deyarli yorliq (≤ 3 so'z).
    const tiny = Math.min(4, minWords);
    if (list.length < PROCESS_MIN_STEPS || avgWords(list.map((st) => st.text)) < minWords || list.some((st) => words(st.text) < tiny)) {
      out.push("short-steps");
    }
    return out;
  }
  if (s.layout === "twoCol" || s.layout === "compare") {
    if (!isPlanSlide(s)) return out;
    const left = (s.left ?? []).filter((x) => x.trim());
    const right = (s.right ?? []).filter((x) => x.trim());
    const n = Math.min(SLIDE_LIMITS.colItems, Math.max(left.length, right.length, COL_MIN_ITEMS));
    const minWords = Math.min(COL_MIN_WORDS, fitWords("colItem", rules, visual, n));
    if (left.length < COL_MIN_ITEMS || right.length < COL_MIN_ITEMS || avgWords([...left, ...right]) < minWords) {
      out.push("short-columns");
    }
    return out;
  }
  if (s.layout === "section") {
    // Skelet subtitle ga faqat mavzu nomini yozadi; sarlavhani takrorlagan subtitle ham bo'sh.
    if (words(s.subtitle) < SECTION_SUBTITLE_MIN_WORDS || norm(s.subtitle) === norm(s.title)) out.push("empty-subtitle");
    return out;
  }
  if (s.layout === "quiz") {
    const cap = clipLimit("quizOption", rules, visual, undefined, undefined, NO_IMAGE);
    const bad = (s.quiz ?? []).some((q) => clippedAt(q.q, SLIDE_LIMITS.quizQ) || q.options.some((o) => clippedAt(o, cap) || o.length > cap));
    if (bad) out.push("clipped-option");
  }
  return out;
}

/**
 * Yupqa slaydlar ro'yxati (deka tartibida). `visual` — deka vizuali;
 * berilmasa sig'im barcha vizuallarning eng torisidan olinadi.
 */
export function thinSlides(slides: SlideModel[], rules: BodyRules, visual?: SlideVisual): { index: number; reasons: ThinReason[] }[] {
  const out: { index: number; reasons: ThinReason[] }[] = [];
  slides.forEach((s, index) => {
    const reasons = thinReasons(s, rules, visual);
    if (reasons.length) out.push({ index, reasons });
  });
  return out;
}

// ───────────────────────────────────────────────────────── ta'mir

/** Ta'mirga shundan kam vaqt qolsa — chaqirilmaydi (ta'mir yaxshilash, majburiyat emas). */
export const REPAIR_MIN_MS = 12_000;
/** Bitta ta'mir chaqiruvining eng uzun kutishi. */
export const REPAIR_TIMEOUT_MS = 45_000;
/** Bitta chaqiruvda eng ko'p shuncha slayd — javob token chegarasiga urilmasin. */
export const REPAIR_MAX_SLIDES = 8;
/** Ta'mirlangan variant/savol asli bilan shu ulushdagi BOSHI bo'yicha mos bo'lishi shart. */
export const REPAIR_PREFIX_SHARE = 0.6;

function list(v: unknown, n: number, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => clipTo(String(x ?? ""), max))
    .filter(Boolean)
    .slice(0, n);
}

/**
 * Yangi matn asl matnning DAVOMI yoki QISQARTMASImi — kalit o'zgarmasin.
 * Asl «…» siz; ikkalasining qisqasining `REPAIR_PREFIX_SHARE` qismi
 * (katta-kichik harfsiz) bir xil bo'lishi shart. Kesilgan variantni
 * to'ldirish ham, sig'maydiganini qisqartirish ham o'tadi; boshqa
 * variantning matnini shu o'ringa qo'yish (javob kalitini buzish) — yo'q.
 *
 * Qisqartirish ham TO'LIQ bo'lsin: yangi matn kamida min(asl uzunligi,
 * ⌈0.5 · qopqoq⌉) belgi (qayta sharh N1 — 178 belgilik variant «Am» ga
 * qisqartirilsa ham 2 belgili umumiy bosh bilan o'tib ketardi).
 */
function samePrefix(orig: string, next: string, cap: number): boolean {
  const a = norm(orig.replace(/…\s*$/u, ""));
  const b = norm(next.replace(/…\s*$/u, ""));
  if (b.length < Math.min(a.length, Math.ceil(0.5 * cap))) return false;
  const k = Math.ceil(REPAIR_PREFIX_SHARE * Math.min(a.length, b.length));
  return k > 0 && a.slice(0, k) === b.slice(0, k);
}

/**
 * Model javobini ASL slayd ustiga qo'yadi — faqat shu maketning MATN
 * maydonlari. `id`, `layout`, `title`, `plan`, rasm, izoh va boshqa
 * hamma narsa asl slayddan (spread) qoladi. Yaroqsiz javob — `null`.
 * Qirqish `clipLimit(…, NO_IMAGE)` bilan — `normalizeSlide` bilan BIR
 * xil rasmsiz chegara (AUDIT-25 P8): ta'mirlangan matn rasmli qutiga
 * sig'masa, rasm keyin joy beradi (`imageYieldField`), matn kesilmaydi.
 */
function mergeRepair(orig: SlideModel, raw: Record<string, unknown>, rules: BodyRules, visual?: SlideVisual): SlideModel | null {
  switch (orig.layout) {
    case "bullets": {
      // Son AVVAL, keyin shu SONDAGI quti — yozuvchi bilan bir funksiya (`bulletClipLimit`).
      const n = list(raw.bullets, rules.maxBullets, Number.MAX_SAFE_INTEGER).length;
      const bullets = list(raw.bullets, rules.maxBullets, bulletClipLimit(rules, visual, n));
      return bullets.length ? { ...orig, bullets } : null;
    }
    case "process": {
      if (!Array.isArray(raw.steps)) return null;
      /*
       * Son AVVAL qisiladi — auditoriya ruxsati va vizual sig'imi
       * (`maxSteps`): 1–4 sinfga 5 bosqich qaytarilsa ham 3 tasi olinadi,
       * matn esa AYNAN shu sondagi quti bilan qirqiladi. 3 dan kam — rad.
       */
      const n = Math.min(raw.steps.length, rules.stepsMax, layoutWordTargets(rules, visual).maxSteps);
      if (n < PROCESS_MIN_STEPS) return null;
      const textMax = clipLimit("stepText", rules, visual, n, undefined, NO_IMAGE);
      const titleMax = clipLimit("stepTitle", rules, visual, n, undefined, NO_IMAGE);
      const steps: SlideStep[] = [];
      for (const [i, x] of raw.steps.slice(0, n).entries()) {
        if (!x || typeof x !== "object") return null;
        const o = x as Record<string, unknown>;
        const title = clipTo(String(o.title ?? orig.steps?.[i]?.title ?? ""), titleMax);
        const text = clipTo(String(o.text ?? ""), textMax);
        if (!title || !text) return null;
        steps.push({ n: clipTo(String(orig.steps?.[i]?.n ?? o.n ?? i + 1), SLIDE_LIMITS.stepN), title, text });
      }
      return { ...orig, steps };
    }
    case "twoCol":
    case "compare": {
      /*
       * Son — prompt va `normalizeSlide` bilan BIR manba (INT-07):
       * `layoutWordTargets.maxColItems` (masalan 8–9 sinf `circle` da 2).
       * Ilgari statik 4 edi: ta'mir 4+4 bandni 42 belgida qabul qilar,
       * yozuvchi esa 2+2 ni 104 da — ta'mirlangan slayd sayozroq chiqardi.
       */
      const maxItems = Math.max(1, Math.min(SLIDE_LIMITS.colItems, layoutWordTargets(rules, visual).maxColItems));
      const n = Math.min(maxItems, Math.max(Array.isArray(raw.left) ? raw.left.length : 0, Array.isArray(raw.right) ? raw.right.length : 0));
      const itemMax = clipLimit("colItem", rules, visual, n, undefined, NO_IMAGE);
      const left = list(raw.left, maxItems, itemMax);
      const right = list(raw.right, maxItems, itemMax);
      if (!left.length || !right.length) return null;
      return {
        ...orig,
        leftTitle: orig.leftTitle || clipTo(String(raw.leftTitle ?? ""), SLIDE_LIMITS.colTitle),
        left,
        rightTitle: orig.rightTitle || clipTo(String(raw.rightTitle ?? ""), SLIDE_LIMITS.colTitle),
        right,
      };
    }
    case "section": {
      const subtitle = clipTo(String(raw.subtitle ?? ""), clipLimit("subtitleSection", rules, visual, undefined, undefined, NO_IMAGE));
      return subtitle ? { ...orig, subtitle } : null;
    }
    case "quiz": {
      /*
       * Test — eng xavfli ta'mir: javob kaliti buzilmasin.
       *   — savollar soni bir xil, har savolda AYNAN 4 variant;
       *   — `answer` asl indeks bilan bir xil (boshqasi — rad);
       *   — FAQAT belgilangan (kesilgan yoki qutiga sig'maydigan)
       *     variant o'zgaradi, qolgani asl matn BAYTMA-BAYT;
       *   — o'zgargan variant/savol asl matnning boshi bilan mos
       *     (`samePrefix`) — boshqa variant matnini shu o'ringa qo'yib
       *     javobni «ko'chirish» rad etiladi.
       */
      const cap = clipLimit("quizOption", rules, visual, undefined, undefined, NO_IMAGE);
      const orig_ = orig.quiz ?? [];
      if (!Array.isArray(raw.quiz) || raw.quiz.length !== orig_.length) return null;
      const quiz: NonNullable<SlideModel["quiz"]> = [];
      for (let j = 0; j < orig_.length; j += 1) {
        const x = raw.quiz[j];
        if (!x || typeof x !== "object") return null;
        const o = x as Record<string, unknown>;
        if (o.answer !== undefined && Number(o.answer) !== orig_[j].answer) return null;
        if (!Array.isArray(o.options) || o.options.length !== SLIDE_LIMITS.quizOptions) return null;
        const options: string[] = [];
        for (let k = 0; k < SLIDE_LIMITS.quizOptions; k += 1) {
          const was = orig_[j].options[k] ?? "";
          if (!clippedAt(was, cap) && was.length <= cap) {
            options.push(was);
            continue;
          }
          const next = clipTo(String(o.options[k] ?? ""), cap);
          if (!next || !samePrefix(was, next, cap)) return null;
          options.push(next);
        }
        let q = orig_[j].q;
        if (clippedAt(q, SLIDE_LIMITS.quizQ) && o.q) {
          const next = clipTo(String(o.q), SLIDE_LIMITS.quizQ);
          if (!samePrefix(q, next, SLIDE_LIMITS.quizQ)) return null;
          q = next;
        }
        quiz.push({ q, options, answer: orig_[j].answer });
      }
      return { ...orig, quiz };
    }
    default:
      return null;
  }
}

const REASON_TEXT: Record<ThinReason, (t: LayoutWordTargets, r: BodyRules, s: SlideModel) => string> = {
  "few-bullets": (_t, r) => `band kam — ${r.minBullets}–${r.maxBullets} ta band yozing`,
  "short-bullets": (t) => `bandlar juda qisqa — har biri ${fmtRange(t.bullet)} so‘zli TO‘LIQ gap (ta’rif, sabab, misol, oqibat)`,
  "short-steps": (t) =>
    `bosqich matni qisqa — ${t.maxSteps > PROCESS_MIN_STEPS ? `${PROCESS_MIN_STEPS}–${t.maxSteps}` : PROCESS_MIN_STEPS} bosqich; text: ${Object.entries(t.stepTextBy)
      .map(([n, r]) => `${n} bosqichda ${fmtRange(r)}`)
      .join(", ")} so‘z — nima qilinadi va natija nima`,
  "empty-subtitle": (t) => `subtitle bo‘sh — ${fmtRange(t.sectionSubtitle)} so‘zlik kirish: bu bo‘limda nima ko‘riladi`,
  "clipped-option": (t) =>
    `variant kesilgan yoki qutiga sig‘maydi — faqat shu variantni ≤ ${t.quizOptionMax} so‘z qilib, ASL MATNNING BOSHINI saqlab to‘ldiring/qisqartiring; qolgan variantlar, tartib va answer o‘zgarmasin`,
  "short-columns": (t) => `ustunlar yupqa — har ustunda ${fmtRange({ min: Math.min(3, t.maxColItems), max: t.maxColItems })} band, har band ${fmtRange(t.colItem)} so‘z`,
  "clipped-text": (t, _r, s) =>
    `matn kesilgan («…» bilan tugagan band) — FAQAT shu bandlarni ma’nosini saqlab QISQARTIRING: ${
      s.layout === "bullets"
        ? `har band ≤ ${t.bullet.max} so‘z`
        : s.layout === "process"
          ? `har bosqich text ≤ ${(t.stepTextBy[Math.max(PROCESS_MIN_STEPS, Math.min(s.steps?.length ?? 0, t.maxSteps))] ?? t.stepText).max} so‘z`
          : `har band ≤ ${t.colItem.max} so‘z`
    }; qolgan bandlar so‘zma-so‘z qolsin, «…» yozmang`,
};

/** Maket bo'yicha model qaytaradigan maydonlar (javob sxemasi uchun). */
const FIELDS: Partial<Record<SlideModel["layout"], string>> = {
  bullets: `"bullets":[""]`,
  process: `"steps":[{"n":"1","title":"","text":""}]`,
  twoCol: `"left":[""],"right":[""]`,
  compare: `"left":[""],"right":[""]`,
  section: `"subtitle":""`,
  quiz: `"quiz":[{"q":"","options":["","","",""],"answer":0}]`,
};

/** Modelga ko'rsatiladigan joriy mazmun — faqat matn maydonlari. */
function current(s: SlideModel): Record<string, unknown> {
  const pick: Record<string, unknown> = { layout: s.layout, title: s.title };
  for (const k of ["subtitle", "bullets", "leftTitle", "left", "rightTitle", "right", "steps", "quiz"] as const) {
    if (s[k] !== undefined) pick[k] = s[k];
  }
  return pick;
}

/**
 * Yupqa slaydlarni BITTA LLM chaqiruvi bilan to'ldiradi.
 *
 * Shartnoma (AUDIT-25, P1 `writeSlidesWithLlm` oxirida, `finalizeQuiz`
 * dan OLDIN, OLTI argument bilan chaqiradi):
 *   — YANGI massiv qaytaradi, kirishni o'zgartirmaydi;
 *   — hech qachon otmaydi: LLM yo'q/yiqildi/vaqt yetmadi → kirish nusxasi;
 *   — faqat yupqa slaydlar so'raladi (ko'pi bilan `REPAIR_MAX_SLIDES`);
 *   — javob faqat slayd ENDI yupqa bo'lmasa qabul qilinadi; `id`,
 *     `layout`, `title`, `plan`, rasm maydonlari asl slayddan qoladi.
 */
export async function repairThinSlides(
  slides: SlideModel[],
  meta: DocMeta,
  tpl: SlideTemplate,
  ctx: SlidePromptCtx,
  deadline?: number,
  jobDeadline?: number,
): Promise<SlideModel[]> {
  const out = slides.slice();
  try {
    if (!llmEnabled()) return out;
    const rules = bodyRules(meta, tpl.id);
    const visual = tpl.visual;
    const thin = thinSlides(out, rules, visual).slice(0, REPAIR_MAX_SLIDES);
    if (!thin.length) return out;
    const left = remainingMs(deadline);
    if (left < REPAIR_MIN_MS) return out;
    if (jobDeadline !== undefined && jobDeadline - Date.now() < REPAIR_MIN_MS) return out;

    const t = layoutWordTargets(rules, visual);
    const system = [
      languageDirective(meta.language),
      `Siz taqdimot muharririsiz: tayyor slaydlardagi YUPQA matnni boyitasiz, KESILGAN («…») matnni esa ma’nosini saqlab qisqartirasiz.`,
      `Mavzu: «${meta.topic}». Fan: ${meta.subject || "—"}.`,
      rules.note,
      `Har bullet — TO‘LIQ gap, ${fmtRange(t.bullet)} so‘z.`,
      ...wordTargetLines(rules, visual),
      `QOIDALAR: layout va title O‘ZGARMAYDI; faqat ko‘rsatilgan maydonlarni to‘liq qayta yozing. Mavjud fikrni chuqurlashtiring — ta’rif, sabab, misol, oqibat. Uydirma raqam, sana, manba, iqtibos YO‘Q. Boshqa slaydlarni takrorlamang.`,
      `Faqat JSON: {"slides":[{"index":0, ...maydonlar}]} — index so‘rovdagidek.`,
      ...researchLines(meta, tpl, ctx),
    ]
      .filter(Boolean)
      .join("\n");
    const user = [
      // Takrorlamaslik uchun deka tarkibi — bir qator.
      `Dekadagi slaydlar: ${out.map((s, i) => `${i}) ${s.title}`).join("; ")}.`,
      `Quyidagi ${thin.length} ta slayd yupqa yoki kesilgan. Har biri uchun ko‘rsatilgan maydonlarni qaytaring.`,
      ...thin.map(({ index, reasons }) => {
        const s = out[index];
        return [
          `index=${index} layout=${s.layout}`,
          `kamchilik: ${reasons.map((r) => REASON_TEXT[r](t, rules, s)).join("; ")}`,
          `qaytaring: {"index":${index},${FIELDS[s.layout] ?? ""}}`,
          `hozirgi: ${JSON.stringify(current(s))}`,
        ].join("\n");
      }),
    ].join("\n\n");
    const maxTokens = Math.min(6_000, 600 + 450 * thin.length);
    const raw = await llmComplete(system, user, maxTokens, {
      json: true,
      timeoutMs: Math.min(REPAIR_TIMEOUT_MS, left),
      deadline: jobDeadline,
    });
    const data = parseLlmJson(raw) as { slides?: unknown } | null;
    if (!Array.isArray(data?.slides)) return out;
    const wanted = new Set(thin.map((x) => x.index));
    let accepted = 0;
    for (const item of data.slides) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const index = Number(o.index);
      if (!Number.isInteger(index) || !wanted.has(index)) continue;
      wanted.delete(index);
      const merged = mergeRepair(out[index], o, rules, visual);
      // Faqat YAXSHILANGAN javob: slayd endi yupqa emas.
      if (merged && !thinReasons(merged, rules, visual).length) {
        out[index] = merged;
        accepted += 1;
      }
    }
    if (accepted < thin.length) console.warn("[slide-quality] ta’mir qabul qilindi", accepted, "/", thin.length);
    return out;
  } catch (e) {
    /*
     * Ta'mir — IXTIYORIY bosqich (`deadline.ts` qoidasi: ixtiyoriy bosqich
     * `DeadlineError` ni ham o'zining «o'tkazib yuborish» yo'liga
     * tushiradi). Tayyor deka yiqilmaydi va bu chaqiruv ish muddatini
     * cho'zmaydi: timeout — min(45 s, BOSQICH qoldig'i), bosqich muddati
     * esa rasm/yig'ish ulushidan OLDIN tugaydi, zanjir `jobDeadline` bilan
     * chegaralangan.
     */
    if (isDeadlineError(e)) console.warn("[slide-quality] ta’mir: ish muddati — o‘tkazib yuborildi");
    else console.warn("[slide-quality] ta’mir o‘tkazib yuborildi:", e instanceof Error ? e.message : e);
    return slides.slice();
  }
}
