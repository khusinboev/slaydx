import { slideLabels } from "./i18n";
import { isSlideFontId, type SlideFontId } from "./slide-fonts";
import { SLIDE_LIMITS, clipTo } from "./slide-limits";
import { photoSlot } from "./slide-layout";
import { refreshAnswerNote, rebuildAnswerKey } from "./slide-quiz";
import { buildSlideDeck } from "./slides";
import { isSlideLayout, type SlideLayout, type SlideModel, type SlideSrc } from "./slide-types";
import type { BodyRules } from "./slide-audience";
import type { AcademicDoc } from "./types";

/**
 * Ko'ruvchida tahrirlashning SOF mantig'i — DB, HTTP va React siz.
 *
 * Bu modul izomorf: uni klient (optimistik render, Ctrl+Z) ham, server
 * (`PATCH …/doc`) ham AYNAN bir xil chaqiradi. Shuning uchun bu yerdan
 * `slide-write.ts` ga import YO'Q — u `llm.ts` ni tortadi va klient
 * bundle'iga tushmaydi. `renumberSlides` shu sababdan lokal qayta
 * yozilgan; `tests/slide-edit.test.mts` uni `slide-write` nusxasi bilan
 * solishtirib qulflaydi.
 *
 * Uchta shartnoma:
 *   1) tahrir MODELGA qilinadi, maketga emas — `planSlide` keyin o'zi
 *      qayta chizadi va PPTX aynan shu rejadan yasaladi;
 *   2) hech bir operatsiya `normalizeSlide` dan o'tmaydi — u tahrir
 *      uchun XAVFLI: bo'sh jadval katagini FILTRLAB ustunni suradi;
 *   3) har operatsiyaning teskarisi bor (`inverseOps`) — undo klientda,
 *      serverda tarix saqlanmaydi.
 */

// ═══════════════════════════════════════════════════════ Tiplar

export type DocOp =
  | { op: "text"; index: number; src: SlideSrc; value: string }
  | { op: "notes"; index: number; value: string }
  | { op: "image"; index: number; url: string | null; alt?: string }
  | { op: "layout"; index: number; layout: SlideLayout }
  | { op: "add"; after: number }
  | { op: "delete"; index: number }
  | { op: "insert"; index: number; slide: SlideModel }
  | { op: "set"; index: number; slide: SlideModel }
  | { op: "reorder"; order: number[] }
  /**
   * Shrift: `size` (pt) va/yoki `font` (`SLIDE_FONTS` id si); `null` —
   * standartga qaytarish. Kamida bittasi berilishi shart.
   */
  | { op: "style"; index: number; src: SlideSrc; size?: number | null; font?: SlideFontId | null }
  /**
   * Ro'yxatni BUTUNICHA yozish — ko'ruvchida butun quti PowerPoint kabi
   * tahrirlanadi (Enter → yangi band). Bo'sh bandlar tashlanadi, har band
   * chegaraga qisqaradi, soni chegaradan oshsa xato. Teskarisi — `set`.
   */
  | { op: "list"; index: number; field: ListField; items: string[] }
  /** Asl (AI) rasmni `imageOrig` dan qaytarish — u bo'lmasa xato. */
  | { op: "imageRestore"; index: number }
  /** Kolontitul — DEKA darajasida, BARCHA slaydlarning `footer` maydoniga. */
  | { op: "footer"; value: string }
  /** Test javobini o'zgartirish: `slides[index].quiz[q].answer = answer` (0..3), javoblar kaliti qayta yig'iladi. */
  | { op: "answer"; index: number; q: number; answer: number };

/** `list` op maydonlari — bir xil turdagi satrlar ro'yxati. */
export type ListField = "bullets" | "left" | "right";
export const LIST_FIELDS: readonly ListField[] = ["bullets", "left", "right"];

/** Operatsiyalarni qo'llash konteksti — hozircha faqat generatsiya id si (aktiv egaligi). */
export type EditCtx = { genId: string };

export type EditResult =
  | { ok: true; doc: AcademicDoc }
  /** `at` — nechanchi operatsiyada yiqildi (API 422 tanasiga tushadi). */
  | { ok: false; error: string; at: number };

export type FieldResult = { ok: true; slide: SlideModel } | { ok: false; error: string };

export type ConvertCheck =
  /** `lossy` — o'girishda ma'lumot yo'qoladi (ustun sarlavhasi, javob kaliti, havola). */
  | { ok: true; lossy: boolean }
  | { ok: false; reason: string };

/** `writeSlideField` ga kerak bo'ladigan qoidalar — `bodyRules` ning kichik qismi. */
export type EditRules = Pick<BodyRules, "maxBullets" | "bulletChars" | "agendaMax">;

// ═══════════════════════════════════════════════════════ Yordamchilar

/**
 * Slayd `id` larini o'rin bo'yicha qayta raqamlaydi.
 *
 * `slide-write.ts` dagi `renumberSlides` NUSXASI (o'sha fayl LLM ni
 * tortgani uchun bu yerga import qilinmaydi). Ikkalasining natijasi bir
 * xilligi test bilan qulflangan — integratsiyada birlashtirilishi mumkin.
 */
function renumber(slides: SlideModel[]): SlideModel[] {
  return slides.map((s, i) => (s.id === `s${i}` ? s : { ...s, id: `s${i}` }));
}

/**
 * `doc.sections` ni slaydlardan qayta yig'adi.
 *
 * `slide-write.ts:791-800` naqshining nusxasi — mundarija/HTML shu
 * ro'yxatdan chiziladi, ya'ni tahrirdan keyin u ham yangilanishi kerak.
 * Integratsiyada `slideSections` eksporti bilan almashtiriladi.
 */
function sectionsOf(slides: SlideModel[]): AcademicDoc["sections"] {
  return slides
    .filter((s) => s.layout !== "title" && s.layout !== "closing")
    .map((s) => ({
      id: s.id,
      title: s.title,
      blocks: (s.bullets?.length ? s.bullets : [s.subtitle || s.quote || s.title]).map((text) => ({
        kind: "p" as const,
        text,
      })),
    }));
}

/**
 * Notiq izohi uchun qisqartirish — QATORLAR saqlanadi.
 *
 * `clipTo` hamma bo'shliqni bittaga tushiradi va abzatslarni yo'q
 * qiladi; izoh esa ko'p qatorli bo'lishi mumkin («Javob: B — …» qatori
 * ham shu yerda yashaydi).
 */
