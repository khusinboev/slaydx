import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  LeaderType,
  Packer,
  PageBorderDisplay,
  PageBorderOffsetFrom,
  PageNumber,
  Paragraph,
  ShadingType,
  TabStopType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { ESSAY_DESIGNS } from "../languages";
import { docLabels } from "./i18n";
import { cleanText } from "./quality";
import type { AcademicDoc, Block } from "./types";

const FONT = "Times New Roman";
const SIZE = 28; // 14pt
const LINE = 360; // 1.5
const CM = 567;
const CONTENT_W = 11906 - 3 * CM - Math.round(1.5 * CM);

type RunExtra = {
  bold?: boolean;
  italics?: boolean;
  size?: number;
};

function run(text: string, extra: RunExtra = {}) {
  return new TextRun({ text: cleanText(text), font: FONT, size: extra.size ?? SIZE, bold: extra.bold, italics: extra.italics });
}

function bodyP(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 200, line: LINE },
    indent: { firstLine: Math.round(1.25 * CM) },
    children: [run(text)],
  });
}

function centerP(text: string, extra: RunExtra = {}): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 160, line: LINE },
    children: [run(text, extra)],
  });
}

function leftP(text: string, extra: RunExtra = {}): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 120, line: LINE },
    children: [run(text, extra)],
  });
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({
    heading: level,
    alignment: AlignmentType.CENTER,
    spacing: { before: 280, after: 200, line: LINE },
    children: [run(text, { bold: true })],
  });
}

function codeBox(text: string, caption?: string): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  if (caption) out.push(centerP(caption, { italics: true, size: 22 }));
  const border = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
  const lines = text.replace(/\r/g, "").split("\n");
  out.push(
    new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: [CONTENT_W],
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: CONTENT_W, type: WidthType.DXA },
              borders: { top: border, bottom: border, left: border, right: border },
              shading: { type: ShadingType.CLEAR, fill: "F2F2F2" },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: lines.map(
                (line) =>
                  new Paragraph({
                    spacing: { line: 276, after: 0 },
                    children: [
                      new TextRun({
                        text: line.length ? line : " ",
                        font: "Consolas",
                        size: 20,
                      }),
                    ],
                  }),
              ),
            }),
          ],
        }),
      ],
    }),
  );
  return out;
}

function tocLine(label: string, page: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 80, line: LINE },
    tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W, leader: LeaderType.DOT }],
    children: [run(label), new TextRun({ text: "\t", font: FONT, size: SIZE }), run(page)],
  });
}

function estimateTocPages(doc: AcademicDoc): string[] {
  let page = doc.titlePage ? 3 : 2;
  const pages: string[] = [];
  for (const s of doc.sections) {
    pages.push(String(page));
    const words = s.blocks.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
    page += Math.max(1, Math.round(words / 280));
  }
  if (doc.references?.length) pages.push(String(page));
  return pages;
}

function blockToParagraphs(b: Block): Array<Paragraph | Table> {
  switch (b.kind) {
    case "h1":
      return [heading(b.text, HeadingLevel.HEADING_1)];
    case "h2":
      return [heading(b.text, HeadingLevel.HEADING_2)];
    case "h3":
      return [
        new Paragraph({
          spacing: { before: 200, after: 120, line: LINE },
          children: [run(b.text, { bold: true })],
        }),
      ];
    case "li":
      return [
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 80, line: LINE },
          children: [run(b.text)],
        }),
      ];
    case "quote":
      return [
        new Paragraph({
          indent: { left: CM },
          spacing: { after: 200, line: LINE },
          children: [run(b.text, { italics: true })],
        }),
      ];
    case "code":
      return codeBox(b.text, b.caption);
    default:
      return [bodyP(b.text)];
  }
}

function tableOf(headers: string[], rows: string[][]): Table {
  const border = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (text: string, bold = false) =>
    new TableCell({
      borders,
      width: { size: Math.round(100 / headers.length), type: WidthType.PERCENTAGE },
      children: [
        new Paragraph({
          spacing: { after: 40, line: 276 },
          children: [run(text, { bold, size: 22 })],
        }),
      ],
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: headers.map((h) => cell(h, true)) }),
      ...rows.map((r) => new TableRow({ children: r.map((c) => cell(c)) })),
    ],
  });
}

