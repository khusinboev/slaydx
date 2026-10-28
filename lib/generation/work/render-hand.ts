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
  Column,
  ColumnBreak,
  Footer,
  Header,
  HeadingLevel,
  HeightRule,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LineRuleType,
  Packer,
  PageNumber,
  PageOrientation,
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
  handCoverLines,
  handFaces,
  handFormulaText,
  handGeometry,
  handSegments,
  handTitleSegments,
  handToneHex,
  handWordJitter,
  handWordPieces,
  type HandWordJitter,
  HAND_FONTS,
  HAND_PAPER_SPECS,
  handPageMargins,
  twToMm,
  type HandGeometry,
  type HandStyle,
} from "./handwriting";
import type { WorkBodyItem, WorkPlan } from "./layout";
import JSZip from "jszip";
import { paperPng } from "./paper-png";

/** Shriftni DOCX ga joylash uchun qidiriladigan kataloglar (dev: `public/`, konteyner: o'rnatilgan shriftlar). */
function fontFileBytes(file: string): Buffer | null {
  for (const dir of [path.join(process.cwd(), "public", "fonts", "handwriting"), "/usr/share/fonts/slaydx-handwriting"]) {
    const p = path.join(dir, file);
    if (existsSync(p)) return readFileSync(p);
  }
  return null;
}

type RunExtra = { size?: number; underline?: boolean; italics?: boolean; /** Muqova sarlavhasi: kalligrafik yuz (bor bo'lsa). */ title?: boolean; /** «Jonli yozuv»: so'zning siljishi va siyoh to'qligi. */ jitter?: HandWordJitter };

