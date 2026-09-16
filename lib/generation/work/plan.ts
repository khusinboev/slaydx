/**
 * SO'Z VA BET REJASI (AUDIT-19 WP-A) — IZOMORF: dvigatel (`engine.ts`),
 * hisobot (`review.ts`), sayqal (`polish.ts`) va FORMA (WP-E «taxminan
 * N bet» ko'rsatmasi) BITTA formuladan o'qiydi. Bu faylga server/og'ir
 * modul (sharp, LLM) import qilinmaydi.
 *
 * Maqoladan farqi (nega `articleWordPlan` yaramadi): talaba ishida
 * APPARATURA boshqacha — titul 1 bet, mundarija 1 bet, adabiyotlar
 * ro'yxati, ilova; annotatsiya yo'q; kirish va xulosa hajmi STANDART
 * bilan belgilangan (kirish 10–15 %, xulosa 2–4 bet), bo'lim ulushi
 * bilan emas.
 *
 * Koeffitsientlar (reja «Standartlar», TNR 14 / 1,5 interval):
 *   perPage 230 so'z; titul 1 bet; mundarija 1 bet; adabiyot satri
 *   0,05 bet × manba soni; sxema 0,45 bet; jadval 0,25 bet; ilova 1 bet.
 */
import type { DocMeta } from "../types";
import type { AcademicDoc } from "../types";
import { WORDS_PER_PAGE } from "../quality";
import { pagesMid, type WorkKind } from "./registry";
import type { SubjectProfile } from "./subjects";
import { isChapterHeadId } from "./types";

/** TNR 14 / 1,5 interval — bir betga so'z (loyiha bo'ylab bitta son). */
export const WORK_WORDS_PER_PAGE = WORDS_PER_PAGE;

/** Apparatura koeffitsientlari — hisobot ham, forma ham shu yerdan o'qiydi. */
export const WORK_OVERHEAD = {
  titlePage: 1,
  toc: 1,
  /** Bitta adabiyot satri (TNR 14/1,5 — ≈20 manba/bet). */
  refLine: 0.05,
  figure: 0.45,
  table: 0.25,
  appendix: 1,
} as const;

/** Bob matni umumiy betning shu ulushidan pastga tushmaydi (apparatura qancha bo'lmasin). */
export const BODY_FLOOR = 0.4;
/** Xulosa mo'ljali — umumiy betning shu ulushi, keyin turning chegarasiga siqiladi. */
export const CONCLUSION_SHARE = 0.09;

export type WorkWordPlan = {
  perPage: number;
  /** Paketning o'rtacha beti («25-30» → 28). */
  pages: number;
  /** Titul + mundarija + adabiyotlar + vizual + ilova (bet). */
  overheadPages: number;
  introPages: number;
  conclusionPages: number;
  chapterPages: number;
  /** So'z: kirish / xulosa / boblar jami / hammasi (matn). */
  intro: number;
  conclusion: number;
  chapters: number;
  body: number;
  /** Kutilayotgan manba soni (janr minimumi yoki foydalanuvchi qiymati). */
  refs: number;
  figures: number;
  tables: number;
  appendices: number;
};

export type WorkPlanAsk = {
  /** Manba minimumi (foydalanuvchi oshirishi mumkin). */
  refs?: number;
  figures?: number;
  tables?: number;
  appendices?: number;
  /** Paket yorlig'i; berilmasa `meta.pagesLabel`/`meta.targetPages`. */
  pages?: string;
};

/** Apparatura beti — `workWordPlan` va `estimateWorkPages` uchun BITTA formula. */
export function workOverheadPages(o: { refs: number; figures: number; tables: number; appendices: number }): number {
  return (
    WORK_OVERHEAD.titlePage +
    WORK_OVERHEAD.toc +
    Math.max(0, o.refs) * WORK_OVERHEAD.refLine +
    Math.max(0, o.figures) * WORK_OVERHEAD.figure +
    Math.max(0, o.tables) * WORK_OVERHEAD.table +
    Math.max(0, o.appendices) * WORK_OVERHEAD.appendix
  );
}

/**
 * So'z rejasi. Paket («25–30 bet») — hujjatning UMUMIY beti: titul,
 * mundarija, adabiyotlar va vizuallar ham shu betlarga kiradi.
 *
 *   matn beti   = paket − apparatura (kamida paketning 40 %)
 *   kirish      = paket × introShare o'rtasi (kurs ishida 28 × 0,125 = 3,5 bet ∈ 3–5)
 *   xulosa      = clamp(paket × 0,09, turning [min, max] beti) — referat ≈1 bet
 *   boblar      = qolgani
 */
