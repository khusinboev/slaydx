import { planArticle, type ArticleAuthorLine, type ArticlePlan, type CiteSpan } from "@/lib/generation/article/layout";
import { planWork, type WorkBodyItem, type WorkPlan } from "@/lib/generation/work/layout";
import { isTeacherDoc, planTeacher, type TeacherPlan } from "@/lib/generation/teacher/layout";
import { isGameDoc, planGame, type GameCardFace, type GameCluesItem, type GamePlan } from "@/lib/generation/games/layout";
import { docLabels } from "@/lib/generation/i18n";
import type { AcademicDoc, Block, DocTable } from "@/lib/generation/types";

export type FlowItem =
  | { type: "title"; id: string }
  | { type: "toc"; id: string }
  /**
   * Annotatsiya. Maqola 2 da (`inline`) yorliq matn bilan bitta paragrafda
   * («**Annotatsiya.** Maqolada …»), kalit so'zlar yorlig'i o'z tilida
   * (`keywordsLabel`) — `render-docx.ts drawArticle` bilan bir xil.
   * Eski hujjatlarda avvalgidek: sarlavha + matn + `docLabels.keywords`.
   */
  | { type: "abstract"; id: string; label: string; text: string; keywords: string; keywordsLabel?: string; inline?: boolean; lang?: string }
  /** `pageBreak` — talaba ishida bob/tuzilmaviy element yangi varaqdan (`paginate.ts`). */
  | { type: "h1"; id: string; text: string; sectionId?: string; pageBreak?: boolean }
  | { type: "h2"; id: string; text: string; sectionId?: string }
  | { type: "h3"; id: string; text: string }
  /** `spans` — Maqola 2 iqtiboslari (`[1; 25-b.]`) belgilangan bo'laklar; matni `text` ga teng. */
  | { type: "p"; id: string; text: string; spans?: CiteSpan[] }
  | { type: "li"; id: string; text: string; spans?: CiteSpan[] }
  | { type: "quote"; id: string; text: string; spans?: CiteSpan[] }
  | { type: "code"; id: string; text: string; caption?: string }
  /**
   * Jadval sarlavhasi (izoh + ustun nomlari) va har bir qator ALOHIDA
   * band — B1: ilgari butun jadval (yoki 10 qatorlik bo'lak) BITTA
   * band edi, uning balandligi bitta varaqdan oshsa `.word-sheet
   * {overflow:hidden}` pastini jim kesardi. Endi har qator o'z
   * balandligi bilan sig'gancha varaqqa oqadi, sarlavha esa BIRINCHI
   * qator bilan birga turadi (`paginate.ts` dagi keep-with-next).
   *
   * `captionAlign` — Maqola 2: «1-jadval. …» TEPADA, GOST oilasida o'ngda,
   * APA/IEEE da chapda (DOCX bilan bir xil); berilmasa eski markaz/kursiv.
   */
  | { type: "table-head"; id: string; table: DocTable; captionAlign?: "left" | "right" | "center" }
  | { type: "table-row"; id: string; row: string[] }
  /**
   * TALABA ISHI (AUDIT-19): jadval RAQAMI («1.1-jadval») jadval
   * sarlavhasidan TEPADA, alohida qatorda, O'NGDA — uslubiy ko'rsatma
   * shuni talab qiladi va `render-docx.ts drawWork` ham shunday chizadi.
   * Raqam sarlavha bilan bitta band bo'lolmaydi: ular boshqa qatorda va
   * boshqa tekislanishda.
   */
  | { type: "table-number"; id: string; text: string }
  /** Jadval OSTIDAGI «Manba: …» — 10 pt kursiv (talaba ishi). */
  | { type: "table-source"; id: string; text: string }
  /**
   * Adabiyotlar ro'yxati ustidagi ogohlantirish.
   *
   * DOCX da u chiziladi («Bu ro'yxat TEKSHIRILMAGAN…»), ko'ruvchida esa
   * umuman yo'q edi (AUDIT-5 P1-6). Ya'ni foydalanuvchi saytda ishonchli
   * ko'rinadigan ro'yxatni ko'rar, ogohlantirishni esa faqat faylni
   * ochgandan keyin topardi — bu aynan akademik halollik uchun
   * qo'shilgan matn.
   */
  | { type: "refNote"; id: string; text: string }
  /** `line` — Maqola 2: tayyor satr («1. …» yoki APA da raqamsiz, osilgan chekinish `hanging`). */
  | { type: "ref"; id: string; n: number; text: string; line?: string; hanging?: boolean }
  /*
   * ── Maqola 2 (AUDIT-17) bandlari — `planArticle` dan. Tartib va raqamlar
   * rejadan keladi; bu yerda ular faqat oqim bandlariga o'giriladi.
   */
  | { type: "udk"; id: string; text: string }
  /** Maqola sarlavhasi — markazda qalin, BOSH HARFSIZ (`h1` emas: u bo'lim sarlavhasi). */
  | { type: "articleTitle"; id: string; text: string }
  | { type: "authors"; id: string; authors: ArticleAuthorLine[] }
  | { type: "highlights"; id: string; label: string; items: string[] }
  /** Sxema (PNG `url` bo'lsa rasm, bo'lmasa o'rinbosar ramka) + sarlavha PASTDA — bitta atom band. */
  | { type: "figure"; id: string; figureId: string; url?: string; w?: number; h?: number; number: string; caption: string; placeholder: string; source?: string }
  /** Formula — KaTeX SSR; raqam o'ngda. Bitta atom band. */
  | { type: "formula"; id: string; latex: string; number: string; display: boolean }
  /** OAK «REFERENCES» ikkinchi ro'yxatining sarlavhasi (`h1` kabi chiziladi). */
  | { type: "refs2"; id: string; text: string }
  /*
   * ── O'qituvchi hujjati (AUDIT-20 WP-C) — `planTeacher` dan.
   *
   * Bu bandlar TITUL BETINING o'rnini bosadi: rasmiy hujjatda muqova
   * yo'q, birinchi betning o'zida shapka turadi. Shuning uchun ular
   * oddiy oqim bandlari — `packPages` ularni boshqa matn bilan birga
   * varaqqa joylaydi va sahifa raqami ham to'g'ri chiqadi.
   */
  /** «Tasdiqlayman» bloki — O'NG YUQORIDA, lavozim va imzo chizig'i bilan. */
  | { type: "teacher-approve"; id: string; lines: string[] }
  /** Muassasa nomi — markazda, qalin. */
  | { type: "teacher-org"; id: string; text: string }
  /** Hujjat nomi («DARS ISHLANMASI») — markazda, qalin, kattaroq. */
  | { type: "teacher-title"; id: string; text: string }
  /** Tur nomi («Yangi mavzu darsi») — markazda, kursiv. */
  | { type: "teacher-subtitle"; id: string; text: string }
  /** «Fan: Biologiya» — yorliq qalin, qiymat oddiy. */
  | { type: "teacher-field"; id: string; label: string; text: string }
  /** O'quvchi maydoni — yorliq/chiziq bo'laklari (`parts`), test varag'i shapkasi. */
  | { type: "teacher-line"; id: string; parts: string[] }
  /** «Ta’limiy maqsad: …» — yorliq qalin, matn bir paragrafda. */
  | { type: "kv"; id: string; label: string; text: string }
  /** Test javob varianti «A) …» — ro'yxat belgisi YO'Q. */
  | { type: "opt"; id: string; letter: string; text: string }
  /** Ogohlantirish («O‘QITUVCHI UCHUN …») — markazda, qalin. */
  | { type: "note"; id: string; text: string }
  /** Ochiq savol javobi uchun bo'sh chiziqlar (matn tuguni YO'Q). */
  | { type: "lines"; id: string; count: number }
  /*
   * ── Bosma o'yinlar (AUDIT-21) — `planGame` dan.
   *
   * Krossvord shapkasi o'qituvchi hujjatinikidan boshqacha (markazda,
   * «Tasdiqlayman» bloki yo'q), shuning uchun o'z bandlari bor:
   * `teacher-*` bandlarini qayta ishlatish ikki oilani bir-biriga
   * bog'lab qo'yardi va bittasining o'zgarishi ikkinchisiga sizib
   * kirardi.
   */
  /** Hujjat nomi («KROSSVORD») — markazda, qalin, kattaroq. */
  | { type: "game-title"; id: string; text: string }
  /** Tur nomi («Klassik») — markazda, kursiv. */
  | { type: "game-subtitle"; id: string; text: string }
  /** «Mavzu: Fotosintez» — markazda, yorliq qalin. */
  | { type: "game-field"; id: string; label: string; text: string }
  /** Gorizontal/Vertikal savollar — CHEGARASIZ ikki ustunli jadval. */
  | { type: "game-clues"; id: string; columns: GameCluesItem["columns"] }
  /**
   * Bitta BOSMA VARAQ (2×4 karta) — ATOM band, o'z betida.
   *
   * `cell` o'lchovlari REJADAN keladi (`plan.page.card`), ko'ruvchi
   * ularni qayta hisoblamaydi: DOCX katagi bilan bitta manba
   * (`games/layout.ts cardCellMm`), ya'ni ekrandagi panjara bosilgan
   * varaqdagi bilan aynan bir xil o'lchamda bo'ladi.
   */
  | {
      type: "game-cards";
      id: string;
      sheet: number;
      sheets: number;
      side: "front" | "back";
      title: string;
      hint: string;
      rows: GameCardFace[][];
      pageBreak: boolean;
      cell: { wMm: number; hMm: number; padMm: number; backPt: number; examplePt: number };
    };