export async function renderHandDocx(doc: AcademicDoc, plan: WorkPlan & { style: HandStyle }): Promise<Uint8Array> {
  const style = plan.style;
  const G: HandGeometry = handGeometry(style.paper, style.font, style);
  const primary = handFaces(style.font)[0]!;
  /** Sarlavha tagi chizig'i (`style.underline === false` bo'lsa chizilmaydi); muqovadagi to'ldirish chiziqlari doim. */
  const ul = style.underline !== false;
  const pitch = G.pitchTw;
  const size = G.sizePt * 2;
  const ink = style.inkHex;
  const W = G.contentTw;

  /**
   * Matn → `w:r` lar: yo'ldoshli shriftda (Maktab: lotin Playwrite, kirill Marck)
   * har yuz alohida run, o'z shrift nomi va o'lchami bilan. Qator balandligi
   * QAT'IY, shuning uchun yuzlar o'lchami farqi chiziqlarni buzmaydi.
   */
  const runs = (text: string, extra: RunExtra = {}): TextRun[] =>
    (extra.title ? handTitleSegments(style.font, text) : handSegments(style.font, text)).map(
      (seg) =>
        new TextRun({
          text: seg.text,
          font: seg.face.family,
          size: Math.round((extra.size ?? size) * seg.face.scale),
          bold: false,
          color: extra.jitter?.tonePct ? handToneHex(ink, extra.jitter.tonePct) : ink,
          /* `w:position` — butun YARIM-PUNKT (ST_SignedHpsMeasure); `docx` turi UniversalMeasure so'raydi, lekin qiymatni o'zgartirmay yozadi. */
          ...(extra.jitter?.dyHalfPt ? { position: String(extra.jitter.dyHalfPt) as never } : {}),
          ...(extra.italics ? { italics: true } : {}),
          ...(extra.underline ? { underline: { type: UnderlineType.SINGLE, color: ink } } : {}),
        }),
    );
  /** Bo'sh matn ham bitta run beradi (bo'sh qator o'z balandligini saqlasin). */
  const run = (text: string, extra: RunExtra = {}): TextRun[] => {
    const r = runs(cleanText(text), extra);
    return r.length ? r : [new TextRun({ text: "", font: primary.family, size: extra.size ?? size, color: ink })];
  };

  /**
   * Iqtibosli matn — HAR bo'lak alohida `<w:t>` (ko'ruvchidagi `<span>` lar bilan juft).
   * Jonli yozuvda har SO'Z o'z siljishi/to'qligi bilan alohida run (`handWordJitter`:
   * ko'ruvchi bilan bir xil qoida, paragraf boshidan sanaladi).
   */
  const spanRuns = (spans: { text: string }[]): TextRun[] => {
    const parts = spans.filter((s) => s.text.length).map((s) => `${/^\s/.test(s.text) ? " " : ""}${cleanText(s.text)}${/\s$/.test(s.text) ? " " : ""}`);
    if (!style.lively) return parts.flatMap((t) => runs(t));
    let i = 0;
    return parts.flatMap((t) => handWordPieces(t).flatMap((w) => runs(w, { jitter: handWordJitter(i++, w) })));
  };

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
  const para = (children: (TextRun | TextRun[])[], o: POpts = {}): Paragraph =>
    new Paragraph({
      alignment: o.align ?? AlignmentType.LEFT,
      spacing: { before: lines(o.before ?? 0), after: lines(o.after ?? 0), line: pitch, lineRule: LineRuleType.EXACT },
      ...(o.firstLine || o.left || o.hanging
        ? { indent: { ...(o.left ? { left: o.left } : {}), ...(o.firstLine ? { firstLine: o.firstLine } : {}), ...(o.hanging ? { hanging: o.hanging } : {}) } }
        : {}),
      ...(o.keepNext ? { keepNext: true } : {}),
      /* Two-up: a "new page" is the next A5 page = the next COLUMN (a page break would start a new sheet). */
      ...(o.pageBreakBefore && !G.twoUp ? { pageBreakBefore: true } : {}),
      ...(o.heading ? { heading: o.heading } : {}),
      ...(o.bullet ? { bullet: { level: 0 } } : {}),
      ...(o.tabs ? { tabStops: o.tabs } : {}),
      children: o.pageBreakBefore && G.twoUp ? [new ColumnBreak(), ...children.flat()] : children.flat(),
    });
  const blank = () => para([run("")]);
  /** Tab — `run()` bo'shliqlarni kesadi, shuning uchun alohida. */
  const tab = () => new TextRun({ text: "\t", font: primary.family, size, color: ink });

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
        else if (l.role === "center") out.push(para([run(l.text, l.big ? { size: Math.round(size * 1.25), title: style.cover === "calligraphy" } : {})], { align: AlignmentType.CENTER }));
        else out.push(para([...(l.label ? [run(`${l.label}:`), new TextRun({ text: " ", font: primary.family, size, color: ink })] : []), run(l.text, { underline: true })], { left: lines(2) }));
      }
      pendingBreak = true;
    }
  }

  /* ── mundarija: oddiy qatorlar (Word maydoni yo'q — yangilash qatorlarni buzmasin) ── */
  if (doc.toc && plan.toc.length) {
    out.push(para([run(plan.labels.toc, { underline: ul })], { align: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1, keepNext: true, after: 1, pageBreakBefore: takeBreak(false) }));
    for (const r of plan.toc) out.push(para([run(r.text)], { left: r.level === 2 ? G.page.firstLineTw : 0 }));
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
          out.push(para([run(b.text, { underline: ul })], { align: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1, keepNext: true, pageBreakBefore: brk, after: 1 }));
          break;
        }
        case "h2":
          takeBreak(false);
          out.push(para([run(b.text, { underline: ul })], { heading: HeadingLevel.HEADING_2, keepNext: true, firstLine: G.page.firstLineTw }));
          break;
        case "h3":
          takeBreak(false);
          out.push(para([run(b.text, { underline: ul })], { align: AlignmentType.CENTER, keepNext: true }));
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
          out.push(para(spanRuns(b.spans), { firstLine: G.page.firstLineTw }));
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
    out.push(para([run(plan.refsLabel, { underline: ul })], { align: AlignmentType.CENTER, heading: HeadingLevel.HEADING_1, keepNext: true, pageBreakBefore: brk, after: 1 }));
    for (const r of plan.refs) out.push(para([run(r.line)], { left: lines(1), hanging: lines(1) }));
  }
  drawBody(plan.appendix);

  /*
   * Page background: the ruling PNG anchored to the header, behind the text (blank / print paper has none).
   * A4 / A5: one page per image; with the `alternate` margin line the odd and even pages get mirrored images
   * and mirrored text margins. Two-up: ONE image holds both A5 pages of the A4 landscape sheet.
   */
  const ruled = HAND_PAPER_SPECS[style.paper].ruled;
  const mirrored = G.marginMode === "alternate" && !G.twoUp;
  const sheetMm = { w: twToMm(G.sheetTw.width), h: twToMm(G.sheetTw.height) };
  const background = (png: Buffer) =>
    new Header({
      children: [
        new Paragraph({
          spacing: { line: 20, lineRule: LineRuleType.EXACT, before: 0, after: 0 },
          children: [
            new ImageRun({
              type: "png",
              data: png,
              transformation: { width: (sheetMm.w / 25.4) * 96, height: (sheetMm.h / 25.4) * 96 },
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

  /** Page number footer; the two-up sheet has none (one footer cannot number two pages). */
  const numberedFooter = () =>
    new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { line: pitch, lineRule: LineRuleType.EXACT },
          children: [new TextRun({ children: [PageNumber.CURRENT], font: primary.family, size: Math.round(size * 0.9), color: ink, bold: false })],
        }),
      ],
    });
  const blankFooter = () => new Footer({ children: [new Paragraph({})] });
  const footers = G.twoUp
    ? undefined
    : {
        default: numberedFooter(),
        ...(hasTitle ? { first: blankFooter() } : {}),
        ...(mirrored ? { even: numberedFooter() } : {}),
      };
  const headers = ruled
    ? {
        default: background(paperPng(style.paper, style.font, style, 0)),
        ...(hasTitle ? { first: background(paperPng(style.paper, style.font, style, 0)) } : {}),
        ...(mirrored ? { even: background(paperPng(style.paper, style.font, style, 1)) } : {}),
      }
    : undefined;

  /* Two-up: one A4 landscape section, two columns = the two A5 pages (left page margins, gap, right page margins). */
  const left = handPageMargins(G, 0);
  const right = handPageMargins(G, 1);
  const pageSize = G.twoUp
    ? { width: Math.min(G.sheetTw.width, G.sheetTw.height), height: Math.max(G.sheetTw.width, G.sheetTw.height), orientation: PageOrientation.LANDSCAPE }
    : { width: G.sheetTw.width, height: G.sheetTw.height };
  const margin = G.twoUp ? { ...G.margins, left: left.left, right: right.right } : G.margins;

  /** Har yuz (Playwrite, Marck, Bad Script…) o'z faylidan DOCX ga joylanadi. */
  const embedded = [...handFaces(style.font), ...(style.cover === "calligraphy" && HAND_FONTS[style.font].title ? [HAND_FONTS[style.font].title!] : [])].flatMap((f) => {
    const data = fontFileBytes(f.file);
    return data ? [{ name: f.family, data, characterSet: "00" as const }] : [];
  });

  const document = new Document({
    creator: "SlaydX",
    ...(mirrored ? { evenAndOddHeaderAndFooters: true } : {}),
    styles: {
      default: {
        document: {
          run: { font: primary.family, size, color: ink },
          paragraph: { spacing: { line: pitch, lineRule: LineRuleType.EXACT, before: 0, after: 0 } },
        },
      },
    },
    ...(embedded.length ? { fonts: embedded } : {}),
    sections: [
      {
        properties: {
          titlePage: hasTitle,
          page: { size: pageSize, margin, pageNumbers: { start: 1 } },
          ...(G.twoUp
            ? { column: { count: 2, equalWidth: false, children: [new Column({ width: G.contentTw, space: left.right + right.left }), new Column({ width: G.contentTw })] } }
            : {}),
        },
        ...(headers ? { headers } : {}),
        ...(footers ? { footers } : {}),
        children: out,
      },
    ],
  });

  const bytes = await Packer.toBuffer(document);
  if (!mirrored) return new Uint8Array(bytes);
  /* `docx` has no switch for mirrored margins (inside = the margin-line side on odd pages, outside on even): patch settings.xml. */
  const zip = await JSZip.loadAsync(bytes);
  const settings = await zip.file("word/settings.xml")!.async("string");
  if (!/<w:evenAndOddHeaders\s*\/>/.test(settings)) throw new Error("renderHandDocx: evenAndOddHeaders missing from settings.xml");
  zip.file("word/settings.xml", settings.replace(/<w:evenAndOddHeaders\s*\/>/, "<w:mirrorMargins/><w:evenAndOddHeaders/>"));
  return new Uint8Array(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}