export function workWordPlan(meta: Pick<DocMeta, "pagesLabel" | "targetPages">, kind: WorkKind, subject: SubjectProfile, ask: WorkPlanAsk = {}): WorkWordPlan {
  const perPage = WORK_WORDS_PER_PAGE;
  const label = ask.pages ?? meta.pagesLabel ?? "";
  const fromLabel = label ? pagesMid(label) : 0;
  const pages = Math.max(4, fromLabel || (Number.isFinite(meta.targetPages) ? Number(meta.targetPages) : 12));

  const refs = Math.max(0, Math.round(ask.refs ?? kind.refsMin));
  const figures = Math.max(0, Math.round(ask.figures ?? subject.defaultVisuals.figures));
  const tables = Math.max(0, Math.round(ask.tables ?? subject.defaultVisuals.tables));
  const appendices = Math.max(0, Math.round(ask.appendices ?? 0));

  const overheadPages = workOverheadPages({ refs, figures, tables, appendices });
  const contentPages = Math.max(pages * BODY_FLOOR, pages - overheadPages);

  const introPages = pages * ((kind.introShare[0] + kind.introShare[1]) / 2);
  const conclusionPages = Math.min(kind.conclusionPages[1], Math.max(kind.conclusionPages[0], pages * CONCLUSION_SHARE));
  // Kirish va xulosa matn betidan oshib ketmasin (kichik paketda apparatura katta).
  const framePages = Math.min(introPages + conclusionPages, contentPages * 0.75);
  const scale = introPages + conclusionPages > 0 ? framePages / (introPages + conclusionPages) : 1;
  const intro = Math.round(introPages * scale * perPage);
  const conclusion = Math.round(conclusionPages * scale * perPage);
  const chapterPages = Math.max(1, contentPages - framePages);
  const chapters = Math.round(chapterPages * perPage);

  return {
    perPage,
    pages,
    overheadPages,
    introPages: introPages * scale,
    conclusionPages: conclusionPages * scale,
    chapterPages,
    intro,
    conclusion,
    chapters,
    body: intro + conclusion + chapters,
    refs,
    figures,
    tables,
    appendices,
  };
}

/**
 * Hujjatning TAXMINIY umumiy beti — forma ko'rsatmasi va hisobot
 * `pageLimit` bandi uchun. Formula `workWordPlan` niki.
 */
export function estimateWorkPages(pages: string, kind: WorkKind, subject: SubjectProfile, ask: WorkPlanAsk = {}): number {
  const plan = workWordPlan({ pagesLabel: pages, targetPages: pagesMid(pages) } as DocMeta, kind, subject, { ...ask, pages });
  return Math.max(1, Math.round(plan.body / plan.perPage + plan.overheadPages));
}

/** So'zlarni sanash — `guardSection` bilan bir xil qoida (probel bo'yicha). */
const WORD_RE = /\S+/g;
const wc = (t: string) => (t.match(WORD_RE) ?? []).length;

/**
 * TAYYOR hujjatning taxminiy beti: haqiqiy matn so'zi / perPage +
 * apparatura (iqtibos qilingan manba, sxema, jadval, ilova soni).
 */
export function estimateWorkDocPages(doc: AcademicDoc): number {
  const perPage = WORK_WORDS_PER_PAGE;
  let body = 0;
  for (const s of doc.sections) for (const b of s.blocks) if (b.kind === "p" || b.kind === "li" || b.kind === "quote") body += wc(b.text);
  const model = doc.work;
  const refs = model ? model.references.filter((r) => r.cited).length : (doc.references?.length ?? 0);
  const figures = model?.figures.length ?? 0;
  const tables = doc.tables?.length ?? 0;
  const appendices = doc.sections.filter((s) => s.id.startsWith("appendix")).length;
  return body / perPage + workOverheadPages({ refs, figures, tables, appendices });
}

/* ────────────────────────── paragraf ulushlari ────────────────────────── */

/**
 * Bob so'zini paragraflar orasida taqsimlaydi. Teng taqsimot ATAYLAB:
 * hisobotning `chapterBalance` qoidasi boblar orasida ±30 % ni talab
 * qiladi — reja ham shu qoidaga mos bo'lishi kerak, aks holda dvigatel
 * o'z hisobotidan qizil oladi.
 */
export function paragraphWords(chapterWords: number, paragraphs: number): number[] {
  const n = Math.max(1, paragraphs);
  const each = Math.max(120, Math.round(chapterWords / n));
  return Array.from({ length: n }, () => each);
}

/** Boblar orasida so'z taqsimoti (teng; oxirgi bobga qoldiq). */
export function chapterWords(total: number, chapters: number): number[] {
  const n = Math.max(1, chapters);
  const each = Math.max(200, Math.round(total / n));
  return Array.from({ length: n }, () => each);
}

/* ────────────────────────── vizual raqamlari ────────────────────────── */

/**
 * «1.1-jadval» / «1.1-rasm» raqamlari — BOB bo'yicha (talaba ishi
 * standarti; maqoladagi `flat` emas). Raqam bo'lim id sidan chiqadi:
 * `ch2.3` dagi birinchi rasm → `2.1`.
 *
 * WP-C (`work/layout.ts planWork`) bu hisobni YAGONA MANBA sifatida
 * qayta e'lon qiladi; hisobot (`review.ts`) hozircha shu yerdan o'qiydi,
 * shunda ikkalasi bir xil raqam beradi.
 */
export function workVisualNumbers(doc: AcademicDoc): { figures: Record<string, string>; tables: Record<string, string> } {
  const figures: Record<string, string> = {};
  const tables: Record<string, string> = {};
  const perChapter = new Map<number, { f: number; t: number }>();
  let flatF = 0;
  let flatT = 0;
  for (const s of doc.sections) {
    if (isChapterHeadId(s.id)) continue;
    const m = /^ch(\d{1,2})/.exec(s.id);
    const chapter = m ? Number(m[1]) : 0;
    for (const b of s.blocks) {
      if (b.kind !== "figure" && b.kind !== "tableRef") continue;
      if (!chapter) {
        // Kirish/xulosa/ilovadagi vizual — tekis raqam (bob yo'q).
        if (b.kind === "figure") figures[b.figureId] = String(++flatF);
        else tables[b.tableId] = String(++flatT);
        continue;
      }
      const c = perChapter.get(chapter) ?? { f: 0, t: 0 };
      perChapter.set(chapter, c);
      if (b.kind === "figure") figures[b.figureId] = `${chapter}.${++c.f}`;
      else tables[b.tableId] = `${chapter}.${++c.t}`;
    }
  }
  return { figures, tables };
}
