/**
 * TALABA ISHI MAKETI — YAGONA MANBA («ko'rdim = oldim», AUDIT-19 WP-C).
 *
 * `planWork(doc)` hujjatni TARTIB va RAQAMLASH bilan yoyadi:
 *
 *   titul (`title-model.ts`) → mundarija (`plan.toc`) → KIRISH →
 *   `1-BOB. NOM` → `1.1. Paragraf` … → XULOSA →
 *   FOYDALANILGAN ADABIYOTLAR → `1-ILOVA`
 *
 * va matn ichidagi `[W…]` iqtiboslarini `[3, 45-b.]` / `[3]` shakliga
 * o'giradi, jadval/rasm/formulaga BOB bo'yicha raqam beradi
 * («1.1-jadval», «1.1-rasm», «(1.1)»; referatda tekis — «1-jadval»).
 *
 * DOCX (`render-docx.ts drawWork`) ham, ko'ruvchi (`lib/viewers/flow.ts
 * workFlow`) ham FAQAT shu natijani chizadi — ikkalasida ham «qaysi band
 * qayerda, qanday raqam bilan» degan mantiq YO'Q. `planArticle` naqshi;
 * izomorf (DOM ham, `docx` ham import qilinmaydi).
 *
 * Nega maqola maketi yaramadi: talaba ishida APPARATURA bor (titul,
 * mundarija, ilova), bo'limlar DARAXT (bob → paragraf, matn esa
 * `sections` da tekis — `work/types.ts` qaroriga qarang), sarlavhalar
 * BOSH HARF va raqamli, adabiyotlar tartibi O'zbekiston qoidasi
 * (`cite/order.ts orderUzReferences`), jadval raqami esa TEPA O'NGDA
 * turadi — maqolada bularning hech biri yo'q.
 *
 * Eski talaba ishi (`doc.work` yo'q) bu yerga UMUMAN kelmaydi:
 * `renderDocx`/`docToFlow` uni avvalgi umumiy yo'l bilan chizishda davom
 * etadi (`viewer/work-legacy` shuni qulflaydi) — «legacy model» kerak emas.
 */
import { renderCitations, type CiteSpan, type RefItem } from "../article/layout";
import type { CiteStyle } from "../article/types";
import { formatReference } from "../cite";
import { orderUzReferences } from "../cite/order";
import { citedOnly } from "../research/verify";
import type { AcademicDoc, Block, DocSection, DocTable, Figure } from "../types";
import { workLabels, type WorkDocLabels } from "./labels";
import { workVisualNumbers } from "./plan";
import { genreOf, workKindOf, type WorkGenre, type WorkKind } from "./registry";
import { SUBJECT_PROFILES, type SubjectProfile } from "./subjects";
import { isChapterHeadId, parseWorkSectionId, type WorkModel } from "./types";

/* ────────────────────────── varaq o'lchovlari ────────────────────────── */

/**
 * Chegaralar (sm) — uslubiy ko'rsatmalar: yuqori 2, past 2, chap 3, o'ng
 * fan profilidan (`SUBJECT_PROFILES[x].rightMarginCm`; gumanitar 1,0).
 * `docx-profile.ts workProfile` ham, ko'ruvchi varag'i ham SHU YERDAN
 * o'qiydi — ikkita nusxa bo'lmasin.
 */
export const WORK_MARGINS_CM = { top: 2, bottom: 2, left: 3 } as const;

/** Tipografiya — TNR 14 / 1,5; jadval 12 pt; «Manba:» va izohlar 10 pt. */
export const WORK_TYPE = { sizePt: 14, line: 1.5, tableSizePt: 12, refsSizePt: 14, smallPt: 10 } as const;

/**
 * Iqtibos uslubi — talaba ishi standarti `[3, 45-b.]` / `[3]` / `[1, 2]`.
 * GOST uslubidagi nuqtali vergul (`[3; 45-b.]`) jurnal maqolasiniki.
 */
export const WORK_CITE_STYLE: CiteStyle = "numeric";