export { titleModel, type TitleModel } from "@/lib/generation/title-model";

export { tocRows, type TocRow } from "@/lib/generation/toc-model";

export function docToFlow(doc: AcademicDoc): FlowItem[] {
  /*
   * Maqola 2: tartib/raqamlash `planArticle` dan — bu yerda takrorlanmaydi.
   * Eski maqola (`doc.article` yo'q) quyidagi umumiy yo'l bilan.
   */
  if (doc.article) return articleFlow(planArticle(doc));
  /*
   * Talaba ishlari 2 (AUDIT-19): kurs ishi / referat / mustaqil ish —
   * `planWork` dan. Eski hujjat (`doc.work` yo'q) umumiy yo'lda qoladi.
   */
  if (doc.work) return workFlow(planWork(doc), doc);
  /*
   * O'qituvchi vositalari 2 (AUDIT-20): dars ishlanmasi, texnologik
   * xarita, glossariy, keys, test — `planTeacher` dan. ESKI hujjat ham
   * shu yerdan (`legacyTeacherModel`): 4 alohida ko'ruvchi o'chirildi,
   * boshqa yo'l yo'q. `renderDocx` dagi shox bilan AYNI shart.
   */
  if (isTeacherDoc(doc)) return teacherFlow(planTeacher(doc));
  /*
   * Bosma o'yinlar (AUDIT-21): krossvord va flesh kartalar — `planGame`
   * dan. `renderDocx` dagi shox bilan AYNI shart (`doc.game`).
   */
  if (isGameDoc(doc)) return gameFlow(planGame(doc));

  const items: FlowItem[] = [];
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;

  if (doc.titlePage) items.push({ type: "title", id: id("title") });
  if (doc.toc) items.push({ type: "toc", id: id("toc") });

  for (const a of doc.abstracts ?? []) {
    items.push({
      type: "abstract",
      id: id("abs"),
      label: a.label,
      text: a.text,
      keywords: a.keywords,
    });
  }

  for (const s of doc.sections) {
    /*
     * Matnsiz bo'lim sarlavhasi CHIZILMAYDI — `render-docx` da ham
     * shunday (`if (s.blocks.length)`), `tocRows` ham uni tashlab
     * ketadi. Ilgari faqat ko'ruvchi uni chizardi: saytda «KIRISH»
     * sarlavhasi ostida hech narsa yo'q sahifa ko'rinar, faylda esa u
     * umuman bo'lmasdi.
     */
    if (!s.blocks.length) continue;
    items.push({ type: "h1", id: id("h1"), text: s.title, sectionId: s.id });
    for (const b of s.blocks) items.push(blockItem(b, id));
  }

  for (const tb of doc.tables ?? []) {
    items.push({ type: "table-head", id: id("tbh"), table: tb });
    for (const row of tb.rows) items.push({ type: "table-row", id: id("tbr"), row });
  }

  if (doc.references?.length) {
    items.push({
      type: "h1",
      id: id("h1"),
      text: docLabels(doc.meta.language).references,
      sectionId: "refs",
    });
    if (doc.referencesNote) {
      items.push({ type: "refNote", id: id("refnote"), text: doc.referencesNote });
    }
    doc.references.forEach((r, i) => items.push({ type: "ref", id: id("ref"), n: i + 1, text: r }));
  }

  return items;
}

