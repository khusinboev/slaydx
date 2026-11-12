import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  LineRuleType,
  Packer,
  PageBorderDisplay,
  PageBorderOffsetFrom,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { contentWidthMm, NOTE_GAP_PT, planTitlePage, SINGLE_LINE, type TitulAlign, type TitulItem, type TitulLineRow, type TitulPara, type TitulPlan } from "./layout";
import type { TitulModel } from "./types";

/**
 * «Titul» DOCX — draws `planTitlePage` and decides nothing itself.
 *
 *   • zones = rows of ONE borderless fixed table (height «at least» the zone,
 *     the cell's vertical alignment = the zone's); the tail is the paragraph
 *     after the table (Word cannot end a document with a table anyway);
 *   • a line row = a nested two-column table: label | value with a bottom
 *     border, the note in a second row; a 1 pt paragraph follows it (a cell
 *     must end with a paragraph) and carries the row's spacing after;
 *   • every paragraph writes `lineRule: auto` explicitly (CLAUDE.md trap:
 *     without it LibreOffice reads `w:line` as an exact height);
 *   • the frame is a real section page border (`w:pgBorders`, double line,
 *     measured from the page edge), never a picture.
 */

const MM = 56.7;
const twip = (mm: number) => Math.round(mm * MM);
const tw = (pt: number) => Math.round(pt * 20);
const hp = (pt: number) => Math.round(pt * 2);
/** Word «multiple» line spacing in 240ths of a line. */
const lineOf = (multiple: number) => Math.round(240 * multiple);

const NONE = { style: BorderStyle.NONE, size: 0, color: "auto" } as const;
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };
const ZERO_MARGINS = { top: 0, bottom: 0, left: 0, right: 0 };

const ALIGN: Record<TitulAlign, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
};

const VALIGN = {
  top: VerticalAlign.TOP,
  center: VerticalAlign.CENTER,
  bottom: VerticalAlign.BOTTOM,
} as const;

function textRun(font: string, text: string, sizePt: number, o: { bold?: boolean; italic?: boolean; spacingPt?: number }): TextRun {
  return new TextRun({
    text,
    font,
    size: hp(sizePt),
    bold: Boolean(o.bold),
    italics: Boolean(o.italic),
    ...(o.spacingPt ? { characterSpacing: tw(o.spacingPt) } : {}),
  });
}

function paragraph(plan: TitulPlan, p: TitulPara): Paragraph {
  const children: TextRun[] = [];
  p.runs.forEach((r, i) => {
    if (i && p.sep) children.push(textRun(plan.font, p.sep, p.sizePt, { spacingPt: p.spacingPt }));
    children.push(textRun(plan.font, r.text, p.sizePt, { bold: r.bold, italic: r.italic, spacingPt: p.spacingPt }));
  });
  return new Paragraph({
    alignment: ALIGN[p.align],
    spacing: { before: tw(p.beforePt), after: tw(p.afterPt), line: lineOf(p.line), lineRule: LineRuleType.AUTO },
    ...(p.indentMm ? { indent: { left: twip(p.indentMm) } } : {}),
    run: { font: plan.font, size: hp(p.sizePt) },
    children,
  });
}

/** A 1 pt paragraph: the spacing before / after a nested table (and the paragraph a cell must end with). */
function spacer(font: string, beforePt: number, afterPt: number): Paragraph {
  return new Paragraph({
    spacing: { before: tw(beforePt), after: tw(afterPt), line: 240, lineRule: LineRuleType.AUTO },
    // The paragraph MARK decides the height of an empty paragraph, not its (empty) run.
    run: { font, size: 2 },
    children: [new TextRun({ text: "", font, size: 2 })],
  });
}

function cellParagraph(plan: TitulPlan, text: string, sizePt: number, align: TitulAlign, o: { bold?: boolean; italic?: boolean }, beforePt = 0): Paragraph {
  return new Paragraph({
    alignment: ALIGN[align],
    spacing: { before: tw(beforePt), after: 0, line: 240, lineRule: LineRuleType.AUTO },
    run: { font: plan.font, size: hp(sizePt) },
    children: [textRun(plan.font, text, sizePt, o)],
  });
}