export function workMarginsCm(subject: SubjectProfile): { top: number; right: number; bottom: number; left: number } {
  return { ...WORK_MARGINS_CM, right: subject.rightMarginCm };
}

/* ────────────────────────── tiplar ────────────────────────── */

export type WorkTocRow = { text: string; level: 1 | 2 };

/**
 * Sarlavha TURI — chizuvchilar uchun:
 *   `structural` — KIRISH / XULOSA / ADABIYOTLAR / ILOVA (raqamsiz);
 *   `chapter`    — `1-BOB. NOM` (kurs ishi/mustaqil) yoki `1. NOM` (referat).
 */
export type WorkHeadKind = "structural" | "chapter";

export type WorkBodyItem =
  | {
      k: "h1";
      text: string;
      title: string;
      number?: string;
      /** Tahrir uchun bo'lim id si (`heading` opi); blok ichidagi `h1` da bo'sh. */
      sectionId: string;
      path: string;
      head: WorkHeadKind;
      /** Yangi varaqdan boshlanadimi (`pageBreakBefore` / `paginate` da flush). */
      pageBreak: boolean;
    }
  | { k: "h2"; text: string; title: string; number?: string; sectionId: string; path: string }
  | { k: "h3"; text: string; path: string }
  | { k: "p"; text: string; spans: CiteSpan[]; path: string }
  | { k: "li"; text: string; spans: CiteSpan[]; path: string }
  | { k: "quote"; text: string; spans: CiteSpan[]; path: string }
  | { k: "code"; text: string; caption?: string; path: string }
  /** Sxema — sarlavha PASTDA markazda («1.1-rasm. Nom»), ostida «Manba: …». */
  | { k: "figure"; figureId: string; figure?: Figure; number: string; caption: string; placeholder: string; source?: string; path: string }
  /**
   * Jadval. Talaba ishi standarti: raqam («1.1-jadval») TEPA O'NGDA
   * alohida qatorda, NOMI uning ostida markazda, jadvaldan keyin
   * «Manba: …» 10 pt kursiv.
   */
  | { k: "table"; tableId: string; table: DocTable; number: string; numberLine: string; caption: string; source?: string; path: string }
  /** Formula markazda, raqami «(1.1)» o'ngda. */
  | { k: "formula"; latex: string; number: string; display: boolean; path: string };

export type WorkPlan = {
  model: WorkModel;
  genre: WorkGenre;
  kind: WorkKind;
  subject: SubjectProfile;
  language: string;
  /**
   * Iqtibos uslubi — talaba ishida DOIM `numeric` («[3, 45-b.]», «[1, 2]»).
   * Maydon ATAYIN bor: tahrir qatlami (`ArticleEditor editNodes`) maqola
   * va talaba ishi rejasini BIR XIL shartnoma bo'yicha o'qiydi.
   */
  cite: CiteStyle;
  labels: WorkDocLabels;
  /** Mundarija qatorlari — matndagi sarlavhalar bilan AYNAN bir xil. */
  toc: WorkTocRow[];
  /** Kirishdan xulosagacha (ilova bu yerda EMAS). */
  body: WorkBodyItem[];
  /** Ilovalar — ADABIYOTLARDAN KEYIN chiziladi, har biri yangi varaqdan. */
  appendix: WorkBodyItem[];
  refsLabel: string;
  refs: RefItem[];
  numbers: { figures: Record<string, string>; tables: Record<string, string>; formulas: Record<string, string> };
  /** Varaq: chegara (sm) va tipografiya — DOCX profili va ko'ruvchi varag'i uchun. */
  page: { marginsCm: { top: number; right: number; bottom: number; left: number } } & typeof WORK_TYPE;
  /** Jadval RAQAMI tekislanishi — talaba ishida doim o'ngda. */
  tableNumberAlign: "right";
  /** Bob sarlavhasi — doim markazda, BOSH HARF. */
  headingAlign: "center";
};

/* ────────────────────────── yordamchilar ────────────────────────── */

export function isWorkV2(doc: AcademicDoc): boolean {
  return Boolean(doc.work);
}

