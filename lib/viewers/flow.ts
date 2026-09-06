import { docLabels } from "@/lib/generation/i18n";
import type { AcademicDoc, Block, DocTable } from "@/lib/generation/types";

export type FlowItem =
  | { type: "title"; id: string }
  | { type: "toc"; id: string }
  | { type: "abstract"; id: string; label: string; text: string; keywords: string }
  | { type: "h1"; id: string; text: string; sectionId?: string }
  | { type: "h2"; id: string; text: string }
  | { type: "h3"; id: string; text: string }
  | { type: "p"; id: string; text: string }
  | { type: "li"; id: string; text: string }
  | { type: "quote"; id: string; text: string }
  | { type: "code"; id: string; text: string; caption?: string }
  | { type: "table"; id: string; table: DocTable }
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
  | { type: "ref"; id: string; n: number; text: string };

export { titleModel, type TitleModel } from "@/lib/generation/title-model";

export { tocRows, type TocRow } from "@/lib/generation/toc-model";

export function docToFlow(doc: AcademicDoc): FlowItem[] {
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
    const rows = tb.rows;
    const chunk = 10;
    if (rows.length <= chunk) {
      items.push({ type: "table", id: id("tb"), table: tb });
    } else {
      for (let i = 0; i < rows.length; i += chunk) {
        items.push({
          type: "table",
          id: id("tb"),
          table: {
            caption: i === 0 ? tb.caption : tb.caption ? `${tb.caption} (davomi)` : undefined,
            headers: tb.headers,
            rows: rows.slice(i, i + chunk),
          },
        });
      }
    }
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
