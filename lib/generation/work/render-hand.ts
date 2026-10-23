/**
 * MUSTAQIL ISH — QO'LYOZMA DOCX (Program 17 band 10).
 *
 * `renderDocx` `plan.style` bor rejani shu yerga uzatadi. MAZMUN va TARTIB
 * `planWork` dan (oddiy `drawWork` bilan bir xil bandlar, raqamlar, matn);
 * bu yerda faqat CHIZILISHI boshqacha:
 *
 *   • shrift/siyoh — qo'lyozma shrifti, ruchka rangi, QALIN yo'q (qo'lda
 *     qalin yozilmaydi; sarlavha tagi chiziladi);
 *   • HAR qator QAT'IY (exact) balandlikda = daftar chizig'i oralig'i; barcha
 *     bo'shliqlar shu oraliqning butun karrasi, shuning uchun matn chiziqda turadi;
 *   • varaq foni — sahifa sarlavhasiga (header) langarlangan, matn ORQASIDAGI
 *     A4 PNG (chiziqli/katakli + qizil chegara; `paper-png.ts`). Word `w:background`
 *     bosmaga chiqmaydi, LibreOffice esa uni umuman ko'rsatmaydi — header rasmi
 *     ikkalasida ham har sahifada chiqadi;
 *   • titul — daftar muqovasi (`handCoverLines`), rasmiy titul emas;
 *   • rasm — chizilmaydi: bo'sh ramka «[1.1-rasm]» (talaba o'zi chizadi/yopishtiradi);
 *     jadval — ingichka «ruchka» chegarasi, qalin/rangli sarlavhasiz; formula —
 *     oddiy matn (`handFormulaText`).
 *
 * `lineRule: EXACT` BU YERDA ATAYIN (CLAUDE.md «AUTO» qoidasi oddiy hujjat
 * uchun; qo'lyozmada chiziqqa tushish uchun aniq balandlik shart).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  HeightRule,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  TextWrappingType,
  UnderlineType,
  VerticalAlign,
  VerticalPositionRelativeFrom,
  WidthType,
} from "docx";
import { cleanText } from "../quality";
import { columnPercents } from "../table-columns";
import { titleModel } from "../title-model";
import type { AcademicDoc } from "../types";
import {
  HAND_PAGE,
  HAND_FONTS,
  handCoverLines,
  handFormulaText,
  handGeometry,
  handText,
  type HandGeometry,
  type HandStyle,
} from "./handwriting";
import type { WorkBodyItem, WorkPlan } from "./layout";
import { paperPng } from "./paper-png";

/** Shriftni DOCX ga joylash uchun qidiriladigan kataloglar (dev: `public/`, konteyner: o'rnatilgan shriftlar). */
function fontFileBytes(file: string): Buffer | null {
  for (const dir of [path.join(process.cwd(), "public", "fonts", "handwriting"), "/usr/share/fonts/slaydx-handwriting"]) {
    const p = path.join(dir, file);
    if (existsSync(p)) return readFileSync(p);
  }
  return null;
}

type RunExtra = { size?: number; underline?: boolean; italics?: boolean };