export async function renderDocx(doc: AcademicDoc): Promise<Uint8Array> {
  const { meta } = doc;
  const L = docLabels(meta.language);
  const year = new Date().getFullYear();
  const children: Array<Paragraph | Table> = [];

  if (doc.titlePage) {
    const ministry = meta.ministry === "maktab" ? L.ministrySchool : L.ministryHigher;
    for (const line of ministry.split("\n")) {
      children.push(centerP(line, { bold: true, size: 24 }));
    }
    children.push(centerP(""));
    if (meta.university && !/^oliy ta[’']lim muassasasi$/i.test(meta.university)) {
      children.push(centerP(meta.university.toUpperCase(), { bold: true, size: 24 }));
    }
    children.push(centerP(""));
    if (meta.faculty) children.push(centerP(L.faculty(meta.faculty)));
    if (meta.department) children.push(centerP(L.department(meta.department)));
    children.push(centerP(""));
    children.push(centerP(""));
    children.push(centerP(meta.workLabel.toUpperCase(), { bold: true, size: 32 }));
    children.push(centerP(""));
    children.push(centerP(`«${meta.topic}»`, { bold: true, italics: true }));
    children.push(centerP(""));
    children.push(centerP(""));
    if (meta.author) children.push(leftP(`${L.doneBy}: ${meta.author}`));
    if (meta.course || meta.group) {
      children.push(
        leftP([meta.course && L.course(meta.course), meta.group && L.group(meta.group)].filter(Boolean).join(", ")),
      );
    }
    if (meta.teacher) children.push(leftP(`${L.supervisor}: ${meta.teacher}`));
    if (meta.subject && meta.subject.toLowerCase() !== meta.workLabel.toLowerCase()) {
      children.push(leftP(`${L.subject}: ${meta.subject}`));
    }
    children.push(centerP(""));
    children.push(centerP(""));
    children.push(centerP(L.academicYear(year, year + 1)));
    children.push(centerP(`${meta.city} — ${year}`, { bold: true }));
    children.push(new Paragraph({ children: [run("")], pageBreakBefore: true }));
  }

  if (doc.toc) {
    const tocPages = estimateTocPages(doc);
    children.push(heading(L.toc, HeadingLevel.HEADING_1));
    doc.sections.forEach((s, i) => {
      children.push(tocLine(`${i + 1}. ${s.title}`, tocPages[i] ?? ""));
    });
    if (doc.references?.length) {
      children.push(tocLine(`${doc.sections.length + 1}. ${L.references}`, tocPages[doc.sections.length] ?? ""));
    }
    children.push(new Paragraph({ children: [run("")], pageBreakBefore: true }));
  }

  for (const a of doc.abstracts ?? []) {
    children.push(heading(a.label.toUpperCase(), HeadingLevel.HEADING_1));
    children.push(bodyP(a.text));
    children.push(bodyP(`${L.keywords}: ${a.keywords}`));
  }

  for (const s of doc.sections) {
    children.push(heading(s.title.toUpperCase(), HeadingLevel.HEADING_1));
    for (const b of s.blocks) children.push(...blockToParagraphs(b));
  }

  for (const tb of doc.tables ?? []) {
    if (tb.caption) children.push(centerP(tb.caption, { italics: true, size: 24 }));
    children.push(tableOf(tb.headers, tb.rows));
  }

  if (doc.references?.length) {
    children.push(heading(L.references, HeadingLevel.HEADING_1));
    doc.references.forEach((r, i) => children.push(bodyP(`${i + 1}. ${r}`)));
  }

  // OTME/GOST: raqam pastida, markazda. Titul — 1-sahifa, lekin raqam chiqmaydi.
  const pageNumberRun = new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 22 });
  const numberedFooter = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [pageNumberRun],
      }),
    ],
  });
  const blankFooter = new Footer({ children: [new Paragraph({})] });
  const hasTitle = Boolean(doc.titlePage);
  const design = ESSAY_DESIGNS.find((d) => d.value === meta.design);
  const borderColor = meta.toolId === "essay" && design ? design.from.replace("#", "") : "222222";

  const document = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: SIZE },
          paragraph: { spacing: { line: LINE } },
        },
      },
    },
    sections: [
      {
        properties: {
          titlePage: hasTitle,
          page: {
            size: { width: 11906, height: 16838 },
            margin: {
              top: 2 * CM,
              bottom: 2 * CM,
              left: 3 * CM,
              right: Math.round(1.5 * CM),
            },
            pageNumbers: { start: 1 },
            borders: {
              pageBorders: {
                display: PageBorderDisplay.ALL_PAGES,
                offsetFrom: PageBorderOffsetFrom.PAGE,
              },
              pageBorderTop: { style: BorderStyle.SINGLE, size: 12, space: 18, color: borderColor },
              pageBorderRight: { style: BorderStyle.SINGLE, size: 12, space: 12, color: borderColor },
              pageBorderBottom: { style: BorderStyle.SINGLE, size: 12, space: 18, color: borderColor },
              pageBorderLeft: { style: BorderStyle.SINGLE, size: 12, space: 14, color: borderColor },
            },
          },
        },
        footers: hasTitle
          ? { first: blankFooter, default: numberedFooter }
          : { default: numberedFooter },
        children,
      },
    ],
  });

  const buf = await Packer.toBuffer(document);
  return new Uint8Array(buf);
}