function clipNotes(text: string): string {
  const t = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const n = SLIDE_LIMITS.notesEdit;
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

/** Maydonni o'chirish — `undefined` QIYMAT emas, kalitning O'ZI yo'qoladi (JSON tengligi uchun). */
function without(s: SlideModel, key: keyof SlideModel): SlideModel {
  if (!(key in s)) return s;
  const copy = { ...s };
  delete copy[key];
  return copy;
}

function setOrDrop(s: SlideModel, key: "kicker" | "subtitle" | "quoteBy" | "imageHint", value: string): SlideModel {
  return value ? { ...s, [key]: value } : without(s, key);
}

/** Slaydning `subtitle` chegarasi maketga bog'liq (`normalizeSlide` bilan bir xil). */
function subtitleMax(layout: SlideLayout): number {
  if (layout === "section") return SLIDE_LIMITS.subtitleSection;
  if (layout === "closing") return SLIDE_LIMITS.subtitleClosing;
  return SLIDE_LIMITS.subtitle;
}

/** Bandlar soni va uzunligi maketga bog'liq: reja `agendaMax`, javoblar kaliti 10 qator. */
function bulletCaps(s: SlideModel, rules: EditRules): { max: number; chars: number } {
  if (s.layout === "agenda") return { max: rules.agendaMax, chars: rules.bulletChars };
  if (s.layout === "answers") return { max: SLIDE_LIMITS.quizMax, chars: SLIDE_LIMITS.answersItem };
  return { max: rules.maxBullets, chars: rules.bulletChars };
}

/**
 * Ro'yxatga yozish: bo'sh qiymat elementni O'CHIRADI, `i === length`
 * esa yangi element QO'SHADI (chegara ichida).
 */
function writeList(list: string[], i: number, value: string, max: number): { ok: true; list: string[] } | { ok: false; error: string } {
  if (!Number.isInteger(i) || i < 0 || i > list.length) return { ok: false, error: "Band indeksi noto'g'ri" };
  if (i === list.length) {
    if (!value) return { ok: true, list };
    if (list.length >= max) return { ok: false, error: `Bu maketda ${max} tadan ortiq band bo'lmaydi` };
    return { ok: true, list: [...list, value] };
  }
  if (!value) return { ok: true, list: list.filter((_, k) => k !== i) };
  return { ok: true, list: list.map((x, k) => (k === i ? value : x)) };
}

// ═══════════════════════════════════════════════════════ Aktiv URL

/**
 * Slayd rasmi FAQAT shu generatsiyaning aktivi bo'lishi mumkin.
 *
 * Tashqi URL (SSRF) ham, boshqa foydalanuvchi generatsiyasining aktivi
 * ham rad etiladi: `renderPptx` keyin bu manzilni SERVER tomonda
 * o'qiydi. Aktiv id — `assetIdFor` (SHA-256 ning 24 belgisi).
 */
export function ownAssetUrlRe(genId: string): RegExp {
  const safe = /^[A-Za-z0-9_-]{1,64}$/.test(genId) ? genId : "\x00";
  return new RegExp(`^/api/generations/${safe}/assets/[0-9a-f]{16,64}$`);
}

// ═══════════════════════════════════════════════════════ O'qish

/** Qatlam matni modelning qaysi qiymatidan chizilgan — `null` = bunday maydon yo'q. */
export function readSlideField(s: SlideModel, src: SlideSrc): string | null {
  switch (src.f) {
    case "title":
      return s.title ?? null;
    case "subtitle":
      return s.subtitle ?? null;
    case "kicker":
      return s.kicker ?? null;
    case "quote":
      return s.quote ?? null;
    case "quoteBy":
      return s.quoteBy ?? null;
    case "leftTitle":
      return s.leftTitle ?? null;
    case "rightTitle":
      return s.rightTitle ?? null;
    case "imageHint":
      return s.imageHint ?? null;
    case "footer":
      return s.footer ?? null;
    case "bullets":
    case "left":
    case "right": {
      const list = s[src.f];
      return list?.[src.i] ?? null;
    }
    case "stats": {
      const st = s.stats?.[src.i];
      return st ? st[src.k] ?? null : null;
    }
    case "steps": {
      const st = s.steps?.[src.i];
      return st ? st[src.k] ?? null : null;
    }
    case "refs": {
      const r = s.refs?.[src.i];
      return r ? r[src.k] ?? null : null;
    }
    case "quiz": {
      const q = s.quiz?.[src.i];
      if (!q) return null;
      return src.k === "q" ? q.q : q.options[src.j] ?? null;
    }
    case "table": {
      if (!s.table) return null;
      if (src.k === "header") return s.table.headers[src.c] ?? null;
      return s.table.rows[src.r]?.[src.c] ?? null;
    }
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════ Yozish

/**
 * Bitta maydonni yozadi (sof — nusxa qaytaradi).
 *
 * Qoidalar (rejadagi shartnoma):
 *   — `title` bo'sh bo'lolmaydi (sarlavhasiz slayd maketni buzadi);
 *   — test varianti bo'sh bo'lolmaydi (A/B/C/D AYNAN to'rtta);
 *   — jadval katagi `""` bo'lib SAQLANADI — ustun surilmaydi;
 *   — `bullets`/`left`/`right`/`stats`/`steps`/`refs` da bo'sh qiymat
 *     elementni o'chiradi, `i === length` esa qo'shadi;
 *   — variant o'zgarsa javob izohi qayta hisoblanadi;
 *   — har qiymat `clipTo` bilan maket chegarasiga qisqaradi.
 */
export function writeSlideField(s: SlideModel, src: SlideSrc, value: string, rules: EditRules): FieldResult {
  switch (src.f) {
    case "title": {
      const v = clipTo(value, SLIDE_LIMITS.title);
      if (!v) return { ok: false, error: "Sarlavha bo'sh bo'lishi mumkin emas" };
      return { ok: true, slide: { ...s, title: v } };
    }
    case "subtitle":
      return { ok: true, slide: setOrDrop(s, "subtitle", clipTo(value, subtitleMax(s.layout))) };
    case "kicker":
      return { ok: true, slide: setOrDrop(s, "kicker", clipTo(value, SLIDE_LIMITS.kicker)) };
    case "imageHint":
      return { ok: true, slide: setOrDrop(s, "imageHint", clipTo(value, SLIDE_LIMITS.imageHint)) };
    case "quoteBy":
      return { ok: true, slide: setOrDrop(s, "quoteBy", clipTo(value, SLIDE_LIMITS.quoteBy)) };
    case "footer":
      // Kolontitul DEKA darajasida — bitta slaydga yozib bo'lmaydi, `{op:"footer"}` ishlatilsin.
      return { ok: false, error: "Kolontitul deka darajasida — footer op" };
    case "quote": {
      if (s.quote == null) return { ok: false, error: "Bu maketda iqtibos yo'q" };
      const v = clipTo(value, SLIDE_LIMITS.quote);
      // Bo'sh iqtibos — `planQuote` sarlavhaga qaytadi, ya'ni slayd bo'sh qolmaydi.
      return { ok: true, slide: v ? { ...s, quote: v } : without(s, "quote") };
    }
    case "leftTitle":
    case "rightTitle": {
      if (s.layout !== "twoCol" && s.layout !== "compare") return { ok: false, error: "Bu maketda ustun sarlavhasi yo'q" };
      return { ok: true, slide: { ...s, [src.f]: clipTo(value, SLIDE_LIMITS.colTitle) } };
    }
    case "bullets": {
      if (!s.bullets) return { ok: false, error: "Bu maketda bandlar yo'q" };
      const caps = bulletCaps(s, rules);
      const w = writeList(s.bullets, src.i, clipTo(value, caps.chars), caps.max);
      return w.ok ? { ok: true, slide: { ...s, bullets: w.list } } : w;
    }
    case "left":
    case "right": {
      const list = s[src.f];
      if (!list) return { ok: false, error: "Bu maketda ustun yo'q" };
      const w = writeList(list, src.i, clipTo(value, SLIDE_LIMITS.colItem), SLIDE_LIMITS.colItems);
      return w.ok ? { ok: true, slide: { ...s, [src.f]: w.list } } : w;
    }
    case "stats": {
      if (!s.stats) return { ok: false, error: "Bu maketda raqamlar yo'q" };
      const i = src.i;
      if (!Number.isInteger(i) || i < 0 || i > s.stats.length) return { ok: false, error: "Raqam indeksi noto'g'ri" };
      if (i === s.stats.length) {
        // Yangi karta faqat QIYMAT bilan tug'iladi: yorliqsiz raqam ma'noli, raqamsiz yorliq — yo'q.
        const v = clipTo(value, SLIDE_LIMITS.statValue);
        if (src.k !== "value" || !v) return { ok: true, slide: s };
        if (s.stats.length >= SLIDE_LIMITS.statsMax) return { ok: false, error: `Bu maketda ${SLIDE_LIMITS.statsMax} tadan ortiq raqam bo'lmaydi` };
        return { ok: true, slide: { ...s, stats: [...s.stats, { value: v, label: "" }] } };
      }
      if (src.k === "value") {
        const v = clipTo(value, SLIDE_LIMITS.statValue);
        // Qiymatsiz karta — bo'sh kvadrat. Butun element o'chadi.
        if (!v) return { ok: true, slide: { ...s, stats: s.stats.filter((_, k) => k !== i) } };
        return { ok: true, slide: { ...s, stats: s.stats.map((x, k) => (k === i ? { ...x, value: v } : x)) } };
      }
      // Yorliq bo'sh bo'lishi MUMKIN — raqamning o'zi ham ma'no beradi.
      const label = clipTo(value, SLIDE_LIMITS.statLabel);
      return { ok: true, slide: { ...s, stats: s.stats.map((x, k) => (k === i ? { ...x, label } : x)) } };
    }
    case "steps": {
      if (!s.steps) return { ok: false, error: "Bu maketda bosqichlar yo'q" };
      const i = src.i;
      if (!Number.isInteger(i) || i < 0 || i > s.steps.length) return { ok: false, error: "Bosqich indeksi noto'g'ri" };
      const max = { n: SLIDE_LIMITS.stepN, title: SLIDE_LIMITS.stepTitle, text: SLIDE_LIMITS.stepText }[src.k];
      const v = clipTo(value, max);
      if (i === s.steps.length) {
        if (src.k !== "title" || !v) return { ok: true, slide: s };
        if (s.steps.length >= SLIDE_LIMITS.stepsMax) return { ok: false, error: `Bu maketda ${SLIDE_LIMITS.stepsMax} tadan ortiq bosqich bo'lmaydi` };
        return { ok: true, slide: { ...s, steps: [...s.steps, { n: String(i + 1), title: v, text: "" }] } };
      }
      // Sarlavhasiz bosqich karta sifatida ma'nosiz — element o'chadi.
      if (src.k === "title" && !v) return { ok: true, slide: { ...s, steps: s.steps.filter((_, k) => k !== i) } };
      return { ok: true, slide: { ...s, steps: s.steps.map((x, k) => (k === i ? { ...x, [src.k]: v } : x)) } };
    }
    case "refs": {
      if (!s.refs) return { ok: false, error: "Bu maketda manbalar yo'q" };
      const i = src.i;
      if (!Number.isInteger(i) || i < 0 || i > s.refs.length) return { ok: false, error: "Manba indeksi noto'g'ri" };
      const max = src.k === "title" ? SLIDE_LIMITS.refTitle : SLIDE_LIMITS.refSource;
      const v = clipTo(value, max);
      if (i === s.refs.length) {
        // Yangi manba faqat NOMI bilan tug'iladi (havolani keyin yozadi).
        if (src.k !== "title" || !v) return { ok: true, slide: s };
        if (s.refs.length >= SLIDE_LIMITS.refsMax) return { ok: false, error: `Bu maketda ${SLIDE_LIMITS.refsMax} tadan ortiq manba bo'lmaydi` };
        return { ok: true, slide: { ...s, refs: [...s.refs, { title: v, source: "" }] } };
      }
      const next = { ...s.refs[i], [src.k]: v };
      // Nomi ham, havolasi ham bo'sh — manba qolmadi.
      if (!next.title && !next.source) return { ok: true, slide: { ...s, refs: s.refs.filter((_, k) => k !== i) } };
      return { ok: true, slide: { ...s, refs: s.refs.map((x, k) => (k === i ? next : x)) } };
    }
    case "quiz": {
      const q = s.quiz?.[src.i];
      if (!q) return { ok: false, error: "Bunday savol yo'q" };
      if (src.k === "q") {
        const v = clipTo(value, SLIDE_LIMITS.quizQ);
        // Savolsiz test slaydi — to'rtta variant nimaga tegishli ekani yo'qoladi.
        if (!v) return { ok: false, error: "Savol bo'sh bo'lishi mumkin emas" };
        return { ok: true, slide: { ...s, quiz: s.quiz!.map((x, k) => (k === src.i ? { ...x, q: v } : x)) } };
      }
      if (src.j < 0 || src.j >= q.options.length) return { ok: false, error: "Variant indeksi noto'g'ri" };
      const v = clipTo(value, SLIDE_LIMITS.quizOption);
      /*
       * Variant AYNAN to'rtta bo'lishi shart: `planQuiz` A/B/C/D
       * kartalarini chizadi va `answer` indeksi shu tartibga bog'langan.
       * Bo'sh variantga ruxsat berilsa, karta bo'sh chiqar yoki element
       * o'chib javob boshqa variantga siljirdi — YOLG'ON kalit.
       */
      if (!v) return { ok: false, error: "Variant bo'sh bo'lishi mumkin emas" };
      const quiz = s.quiz!.map((x, k) => (k === src.i ? { ...x, options: x.options.map((o, j) => (j === src.j ? v : o)) } : x));
      // Javob izohi variant MATNINI o'z ichiga oladi — qayta hisoblanadi.
      return { ok: true, slide: refreshAnswerNote({ ...s, quiz }) };
    }
    case "table": {
      if (!s.table) return { ok: false, error: "Bu maketda jadval yo'q" };
      const v = clipTo(value, src.k === "header" ? SLIDE_LIMITS.tableHeaderWide : SLIDE_LIMITS.tableCell);
      if (src.k === "header") {
        if (src.c < 0 || src.c >= s.table.headers.length) return { ok: false, error: "Ustun indeksi noto'g'ri" };
        if (!v) return { ok: false, error: "Ustun sarlavhasi bo'sh bo'lishi mumkin emas" };
        return { ok: true, slide: { ...s, table: { ...s.table, headers: s.table.headers.map((h, c) => (c === src.c ? v : h)) } } };
      }
      const row = s.table.rows[src.r];
      if (!row || src.c < 0 || src.c >= row.length) return { ok: false, error: "Katak indeksi noto'g'ri" };
      /*
       * Bo'sh katak SAQLANADI. `normalizeSlide` uni filtrlab tashlardi va
       * qatordagi qolgan kataklar chapga surilib, ma'lumot BOSHQA ustunga
       * tushardi — tahrirda bu jimgina buzilish bo'lardi.
       */
      const rows = s.table.rows.map((r, ri) => (ri === src.r ? r.map((c, ci) => (ci === src.c ? v : c)) : r));
      return { ok: true, slide: { ...s, table: { ...s.table, rows } } };
    }
    default:
      return { ok: false, error: "Noma'lum maydon" };
  }
}

// ═══════════════════════════════════════════════════════ Maket o'girish

/**
 * Stats qiymatidan sonni ajratadi.
 *
 * `slide-layout.ts:1588` `parseStatNumber` NUSXASI — u hali eksport
 * emas; integratsiyada eksportga almashtiriladi (reja: «`slide-layout.ts`
 * — `parseStatNumber` eksport»). Mantiq bir xil bo'lishi test bilan
 * qulflanmaydi (funksiya eksport emas), shuning uchun nusxa AYNAN.
 */
function parseStatNumber(value: string): number | null {
  const t = value.replace(/\u00a0/g, " ").trim().toLowerCase();
  if (/^[a-z]+\d/i.test(t)) return null;
  const m = t.match(/-?\d[\d\s.,]*/);
  if (!m) return null;
  const raw = m[0].replace(/\s/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".");
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (/mlrd|milliard|billion/.test(t)) return n * 1e9;
  if (/mln|million/.test(t)) return n * 1e6;
  if (/ming|thousand/.test(t)) return n * 1e3;
  return n;
}

/** Bandni «qiymat + yorliq» ga ajratadi: «95% — qoniqish» → {value:"95%", label:"qoniqish"}. */
function splitStat(b: string): { value: string; label: string } | null {
  const m = b.trim().match(/^(\S+)\s*(?:[—–:-]\s*)?(.*)$/);
  if (!m) return null;
  if (parseStatNumber(m[1]) == null) return null;
  return { value: clipTo(m[1], SLIDE_LIMITS.statValue), label: clipTo(m[2], SLIDE_LIMITS.statLabel) };
}

/** Bandni «sarlavha — matn» ga ajratadi (`coerceLayout` naqshi). */
function splitStep(b: string, i: number): { n: string; title: string; text: string } {
  const [head, ...rest] = b.split(/\s+[—–:-]\s+/);
  return {
    n: String(i + 1),
    title: clipTo(head, SLIDE_LIMITS.stepTitle),
    text: clipTo(rest.join(" — "), SLIDE_LIMITS.stepText),
  };
}

/** Har maketdan bandlar hovuzi — «→ bullets» o'girishlari shundan boshlanadi. */
function bulletPool(s: SlideModel): string[] {
  switch (s.layout) {
    case "twoCol":
    case "compare":
      return [...(s.left ?? []), ...(s.right ?? [])];
    case "stats":
      return (s.stats ?? []).map((x) => (x.label ? `${x.value} — ${x.label}` : x.value));
    case "process":
      return (s.steps ?? []).map((x) => (x.text ? `${x.title} — ${x.text}` : x.title));
    case "table":
      return (s.table?.rows ?? []).map((r) => r.filter(Boolean).join(" — "));
    case "quiz":
      return (s.quiz ?? []).map((q) => q.q);
    case "references":
      return (s.refs ?? []).map((r) => (r.source && r.source !== r.title ? `${r.title} — ${r.source}` : r.title));
    case "quote":
      return [s.quote, s.quoteBy].filter((x): x is string => Boolean(x));
    case "title":
    case "section":
    case "closing":
      return [s.subtitle].filter((x): x is string => Boolean(x));
    default:
      return s.bullets ?? [];
  }
}

/**
 * O'girish jadvali — rejadagi «Maket o'zgartirish jadvali» AYNAN.
 *
 * `true` — ruxsat, `"lossy"` — ruxsat, lekin ma'lumot yo'qoladi
 * (ustun sarlavhasi, javob kaliti, havola, iqtibos muallifi).
 * Jadvalda yo'q juftlik — TAQIQ: u uydirma ma'lumot talab qiladi
 * (`→ table`, `→ quiz`, `→ references`, `→ answers`, raqamsiz `→ stats`)
 * yoki ma'nosiz (`→ title` — muqova bitta bo'ladi).
 */
const CONVERSIONS: Record<string, "ok" | "lossy"> = {
  "bullets>agenda": "ok",
  "agenda>bullets": "ok",
  "twoCol>compare": "ok",
  "compare>twoCol": "ok",
  "title>section": "ok",
  "section>title": "ok",
  "title>closing": "ok",
  "closing>title": "ok",
  "section>closing": "ok",
  "closing>section": "ok",
  "bullets>twoCol": "ok",
  "twoCol>bullets": "lossy",
  "compare>bullets": "lossy",
  "bullets>process": "ok",
  "process>bullets": "lossy",
  "bullets>stats": "ok",
  "stats>bullets": "lossy",
  "quote>section": "ok",
  "quote>closing": "ok",
  "quote>bullets": "lossy",
  "section>quote": "ok",
  "closing>quote": "ok",
  "bullets>quote": "lossy",
  "table>bullets": "lossy",
  "quiz>bullets": "lossy",
  "references>bullets": "lossy",
  "answers>bullets": "lossy",
};

/**
 * Shu slaydni shu maketga o'girish MUMKINMI.
 *
 * Ikki bosqich: (1) jadvalda juftlik bormi, (2) MAZMUN yetadimi —
 * raqamsiz bandlardan `stats` yasab bo'lmaydi (uydirma raqam), bitta
 * banddan ikki ustun chiqmaydi. Ko'ruvchi shu funksiya bilan maket
 * chiplarini o'chiradi, server esa qabul qilmaydi.
 */
export function canConvert(s: SlideModel, to: SlideLayout): ConvertCheck {
  if (!isSlideLayout(to)) return { ok: false, reason: "Noma'lum maket" };
  if (s.layout === to) return { ok: true, lossy: false };
  const rule = CONVERSIONS[`${s.layout}>${to}`];
  if (!rule) return { ok: false, reason: `«${s.layout}» maketini «${to}» ga o'girib bo'lmaydi` };
  const pool = bulletPool(s).filter(Boolean);
  if (to === "stats") {
    if (!pool.length) return { ok: false, reason: "Raqam yo'q — stats maketi uydirma talab qiladi" };
    if (pool.some((b) => splitStat(b) == null)) return { ok: false, reason: "Har band raqamdan boshlanishi kerak" };
  }
  if ((to === "twoCol" || to === "compare") && s.layout === "bullets" && pool.length < 2) {
    return { ok: false, reason: "Ikki ustun uchun kamida ikki band kerak" };
  }
  if (to === "process" && pool.length < 1) return { ok: false, reason: "Bosqich uchun band kerak" };
  if (to === "quote" && !pool.length) return { ok: false, reason: "Iqtibos uchun matn yo'q" };
  return { ok: true, lossy: rule === "lossy" };
}

/** Faqat maketga bog'liq bo'lmagan «tana» maydonlari — o'girishda qolganlari tashlanadi. */
function baseOf(s: SlideModel, to: SlideLayout): SlideModel {
  const out: SlideModel = { id: s.id, layout: to, title: s.title };
  if (s.kicker) out.kicker = s.kicker;
  if (s.footer) out.footer = s.footer;
  if (s.notes) out.notes = s.notes;
  if (s.imageHint) out.imageHint = s.imageHint;
  if (s.image) out.image = s.image;
  return out;
}

/**
 * Maketni o'giradi (sof). `canConvert` rad etsa — xato, model o'zgarmaydi.
 *
 * Kerakmas maydonlar TASHLANADI (bandlarga o'girilgan jadval `table`
 * maydonini olib qolmaydi): aks holda maketni orqaga qaytarganda eski
 * ma'lumot «tirilib» chiqar va ekranda ko'ringan bilan PPTX farq qilardi.
 */
export function convertLayout(s: SlideModel, to: SlideLayout, rules: EditRules): FieldResult {
  const check = canConvert(s, to);
  if (!check.ok) return { ok: false, error: check.reason };
  if (s.layout === to) return { ok: true, slide: s };
  const base = baseOf(s, to);
  const pool = bulletPool(s).filter(Boolean);
  if (to === "bullets" || to === "agenda") {
    const caps = bulletCaps({ ...base, layout: to }, rules);
    return { ok: true, slide: { ...base, bullets: pool.slice(0, caps.max).map((b) => clipTo(b, caps.chars)) } };
  }
  if (to === "twoCol" || to === "compare") {
    if (s.left || s.right) {
      const slide: SlideModel = { ...base, left: s.left ?? [], right: s.right ?? [] };
      slide.leftTitle = s.leftTitle || (to === "compare" ? "Birinchi" : "");
      slide.rightTitle = s.rightTitle || (to === "compare" ? "Ikkinchi" : "");
      return { ok: true, slide };
    }
    const items = pool.map((b) => clipTo(b, SLIDE_LIMITS.colItem));
    const mid = Math.ceil(items.length / 2);
    return {
      ok: true,
      slide: {
        ...base,
        leftTitle: to === "compare" ? "Birinchi" : "",
        left: items.slice(0, mid).slice(0, SLIDE_LIMITS.colItems),
        rightTitle: to === "compare" ? "Ikkinchi" : "",
        right: items.slice(mid).slice(0, SLIDE_LIMITS.colItems),
      },
    };
  }
  if (to === "process") {
    return { ok: true, slide: { ...base, steps: pool.slice(0, SLIDE_LIMITS.stepsMax).map(splitStep) } };
  }
  if (to === "stats") {
    const stats = pool.map(splitStat).filter((x): x is { value: string; label: string } => Boolean(x));
    return { ok: true, slide: { ...base, stats: stats.slice(0, SLIDE_LIMITS.statsMax) } };
  }
  if (to === "quote") {
    return { ok: true, slide: { ...base, quote: clipTo(s.quote || pool[0] || s.title, SLIDE_LIMITS.quote) } };
  }
  // title / section / closing — izoh matni saqlanadi.
  const sub = clipTo(s.subtitle || s.quote || pool[0] || "", subtitleMax(to));
  return { ok: true, slide: sub ? { ...base, subtitle: sub } : base };
}

// ═══════════════════════════════════════════════════════ Yangi slayd

/**
 * Bo'sh slayd — sarlavhasi HUJJAT tilida.
 *
 * Klientdan model kelmaydi (`{op:"add", after}`), shuning uchun uni
 * shu yerda kod yasaydi: `bullets` maketi, bo'sh ro'yxat, tarjima
 * qilingan sarlavha (`SlideLabels.newSlide`).
 */
export function newSlide(after: number, lang: string): SlideModel {
  return { id: `s${after + 1}`, layout: "bullets", title: slideLabels(lang).newSlide, bullets: [] };
}

// ═══════════════════════════════════════════════════════ Tozalash

/**
 * Klientdan kelgan slayd modelini OQ-RO'YXAT bo'yicha tozalaydi.
 *
 * `insert`/`set` operatsiyalari butun modelni olib keladi (undo, maket
 * qaytarish), ya'ni bu yagona joy — noma'lum maydon, uzun matn, begona
 * rasm URL i va buzuq test shu yerda to'xtaydi. `normalizeSlide` dan
 * farqi: jadval kataklari FILTRLANMAYDI (ustun surilmaydi) va matn
 * yo'qolmaydi — faqat chegaraga qisqaradi.
 */
export function sanitizeSlideModel(raw: unknown, genId: string, rules: EditRules): SlideModel | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const layoutRaw = typeof o.layout === "string" ? o.layout : "";
  if (!isSlideLayout(layoutRaw)) return null;
  const layout: SlideLayout = layoutRaw;
  const title = clipTo(String(o.title ?? ""), SLIDE_LIMITS.title);
  if (!title) return null;
  const out: SlideModel = { id: typeof o.id === "string" && o.id ? clipTo(o.id, 40) : "s0", layout, title };

  const str = (v: unknown, n: number) => (typeof v === "string" ? clipTo(v, n) : "");
  const list = (v: unknown, max: number, chars: number) =>
    Array.isArray(v)
      ? v
          .filter((x) => typeof x === "string")
          .map((x) => clipTo(x as string, chars))
          .filter(Boolean)
          .slice(0, max)
      : [];

  const kicker = str(o.kicker, SLIDE_LIMITS.kicker);
  if (kicker) out.kicker = kicker;
  const subtitle = str(o.subtitle, subtitleMax(layout));
  if (subtitle) out.subtitle = subtitle;
  const footer = str(o.footer, FOOTER_MAX);
  if (footer) out.footer = footer;
  if (typeof o.notes === "string") {
    const notes = clipNotes(o.notes);
    if (notes) out.notes = notes;
  }
  if (o.fontSize && typeof o.fontSize === "object" && !Array.isArray(o.fontSize)) {
    const fs: Record<string, number> = {};
    for (const [k, v] of Object.entries(o.fontSize as Record<string, unknown>)) {
      if (k.length <= 80 && typeof v === "number" && v >= FONT_MIN && v <= FONT_MAX) fs[k] = Math.round(v);
    }
    if (Object.keys(fs).length) out.fontSize = fs;
  }
  if (o.font && typeof o.font === "object" && !Array.isArray(o.font)) {
    const ff: Record<string, SlideFontId> = {};
    for (const [k, v] of Object.entries(o.font as Record<string, unknown>)) {
      // Faqat reyestrdagi id — begona nom PPTX `fontFace` ga tushmasin.
      if (k.length <= 80 && isSlideFontId(v)) ff[k] = v;
    }
    if (Object.keys(ff).length) out.font = ff;
  }
  const hint = str(o.imageHint, SLIDE_LIMITS.imageHint);
  if (hint) out.imageHint = hint;
  // Rasm (va asl rasm) FAQAT shu generatsiyaning aktivi bo'lishi mumkin (SSRF himoyasi).
  const image = ownImage(o.image, genId, str);
  if (image) out.image = image;
  const orig = ownImage(o.imageOrig, genId, str);
  if (orig) out.imageOrig = orig;

  const caps = bulletCaps(out, rules);
  const bullets = list(o.bullets, caps.max, caps.chars);
  if (bullets.length || layout === "bullets" || layout === "agenda" || layout === "answers") out.bullets = bullets;

  if (layout === "twoCol" || layout === "compare") {
    out.leftTitle = str(o.leftTitle, SLIDE_LIMITS.colTitle);
    out.rightTitle = str(o.rightTitle, SLIDE_LIMITS.colTitle);
    out.left = list(o.left, SLIDE_LIMITS.colItems, SLIDE_LIMITS.colItem);
    out.right = list(o.right, SLIDE_LIMITS.colItems, SLIDE_LIMITS.colItem);
    delete out.bullets;
  } else if (layout === "quote") {
    out.quote = str(o.quote, SLIDE_LIMITS.quote) || title;
    const by = str(o.quoteBy, SLIDE_LIMITS.quoteBy);
    if (by) out.quoteBy = by;
    delete out.bullets;
  } else if (layout === "stats") {
    out.stats = (Array.isArray(o.stats) ? o.stats : [])
      .map((x) => {
        if (!x || typeof x !== "object") return null;
        const st = x as Record<string, unknown>;
        const value = str(st.value, SLIDE_LIMITS.statValue);
        return value ? { value, label: str(st.label, SLIDE_LIMITS.statLabel) } : null;
      })
      .filter((x): x is { value: string; label: string } => Boolean(x))
      .slice(0, SLIDE_LIMITS.statsMax);
    if (typeof o.chart === "boolean") out.chart = o.chart;
    delete out.bullets;
  } else if (layout === "process") {
    out.steps = (Array.isArray(o.steps) ? o.steps : [])
      .map((x, i) => {
        if (!x || typeof x !== "object") return null;
        const st = x as Record<string, unknown>;
        const t = str(st.title, SLIDE_LIMITS.stepTitle);
        if (!t) return null;
        return { n: str(st.n, SLIDE_LIMITS.stepN) || String(i + 1), title: t, text: str(st.text, SLIDE_LIMITS.stepText) };
      })
      .filter((x): x is { n: string; title: string; text: string } => Boolean(x))
      .slice(0, SLIDE_LIMITS.stepsMax);
    delete out.bullets;
  } else if (layout === "table") {
    const t = (o.table && typeof o.table === "object" ? o.table : {}) as Record<string, unknown>;
    const headers = list(t.headers, SLIDE_LIMITS.tableCols, SLIDE_LIMITS.tableHeaderWide);
    // Jadvalsiz `table` — bo'sh ramka; slayd bandlarga tushadi (`normalizeSlide` naqshi).
    if (headers.length < 2) return { ...out, layout: "bullets", bullets: bullets };
    const rows = (Array.isArray(t.rows) ? t.rows : [])
      .filter((r) => Array.isArray(r))
      .map((r) =>
        Array.from({ length: headers.length }, (_, c) => {
          const cell = (r as unknown[])[c];
          // Bo'sh katak SAQLANADI — ustun surilmasin.
          return typeof cell === "string" ? clipTo(cell, SLIDE_LIMITS.tableCell) : "";
        }),
      )
      .slice(0, SLIDE_LIMITS.tableRows);
    if (rows.length < 1) return { ...out, layout: "bullets", bullets: bullets };
    out.table = { headers, rows };
    delete out.bullets;
  } else if (layout === "quiz") {
    const quiz = (Array.isArray(o.quiz) ? o.quiz : [])
      .map((x) => {
        if (!x || typeof x !== "object") return null;
        const q = x as Record<string, unknown>;
        const text = str(q.q, SLIDE_LIMITS.quizQ);
        const options = list(q.options, SLIDE_LIMITS.quizOptions, SLIDE_LIMITS.quizOption);
        // Variant soni AYNAN 4 bo'lmasa savol tashlanadi — `answer` siljib yolg'on kalit bo'lardi.
        if (!text || options.length !== SLIDE_LIMITS.quizOptions) return null;
        const n = Number(q.answer);
        const answer = Number.isFinite(n) ? Math.max(0, Math.min(SLIDE_LIMITS.quizOptions - 1, Math.round(n))) : 0;
        return { q: text, options, answer };
      })
      .filter((x): x is { q: string; options: string[]; answer: number } => Boolean(x))
      .slice(0, SLIDE_LIMITS.quizMax);
    if (!quiz.length) return { ...out, layout: "bullets", bullets: bullets };
    out.quiz = quiz;
    delete out.bullets;
  } else if (layout === "references") {
    const refs = (Array.isArray(o.refs) ? o.refs : [])
      .map((x) => {
        if (!x || typeof x !== "object") return null;
        const r = x as Record<string, unknown>;
        const t = str(r.title, SLIDE_LIMITS.refTitle);
        const source = str(r.source, SLIDE_LIMITS.refSource);
        return t || source ? { title: t || source, source } : null;
      })
      .filter((x): x is { title: string; source: string } => Boolean(x))
      .slice(0, SLIDE_LIMITS.refsMax);
    if (refs.length) {
      out.refs = refs;
      delete out.bullets;
    } else out.bullets = bullets;
  }
  return out;
}

/** `{url, alt?}` — faqat o'z aktivi bo'lsa; aks holda `null`. */
function ownImage(
  raw: unknown,
  genId: string,
  str: (v: unknown, n: number) => string,
): NonNullable<SlideModel["image"]> | null {
  if (!raw || typeof raw !== "object") return null;
  const im = raw as Record<string, unknown>;
  if (typeof im.url !== "string" || !ownAssetUrlRe(genId).test(im.url)) return null;
  const image: NonNullable<SlideModel["image"]> = { url: im.url };
  const alt = str(im.alt, SLIDE_LIMITS.imageAlt);
  if (alt) image.alt = alt;
  return image;
}

// ═══════════════════════════════════════════════════════ Operatsiyalar

function fail(error: string, at: number): EditResult {
  return { ok: false, error, at };
}

/**
 * Operatsiyalar ro'yxatini qo'llaydi (sof — yangi `doc` qaytaradi).
 *
 * Barcha tekshiruvlar shu yerda: indeks chegarasi, permutatsiya,
 * oxirgi slaydni o'chirmaslik, rasm URL i egaligi, maketda rasm joyi
 * borligi, o'girish jadvali. Xato bo'lsa HECH NARSA qo'llanmaydi —
 * PATCH atomar bo'lishi kerak (409/422 dan keyin klientdagi hujjat
 * serverdagisi bilan mos qolsin).
 */
export function applyDocOps(doc: AcademicDoc, ops: DocOp[], ctx: EditCtx): EditResult {
  if (!doc.slides?.length) return fail("Bu deka eski formatda — tahrir qilib bo'lmaydi", 0);
  const deck = buildSlideDeck(doc);
  const rules: EditRules = deck.bodyType;
  const lang = doc.meta.language || "uz";
  const assetRe = ownAssetUrlRe(ctx.genId);
  let slides = doc.slides.slice();

  for (let at = 0; at < ops.length; at++) {
    const op = ops[at];
    const idx = "index" in op ? op.index : -1;
    if (op.op !== "add" && op.op !== "reorder" && op.op !== "footer") {
      const max = op.op === "insert" ? slides.length : slides.length - 1;
      if (!Number.isInteger(idx) || idx < 0 || idx > max) return fail("Slayd indeksi chegaradan tashqarida", at);
    }
    switch (op.op) {
      case "text": {
        const w = writeSlideField(slides[idx], op.src, op.value, rules);
        if (!w.ok) return fail(w.error, at);
        slides[idx] = w.slide;
        break;
      }
      case "notes": {
        const notes = clipNotes(op.value);
        slides[idx] = notes ? { ...slides[idx], notes } : without(slides[idx], "notes");
        break;
      }
      case "image": {
        const s = slides[idx];
        /*
         * ASL rasm BIRINCHI almashtirish/o'chirishda `imageOrig` ga ko'chadi
         * («Rasmni qaytarish» uchun); keyingi almashtirishlar uni ustidan
         * YOZMAYDI — foydalanuvchi har doim AI chizgan rasmga qaytoladi.
         */
        const keep = s.image && !s.imageOrig ? { imageOrig: s.image } : {};
        if (op.url === null) {
          slides[idx] = { ...without(s, "image"), ...keep };
          break;
        }
        if (typeof op.url !== "string" || !assetRe.test(op.url)) return fail("Rasm manzili bu generatsiyaga tegishli emas", at);
        // Maketda rasm joyi bo'lmasa rasm HECH QAYERDA chizilmasdi — jim yo'qolish o'rniga xato.
        if (!photoSlot(s.layout, deck.visual)) return fail("Bu maketda rasm joyi yo'q", at);
        const alt = op.alt ? clipTo(op.alt, SLIDE_LIMITS.imageAlt) : "";
        slides[idx] = { ...s, ...keep, image: alt ? { url: op.url, alt } : { url: op.url } };
        break;
      }
      case "imageRestore": {
        const s = slides[idx];
        if (!s.imageOrig) return fail("Qaytaradigan asl rasm yo'q", at);
        if (!photoSlot(s.layout, deck.visual)) return fail("Bu maketda rasm joyi yo'q", at);
        slides[idx] = { ...without(s, "imageOrig"), image: s.imageOrig };
        break;
      }
      case "list": {
        const s = slides[idx];
        const field = op.field;
        if (!LIST_FIELDS.includes(field)) return fail("Noma'lum ro'yxat maydoni", at);
        if (!s[field]) return fail(field === "bullets" ? "Bu maketda bandlar yo'q" : "Bu maketda ustun yo'q", at);
        if (!Array.isArray(op.items)) return fail("Bandlar ro'yxati kutilgan", at);
        const caps = field === "bullets" ? bulletCaps(s, rules) : { max: SLIDE_LIMITS.colItems, chars: SLIDE_LIMITS.colItem };
        // Bo'sh band — o'chirilgan band (`writeList` bilan bir xil ma'no).
        const items = op.items.map((x) => clipTo(String(x ?? ""), caps.chars)).filter(Boolean);
        if (items.length > caps.max) return fail(`Bu maketda ${caps.max} tadan ortiq band bo'lmaydi`, at);
        slides[idx] = { ...s, [field]: items };
        break;
      }
      case "layout": {
        if (typeof op.layout !== "string" || !isSlideLayout(op.layout)) return fail("Noma'lum maket", at);
        const c = convertLayout(slides[idx], op.layout, rules);
        if (!c.ok) return fail(c.error, at);
        // Yangi maketda rasm joyi bo'lmasa rasm tushib qoladi (undo uni qaytaradi).
        slides[idx] = photoSlot(c.slide.layout, deck.visual) ? c.slide : without(c.slide, "image");
        break;
      }
      case "add": {
        const after = op.after;
        if (!Number.isInteger(after) || after < -1 || after > slides.length - 1) return fail("Qo'shish o'rni noto'g'ri", at);
        if (slides.length >= SLIDE_LIMITS.maxSlides) return fail(`Dekada ${SLIDE_LIMITS.maxSlides} tadan ortiq slayd bo'lmaydi`, at);
        const fresh = newSlide(after, lang);
        // Kolontitul deka bo'ylab bir xil — qo'shni slayddan olinadi (V1 da tahrirlanmaydi).
        const footer = slides[Math.max(0, after)]?.footer;
        slides = [...slides.slice(0, after + 1), footer ? { ...fresh, footer } : fresh, ...slides.slice(after + 1)];
        break;
      }
      case "delete": {
        if (slides.length <= 1) return fail("Oxirgi slaydni o'chirib bo'lmaydi", at);
        slides = slides.filter((_, i) => i !== idx);
        break;
      }
      case "insert": {
        const s = sanitizeSlideModel(op.slide, ctx.genId, rules);
        if (!s) return fail("Slayd modeli yaroqsiz", at);
        if (slides.length >= SLIDE_LIMITS.maxSlides) return fail(`Dekada ${SLIDE_LIMITS.maxSlides} tadan ortiq slayd bo'lmaydi`, at);
        slides = [...slides.slice(0, idx), s, ...slides.slice(idx)];
        break;
      }
      case "set": {
        const s = sanitizeSlideModel(op.slide, ctx.genId, rules);
        if (!s) return fail("Slayd modeli yaroqsiz", at);
        slides[idx] = s;
        break;
      }
      case "style": {
        if (op.size === undefined && op.font === undefined) return fail("«style» da o'lcham yoki shrift bo'lishi kerak", at);
        const key = JSON.stringify(op.src);
        const cur = slides[idx];
        const next: SlideModel = { ...cur };
        if (op.size !== undefined) {
          const size = op.size;
          if (size !== null && (!Number.isFinite(size) || size < FONT_MIN || size > FONT_MAX)) return fail(`Shrift ${FONT_MIN}–${FONT_MAX} pt oralig'ida bo'lsin`, at);
          const map: Record<string, number> = { ...(cur.fontSize ?? {}) };
          if (size === null) delete map[key];
          else map[key] = Math.round(size);
          if (Object.keys(map).length) next.fontSize = map;
          else delete next.fontSize;
        }
        if (op.font !== undefined) {
          const font = op.font;
          if (font !== null && !isSlideFontId(font)) return fail("Noma'lum shrift", at);
          const map: Record<string, SlideFontId> = { ...(cur.font ?? {}) };
          if (font === null) delete map[key];
          else map[key] = font;
          if (Object.keys(map).length) next.font = map;
          else delete next.font;
        }
        slides[idx] = next;
        break;
      }
      case "footer": {
        // DEKA darajasida: bo'sh qiymat maydonning O'ZINI o'chiradi (boshqa `setOrDrop` naqshi).
        const footer = clipTo(op.value, FOOTER_MAX);
        slides = slides.map((s) => (footer ? { ...s, footer } : without(s, "footer")));
        break;
      }
      case "answer": {
        const s = slides[idx];
        const q = s.quiz?.[op.q];
        if (!q) return fail("Bunday savol yo'q", at);
        if (!Number.isInteger(op.answer) || op.answer < 0 || op.answer >= SLIDE_LIMITS.quizOptions) {
          return fail("Javob indeksi noto'g'ri", at);
        }
        const quiz = s.quiz!.map((x, k) => (k === op.q ? { ...x, answer: op.answer } : x));
        slides[idx] = refreshAnswerNote({ ...s, quiz });
        // Javob o'zgarsa «1 — B» kaliti ESKIRADI — shu yerda darhol qayta yig'iladi.
        rebuildAnswerKey(slides, lang);
        break;
      }
      case "reorder": {
        const order = op.order;
        if (!Array.isArray(order) || order.length !== slides.length) return fail("Tartib ro'yxati mos emas", at);
        const seen = new Set<number>();
        for (const n of order) {
          if (!Number.isInteger(n) || n < 0 || n >= slides.length || seen.has(n)) return fail("Tartib ro'yxati permutatsiya emas", at);
          seen.add(n);
        }
        slides = order.map((n) => slides[n]);
        break;
      }
      default:
        return fail("Noma'lum operatsiya", at);
    }
  }

  const next = renumber(slides);
  return { ok: true, doc: { ...doc, slides: next, sections: sectionsOf(next) } };
}

/**
 * Teskari operatsiyalar — klientdagi Ctrl+Z uchun.
 *
 * Har op'ning teskarisi UNDAN OLDINGI holatga qarab hisoblanadi, keyin
 * ro'yxat teskari tartibda qaytariladi:
 * `applyDocOps(applyDocOps(doc, ops), inverseOps(doc, ops))` = `doc`.
 * Matn/izoh/rasm/maket o'zgarishlarining teskarisi — butun slaydni
 * qaytaruvchi `set` (maydon darajasida teskari hisoblash bo'sh element
 * o'chishi kabi holatlarda noto'g'ri bo'lardi).
 */
export function inverseOps(doc: AcademicDoc, ops: DocOp[], ctx: EditCtx): DocOp[] {
  const out: DocOp[] = [];
  let cur = doc;
  for (const op of ops) {
    const slides = cur.slides ?? [];
    if (op.op === "add") {
      out.push({ op: "delete", index: op.after + 1 });
    } else if (op.op === "delete") {
      out.push({ op: "insert", index: op.index, slide: slides[op.index] });
    } else if (op.op === "insert") {
      out.push({ op: "delete", index: op.index });
    } else if (op.op === "reorder") {
      const back = new Array<number>(op.order.length);
      op.order.forEach((from, to) => {
        back[from] = to;
      });
      out.push({ op: "reorder", order: back });
    } else if (op.op === "footer") {
      // Deka footer bir xil bo'lishi kerak — birinchi slayddagi (o'zgarishdan OLDINGI) qiymat yetarli.
      out.push({ op: "footer", value: slides[0]?.footer ?? "" });
    } else if (op.op === "answer") {
      // Teskari `answer` op qo'llanganda `applyDocOps` javoblar kalitini o'zi qayta yig'adi.
      const q = slides[op.index]?.quiz?.[op.q];
      out.push({ op: "answer", index: op.index, q: op.q, answer: q?.answer ?? 0 });
    } else {
      out.push({ op: "set", index: op.index, slide: slides[op.index] });
    }
    const step = applyDocOps(cur, [op], ctx);
    // Yiqilgan operatsiya hujjatni o'zgartirmaydi — teskarisi ham keraksiz.
    if (!step.ok) {
      out.pop();
      break;
    }
    cur = step.doc;
  }
  return out.reverse();
}

// ═══════════════════════════════════════════════════════ Tahlil (`unknown` dan)

/** Bitta so'rovdagi operatsiyalar soni — PATCH tanasi kichik qolsin. */
const MAX_OPS = 50;
/** Bitta matn qiymati — eng uzun chegara (`notesEdit`) dan ham katta, lekin cheksiz emas. */
const MAX_STR = 4000;

const OP_NAMES = new Set(["text", "notes", "image", "imageRestore", "list", "layout", "add", "delete", "insert", "set", "reorder", "style", "footer", "answer"]);
/** Foydalanuvchi tanlay oladigan shrift oralig'i (pt). */
export const FONT_MIN = 8;
export const FONT_MAX = 96;
/** Kolontitul chegarasi (belgi) — `{op:"footer"}` BARCHA slaydga shu bilan yozadi. */
export const FOOTER_MAX = 120;
const SRC_KEYS: Record<string, "none" | "i" | "ik" | "quiz" | "table"> = {
  title: "none",
  subtitle: "none",
  kicker: "none",
  quote: "none",
  quoteBy: "none",
  leftTitle: "none",
  rightTitle: "none",
  imageHint: "none",
  footer: "none",
  bullets: "i",
  left: "i",
  right: "i",
  stats: "ik",
  steps: "ik",
  refs: "ik",
  quiz: "quiz",
  table: "table",
};
const SRC_SUBKEYS: Record<string, string[]> = {
  stats: ["value", "label"],
  steps: ["n", "title", "text"],
  refs: ["title", "source"],
};

/**
 * Prototip ifloslanishiga olib boradigan kalitlar.
 *
 * `JSON.parse` `"__proto__"` ni ODDIY o'z-mulk sifatida yaratadi, lekin
 * u keyinchalik `{...obj}` yoki `Object.assign` orqali haqiqiy prototipga
 * aylanishi mumkin — shuning uchun butun tana bo'ylab rad etiladi.
 */
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function scan(v: unknown, depth = 0): string | null {
  if (depth > 8) return "Tana juda chuqur";
  if (typeof v === "string") return v.length > MAX_STR ? "Matn juda uzun" : null;
  if (v === null || typeof v === "number" || typeof v === "boolean" || v === undefined) return null;
  if (Array.isArray(v)) {
    if (v.length > 200) return "Ro'yxat juda uzun";
    for (const x of v) {
      const e = scan(x, depth + 1);
      if (e) return e;
    }
    return null;
  }
  if (typeof v !== "object") return "Qiymat turi yaroqsiz";
  for (const k of Object.keys(v as object)) {
    if (BAD_KEYS.has(k)) return "Taqiqlangan kalit";
    const e = scan((v as Record<string, unknown>)[k], depth + 1);
    if (e) return e;
  }
  return null;
}

function num(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1000;
}

function parseSrc(v: unknown): SlideSrc | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const f = typeof o.f === "string" ? o.f : "";
  const kind = SRC_KEYS[f];
  if (!kind) return null;
  if (kind === "none") return { f } as SlideSrc;
  if (kind === "i") return num(o.i) ? ({ f, i: o.i } as SlideSrc) : null;
  if (kind === "ik") {
    const k = typeof o.k === "string" ? o.k : "";
    return num(o.i) && SRC_SUBKEYS[f].includes(k) ? ({ f, i: o.i, k } as SlideSrc) : null;
  }
  if (kind === "quiz") {
    if (!num(o.i)) return null;
    if (o.k === "q") return { f: "quiz", i: o.i, k: "q" };
    if (o.k === "option" && num(o.j)) return { f: "quiz", i: o.i, k: "option", j: o.j };
    return null;
  }
  if (o.k === "header" && num(o.c)) return { f: "table", k: "header", c: o.c };
  if (o.k === "cell" && num(o.r) && num(o.c)) return { f: "table", k: "cell", r: o.r, c: o.c };
  return null;
}

/**
 * Slayd modelining TIP tekshiruvi (mazmun tozalash — `sanitizeSlideModel`).
 *
 * Nega alohida: `chart: "yes"` kabi noto'g'ri TIP jimgina tashlanmasligi
 * kerak — u klient xatosi, uni 400 bilan ko'rsatgan ma'qul; tozalagich
 * esa uzun matn/chegaralar bilan shug'ullanadi.
 */
function slideShapeOk(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.title !== "string" || typeof o.layout !== "string") return false;
  const strOpt = (x: unknown) => x === undefined || typeof x === "string";
  const strArr = (x: unknown) => x === undefined || (Array.isArray(x) && x.every((y) => typeof y === "string"));
  if (!["id", "kicker", "subtitle", "quote", "quoteBy", "leftTitle", "rightTitle", "footer", "notes", "imageHint"].every((k) => strOpt(o[k]))) return false;
  if (!["bullets", "left", "right"].every((k) => strArr(o[k]))) return false;
  if (o.chart !== undefined && typeof o.chart !== "boolean") return false;
  const imageOk = (x: unknown) => x === undefined || (Boolean(x) && typeof x === "object" && typeof (x as Record<string, unknown>).url === "string");
  if (!imageOk(o.image) || !imageOk(o.imageOrig)) return false;
  for (const k of ["stats", "steps", "refs", "quiz"]) {
    const x = o[k];
    if (x !== undefined && (!Array.isArray(x) || x.some((y) => !y || typeof y !== "object" || Array.isArray(y)))) return false;
  }
  if (o.table !== undefined && (!o.table || typeof o.table !== "object" || Array.isArray(o.table))) return false;
  return true;
}