function lineRow(plan: TitulPlan, it: TitulLineRow): Array<Paragraph | Table> {
  const labelW = twip(it.labelMm);
  const valueW = twip(it.widthMm - it.labelMm);
  const underline = { style: BorderStyle.SINGLE, size: 6, color: "000000" } as const;
  const cell = (children: Paragraph[], width: number, extra: { bottom?: typeof underline } = {}) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      margins: ZERO_MARGINS,
      borders: { ...NO_BORDERS, ...(extra.bottom ? { bottom: extra.bottom } : {}) },
      verticalAlign: VerticalAlign.BOTTOM,
      children,
    });
  const rows = [
    new TableRow({
      children: [
        cell(it.label ? [cellParagraph(plan, it.label.text, it.labelSizePt, "left", it.label)] : [spacer(plan.font, 0, 0)], labelW),
        cell([cellParagraph(plan, it.value.text, it.valueSizePt, it.valueAlign, it.value)], valueW, { bottom: underline }),
      ],
    }),
  ];
  if (it.note) {
    rows.push(
      new TableRow({
        children: [cell([spacer(plan.font, 0, 0)], labelW), cell([cellParagraph(plan, it.note.text, it.noteSizePt, "center", it.note, NOTE_GAP_PT)], valueW)],
      }),
    );
  }
  const table = new Table({
    width: { size: labelW + valueW, type: WidthType.DXA },
    columnWidths: [labelW, valueW],
    layout: TableLayoutType.FIXED,
    borders: { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE },
    indent: { size: twip(it.offsetMm), type: WidthType.DXA },
    rows,
  });
  return [...(it.beforePt ? [spacer(plan.font, Math.max(0, it.beforePt - SINGLE_LINE), 0)] : []), table, spacer(plan.font, 0, Math.max(0, it.afterPt - SINGLE_LINE))];
}

function items(plan: TitulPlan, list: TitulItem[]): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  for (const it of list) {
    if (it.k === "p") out.push(paragraph(plan, it));
    else out.push(...lineRow(plan, it));
  }
  // A cell must end with a paragraph (an empty zone too).
  if (!out.length || out[out.length - 1] instanceof Table) out.push(spacer(plan.font, 0, 0));
  return out;
}

/** The plan as DOCX bytes. */
export async function renderTitulPlanDocx(plan: TitulPlan): Promise<Uint8Array> {
  const m = plan.page.margin;
  const W = twip(contentWidthMm(plan));
  const zones = new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [W],
    layout: TableLayoutType.FIXED,
    borders: { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE },
    rows: plan.zones.map(
      (z) =>
        new TableRow({
          height: { value: twip(z.heightMm), rule: HeightRule.ATLEAST },
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: W, type: WidthType.DXA },
              margins: ZERO_MARGINS,
              borders: NO_BORDERS,
              verticalAlign: VALIGN[z.valign],
              children: items(plan, z.items),
            }),
          ],
        }),
    ),
  });
  const tail = plan.tail.length ? plan.tail.map((p) => paragraph(plan, p)) : [spacer(plan.font, 0, 0)];
  const b = plan.border;
  const line = b ? { style: BorderStyle.DOUBLE, size: Math.round(b.linePt * 8), color: "000000", space: Math.round(b.offsetPt) } : null;

  const document = new Document({
    styles: {
      default: {
        document: {
          run: { font: plan.font, size: 28 },
          paragraph: { spacing: { line: 240, lineRule: LineRuleType.AUTO } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: twip(plan.page.widthMm), height: twip(plan.page.heightMm) },
            margin: { top: twip(m.top), right: twip(m.right), bottom: twip(m.bottom), left: twip(m.left), header: 0, footer: 0 },
            ...(line
              ? {
                  borders: {
                    pageBorders: { display: PageBorderDisplay.ALL_PAGES, offsetFrom: PageBorderOffsetFrom.PAGE },
                    pageBorderTop: line,
                    pageBorderRight: line,
                    pageBorderBottom: line,
                    pageBorderLeft: line,
                  },
                }
              : {}),
          },
        },
        children: [zones, ...tail],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

/** The stored model as DOCX bytes (engine, rebuild after an edit). */
export function renderTitulDocx(model: TitulModel): Promise<Uint8Array> {
  return renderTitulPlanDocx(planTitlePage(model));
}