/**
 * Maqola rejasi → oqim bandlari. Titul ham, mundarija ham yo'q (DOCX
 * `drawArticle` bilan bir xil); jadval `tableRef` joyida, sarlavhasi
 * «1-jadval. …» bilan (davomi sarlavhasi ham shu matndan).
 */
export function articleFlow(plan: ArticlePlan): FlowItem[] {
  const items: FlowItem[] = [];
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;

  for (const h of plan.head) {
    switch (h.k) {
      case "udk":
        items.push({ type: "udk", id: id("udk"), text: h.text });
        break;
      case "title":
        items.push({ type: "articleTitle", id: id("atitle"), text: h.text });
        break;
      case "authors":
        items.push({ type: "authors", id: id("auth"), authors: h.authors });
        break;
      case "abstract":
        items.push({ type: "abstract", id: id("abs"), label: h.label, text: h.text, keywords: h.keywords, keywordsLabel: h.keywordsLabel, inline: true, lang: h.lang });
        break;
      case "highlights":
        items.push({ type: "highlights", id: id("hl"), label: h.label, items: h.items });
        break;
    }
  }

  for (const b of plan.body) {
    switch (b.k) {
      case "h1":
        items.push({ type: "h1", id: id("h1"), text: b.text, sectionId: b.sectionId });
        break;
      case "h2":
        items.push({ type: "h2", id: id("h2"), text: b.text });
        break;
      case "h3":
        items.push({ type: "h3", id: id("h3"), text: b.text });
        break;
      case "p":
      case "li":
      case "quote":
        items.push({ type: b.k, id: id(b.k), text: b.text, spans: b.spans });
        break;
      case "code":
        items.push({ type: "code", id: id("code"), text: b.text, caption: b.caption });
        break;
      case "figure":
        items.push({
          type: "figure",
          id: id("fig"),
          figureId: b.figureId,
          url: b.figure?.url,
          w: b.figure?.w,
          h: b.figure?.h,
          number: b.number,
          caption: b.caption,
          placeholder: b.placeholder,
          source: b.source,
        });
        break;
      case "table":
        items.push({ type: "table-head", id: id("tbh"), table: { ...b.table, caption: b.caption }, captionAlign: plan.tableCaptionAlign });
        for (const row of b.table.rows) items.push({ type: "table-row", id: id("tbr"), row });
        break;
      case "formula":
        items.push({ type: "formula", id: id("eq"), latex: b.latex, number: b.number, display: b.display });
        break;
    }
  }

  const hanging = plan.cite === "apa7";
  if (plan.refs.length) {
    items.push({ type: "h1", id: id("h1"), text: plan.refsLabel, sectionId: "refs" });
    for (const r of plan.refs) items.push({ type: "ref", id: id("ref"), n: r.n, text: r.text, line: r.line, hanging });
  }
  if (plan.refs2?.length && plan.refs2Label) {
    items.push({ type: "refs2", id: id("refs2"), text: plan.refs2Label });
    for (const r of plan.refs2) items.push({ type: "ref", id: id("ref2"), n: r.n, text: r.text, line: r.line, hanging });
  }
  return items;
}