export async function renderHandDocx(doc: AcademicDoc, plan: WorkPlan & { style: HandStyle }): Promise<Uint8Array> {
  const style = plan.style;
  const G: HandGeometry = handGeometry(style.paper, style.font);
  const spec = HAND_FONTS[style.font];
  const pitch = G.pitchTw;
  const size = G.sizePt * 2;
  const ink = style.inkHex;
  const W = G.contentTw;

  const run = (text: string, extra: RunExtra = {}): TextRun =>
    new TextRun({
      text: handText(style.font, cleanText(text)),
      font: spec.family,
      size: extra.size ?? size,
      bold: false,
      color: ink,
      ...(extra.italics ? { italics: true } : {}),
      ...(extra.underline ? { underline: { type: UnderlineType.SINGLE, color: ink } } : {}),
    });

  /** Iqtibosli matn — HAR bo'lak alohida `<w:t>` (ko'ruvchidagi `<span>` lar bilan juft). */
  const spanRuns = (spans: { text: string }[]): TextRun[] =>
    spans
      .filter((s) => s.text.length)
      .map(
        (s) =>
          new TextRun({
            text: handText(style.font, `${/^\s/.test(s.text) ? " " : ""}${cleanText(s.text)}${/\s$/.test(s.text) ? " " : ""}`),
            font: spec.family,
            size,
            bold: false,
            color: ink,
          }),
      );

  /** Bo'shliq — qator OLDIDA/KEYIN faqat butun qator soni. */
  const lines = (n: number) => Math.round(n * pitch);
  type POpts = {
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    before?: number;
    after?: number;
    firstLine?: number;
    left?: number;
    hanging?: number;
    keepNext?: boolean;
    pageBreakBefore?: boolean;
    heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
    bullet?: boolean;
    tabs?: { type: (typeof TabStopType)[keyof typeof TabStopType]; position: number }[];
  };
  const para = (children: TextRun[], o: POpts = {}): Paragraph =>
    new Paragraph({
      alignment: o.align ?? AlignmentType.LEFT,
      spacing: { before: lines(o.before ?? 0), after: lines(o.after ?? 0), line: pitch, lineRule: LineRuleType.EXACT },
      ...(o.firstLine || o.left || o.hanging
        ? { indent: { ...(o.left ? { left: o.left } : {}), ...(o.firstLine ? { firstLine: o.firstLine } : {}), ...(o.hanging ? { hanging: o.hanging } : {}) } }
        : {}),
      ...(o.keepNext ? { keepNext: true } : {}),
      ...(o.pageBreakBefore ? { pageBreakBefore: true } : {}),
      ...(o.heading ? { heading: o.heading } : {}),
      ...(o.bullet ? { bullet: { level: 0 } } : {}),
      ...(o.tabs ? { tabStops: o.tabs } : {}),
      children,
    });
  const blank = () => para([run("")]);
  /** Tab — `run()` bo'shliqlarni kesadi, shuning uchun alohida. */
  const tab = () => new TextRun({ text: "\t", font: spec.family, size, color: ink });

  const out: Array<Paragraph | Table> = [];
  /** Titul varaqni allaqachon yopdi: keyingi birinchi band yangi varaqdan boshlanadi. */
  let pendingBreak = false;
  let drawn = false;
  const takeBreak = (want: boolean): boolean => {
    const yes = pendingBreak || (want && drawn);
    pendingBreak = false;
    drawn = true;
    return yes;
  };

  /* ── titul: daftar muqovasi ── */
  const hasTitle = Boolean(doc.titlePage);
  if (hasTitle) {
    const T = titleModel(doc);
    if (T.kind === "gost") {
      for (const l of handCoverLines(T)) {
        if (l.role === "gap") out.push(blank());
        else if (l.role === "center") out.push(para([run(l.text, l.big ? { size: Math.round(size * 1.25) } : {})], { align: AlignmentType.CENTER }));
        else out.push(para([...(l.label ? [run(`${l.label}:`), new TextRun({ text: " ", font: spec.family, size, color: ink })] : []), run(l.text, { underline: true })], { left: lines(2) }));
      }
      pendingBreak = true;
    }
  }

  /* ── mundarija: oddiy qatorlar (Word maydoni yo'q — yangilash qatorlarni buzmasin) ── */
  if (doc.toc && plan.toc.length) {
    out.push(para([run(plan.labels.toc, { underline: true })], { align: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1, keepNext: true, after: 1, pageBreakBefore: takeBreak(false) }));
    for (const r of plan.toc) out.push(para([run(r.text)], { left: r.level === 2 ? HAND_PAGE.firstLineTw : 0 }));
  }

  const colPercents = (headers: string[], widths?: number[]) => widths ?? columnPercents(headers) ?? headers.map(() => Math.round(100 / headers.length));
  const penBorder = { style: BorderStyle.SINGLE, size: 4, color: ink };
  const borders = { top: penBorder, bottom: penBorder, left: penBorder, right: penBorder };

  const cellParas = (text: string, align: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT) => [para([run(text)], { align })];

  const penTable = (headers: string[], rows: string[][], widths?: number[]): Table => {
    const pct = colPercents(headers, widths);
    const grid = pct.map((w) => Math.round((W * w) / 100));
    const cell = (text: string, i: number) =>
      new TableCell({
        borders,
        width: { size: grid[i] ?? Math.round(W / headers.length), type: WidthType.DXA },
        margins: { top: 0, bottom: 0, left: 80, right: 80 },
        children: cellParas(text),
      });
    return new Table({
      width: { size: W, type: WidthType.DXA },
      columnWidths: grid,
      layout: TableLayoutType.FIXED,
      rows: [new TableRow({ children: headers.map(cell), cantSplit: true }), ...rows.map((r) => new TableRow({ children: r.map(cell), cantSplit: true }))],
    });
  };

  /** Rasm o'rni: bo'sh ramka (5 qator) — talaba chizadi yoki yopishtiradi. */
  const figureBox = (placeholder: string): Table =>
    new Table({
      width: { size: W, type: WidthType.DXA },
      columnWidths: [W],
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({
          height: { value: lines(5), rule: HeightRule.EXACT },
          cantSplit: true,
          children: [
            new TableCell({
              borders,
              width: { size: W, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 0, bottom: 0, left: 80, right: 80 },
              children: [para([run(placeholder)], { align: AlignmentType.CENTER })],
            }),
          ],
        }),
      ],
    });

  const drawBody = (items: WorkBodyItem[]) => {
    for (const b of items) {
      switch (b.k) {
        case "h1": {
          const brk = takeBreak(b.pageBreak);
          out.push(para([run(b.text, { underline: true })], { align: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1, keepNext: true, pageBreakBefore: brk, after: 1 }));
          break;
        }
        case "h2":
          takeBreak(false);
          out.push(para([run(b.text, { underline: true })], { heading: HeadingLevel.HEADING_2, keepNext: true, firstLine: HAND_PAGE.firstLineTw }));
          break;
        case "h3":
          takeBreak(false);
          out.push(para([run(b.text, { underline: true })], { align: AlignmentType.CENTER, keepNext: true }));
          break;
        case "table":
          takeBreak(false);
          out.push(para([run(b.numberLine)], { align: AlignmentType.RIGHT, keepNext: true }));
          if (b.caption) out.push(para([run(b.caption)], { align: AlignmentType.CENTER, keepNext: true }));
          out.push(penTable(b.table.headers, b.table.rows, b.table.widths));
          if (b.source) out.push(para([run(b.source, { italics: true })]));
          break;
        case "figure":
          takeBreak(false);
          out.push(figureBox(b.placeholder));
          out.push(para([run(b.caption)], { align: AlignmentType.CENTER, keepNext: Boolean(b.source) }));
          if (b.source) out.push(para([run(b.source, { italics: true })], { align: AlignmentType.CENTER }));
          break;
        case "formula":
          takeBreak(false);
          out.push(
            para([tab(), run(handFormulaText(b.latex)), tab(), run(b.number)], {
              tabs: [
                { type: TabStopType.CENTER, position: Math.round(W / 2) },
                { type: TabStopType.RIGHT, position: W },
              ],
            }),
          );
          break;
        case "p":
          takeBreak(false);
          out.push(para(spanRuns(b.spans), { firstLine: HAND_PAGE.firstLineTw }));
          break;
        case "li":
          takeBreak(false);
          out.push(para(spanRuns(b.spans), { bullet: true }));
          break;
        case "quote":
          takeBreak(false);
          out.push(para(spanRuns(b.spans), { left: lines(1) }));
          break;
        case "code":
          takeBreak(false);
          if (b.caption) out.push(para([run(b.caption)], { align: AlignmentType.CENTER, keepNext: true }));
          for (const l of b.text.replace(/\r/g, "").split("\n")) out.push(para([run(l.length ? l : " ")], { left: lines(1) }));
          break;
        default: {
          const never: never = b;
          void never;
        }
      }
    }
  };

  drawBody(plan.body as WorkBodyItem[]);

  if (plan.refs.length) {
    const brk = takeBreak(true);
    out.push(para([run(plan.refsLabel, { underline: true })], { align: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1, keepNext: true, pageBreakBefore: brk, after: 1 }));
    for (const r of plan.refs) out.push(para([run(r.line)], { left: lines(1), hanging: lines(1) }));
  }
  drawBody(plan.appendix);

  /* ── varaq foni: header'ga langarlangan A4 PNG, matn ORQASIDA ── */
  const paper = paperPng(style.paper, style.font);
  const background = () =>
    new Header({
      children: [
        new Paragraph({
          spacing: { line: 20, lineRule: LineRuleType.EXACT, before: 0, after: 0 },
          children: [
            new ImageRun({
              type: "png",
              data: paper,
              transformation: { width: (210 / 25.4) * 96, height: (297 / 25.4) * 96 },
              altText: { name: "Daftar varag'i", title: "Daftar varag'i", description: "Chiziqli/katakli daftar varag'i foni" },
              floating: {
                horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
                verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
                behindDocument: true,
                allowOverlap: true,
                wrap: { type: TextWrappingType.NONE },
              },
            }),
          ],
        }),
      ],
    });

  const numberedFooter = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: pitch, lineRule: LineRuleType.EXACT },
        children: [new TextRun({ children: [PageNumber.CURRENT], font: spec.family, size: Math.round(size * 0.9), color: ink, bold: false })],
      }),
    ],
  });
  const blankFooter = new Footer({ children: [new Paragraph({})] });

  const fontBytes = fontFileBytes(spec.file);

  const document = new Document({
    creator: "SlaydX",
    styles: {
      default: {
        document: {
          run: { font: spec.family, size, color: ink },
          paragraph: { spacing: { line: pitch, lineRule: LineRuleType.EXACT, before: 0, after: 0 } },
        },
      },
    },
    ...(fontBytes ? { fonts: [{ name: spec.family, data: fontBytes, characterSet: "00" }] } : {}),
    sections: [
      {
        properties: {
          titlePage: hasTitle,
          page: {
            size: { width: HAND_PAGE.widthTw, height: HAND_PAGE.heightTw },
            margin: G.margins,
            pageNumbers: { start: 1 },
          },
        },
        headers: hasTitle ? { default: background(), first: background() } : { default: background() },
        footers: hasTitle ? { first: blankFooter, default: numberedFooter } : { default: numberedFooter },
        children: out,
      },
    ],
  });

  return new Uint8Array(await Packer.toBuffer(document));
}