export type ParseResult = { ok: true; ops: DocOp[] } | { ok: false; error: string };

/**
 * `unknown` dan (HTTP tanasi) `DocOp[]` ga — tip tekshiruvi bilan.
 *
 * Bu route va `applyDocOps` orasidagi YAGONA darvoza: undan keyin
 * mantiq `DocOp` tipiga ishonadi. Shakl yaroqsiz bo'lsa 400 (bu yerda),
 * mazmun yaroqsiz bo'lsa 422 (`applyDocOps`).
 */
export function parseDocOps(raw: unknown): ParseResult {
  if (!Array.isArray(raw)) return { ok: false, error: "Operatsiyalar ro'yxati kutilgan" };
  if (!raw.length) return { ok: false, error: "Operatsiya yo'q" };
  if (raw.length > MAX_OPS) return { ok: false, error: `Bir so'rovda ${MAX_OPS} tadan ortiq operatsiya bo'lmaydi` };
  const bad = scan(raw);
  if (bad) return { ok: false, error: bad };
  const ops: DocOp[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: "Operatsiya obyekt bo'lishi kerak" };
    const o = item as Record<string, unknown>;
    const name = typeof o.op === "string" ? o.op : "";
    if (!OP_NAMES.has(name)) return { ok: false, error: "Noma'lum operatsiya" };
    if (name === "reorder") {
      if (!Array.isArray(o.order) || !o.order.every(num)) return { ok: false, error: "Tartib ro'yxati yaroqsiz" };
      ops.push({ op: "reorder", order: o.order as number[] });
      continue;
    }
    if (name === "style") {
      if (!num(o.index)) return { ok: false, error: "«style» yaroqsiz" };
      // Manba kanonik shaklga keltiriladi — kalit (`JSON.stringify`) qatlamniki bilan bir xil bo'lsin.
      const src = parseSrc(o.src);
      if (!src) return { ok: false, error: "«src» yaroqsiz" };
      if (o.size === undefined && o.font === undefined) return { ok: false, error: "«style» da o'lcham yoki shrift bo'lishi kerak" };
      if (o.size !== undefined && !(o.size === null || num(o.size))) return { ok: false, error: "Shrift o'lchami son bo'lishi kerak" };
      if (o.font !== undefined && !(o.font === null || isSlideFontId(o.font))) return { ok: false, error: "Noma'lum shrift" };
      ops.push({
        op: "style",
        index: o.index as number,
        src,
        ...(o.size !== undefined ? { size: o.size as number | null } : {}),
        ...(o.font !== undefined ? { font: o.font as SlideFontId | null } : {}),
      });
      continue;
    }
    if (name === "add") {
      if (!(o.after === -1 || num(o.after))) return { ok: false, error: "«after» yaroqsiz" };
      ops.push({ op: "add", after: o.after as number });
      continue;
    }
    if (name === "footer") {
      if (typeof o.value !== "string") return { ok: false, error: "«value» matn bo'lishi kerak" };
      ops.push({ op: "footer", value: o.value });
      continue;
    }
    if (!num(o.index)) return { ok: false, error: "«index» yaroqsiz" };
    const index = o.index as number;
    if (name === "text") {
      const src = parseSrc(o.src);
      if (!src) return { ok: false, error: "«src» yaroqsiz" };
      if (typeof o.value !== "string") return { ok: false, error: "«value» matn bo'lishi kerak" };
      ops.push({ op: "text", index, src, value: o.value });
    } else if (name === "notes") {
      if (typeof o.value !== "string") return { ok: false, error: "«value» matn bo'lishi kerak" };
      ops.push({ op: "notes", index, value: o.value });
    } else if (name === "image") {
      if (!(o.url === null || typeof o.url === "string")) return { ok: false, error: "«url» yaroqsiz" };
      if (o.alt !== undefined && typeof o.alt !== "string") return { ok: false, error: "«alt» yaroqsiz" };
      ops.push({ op: "image", index, url: o.url as string | null, ...(typeof o.alt === "string" ? { alt: o.alt } : {}) });
    } else if (name === "imageRestore") {
      ops.push({ op: "imageRestore", index });
    } else if (name === "list") {
      const field = typeof o.field === "string" && (LIST_FIELDS as readonly string[]).includes(o.field) ? (o.field as ListField) : null;
      if (!field) return { ok: false, error: "«field» yaroqsiz" };
      if (!Array.isArray(o.items) || !o.items.every((x) => typeof x === "string")) return { ok: false, error: "«items» matnlar ro'yxati bo'lishi kerak" };
      ops.push({ op: "list", index, field, items: o.items as string[] });
    } else if (name === "layout") {
      if (typeof o.layout !== "string" || !isSlideLayout(o.layout)) return { ok: false, error: "«layout» yaroqsiz" };
      ops.push({ op: "layout", index, layout: o.layout });
    } else if (name === "delete") {
      ops.push({ op: "delete", index });
    } else if (name === "answer") {
      if (!num(o.q) || !num(o.answer)) return { ok: false, error: "«answer» yaroqsiz" };
      ops.push({ op: "answer", index, q: o.q as number, answer: o.answer as number });
    } else {
      if (!slideShapeOk(o.slide)) return { ok: false, error: "«slide» yaroqsiz" };
      ops.push({ op: name as "insert" | "set", index, slide: o.slide as SlideModel });
    }
  }
  return { ok: true, ops };
}