/**
 * Talaba ishi rejasi → oqim bandlari (AUDIT-19 WP-C).
 *
 * Tartib `render-docx.ts drawWork` bilan AYNAN bir xil: titul →
 * mundarija → tana → adabiyotlar → ilovalar. Jadval uch bandga bo'linadi
 * (raqam, sarlavha+ustunlar, qatorlar, manba) — DOCX da ham ular uchta
 * mustaqil paragraf/jadval, ya'ni matn tugunlari ketma-ketligi bir xil
 * (`viewer/work-parity`).
 */
export function workFlow(plan: WorkPlan, doc: AcademicDoc): FlowItem[] {
  const items: FlowItem[] = [];
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;

  if (doc.titlePage) items.push({ type: "title", id: id("title") });
  if (doc.toc && plan.toc.length) items.push({ type: "toc", id: id("toc") });

  const push = (b: WorkBodyItem) => {
    switch (b.k) {
      case "h1":
        items.push({ type: "h1", id: id("h1"), text: b.text, ...(b.sectionId ? { sectionId: b.sectionId } : {}), pageBreak: b.pageBreak });
        break;
      case "h2":
        items.push({ type: "h2", id: id("h2"), text: b.text, ...(b.sectionId ? { sectionId: b.sectionId } : {}) });
        break;
      case "h3":
        items.push({ type: "h3", id: id("h3"), text: b.text });
        break;
      case "p":
      case "li":
      case "quote":
        items.push({ type: b.k, id: id(b.k), text: b.text, spans: b.spans });
        break;
      case "code":
        items.push({ type: "code", id: id("code"), text: b.text, caption: b.caption });
        break;
      case "figure":
        items.push({
          type: "figure",
          id: id("fig"),
          figureId: b.figureId,
          url: b.figure?.url,
          w: b.figure?.w,
          h: b.figure?.h,
          number: b.number,
          caption: b.caption,
          placeholder: b.placeholder,
          source: b.source,
        });
        break;
      case "table":
        items.push({ type: "table-number", id: id("tbn"), text: b.numberLine });
        items.push({ type: "table-head", id: id("tbh"), table: { ...b.table, caption: b.caption }, captionAlign: "center" });
        for (const row of b.table.rows) items.push({ type: "table-row", id: id("tbr"), row });
        if (b.source) items.push({ type: "table-source", id: id("tbs"), text: b.source });
        break;
      case "formula":
        items.push({ type: "formula", id: id("eq"), latex: b.latex, number: b.number, display: b.display });
        break;
    }
  };

  for (const b of plan.body) push(b);

  if (plan.refs.length) {
    items.push({ type: "h1", id: id("h1"), text: plan.refsLabel, sectionId: "refs", pageBreak: true });
    for (const r of plan.refs) items.push({ type: "ref", id: id("ref"), n: r.n, text: r.text, line: r.line });
  }

  for (const b of plan.appendix) push(b);
  return items;
}