/** `appendix-1`, `appendix2`, `appendix` — ilova bo'limi. */
export function isAppendixId(id: string): boolean {
  return /^appendix(?:[-_]?\d{1,2})?$/i.test(id);
}

/** Paragraf bo'limi (`ch1.2`) — bob sarlavhasi emas. */
function isParagraphId(id: string): boolean {
  const p = parseWorkSectionId(id);
  return Boolean(p && p.paragraph);
}

/**
 * Bo'lim sarlavhasi matni: KIRISH/XULOSA yorliqdan, ilova «1-ILOVA»,
 * qolgani modelning o'z sarlavhasi — hammasi BOSH HARFDA (uslubiy
 * ko'rsatma; DOCX `sectionHeading` ham, ko'ruvchi `.word-h1` ham buni
 * TAKRORLAYDI, shuning uchun matnning o'zi ham shu shaklda bo'lishi
 * kerak — aks holda paritet testi ikki xil matn ko'rardi).
 */
function structuralText(s: DocSection, L: WorkDocLabels, appendixN: number): string {
  if (s.id === "intro") return L.intro.toUpperCase();
  if (s.id === "conclusion") return L.conclusion.toUpperCase();
  if (isAppendixId(s.id)) return L.appendix(appendixN).toUpperCase();
  return (s.title || "").toUpperCase();
}

/* ────────────────────────── raqamlash ────────────────────────── */

/* ────────────────────────── reja ────────────────────────── */

