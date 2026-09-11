import { planArticle, type ArticleAuthorLine, type ArticlePlan, type CiteSpan } from "@/lib/generation/article/layout";
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
  | { type: "h1"; id: string; text: string; sectionId?: string }
  | { type: "h2"; id: string; text: string }
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
  | { type: "table-head"; id: string; table: DocTable; captionAlign?: "left" | "right" }
  | { type: "table-row"; id: string; row: string[] }
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
  | { type: "figure"; id: string; figureId: string; url?: string; w?: number; h?: number; number: string; caption: string; placeholder: string }
  /** Formula — KaTeX SSR; raqam o'ngda. Bitta atom band. */
  | { type: "formula"; id: string; latex: string; number: string; display: boolean }
  /** OAK «REFERENCES» ikkinchi ro'yxatining sarlavhasi (`h1` kabi chiziladi). */
  | { type: "refs2"; id: string; text: string };

export { titleModel, type TitleModel } from "@/lib/generation/title-model";

export { tocRows, type TocRow } from "@/lib/generation/toc-model";

export function docToFlow(doc: AcademicDoc): FlowItem[] {
  /*
   * Maqola 2: tartib/raqamlash `planArticle` dan — bu yerda takrorlanmaydi.
   * Eski maqola (`doc.article` yo'q) quyidagi umumiy yo'l bilan.
   */
  if (doc.article) return articleFlow(planArticle(doc));

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