/**
 * O'qituvchi hujjati rejasi → oqim bandlari (AUDIT-20 WP-C).
 *
 * Tartib `render-docx.ts drawTeacher` bilan AYNAN bir xil: shapka →
 * bo'limlar → jadvallar. Titul beti YO'Q (`type: "title"` bandi ham
 * yo'q) — rasmiy shaklda birinchi betning o'zida shapka turadi.
 *
 * Jadval DOCX dagidek uch bandga bo'linadi (raqam, sarlavha + ustunlar,
 * qatorlar) — matn tugunlari ketma-ketligi bir xil bo'lsin
 * (`viewer/teacher-parity`).
 */
export function teacherFlow(plan: TeacherPlan): FlowItem[] {
  const items: FlowItem[] = [];
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;

  for (const h of plan.head) {
    switch (h.k) {
      case "approve":
        items.push({ type: "teacher-approve", id: id("tapp"), lines: h.lines });
        break;
      case "org":
        items.push({ type: "teacher-org", id: id("torg"), text: h.text });
        break;
      case "title":
        items.push({ type: "teacher-title", id: id("ttitle"), text: h.text });
        break;
      case "subtitle":
        items.push({ type: "teacher-subtitle", id: id("tsub"), text: h.text });
        break;
      case "field":
        items.push({ type: "teacher-field", id: id("tfield"), label: h.label, text: h.text });
        break;
      case "line":
        items.push({ type: "teacher-line", id: id("tline"), parts: h.parts });
        break;
    }
  }

  for (const b of plan.body) {
    switch (b.k) {
      case "h1":
        items.push({ type: "h1", id: id("h1"), sectionId: b.sectionId, text: b.text, pageBreak: b.pageBreak });
        break;
      case "h2":
        items.push({ type: "h2", id: id("h2"), text: b.text });
        break;
      case "h3":
        items.push({ type: "h3", id: id("h3"), text: b.text });
        break;
      case "p":
      case "li":
      case "quote":
        items.push({ type: b.k, id: id(b.k), text: b.text });
        break;
      case "code":
        items.push({ type: "code", id: id("code"), text: b.text, caption: b.caption });
        break;
      case "kv":
        items.push({ type: "kv", id: id("kv"), label: b.label, text: b.text });
        break;
      case "opt":
        items.push({ type: "opt", id: id("opt"), letter: b.letter, text: b.text });
        break;
      case "note":
        items.push({ type: "note", id: id("note"), text: b.text });
        break;
      case "lines":
        items.push({ type: "lines", id: id("lines"), count: b.count });
        break;
      case "table":
        items.push({ type: "table-number", id: id("tbn"), text: b.numberLine });
        items.push({ type: "table-head", id: id("tbh"), table: { ...b.table, caption: b.caption }, captionAlign: "center" });
        for (const row of b.table.rows) items.push({ type: "table-row", id: id("tbr"), row });
        break;
      case "figure":
        items.push({
          type: "figure",
          id: id("fig"),
          figureId: b.figureId,
          url: b.figure?.url,
          w: b.figure?.w,
          h: b.figure?.h,
          number: b.number,
          caption: b.caption,
          placeholder: b.placeholder,
        });
        break;
    }
  }
  return items;
}