export function planWork(doc: AcademicDoc): WorkPlan {
  const model = doc.work;
  if (!model) throw new Error("planWork: `doc.work` yo'q — eski hujjat umumiy yo'l bilan chiziladi");
  const genre = genreOf(model.genre);
  const kind = workKindOf(model.genre, model.kind);
  const subject = SUBJECT_PROFILES[model.subject] ?? SUBJECT_PROFILES.humanities;
  const language = model.language || doc.meta.language || "uz";
  const L = workLabels(language);
  /** Referat — BOB emas, BO'LIM: «1. Nom», vizual raqami tekis. */
  const flat = kind.shape === "sections";

  /* ── manbalar: faqat `cited`, O'zbekiston tartibi, raqam qayta beriladi ── */
  const ordered = orderUzReferences(citedOnly(model.references ?? []));
  const refs: RefItem[] = ordered.map((r) => {
    const text = formatReference(r, "gost", language);
    return { n: r.n!, text, line: `${r.n}. ${text}`, ref: r };
  });

  // Vizual raqamlari — YAGONA manba `work/plan.ts workVisualNumbers` (referatda tekis, hisobot ham shundan).
  const numbers = workVisualNumbers(doc);
  const formulas: Record<string, string> = {};
  /*
   * Iqtibos uslubi — `numeric`: «[3, 45-b.]» va «[1, 2]» (talaba ishi
   * standarti; GOST uslubidagi nuqtali vergul jurnal maqolasiniki).
   * `[fig:f1]`/`[tab:t1]` havolalari rejadagi raqamga o'giriladi.
   */
  const cites = (text: string) => renderCitations(text, ordered, WORK_CITE_STYLE, language, numbers);

  const figures = new Map((model.figures ?? []).map((f) => [f.id, f]));
  const tables = new Map((doc.tables ?? []).filter((t) => t.id).map((t) => [t.id!, t]));

  const body: WorkBodyItem[] = [];
  /** Ilovalar ADABIYOTLARDAN KEYIN turadi — shuning uchun alohida oqim. */
  const appendix: WorkBodyItem[] = [];
  const toc: WorkTocRow[] = [];
  const drawnTables = new Set<string>();
  /** Joriy oqim: asosiy tana yoki ilova (`pushBlocks` shunga yozadi). */
  let sink: WorkBodyItem[] = body;

  const pushHead = (row: WorkTocRow) => toc.push(row);

  const tableItem = (t: DocTable, path: string): WorkBodyItem => {
    const n = numbers.tables[t.id!] ?? "";
    drawnTables.add(t.id!);
    const raw = (t.caption ?? "").trim();
    return {
      k: "table",
      tableId: t.id!,
      table: t,
      number: n,
      numberLine: L.tableRef(n),
      caption: cites(raw).text,
      ...(t.source?.trim() ? { source: `${L.source} ${cites(t.source.trim()).text}` } : {}),
      path,
    };
  };

  const textItem = (b: Extract<Block, { kind: "p" | "li" | "quote" }>, path: string): WorkBodyItem => {
    const r = cites(b.text);
    return { k: b.kind, text: r.text, spans: r.spans, path };
  };

  /** Bo'lim bloklari; `chapter` — formula raqami uchun bob (referatda bo'lim) raqami. */
  const pushBlocks = (blocks: Block[], path: string, chapter: number, fcount: { n: number }) => {
    blocks.forEach((b, bi) => {
      const p = `${path}.blocks.${bi}`;
      switch (b.kind) {
        case "h1":
          sink.push({ k: "h1", text: b.text, title: b.text, sectionId: "", path: p, head: "structural", pageBreak: false });
          break;
        case "h2":
          sink.push({ k: "h2", text: b.text, title: b.text, sectionId: "", path: p });
          break;
        case "h3":
          sink.push({ k: "h3", text: b.text, path: p });
          break;
        case "code":
          sink.push({ k: "code", text: b.text, ...(b.caption ? { caption: b.caption } : {}), path: p });
          break;
        case "figure": {
          const f = figures.get(b.figureId);
          if (f?.fallbackBlocks?.length) {
            // Sxema maketlanmadi — o'rniga raqamlangan ro'yxat (raqam ham berilmaydi).
            pushBlocks(f.fallbackBlocks, path, chapter, fcount);
            break;
          }
          const n = numbers.figures[b.figureId] ?? "";
          const cap = (b.text || f?.caption || "").trim();
          const src = f?.source?.trim();
          sink.push({
            k: "figure",
            figureId: b.figureId,
            ...(f ? { figure: f } : {}),
            number: n,
            caption: `${L.figureRef(n)}. ${cites(cap).text}`.trim(),
            placeholder: `[${L.figureRef(n)}]`,
            ...(src ? { source: `${L.source} ${cites(src).text}` } : {}),
            path: p,
          });
          break;
        }
        case "tableRef": {
          const t = tables.get(b.tableId);
          if (t && !drawnTables.has(b.tableId)) sink.push(tableItem(t, p));
          break;
        }
        case "formula": {
          // Bobsiz bo'lim (kirish/xulosa/ilova) va referat — TEKIS raqam.
          const n = flat || !chapter ? String(fcount.n + 1) : `${chapter}.${fcount.n + 1}`;
          fcount.n++;
          formulas[p] = n;
          sink.push({ k: "formula", latex: b.text, number: `(${n})`, display: b.display !== false, path: p });
          break;
        }
        default:
          sink.push(textItem(b, p));
      }
    });
  };

  /* ── bo'limlar: kirish → boblar/paragraflar → xulosa (ilova adabiyotlardan keyin) ── */
  const appendices: DocSection[] = [];
  let chapterN = 0;
  let paragraphN = 0;
  const fcount: Record<number, { n: number }> = {};
  const counterFor = (ch: number) => (fcount[ch] ??= { n: 0 });

  doc.sections.forEach((s) => {
    const index = doc.sections.indexOf(s);
    const path = `sections.${index}`;
    if (isAppendixId(s.id)) {
      appendices.push(s);
      return;
    }
    if (isChapterHeadId(s.id)) {
      chapterN++;
      paragraphN = 0;
      const number = flat ? `${chapterN}.` : L.chapterPrefix(chapterN);
      const text = `${number} ${(s.title || "").toUpperCase()}`.trim();
      sink.push({
        k: "h1",
        text,
        title: s.title,
        number,
        sectionId: s.id,
        path: `${path}.title`,
        head: "chapter",
        // Kurs ishi/mustaqil ishda har bob YANGI VARAQDAN; referat bo'limlari oqadi.
        pageBreak: !flat,
      });
      pushHead({ text, level: 1 });
      // Bob sarlavhasi bo'limida matn bo'lmaydi, lekin tahrirdan keyin
      // paydo bo'lsa yo'qolmasin.
      if (s.blocks.length) pushBlocks(s.blocks, path, chapterN, counterFor(chapterN));
      return;
    }
    if (isParagraphId(s.id)) {
      if (!s.blocks.length) return;
      paragraphN++;
      const chapter = parseWorkSectionId(s.id)!.chapter;
      const number = L.paragraphPrefix(chapter, paragraphN);
      const text = `${number} ${s.title}`.trim();
      sink.push({ k: "h2", text, title: s.title, number, sectionId: s.id, path: `${path}.title` });
      pushHead({ text, level: 2 });
      pushBlocks(s.blocks, path, chapter, counterFor(chapter));
      return;
    }
    // KIRISH / XULOSA / boshqa raqamsiz bo'lim.
    if (!s.blocks.length) return;
    const text = structuralText(s, L, 0);
    sink.push({
      k: "h1",
      text,
      title: s.title,
      sectionId: s.id,
      path: `${path}.title`,
      head: "structural",
      /*
       * GOST 7.32 / uslubiy ko'rsatmalar: tuzilmaviy element (KIRISH,
       * XULOSA, ADABIYOTLAR, ILOVA) HAR DOIM yangi varaqdan — janrga
       * bog'liq emas. Birinchi band uchun chizuvchilar uzilishni
       * qo'shmaydi (titul/mundarija allaqachon varaqni yopgan).
       */
      pageBreak: true,
    });
    pushHead({ text, level: 1 });
    pushBlocks(s.blocks, path, 0, counterFor(0));
  });

  // Langarlangan, lekin `tableRef` siz jadvallar — hujjat oxirida yo'qolmasin.
  for (const t of doc.tables ?? []) {
    if (t.id && !drawnTables.has(t.id)) sink.push(tableItem(t, `tables.${(doc.tables ?? []).indexOf(t)}`));
  }

  /* ── adabiyotlar (yangi varaqdan) ── */
  const refsLabel = L.references.toUpperCase();
  if (refs.length) pushHead({ text: refsLabel, level: 1 });

  /* ── ilovalar (har biri yangi varaqdan, ADABIYOTLARDAN KEYIN) ── */
  sink = appendix;
  appendices.forEach((s, i) => {
    const index = doc.sections.indexOf(s);
    const path = `sections.${index}`;
    const text = structuralText(s, L, i + 1);
    sink.push({ k: "h1", text, title: s.title, sectionId: s.id, path: `${path}.title`, head: "structural", pageBreak: true });
    pushHead({ text, level: 1 });
    if (s.title && s.title.toUpperCase() !== text) {
      // «1-ILOVA» ostidagi ilova NOMI — alohida markazlashgan qator.
      sink.push({ k: "h3", text: s.title, path: `${path}.title` });
    }
    pushBlocks(s.blocks, path, 0, counterFor(0));
  });

  return {
    model,
    genre,
    kind,
    subject,
    language,
    cite: WORK_CITE_STYLE,
    labels: L,
    toc,
    body,
    appendix,
    refsLabel,
    refs,
    numbers: { ...numbers, formulas },
    page: { marginsCm: workMarginsCm(subject), ...WORK_TYPE },
    tableNumberAlign: "right",
    headingAlign: "center",
  };
}

/** Ilovalar bo'limlari — `planWork` tartibida (adabiyotlardan keyin). */
export function workAppendices(doc: AcademicDoc): DocSection[] {
  return doc.sections.filter((s) => isAppendixId(s.id));
}

export function workFigureNumber(plan: WorkPlan, figureId: string): string | undefined {
  return plan.numbers.figures[figureId];
}

export function workTableNumber(plan: WorkPlan, tableId: string): string | undefined {
  return plan.numbers.tables[tableId];
}
