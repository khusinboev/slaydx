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
  | { type: "ref"; id: string; n: number; text: string };

export type TitleModel = {
  labels: ReturnType<typeof docLabels>;
  ministry: string[];
  university: string;
  faculty?: string;
  department?: string;
  workLabel: string;
  topic: string;
  author?: string;
  courseLine?: string;
  teacher?: string;
  subject?: string;
  cityYear: string;
};

export function titleModel(doc: AcademicDoc): TitleModel {
  const { meta } = doc;
  const L = docLabels(meta.language);
  const year = new Date(Date.now()).getFullYear();
  const faculty = meta.faculty ? L.faculty(meta.faculty) : undefined;
  const department = meta.department ? L.department(meta.department) : undefined;
  const courseLine = [meta.course && L.course(meta.course), meta.group && L.group(meta.group)]
    .filter(Boolean)
    .join(", ");
  return {
    labels: L,
    ministry: (meta.ministry === "maktab" ? L.ministrySchool : L.ministryHigher).split("\n"),
    university: meta.university,
    faculty,
    department,
    workLabel: meta.workLabel,
    topic: meta.topic,
    author: meta.author || undefined,
    courseLine: courseLine || undefined,
    teacher: meta.teacher || undefined,
    subject: meta.subject || undefined,
    cityYear: `${meta.city || "Toshkent"} — ${year}`,
  };
}

export function tocEntries(doc: AcademicDoc) {
  const rows = doc.sections.map((s) => s.title);
  if (doc.references?.length) rows.push(docLabels(doc.meta.language).references);
  return rows;
}

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