/**
 * O'yin rejasi → oqim bandlari (AUDIT-21 WP-A/WP-B).
 *
 * Tartib `render-docx.ts drawGame` bilan AYNAN bir xil: shapka →
 * to'r/savollar yoki karta varaqlari. Titul beti YO'Q (`type: "title"`
 * bandi ham yo'q), kartalarda esa shapka ham yo'q — birinchi bet
 * kartalarning O'ZI bo'lishi kerak (`planGame` izohi).
 *
 * Karta varag'i BITTA band bo'lib qoladi (jadval qatorlariga
 * bo'linmaydi, `table-row` naqshidan farqli): panjara bo'linsa varaq
 * ikki betga tarqalib, old/orqa juftlik siljib ketardi.
 */
export function gameFlow(plan: GamePlan): FlowItem[] {
  const items: FlowItem[] = [];
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;

  for (const h of plan.head) {
    switch (h.k) {
      case "title":
        items.push({ type: "game-title", id: id("gtitle"), text: h.text });
        break;
      case "subtitle":
        items.push({ type: "game-subtitle", id: id("gsub"), text: h.text });
        break;
      case "field":
        items.push({ type: "game-field", id: id("gfield"), label: h.label, text: h.text });
        break;
    }
  }

  const cell = {
    wMm: plan.page.card.wMm,
    hMm: plan.page.card.hMm,
    padMm: plan.page.card.padMm,
    backPt: plan.page.card.backPt,
    examplePt: plan.page.card.examplePt,
  };

  for (const b of plan.body) {
    switch (b.k) {
      case "h1":
        items.push({ type: "h1", id: id("h1"), sectionId: b.sectionId, text: b.text, pageBreak: b.pageBreak });
        break;
      case "h3":
        items.push({ type: "h3", id: id("h3"), text: b.text });
        break;
      case "p":
      case "li":
        items.push({ type: b.k, id: id(b.k), text: b.text });
        break;
      case "note":
        items.push({ type: "note", id: id("note"), text: b.text });
        break;
      case "clues":
        items.push({ type: "game-clues", id: id("gclues"), columns: b.columns });
        break;
      case "cards":
        items.push({
          type: "game-cards",
          id: id("gcards"),
          sheet: b.sheet,
          sheets: b.sheets,
          side: b.side,
          title: b.title,
          hint: b.hint,
          rows: b.rows,
          pageBreak: b.pageBreak,
          cell,
        });
        break;
      case "figure":
        items.push({
          type: "figure",
          id: id("fig"),
          figureId: b.figureId,
          url: b.figure?.url,
          w: b.figure?.w,
          h: b.figure?.h,
          number: b.number,
          caption: b.caption,
          placeholder: b.placeholder,
        });
        break;
    }
  }
  return items;
}

function blockItem(b: Block, id: (p: string) => string): FlowItem {
  switch (b.kind) {
    case "h1":
      return { type: "h1", id: id("h1"), text: b.text };
    case "h2":
      return { type: "h2", id: id("h2"), text: b.text };
    case "h3":
      return { type: "h3", id: id("h3"), text: b.text };
    case "li":
      return { type: "li", id: id("li"), text: b.text };
    case "quote":
      return { type: "quote", id: id("qt"), text: b.text };
    case "code":
      return { type: "code", id: id("code"), text: b.text, caption: b.caption };
    default:
      return { type: "p", id: id("p"), text: b.text };
  }
}
