import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  HeightRule,
  ImageRun,
  LineRuleType,
  Math as DocxMath,
  PageOrientation,
  Packer,
  PageBorderDisplay,
  PageBorderOffsetFrom,
  PageNumber,
  Paragraph,
  ShadingType,
  TableOfContents,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { ESSAY_DESIGNS } from "../languages";
import { planArticle, type ArticlePlan, type HeadItem, type BodyItem } from "./article/layout";
import { planWork, type WorkBodyItem, type WorkPlan } from "./work/layout";
import { isTeacherDoc, planTeacher, type TeacherPlan } from "./teacher/layout";
import { isGameDoc, planGame, type GamePlan } from "./games/layout";
import { articleProfile, CM, contentWidth, gameProfile, profileFor, resumeProfile, teacherProfile, workProfile, type DocProfile } from "./docx-profile";
import { docLabels } from "./i18n";
import { omml } from "./omml";
import { cleanText } from "./quality";
import { columnPercents } from "./table-columns";
import { legacyResumeModel } from "./resume/model";
import { renderResumeDocx, type ResumeDocxOpts } from "./resume/render-docx";
import type { ImageBytes } from "./slide-images";
import { titleModel } from "./title-model";
import { tocRows } from "./toc-model";
import type { AcademicDoc, Block, DocTable } from "./types";

type RunExtra = {
  bold?: boolean;
  italics?: boolean;
  size?: number;
  font?: string;
  color?: string;
};

/**
 * Profilga bog'langan chizish vositalari.
 *
 * Ilgari bular modul darajasidagi funksiyalar edi va `FONT`/`SIZE`/`LINE`
 * konstantalarini to'g'ridan-to'g'ri o'qirdi — ya'ni butun hujjat bitta
 * tipografiyaga qulflangan edi. Endi ular profil ustida quriladi va
 * `renderDocx` ichidagi chaqiruvlar o'zgarmaydi.
 */
function makeKit(P: DocProfile) {
  const { font, size, line } = P.type;
  const CONTENT_W = contentWidth(P);

  const run = (text: string, extra: RunExtra = {}) =>
    new TextRun({
      text: cleanText(text),
      font: extra.font ?? font,
      size: extra.size ?? size,
      bold: extra.bold,
      italics: extra.italics,
      ...(extra.color ? { color: extra.color } : {}),
    });

  const bodyP = (text: string): Paragraph =>
    new Paragraph({
      alignment: P.type.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
      spacing: { after: P.type.after, line, lineRule: LineRuleType.AUTO },
      ...(P.type.firstLine ? { indent: { firstLine: P.type.firstLine } } : {}),
      children: [run(text)],
    });

  const centerP = (text: string, extra: RunExtra = {}): Paragraph =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160, line, lineRule: LineRuleType.AUTO },
      children: [run(text, extra)],
    });

  const leftP = (text: string, extra: RunExtra = {}): Paragraph =>
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 120, line, lineRule: LineRuleType.AUTO },
      children: [run(text, extra)],
    });

  /**
   * Titul sahifadagi imzo qatori: chapda yorliq, o'ngda imzo chizig'i.
   *
   * OTME da topshiriladigan ish imzolanadi — chiziqsiz titul «tayyor emas»
   * ko'rinadi va talaba uni qo'lda chizib qo'shishga majbur bo'lardi.
   */
  const signatureP = (label: string): Paragraph =>
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 120, line, lineRule: LineRuleType.AUTO },
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
      children: [run(label), new TextRun({ text: "\t", font, size }), run("____________")],
    });

  /**
   * Mundarija qatori. 2-daraja chapdan suriladi — bob va ostmavzu
   * ko'z bilan ajralib tursin.
   */
  const tocLine = (text: string, level: 1 | 2): Paragraph =>
    new Paragraph({
      spacing: { line, after: 0, lineRule: LineRuleType.AUTO },
      indent: { left: level === 2 ? Math.round(0.75 * CM) : 0 },
      children: [run(text, { bold: level === 1 })],
    });

  const heading = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph =>
    new Paragraph({
      heading: level,
      alignment: P.heading.align === "left" ? AlignmentType.LEFT : AlignmentType.CENTER,
      spacing: { before: 280, after: 200, line, lineRule: LineRuleType.AUTO },
      ...(P.heading.rule
        ? { border: { bottom: { style: BorderStyle.SINGLE, size: 8, space: 2, color: "F97316" } } }
        : {}),
      children: [run(text, { bold: true, ...(P.heading.color ? { color: P.heading.color } : {}) })],
    });

  /** Bo'lim/annotatsiya sarlavhasi — profil talab qilsa BOSH HARFGA o'tadi. */
  const sectionHeading = (text: string): Paragraph =>
    heading(P.heading.upper ? text.toUpperCase() : text, HeadingLevel.HEADING_1);

  /**
   * OSTMAVZU sarlavhasi («1.1. Tushuncha va tasnif») — chapda, abzats
   * chekinishi bilan.
   *
   * Ilgari u `heading()` orqali chizilardi, ya'ni BOB sarlavhasi bilan
   * bir xil — gost profilida MARKAZDA. Bu ikki jihatdan noto'g'ri edi:
   *
   *   • GOST 7.32 va OTME uslubiy ko'rsatmalarida struktura elementlari
   *     (bob, mundarija, adabiyotlar) markazda, ostmavzu esa «абзацного
   *     отступа» — abzats chekinishidan yoziladi;
   *   • sayt ko'ruvchisi uni allaqachon CHAPDA chizardi (`.word-h2`),
   *     ya'ni foydalanuvchi ko'rgan hujjat yuklab olganidan farq qilardi.
   *
   * Ya'ni bu yerda ko'ruvchi haq, fayl xato edi.
   */
  const subHeading = (text: string): Paragraph =>
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      alignment: AlignmentType.LEFT,
      spacing: { before: 240, after: 120, line, lineRule: LineRuleType.AUTO },
      ...(P.type.firstLine ? { indent: { firstLine: P.type.firstLine } } : {}),
      children: [run(text, { bold: true, ...(P.heading.color ? { color: P.heading.color } : {}) })],
    });

  const codeBox = (text: string, caption?: string): Array<Paragraph | Table> => {
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
                  (l) =>
                    new Paragraph({
                      spacing: { line: 276, after: 0, lineRule: LineRuleType.AUTO },
                      children: [
                        new TextRun({
                          text: l.length ? l : " ",
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
  };

  const blockToParagraphs = (b: Block): Array<Paragraph | Table> => {
    switch (b.kind) {
      case "h1":
        return [heading(b.text, HeadingLevel.HEADING_1)];
      case "h2":
        return [subHeading(b.text)];
      case "h3":
        return [
          new Paragraph({
            spacing: { before: 200, after: 120, line, lineRule: LineRuleType.AUTO },
            children: [run(b.text, { bold: true })],
          }),
        ];
      case "li":
        return [
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 80, line, lineRule: LineRuleType.AUTO },
            children: [run(b.text)],
          }),
        ];
      case "quote":
        return [
          new Paragraph({
            indent: { left: CM },
            spacing: { after: 200, line, lineRule: LineRuleType.AUTO },
            children: [run(b.text, { italics: true })],
          }),
        ];
      case "code":
        return codeBox(b.text, b.caption);
      default:
        return [bodyP(b.text)];
    }
  };

  /**
   * Jadval. Ustun kengliklari `widths` bilan berilishi mumkin — texnologik
   * xaritada «Mavzu» ustuni «№» ustunidan olti barobar keng bo'lishi kerak,
   * teng taqsimotda esa mavzu matni to'rt qatorga sinardi.
   */
  const tableOf = (headers: string[], rows: string[][], widths?: number[]): Table => {
    const border = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
    const borders = { top: border, bottom: border, left: border, right: border };
    const pct = (i: number) => widths?.[i] ?? Math.round(100 / headers.length);
    const cell = (text: string, i: number, bold = false) =>
      new TableCell({
        borders,
        width: { size: pct(i), type: WidthType.PERCENTAGE },
        children: [
          new Paragraph({
            spacing: { after: 40, line: 276, lineRule: LineRuleType.AUTO },
            children: [run(text, { bold, size: P.tableSize })],
          }),
        ],
      });
    /*
     * `columnWidths` (ya'ni `<w:tblGrid>`) SHART.
     *
     * Katakdagi foiz kengligi yolg'iz yetarli emas: `tblGrid` bo'lmasa
     * Word ham, LibreOffice ham avtomatik maketga o'tadi va ustunlarni
     * DEYARLI TENG chizadi. Texnologik xaritada bu «Mavzu» ustunini
     * «№» ustuni bilan bir xil qilib qo'yardi va mavzu matni to'rt
     * qatorga sinardi. Grid berilganda maket qat'iy bo'ladi.
     */
    const grid = widths
      ? widths.map((w) => Math.round((CONTENT_W * w) / 100))
      : headers.map(() => Math.round(CONTENT_W / headers.length));
    return new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: grid,
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({ children: headers.map((h, i) => cell(h, i, true)) }),
        ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, i)) })),
      ],
    });
  };

  return { run, bodyP, centerP, leftP, signatureP, tocLine, heading, sectionHeading, blockToParagraphs, tableOf, CONTENT_W };
}

type Kit = ReturnType<typeof makeKit>;

function drawTable(K: Kit, tb: DocTable, out: Array<Paragraph | Table>) {
  if (tb.caption) out.push(K.centerP(tb.caption, { italics: true, size: 24 }));
  // Ustun kengliklari: jadval o'zi bergani ustun, bo'lmasa `table-columns.ts`
  // (sayt ko'ruvchisi ham aynan shu tartibda).
  out.push(K.tableOf(tb.headers, tb.rows, tb.widths ?? columnPercents(tb.headers) ?? undefined));
}

/* ────────────────────────── Maqola 2 ────────────────────────── */

const DATA_IMG = /^data:image\/(png|jpe?g);base64,/i;

/**
 * Sxema PNG bayti: AVVAL `resolveImage` (saqlangan aktiv — tahrirdan
 * keyingi qayta render), keyin `data:` (yaratish vaqti). Tashqi `https:`
 * ATAYIN yuklanmaydi (`resume/render-docx.ts` bilan bir xil shartnoma).
 * Bayt bo'lmasa `null` — rasm o'rniga o'rinbosar ramka chiziladi, xato
 * tashlanmaydi.
 */
async function figureBytes(url: string | undefined, opts: ResumeDocxOpts): Promise<{ data: Buffer; type: "png" | "jpg" } | null> {
  if (!url) return null;
  const img: ImageBytes | null =
    (opts.resolveImage ? await opts.resolveImage(url).catch(() => null) : null) ??
    (DATA_IMG.test(url) ? { data: url, type: /png/i.test(DATA_IMG.exec(url)![1]) ? "png" : "jpg" } : null);
  if (!img) return null;
  const i = img.data.indexOf("base64,");
  const data = Buffer.from(i >= 0 ? img.data.slice(i + 7) : img.data, "base64");
  return data.byteLength ? { data, type: img.type === "png" ? "png" : "jpg" } : null;
}

/**
 * Maqola tanasi — FAQAT `planArticle` rejasini chizadi («ko'rdim = oldim»).
 *
 * Tartib va raqamlar rejadan: bu yerda «qaysi band qayerda» degan qaror
 * YO'Q. Joylashuv qoidalari (mahsulot egasi, OAK/GOST): rasm sarlavhasi
 * PASTDA markazda, jadval sarlavhasi TEPADA (GOST oilasida o'ngda, APA/
 * IEEE da chapda), formula markazda va raqami o'ng chekkada, annotatsiya
 * yorlig'i qalin va matn bilan bitta paragrafda, titul/mundarija YO'Q.
 */
async function drawArticle(plan: ArticlePlan, K: Kit, P: DocProfile, opts: ResumeDocxOpts): Promise<Array<Paragraph | Table>> {
  const out: Array<Paragraph | Table> = [];
  const { line, font, size } = P.type;
  const small = Math.max(20, size - 4);
  const W = K.CONTENT_W;
  /**
   * Iqtibosli matn — HAR bo'lak alohida `<w:t>` (ko'ruvchidagi `<span>`
   * lar bilan bir xil tugunlar; paritet testi shuni solishtiradi).
   * `cleanText` chetdagi bo'shliqni kesadi — bo'laklar orasidagi bitta
   * bo'shliq saqlanadi, aks holda «…aylantirdi[1]» yopishib qolardi.
   */
  const spanRuns = (spans: { text: string }[], extra: RunExtra = {}): TextRun[] =>
    spans
      .filter((s) => s.text.length)
      .map(
        (s) =>
          new TextRun({
            text: `${/^\s/.test(s.text) ? " " : ""}${cleanText(s.text)}${/\s$/.test(s.text) ? " " : ""}`,
            font,
            size: extra.size ?? size,
            bold: extra.bold,
            italics: extra.italics,
          }),
      );
  /** Yorliq + matn bitta paragrafda («**Annotatsiya.** Matn…») — orasidagi bo'shliq saqlanadi. */
  const absLine = Math.round(240 * plan.profile.abstractLine);
  const labeled = (label: string, text: string) => [
    ...spanRuns([{ text: label }], { bold: true, size: small }),
    ...spanRuns([{ text: ` ${text}` }], { size: small }),
  ];
  /** Sarlavha (keyingisi bilan birga) — reja bandlari uchun umumiy. */
  const keepP = (text: string, extra: RunExtra & { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; before?: number; after?: number } = {}) =>
    new Paragraph({
      alignment: extra.align ?? AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: extra.before ?? 0, after: extra.after ?? 120, line, lineRule: LineRuleType.AUTO },
      children: [K.run(text, extra)],
    });

  /* ── bosh blok ── */
  for (const h of plan.head as HeadItem[]) {
    switch (h.k) {
      case "udk":
        out.push(new Paragraph({ alignment: AlignmentType.LEFT, keepNext: true, spacing: { after: 160, line, lineRule: LineRuleType.AUTO }, children: [K.run(h.text, { size: small })] }));
        break;
      case "title":
        out.push(keepP(h.text, { bold: true, after: 200 }));
        break;
      case "authors":
        for (const a of h.authors) {
          out.push(keepP(a.line, { bold: true, after: 40 }));
          if (a.affiliation) out.push(keepP(a.affiliation, { italics: true, size: small, after: 120 }));
        }
        break;
      case "abstract":
        // Profil intervali (OAK 1.15) — ko'ruvchida `--doc-abs-line` (`.word-abstract-p`).
        out.push(
          new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            spacing: { before: 120, after: 80, line: absLine, lineRule: LineRuleType.AUTO },
            ...(P.type.firstLine ? { indent: { firstLine: P.type.firstLine } } : {}),
            children: labeled(`${h.label}.`, h.text),
          }),
        );
        out.push(
          new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 160, line: absLine, lineRule: LineRuleType.AUTO },
            ...(P.type.firstLine ? { indent: { firstLine: P.type.firstLine } } : {}),
            children: labeled(`${h.keywordsLabel}:`, h.keywords),
          }),
        );
        break;
      case "highlights":
        out.push(new Paragraph({ keepNext: true, spacing: { before: 120, after: 80, line, lineRule: LineRuleType.AUTO }, children: [K.run(h.label, { bold: true })] }));
        for (const t of h.items) out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60, line, lineRule: LineRuleType.AUTO }, children: [K.run(t, { size: small })] }));
        break;
    }
  }

  /* ── tana ── */
  for (const b of plan.body as BodyItem[]) {
    switch (b.k) {
      case "h1":
        out.push(K.sectionHeading(b.text));
        break;
      case "figure": {
        const img = await figureBytes(b.figure?.url, opts);
        if (img && b.figure) {
          /*
           * Kenglik: foydali kenglikdan oshmasin (twip → px: /15), 160 mm
           * dan ham (300 dpi PNG 1890 px — sahifaga sig'maydi). Balandlik
           * nisbat bilan; juda baland sxema 180 mm bilan cheklanadi.
           */
          const maxW = Math.min(Math.floor(W / 15), Math.floor((160 / 25.4) * 96));
          const ratio = b.figure.h && b.figure.w ? b.figure.h / b.figure.w : 0.7;
          let width = maxW;
          let height = Math.round(width * ratio);
          const maxH = Math.floor((180 / 25.4) * 96);
          if (height > maxH) {
            height = maxH;
            width = Math.round(height / ratio);
          }
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              keepNext: true,
              /*
               * `lineRule: auto` SHART: usiz LibreOffice `w:line` ni QAT'IY
               * balandlik deb o'qiydi va rasmni bitta matn qatoriga siqib
               * qo'yadi (ko'zdan kechiruvda 118 mm li sxema ko'rinmay
               * qolgan edi; rezyume suratida ham xuddi shu saboq).
               */
              spacing: { before: 120, after: 80, line: 240, lineRule: LineRuleType.AUTO },
              children: [new ImageRun({ type: img.type, data: img.data, transformation: { width, height } })],
            }),
          );
        } else {
          // PNG hali yo'q (WP3 beradi) — ramkali o'rinbosar, sarlavha va raqam saqlanadi.
          const border = { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 8 };
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              keepNext: true,
              border: { top: border, bottom: border, left: border, right: border },
              spacing: { before: 120, after: 80, line, lineRule: LineRuleType.AUTO },
              children: [K.run(b.placeholder, { italics: true, color: "666666" })],
            }),
          );
        }
        // Sarlavha PASTDA, markazda; ostida «Manba: …» (bo'lsa) kichik kursiv.
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            ...(b.source ? { keepNext: true } : {}),
            spacing: { after: b.source ? 40 : 200, line, lineRule: LineRuleType.AUTO },
            children: [K.run(b.caption)],
          }),
        );
        if (b.source) {
          out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200, line, lineRule: LineRuleType.AUTO }, children: [K.run(b.source, { italics: true, size: small })] }));
        }
        break;
      }
      case "table": {
        // Sarlavha TEPADA; jadval bilan birga (keepNext).
        out.push(
          new Paragraph({
            alignment: plan.tableCaptionAlign === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT,
            keepNext: true,
            spacing: { before: 120, after: 80, line, lineRule: LineRuleType.AUTO },
            children: [K.run(b.caption)],
          }),
        );
        const t = b.table;
        out.push(K.tableOf(t.headers, t.rows, t.widths ?? columnPercents(t.headers) ?? undefined));
        out.push(new Paragraph({ spacing: { after: 120, line: 240, lineRule: LineRuleType.AUTO }, children: [] }));
        break;
      }
      case "formula":
        /*
         * `\t` formula `\t` (1): birinchi tab markaz to'xtashiga, ikkinchisi
         * o'ng chekkaga — formula markazda, raqam o'ngda (GOST 7.32 §6.8).
         */
        out.push(
          new Paragraph({
            alignment: AlignmentType.LEFT,
            tabStops: [
              { type: TabStopType.CENTER, position: Math.round(W / 2) },
              { type: TabStopType.RIGHT, position: W },
            ],
            // Kasr/ildiz qator balandligidan oshadi — `auto` bo'lmasa siqiladi.
            spacing: { before: 120, after: 160, line, lineRule: LineRuleType.AUTO },
            children: [
              new TextRun({ text: "\t", font, size }),
              new DocxMath({ children: omml(b.latex) }),
              new TextRun({ text: "\t", font, size }),
              K.run(b.number),
            ],
          }),
        );
        break;
      case "p":
        out.push(
          new Paragraph({
            alignment: P.type.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
            spacing: { after: P.type.after, line, lineRule: LineRuleType.AUTO },
            ...(P.type.firstLine ? { indent: { firstLine: P.type.firstLine } } : {}),
            children: spanRuns(b.spans),
          }),
        );
        break;
      case "li":
        out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 80, line, lineRule: LineRuleType.AUTO }, children: spanRuns(b.spans) }));
        break;
      case "quote":
        out.push(new Paragraph({ indent: { left: CM }, spacing: { after: 200, line, lineRule: LineRuleType.AUTO }, children: spanRuns(b.spans, { italics: true }) }));
        break;
      case "h2":
      case "h3":
      case "code":
        out.push(...K.blockToParagraphs(b.k === "code" ? { kind: "code", text: b.text, caption: b.caption } : { kind: b.k, text: b.text }));
        break;
    }
  }

  /* ── adabiyotlar ── */
  // Ro'yxat profil o'lchamida (OAK: TNR 12 / 1.15) — ko'ruvchi `--doc-refs-size` bilan juft.
  const refLine = Math.round(240 * plan.profile.refsLine);
  const refP = (text: string) =>
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 60, line: refLine, lineRule: LineRuleType.AUTO },
      indent: plan.cite === "apa7" ? { left: Math.round(1.25 * CM), hanging: Math.round(1.25 * CM) } : { left: 0, firstLine: 0 },
      children: [K.run(text, { size: plan.profile.refsSizePt * 2 })],
    });
  if (plan.refs.length) {
    out.push(K.sectionHeading(plan.refsLabel));
    for (const r of plan.refs) out.push(refP(r.line));
  }
  if (plan.refs2?.length && plan.refs2Label) {
    out.push(K.sectionHeading(plan.refs2Label));
    for (const r of plan.refs2) out.push(refP(r.line));
  }
  return out;
}

/* ────────────────────────── Talaba ishlari 2 (AUDIT-19) ────────────────────────── */

/**
 * Kurs ishi / referat / mustaqil ish tanasi — FAQAT `planWork` rejasini
 * chizadi («ko'rdim = oldim»).
 *
 * Joylashuv qoidalari (uslubiy ko'rsatmalar, GOST 7.32):
 *   • bo'lim sarlavhasi MARKAZDA, BOSH HARF (matn rejada allaqachon shunday);
 *   • bob/ilova/adabiyotlar YANGI VARAQDAN (`pageBreakBefore`), paragraflar oqadi;
 *   • paragraf sarlavhasi («1.1. …») CHAPDA, qalin, abzats chekinishi bilan;
 *   • JADVAL: raqam («1.1-jadval») TEPA O'NGDA alohida qatorda, NOMI uning
 *     ostida markazda, jadvaldan keyin «Manba: …» 10 pt KURSIV;
 *   • RASM: sarlavha («1.1-rasm. …») PASTDA markazda, ostida manba;
 *   • formula markazda, raqami «(1.1)» o'ng chekkada;
 *   • mundarija Word MAYDONI ichida, lekin tarkibini biz yozamiz
 *     (LibreOffice maydonni to'ldirmaydi — `renderDocx` dagi izoh).
 */
async function drawWork(plan: WorkPlan, doc: AcademicDoc, K: Kit, P: DocProfile, opts: ResumeDocxOpts): Promise<Array<Paragraph | Table>> {
  const out: Array<Paragraph | Table> = [];
  const { line, font, size } = P.type;
  /** «Manba: …» va jadval izohlari — 10 pt (rejadagi `page.smallPt`). */
  const small = plan.page.smallPt * 2;
  const W = K.CONTENT_W;

  /** Iqtibosli matn — HAR bo'lak alohida `<w:t>` (ko'ruvchidagi `<span>` lar bilan juft). */
  const spanRuns = (spans: { text: string }[], extra: RunExtra = {}): TextRun[] =>
    spans
      .filter((s) => s.text.length)
      .map(
        (s) =>
          new TextRun({
            text: `${/^\s/.test(s.text) ? " " : ""}${cleanText(s.text)}${/\s$/.test(s.text) ? " " : ""}`,
            font,
            size: extra.size ?? size,
            bold: extra.bold,
            italics: extra.italics,
          }),
      );

  /*
   * `drawn` — birinchi chizilgan bandni belgilaydi. Titul o'zidan keyin
   * varaqni allaqachon yopgan (`renderDocx` uzilish paragrafi), shuning
   * uchun MUNDARIJA (yoki mundarija bo'lmasa — KIRISH) yangi varaqni
   * O'ZIDAN so'ramaydi: ikkinchi uzilish BO'SH varaq qoldirardi.
   * Mundarijadan KEYIN esa kirish o'z uzilishini oladi — bu yerda
   * bo'sh paragraf ishlatilmaydi (umumiy yo'ldagi naqshdan farqi:
   * sarlavha ustida sababsiz bo'sh qator qolmasin).
   */
  let drawn = false;
  const breakFor = (want: boolean) => want && drawn;

  /* ── mundarija ── */
  if (doc.toc && plan.toc.length) {
    out.push(K.heading(plan.labels.toc, HeadingLevel.HEADING_1));
    out.push(
      new TableOfContents(plan.labels.toc, {
        hyperlink: true,
        headingStyleRange: "1-2",
        contentChildren: plan.toc.map((r) => K.tocLine(r.text, r.level)),
      }),
    );
    drawn = true;
  }

  const drawBody = async (items: WorkBodyItem[]) => {
  for (const b of items) {
    switch (b.k) {
      case "h1": {
        const pageBreakBefore = breakFor(b.pageBreak);
        drawn = true;
        out.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            keepNext: true,
            ...(pageBreakBefore ? { pageBreakBefore: true } : {}),
            spacing: { before: 280, after: 200, line, lineRule: LineRuleType.AUTO },
            children: [K.run(b.text, { bold: true, ...(P.heading.color ? { color: P.heading.color } : {}) })],
          }),
        );
        break;
      }
      case "h2":
        drawn = true;
        out.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            alignment: AlignmentType.LEFT,
            keepNext: true,
            spacing: { before: 240, after: 120, line, lineRule: LineRuleType.AUTO },
            ...(P.type.firstLine ? { indent: { firstLine: P.type.firstLine } } : {}),
            children: [K.run(b.text, { bold: true, ...(P.heading.color ? { color: P.heading.color } : {}) })],
          }),
        );
        break;
      case "h3":
        drawn = true;
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            keepNext: true,
            spacing: { before: 120, after: 120, line, lineRule: LineRuleType.AUTO },
            children: [K.run(b.text, { bold: true })],
          }),
        );
        break;
      case "table": {
        drawn = true;
        // Raqam TEPA O'NGDA — alohida qator, jadval bilan birga (`keepNext`).
        out.push(
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            keepNext: true,
            spacing: { before: 160, after: 40, line, lineRule: LineRuleType.AUTO },
            children: [K.run(b.numberLine)],
          }),
        );
        if (b.caption) {
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              keepNext: true,
              spacing: { after: 80, line, lineRule: LineRuleType.AUTO },
              children: [K.run(b.caption, { bold: true })],
            }),
          );
        }
        const t = b.table;
        out.push(K.tableOf(t.headers, t.rows, t.widths ?? columnPercents(t.headers) ?? undefined));
        if (b.source) {
          out.push(
            new Paragraph({
              alignment: AlignmentType.LEFT,
              spacing: { before: 40, after: 160, line, lineRule: LineRuleType.AUTO },
              children: [K.run(b.source, { italics: true, size: small })],
            }),
          );
        } else {
          out.push(new Paragraph({ spacing: { after: 120, line: 240, lineRule: LineRuleType.AUTO }, children: [] }));
        }
        break;
      }
      case "figure": {
        drawn = true;
        const img = await figureBytes(b.figure?.url, opts);
        if (img && b.figure) {
          const maxW = Math.min(Math.floor(W / 15), Math.floor((160 / 25.4) * 96));
          const ratio = b.figure.h && b.figure.w ? b.figure.h / b.figure.w : 0.7;
          let width = maxW;
          let height = Math.round(width * ratio);
          const maxH = Math.floor((180 / 25.4) * 96);
          if (height > maxH) {
            height = maxH;
            width = Math.round(height / ratio);
          }
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              keepNext: true,
              // `lineRule: auto` SHART — usiz LibreOffice rasmni bitta matn qatoriga siqadi.
              spacing: { before: 120, after: 80, line: 240, lineRule: LineRuleType.AUTO },
              children: [new ImageRun({ type: img.type, data: img.data, transformation: { width, height } })],
            }),
          );
        } else {
          const border = { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 8 };
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              keepNext: true,
              border: { top: border, bottom: border, left: border, right: border },
              spacing: { before: 120, after: 80, line, lineRule: LineRuleType.AUTO },
              children: [K.run(b.placeholder, { italics: true, color: "666666" })],
            }),
          );
        }
        // Sarlavha PASTDA, markazda; ostida «Manba: …».
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            ...(b.source ? { keepNext: true } : {}),
            spacing: { after: b.source ? 40 : 200, line, lineRule: LineRuleType.AUTO },
            children: [K.run(b.caption)],
          }),
        );
        if (b.source) {
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 200, line, lineRule: LineRuleType.AUTO },
              children: [K.run(b.source, { italics: true, size: small })],
            }),
          );
        }
        break;
      }
      case "formula":
        drawn = true;
        out.push(
          new Paragraph({
            alignment: AlignmentType.LEFT,
            tabStops: [
              { type: TabStopType.CENTER, position: Math.round(W / 2) },
              { type: TabStopType.RIGHT, position: W },
            ],
            spacing: { before: 120, after: 160, line, lineRule: LineRuleType.AUTO },
            children: [
              new TextRun({ text: "\t", font, size }),
              new DocxMath({ children: omml(b.latex) }),
              new TextRun({ text: "\t", font, size }),
              K.run(b.number),
            ],
          }),
        );
        break;
      case "p":
        drawn = true;
        out.push(
          new Paragraph({
            alignment: P.type.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
            spacing: { after: P.type.after, line, lineRule: LineRuleType.AUTO },
            ...(P.type.firstLine ? { indent: { firstLine: P.type.firstLine } } : {}),
            children: spanRuns(b.spans),
          }),
        );
        break;
      case "li":
        drawn = true;
        out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 80, line, lineRule: LineRuleType.AUTO }, children: spanRuns(b.spans) }));
        break;
      case "quote":
        drawn = true;
        out.push(new Paragraph({ indent: { left: CM }, spacing: { after: 200, line, lineRule: LineRuleType.AUTO }, children: spanRuns(b.spans, { italics: true }) }));
        break;
      case "code":
        drawn = true;
        out.push(...K.blockToParagraphs({ kind: "code", text: b.text, ...(b.caption ? { caption: b.caption } : {}) }));
        break;
    }
  }
  };

  await drawBody(plan.body as WorkBodyItem[]);

  /* ── adabiyotlar (yangi varaqdan, «1. …» raqamli GOST satrlari) ── */
  if (plan.refs.length) {
    out.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        keepNext: true,
        pageBreakBefore: true,
        spacing: { before: 280, after: 200, line, lineRule: LineRuleType.AUTO },
        children: [K.run(plan.refsLabel, { bold: true, ...(P.heading.color ? { color: P.heading.color } : {}) })],
      }),
    );
    for (const r of plan.refs) {
      out.push(
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 60, line, lineRule: LineRuleType.AUTO },
          indent: { left: 0, firstLine: 0 },
          children: [K.run(r.line)],
        }),
      );
    }
  }

  /* ── ilovalar (adabiyotlardan KEYIN, har biri yangi varaqdan) ── */
  await drawBody(plan.appendix);
  return out;
}

/* ────────────────────────── O'qituvchi vositalari 2 (AUDIT-20) ────────────────────────── */

/**
 * Dars ishlanmasi / texnologik xarita / glossariy / keys / test tanasi —
 * FAQAT `planTeacher` rejasini chizadi («ko'rdim = oldim»).
 *
 * Joylashuv qoidalari (`docs/research/*.md` §1/§3):
 *   • TITUL BETI YO'Q — birinchi betning o'zida rasmiy SHAPKA:
 *     «Tasdiqlayman» bloki O'NG YUQORIDA, ostida muassasa va hujjat
 *     nomi markazda, keyin «Fan: …», «Sinf: …», «Tuzuvchi: …» qatorlari;
 *   • bo'lim sarlavhasi CHAPDA, qalin, BOSH HARFSIZ (`teacherProfile`);
 *   • JADVAL: raqami («1-jadval») tepa o'ngda, nomi ostida markazda;
 *   • test: har variant, javoblar kaliti va OMR varag'i YANGI BETDAN;
 *   • kalit ustida qizil emas, QALIN ogohlantirish («O'QITUVCHI UCHUN»)
 *     — DOCX da rang bosma nusxada yo'qoladi, qalinlik esa qoladi.
 */
async function drawTeacher(plan: TeacherPlan, K: Kit, P: DocProfile, opts: ResumeDocxOpts): Promise<Array<Paragraph | Table>> {
  const out: Array<Paragraph | Table> = [];
  const { line, font, size } = P.type;
  const small = plan.page.smallPt * 2;
  const W = K.CONTENT_W;

  /** «Yorliq: qiymat» — yorliq QALIN, qiymat oddiy (bitta paragrafda). */
  const kvP = (label: string, text: string, extra: { indent?: boolean } = {}): Paragraph =>
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 60, line, lineRule: LineRuleType.AUTO },
      ...(extra.indent ? { indent: { left: Math.round(0.5 * CM) } } : {}),
      children: [K.run(label, { bold: true }), new TextRun({ text: " ", font, size }), K.run(text)],
    });

  /* ── shapka ── */
  for (const h of plan.head) {
    switch (h.k) {
      case "approve":
        /*
         * O'NG YUQORIDA: har qator o'ng chekkaga tekislanadi. Jadval
         * ichiga solinmaydi — LibreOffice ramkasiz jadvalni ham PDF da
         * chegara chizig'i bilan ko'rsatib yuborardi (AUDIT-13 ko'zi).
         */
        for (const l of h.lines) {
          out.push(
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              keepNext: true,
              spacing: { after: 0, line, lineRule: LineRuleType.AUTO },
              children: [K.run(l)],
            }),
          );
        }
        out.push(new Paragraph({ spacing: { after: 120, line: 240, lineRule: LineRuleType.AUTO }, children: [] }));
        break;
      case "org":
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            keepNext: true,
            spacing: { after: 80, line, lineRule: LineRuleType.AUTO },
            children: [K.run(h.text, { bold: true })],
          }),
        );
        break;
      case "title":
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            keepNext: true,
            spacing: { before: 80, after: 40, line, lineRule: LineRuleType.AUTO },
            children: [K.run(h.text, { bold: true, size: size + 4 })],
          }),
        );
        break;
      case "subtitle":
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            keepNext: true,
            spacing: { after: 160, line, lineRule: LineRuleType.AUTO },
            children: [K.run(h.text, { italics: true })],
          }),
        );
        break;
      case "field":
        out.push(kvP(`${h.label}:`, h.text));
        break;
      case "line":
        /*
         * Har bo'lak ALOHIDA run: `cleanText` bitta matndagi ikkita
         * tagchiziq guruhini markdown `__qalin__` deb o'qib, ikkalasidan
         * ham ikkitadan belgini yeb qo'yardi (bosma varaqda chiziqlar
         * qisqarardi). Bo'laklar orasidagi bo'shliq ham alohida run —
         * `cleanText` uni `trim` qilib tashlamasin.
         */
        out.push(
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { before: 120, after: 160, line, lineRule: LineRuleType.AUTO },
            children: h.parts.flatMap((part, i) => (i ? [new TextRun({ text: "  ", font, size }), K.run(part)] : [K.run(part)])),
          }),
        );
        break;
    }
  }

  /*
   * `drawn` — birinchi chizilgan banddan keyingina sahifa uzilishi
   * qo'yiladi: shapka tugagan joyda uzilish bo'lsa birinchi bet BO'SH
   * qolardi (`drawWork` dagi bilan bir xil qoida).
   */
  let drawn = out.length > 0;

  for (const b of plan.body) {
    switch (b.k) {
      case "h1": {
        const pageBreakBefore = b.pageBreak && drawn;
        drawn = true;
        out.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: P.heading.align === "center" ? AlignmentType.CENTER : AlignmentType.LEFT,
            keepNext: true,
            ...(pageBreakBefore ? { pageBreakBefore: true } : {}),
            spacing: { before: 240, after: 120, line, lineRule: LineRuleType.AUTO },
            children: [K.run(b.text, { bold: true, ...(P.heading.color ? { color: P.heading.color } : {}) })],
          }),
        );
        break;
      }
      case "h2":
        drawn = true;
        out.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            alignment: AlignmentType.LEFT,
            keepNext: true,
            spacing: { before: 160, after: 80, line, lineRule: LineRuleType.AUTO },
            children: [K.run(b.text, { bold: true, ...(P.heading.color ? { color: P.heading.color } : {}) })],
          }),
        );
        break;
      case "h3":
        drawn = true;
        out.push(
          new Paragraph({
            alignment: AlignmentType.LEFT,
            keepNext: true,
            spacing: { before: 120, after: 60, line, lineRule: LineRuleType.AUTO },
            children: [K.run(b.text, { bold: true })],
          }),
        );
        break;
      case "p":
        drawn = true;
        out.push(
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { after: P.type.after, line, lineRule: LineRuleType.AUTO },
            children: [K.run(b.text)],
          }),
        );
        break;
      case "kv":
        drawn = true;
        out.push(kvP(b.label, b.text, { indent: true }));
        break;
      case "opt":
        drawn = true;
        /*
         * Javob varianti — RO'YXAT BELGISIZ: `A)` harfi matnning o'zida.
         * `w:numPr` bullet qo'yilsa Word «• A) …» chizardi, ya'ni ikkita
         * marker bo'lardi va javob varag'idagi harf bilan chalkashardi.
         */
        out.push(
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { after: 20, line, lineRule: LineRuleType.AUTO },
            indent: { left: Math.round(0.8 * CM) },
            children: [K.run(`${b.letter}) ${b.text}`)],
          }),
        );
        break;
      case "li":
        drawn = true;
        out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60, line, lineRule: LineRuleType.AUTO }, children: [K.run(b.text)] }));
        break;
      case "quote":
        drawn = true;
        out.push(new Paragraph({ indent: { left: CM }, spacing: { after: 160, line, lineRule: LineRuleType.AUTO }, children: [K.run(b.text, { italics: true })] }));
        break;
      case "code":
        drawn = true;
        out.push(...K.blockToParagraphs({ kind: "code", text: b.text, ...(b.caption ? { caption: b.caption } : {}) }));
        break;
      case "note":
        drawn = true;
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            keepNext: true,
            spacing: { before: 80, after: 120, line, lineRule: LineRuleType.AUTO },
            children: [K.run(b.text, { bold: true })],
          }),
        );
        break;
      case "lines": {
        drawn = true;
        /*
         * Ochiq savol javobi — chegarasiz JADVALning pastki chizig'i
         * bo'lgan qatorlari.
         *
         * Nega paragraf emas: pastki chegarali ketma-ket BO'SH
         * paragraflarni LibreOffice ham, Word ham BITTA blokka
         * birlashtiradi va chiziqni faqat OXIRIDA chizadi — ko'z
         * tekshiruvida aynan shu ko'rindi (to'rt chiziq o'rniga bitta,
         * ustida katta bo'sh joy). Jadval qatorlari hech qachon
         * birlashmaydi. Nuqtali chiziq («………») ham yaramaydi: u MATN
         * tuguni bo'lib, ko'ruvchi bilan paritetga shovqin qo'shardi.
         */
        const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
        const rule = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
        out.push(
          new Table({
            width: { size: W, type: WidthType.DXA },
            columnWidths: [W],
            layout: TableLayoutType.FIXED,
            rows: Array.from(
              { length: b.count },
              () =>
                new TableRow({
                  children: [
                    new TableCell({
                      width: { size: W, type: WidthType.DXA },
                      borders: { top: none, left: none, right: none, bottom: rule },
                      margins: { top: 60, bottom: 60, left: 0, right: 0 },
                      children: [new Paragraph({ spacing: { after: 0, line: 276, lineRule: LineRuleType.AUTO }, children: [] })],
                    }),
                  ],
                }),
            ),
          }),
        );
        out.push(new Paragraph({ spacing: { after: 120, line: 240, lineRule: LineRuleType.AUTO }, children: [] }));
        break;
      }
      case "table": {
        drawn = true;
        // Raqam TEPA O'NGDA — alohida qator, jadval bilan birga.
        out.push(
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            keepNext: true,
            spacing: { before: 160, after: 40, line, lineRule: LineRuleType.AUTO },
            children: [K.run(b.numberLine)],
          }),
        );
        if (b.caption) {
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              keepNext: true,
              spacing: { after: 80, line, lineRule: LineRuleType.AUTO },
              children: [K.run(b.caption, { bold: true })],
            }),
          );
        }
        const t = b.table;
        out.push(K.tableOf(t.headers, t.rows, t.widths ?? columnPercents(t.headers) ?? undefined));
        out.push(new Paragraph({ spacing: { after: 120, line: 240, lineRule: LineRuleType.AUTO }, children: [] }));
        break;
      }
      case "figure": {
        drawn = true;
        const img = await figureBytes(b.figure?.url, opts);
        if (img && b.figure) {
          const maxW = Math.min(Math.floor(W / 15), Math.floor((170 / 25.4) * 96));
          const ratio = b.figure.h && b.figure.w ? b.figure.h / b.figure.w : 1.3;
          let width = maxW;
          let height = Math.round(width * ratio);
          const maxH = Math.floor((210 / 25.4) * 96);
          if (height > maxH) {
            height = maxH;
            width = Math.round(height / ratio);
          }
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              keepNext: true,
              // `lineRule: auto` SHART — usiz LibreOffice rasmni bitta matn qatoriga siqadi.
              spacing: { before: 120, after: 80, line: 240, lineRule: LineRuleType.AUTO },
              children: [new ImageRun({ type: img.type, data: img.data, transformation: { width, height } })],
            }),
          );
        } else {
          const border = { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 8 };
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              keepNext: true,
              border: { top: border, bottom: border, left: border, right: border },
              spacing: { before: 120, after: 80, line, lineRule: LineRuleType.AUTO },
              children: [K.run(b.placeholder, { italics: true, color: "666666" })],
            }),
          );
        }
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200, line, lineRule: LineRuleType.AUTO },
            children: [K.run(b.caption, { size: small })],
          }),
        );
        break;
      }
    }
  }
  return out;
}

/* ────────────────────────── Bosma o'yinlar (AUDIT-21) ────────────────────────── */

/** Millimetr → twip (DXA). `CM = 567` bilan bir juft. */
const MM = 56.7;
const mmDxa = (v: number) => Math.round(v * MM);

/**
 * Krossvord / flesh kartalar tanasi — FAQAT `planGame` rejasini chizadi
 * («ko'rdim = oldim»).
 *
 * Joylashuv qoidalari (`docs/research/{crossword,flashcards}.md` §3):
 *   • TITUL BETI YO'Q (`gameProfile.titlePage === "none"`);
 *   • krossvord: sarlavha markazda → to'r rasmi markazda → Gorizontal/
 *     Vertikal savollar CHEGARASIZ ikki ustunli jadvalda → javoblar
 *     varag'i YANGI BETDAN;
 *   • kartalar: har bet — ikki qatorli varaq shapkasi + 2×4 panjara;
 *     katak kengligi va qator BALANDLIGI millimetrda QAT'IY belgilanadi
 *     (`HeightRule.EXACT`), aks holda uzunroq ta'rif qatorni cho'zib,
 *     old bet bilan orqa betni siljitib yuborardi va kesilgan kartaning
 *     orqasida qo'shnisining matni qolardi.
 *
 * Kesish chizig'i — katakning O'Z chegarasi (nuqtali, och kulrang):
 * alohida «kesish belgilari» chizish uchun DOCX da shakl kerak bo'lardi,
 * u esa LibreOffice va Word da har xil joyga tushadi.
 */
async function drawGame(plan: GamePlan, K: Kit, P: DocProfile, opts: ResumeDocxOpts): Promise<Array<Paragraph | Table>> {
  const out: Array<Paragraph | Table> = [];
  const { line, font, size } = P.type;
  const small = plan.page.smallPt * 2;
  const W = K.CONTENT_W;
  const card = plan.page.card;

  /* ── shapka (krossvord; kartalarda BO'SH — `planGame` izohi) ── */
  for (const h of plan.head) {
    switch (h.k) {
      case "title":
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            keepNext: true,
            spacing: { before: 80, after: 40, line, lineRule: LineRuleType.AUTO },
            children: [K.run(h.text, { bold: true, size: size + 4 })],
          }),
        );
        break;
      case "subtitle":
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            keepNext: true,
            spacing: { after: 120, line, lineRule: LineRuleType.AUTO },
            children: [K.run(h.text, { italics: true })],
          }),
        );
        break;
      case "field":
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            keepNext: true,
            spacing: { after: 160, line, lineRule: LineRuleType.AUTO },
            children: [K.run(`${h.label}:`, { bold: true }), new TextRun({ text: " ", font, size }), K.run(h.text)],
          }),
        );
        break;
    }
  }

  /*
   * `drawn` — birinchi chizilgan banddan keyingina sahifa uzilishi
   * qo'yiladi (`drawTeacher`/`drawWork` bilan bir xil qoida): birinchi
   * varaq bo'sh qolmasin.
   */
  let drawn = out.length > 0;

  for (const b of plan.body) {
    switch (b.k) {
      case "h1": {
        const pageBreakBefore = b.pageBreak && drawn;
        drawn = true;
        out.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: P.heading.align === "center" ? AlignmentType.CENTER : AlignmentType.LEFT,
            keepNext: true,
            ...(pageBreakBefore ? { pageBreakBefore: true } : {}),
            spacing: { before: 240, after: 120, line, lineRule: LineRuleType.AUTO },
            children: [K.run(b.text, { bold: true, ...(P.heading.color ? { color: P.heading.color } : {}) })],
          }),
        );
        break;
      }
      case "h3":
        drawn = true;
        out.push(
          new Paragraph({
            alignment: AlignmentType.LEFT,
            keepNext: true,
            spacing: { before: 120, after: 60, line, lineRule: LineRuleType.AUTO },
            children: [K.run(b.text, { bold: true })],
          }),
        );
        break;
      case "p":
        drawn = true;
        out.push(
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { after: P.type.after, line, lineRule: LineRuleType.AUTO },
            children: [K.run(b.text)],
          }),
        );
        break;
      case "li":
        drawn = true;
        out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 60, line, lineRule: LineRuleType.AUTO }, children: [K.run(b.text)] }));
        break;
      case "note":
        drawn = true;
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            keepNext: true,
            spacing: { before: 80, after: 120, line, lineRule: LineRuleType.AUTO },
            children: [K.run(b.text, { bold: true })],
          }),
        );
        break;
      case "clues": {
        drawn = true;
        /*
         * Ikki ustun — CHEGARASIZ jadval: bosma krossvordda savollar
         * ikki ustunda yoziladi va har ustun o'z sarlavhasi bilan
         * boshlanadi. `w:cols` (haqiqiy gazeta ustunlari) yaramaydi:
         * u BUTUN bo'limga tegishli bo'lar va to'r rasmini ham ikkiga
         * bo'lib yuborardi.
         */
        const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
        const colW = Math.floor(W / Math.max(1, b.columns.length));
        out.push(
          new Table({
            width: { size: W, type: WidthType.DXA },
            columnWidths: b.columns.map(() => colW),
            layout: TableLayoutType.FIXED,
            /*
             * Chegara JADVAL darajasida ham o'chiriladi: `docx` standart
             * bo'yicha `w:tblBorders` ni `single` bilan yozadi va u
             * katak sozlamasi bilan raqobatlashadi (LibreOffice katakni
             * tinglaydi, Word esa jadvalni — ya'ni faylning ko'rinishi
             * dasturga bog'liq bo'lib qolardi).
             */
            borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
            /*
             * HAR SAVOL O'Z QATORIDA (sarlavha qatori + N qator): bitta
             * ulkan qator LibreOffice'da betga sig'masa BUTUNLAY keyingi
             * betga o'tib, to'r ostida yarim bet bo'sh qolardi (AUDIT-21
             * ko'z tekshiruvi). Qatorlar betlar orasida erkin bo'linadi.
             */
            rows: [
              new TableRow({
                children: b.columns.map(
                  (col) =>
                    new TableCell({
                      width: { size: colW, type: WidthType.DXA },
                      borders: { top: none, bottom: none, left: none, right: none },
                      margins: { top: 40, bottom: 40, left: 0, right: 120 },
                      children: [new Paragraph({ alignment: AlignmentType.LEFT, keepNext: true, spacing: { after: 80, line, lineRule: LineRuleType.AUTO }, children: [K.run(col.title, { bold: true })] })],
                    }),
                ),
              }),
              ...Array.from({ length: Math.max(...b.columns.map((c) => c.items.length)) }, (_, i) =>
                new TableRow({
                  children: b.columns.map(
                    (col) =>
                      new TableCell({
                        width: { size: colW, type: WidthType.DXA },
                        borders: { top: none, bottom: none, left: none, right: none },
                        margins: { top: 0, bottom: 0, left: 0, right: 120 },
                        children: [
                          new Paragraph({
                            alignment: AlignmentType.LEFT,
                            spacing: { after: 60, line, lineRule: LineRuleType.AUTO },
                            children: col.items[i] ? [K.run(col.items[i]!.text, { size: plan.page.tableSizePt * 2 })] : [],
                          }),
                        ],
                      }),
                  ),
                }),
              ),
            ],
          }),
        );
        out.push(new Paragraph({ spacing: { after: 120, line: 240, lineRule: LineRuleType.AUTO }, children: [] }));
        break;
      }
      case "cards": {
        drawn = true;
        const pad = mmDxa(card.padMm);
        const cellW = mmDxa(card.wMm);
        const rowH = mmDxa(card.hMm);
        /*
         * Varaq shapkasi — HAR betda ikki qator, BIR XIL balandlikda
         * (`planGame` izohi: old bet bilan orqa bet siljimasin).
         */
        out.push(
          new Paragraph({
            alignment: AlignmentType.LEFT,
            keepNext: true,
            ...(b.pageBreak ? { pageBreakBefore: true } : {}),
            spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO },
            children: [K.run(b.title, { size: small })],
          }),
        );
        out.push(
          new Paragraph({
            alignment: AlignmentType.LEFT,
            keepNext: true,
            spacing: { after: 60, line: 240, lineRule: LineRuleType.AUTO },
            children: [K.run(b.hint, { size: small, italics: true, color: "666666" })],
          }),
        );
        const cut = { style: BorderStyle.DASHED, size: 4, color: "BBBBBB" };
        out.push(
          new Table({
            width: { size: cellW * card.cols, type: WidthType.DXA },
            columnWidths: Array.from({ length: card.cols }, () => cellW),
            layout: TableLayoutType.FIXED,
            // Kesish chizig'i JADVAL darajasida ham — `docx` ning standart
            // `single` chegarasi Word da qattiq ramka chizib qo'ymasin.
            borders: { top: cut, bottom: cut, left: cut, right: cut, insideHorizontal: cut, insideVertical: cut },
            rows: b.rows.map(
              (row) =>
                new TableRow({
                  // QAT'IY balandlik — panjara har betda bir xil joyda tursin.
                  height: { value: rowH, rule: HeightRule.EXACT },
                  children: row.map(
                    (face) =>
                      new TableCell({
                        width: { size: cellW, type: WidthType.DXA },
                        borders: { top: cut, bottom: cut, left: cut, right: cut },
                        margins: { top: pad, bottom: pad, left: pad, right: pad },
                        verticalAlign: VerticalAlign.CENTER,
                        children:
                          face.k === "blank"
                            ? [new Paragraph({ spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO }, children: [] })]
                            : [
                                new Paragraph({
                                  alignment: AlignmentType.CENTER,
                                  spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO },
                                  children: [K.run(face.text, face.side === "front" ? { bold: true } : { size: card.backPt * 2 })],
                                }),
                                ...(face.example
                                  ? [
                                      new Paragraph({
                                        alignment: AlignmentType.CENTER,
                                        spacing: { before: 60, after: 0, line: 240, lineRule: LineRuleType.AUTO },
                                        children: [K.run(face.example, { size: card.examplePt * 2, italics: true })],
                                      }),
                                    ]
                                  : []),
                              ],
                      }),
                  ),
                }),
            ),
          }),
        );
        break;
      }
      case "figure": {
        drawn = true;
        const img = await figureBytes(b.figure?.url, opts);
        if (img && b.figure) {
          const maxW = Math.min(Math.floor(W / 15), Math.floor((170 / 25.4) * 96));
          const ratio = b.figure.h && b.figure.w ? b.figure.h / b.figure.w : 1;
          /*
           * To'rning CHOP ETILADIGAN kengligi SPECDAN (`FigureSpec
           * kind:"svg"` `widthMm`): kichik to'r (13×13) betning butun
           * enига cho'zilsa kataklar bemaza katta chiqardi, katta to'r
           * (21×21) esa 170 mm ga siqilib, harflar o'qilmasdi. WP-A
           * uni katak o'lchamidan hisoblaydi — maket faqat hurmat
           * qiladi.
           */
          const specMm = b.figure.spec.kind === "svg" ? Number(b.figure.spec.widthMm) : 0;
          const wantW = specMm > 0 ? Math.floor((specMm / 25.4) * 96) : maxW;
          let width = Math.min(maxW, wantW);
          let height = Math.round(width * ratio);
          const maxH = Math.floor((200 / 25.4) * 96);
          if (height > maxH) {
            height = maxH;
            width = Math.round(height / ratio);
          }
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              keepNext: true,
              // `lineRule: auto` SHART — usiz LibreOffice rasmni bitta matn qatoriga siqadi.
              spacing: { before: 120, after: 80, line: 240, lineRule: LineRuleType.AUTO },
              children: [new ImageRun({ type: img.type, data: img.data, transformation: { width, height } })],
            }),
          );
        } else {
          const border = { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 8 };
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              keepNext: true,
              border: { top: border, bottom: border, left: border, right: border },
              spacing: { before: 120, after: 80, line, lineRule: LineRuleType.AUTO },
              children: [K.run(b.placeholder, { italics: true, color: "666666" })],
            }),
          );
        }
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200, line, lineRule: LineRuleType.AUTO },
            children: [K.run(b.caption, { size: small })],
          }),
        );
        break;
      }
    }
  }
  return out;
}

/**
 * `opts.resolveImage` — tahrirdan keyingi QAYTA render uchun (B-1).
 *
 * Saqlangan `doc_json` dagi surat URL i `/api/generations/…/assets/…`
 * bo'ladi; baytni faqat egalik tekshiruvidan o'tgan server hal qiluvchi
 * bera oladi (`assetImageResolver`). Shartnoma `render-pptx.ts` dagi
 * bilan AYNAN bir xil (`ImageBytes`), shuning uchun `edit-adapters.ts`
 * ikkala rendererga bitta hal qiluvchini uzata oladi.
 */
export async function renderDocx(doc: AcademicDoc, opts: ResumeDocxOpts = {}): Promise<Uint8Array> {
  const { meta } = doc;
  const base = profileFor(meta);
  /*
   * Rezyume modeli: yangi hujjatda `doc.resume`, eskisida
   * `legacyResumeModel` (B-8). Profil SHABLONGA bog'liq bo'lgani uchun
   * model profildan OLDIN aniqlanadi.
   */
  const resume = doc.resume ?? (base.id === "resume" ? legacyResumeModel(doc) : null);
  /*
   * Maqola 2: `doc.article` bo'lsa reja (`planArticle`) va nashr profili
   * modeldan. Eski maqola (`doc.article` yo'q) — quyidagi umumiy yo'l
   * (titul, mundarija, jadval oxirida) o'zgarishsiz.
   */
  const article = doc.article ? planArticle(doc) : null;
  /*
   * Talaba ishlari 2 (AUDIT-19): `doc.work` bo'lsa reja (`planWork`) va
   * profil FAN PROFILIDAN. Eski kurs ishi/referat (`doc.work` yo'q) —
   * quyidagi umumiy yo'l (titul, mundarija, jadval oxirida) o'zgarishsiz.
   */
  const work = !article && doc.work ? planWork(doc) : null;
  /*
   * O'qituvchi vositalari 2 (AUDIT-20 WP-C): beshala vosita — dars
   * ishlanmasi, texnologik xarita, glossariy, keys, test — `planTeacher`
   * dan. ESKI hujjat (`doc.teacher` yo'q) ham SHU yo'ldan: 4 eski
   * ko'ruvchi o'chirilgani uchun sayt uni yangi maketda ko'rsatadi,
   * ya'ni fayl ham shu maketda chiqishi kerak («ko'rdim = oldim»);
   * modelni `legacyTeacherModel` beradi va tuzilma bo'sh bo'lgani uchun
   * hujjatning MAZMUNI o'zgarmaydi.
   */
  const teacher = !article && !work && isTeacherDoc(doc) ? planTeacher(doc) : null;
  /*
   * Bosma o'yinlar (AUDIT-21 WP-A/WP-B): krossvord va flesh kartalar —
   * `planGame` dan. Shart `doc.game` ning O'ZI: o'yin vositasining eski
   * hujjati YO'Q (ikkalasi ham yangi xizmat), shuning uchun `toolId`
   * bo'yicha zaxira yo'l ham kerak emas.
   */
  const game = !article && !work && !teacher && isGameDoc(doc) ? planGame(doc) : null;
  const P = resume
    ? resumeProfile(resume.template)
    : article
      ? articleProfile(article.profile.id, { headingAlign: article.headingAlign })
      : work
        ? workProfile(work.model.subject)
        : teacher
          ? teacherProfile(teacher.kind)
          : game
            ? gameProfile(game.kind)
            : base;
  const K = makeKit(P);
  const L = docLabels(meta.language);
  const children: Array<Paragraph | Table> = [];

  /**
   * Titul YAGONA modeldan chiziladi (`title-model.ts`).
   *
   * Ilgari bu yerda ikkita mustaqil blok turardi va sayt ko'ruvchisi
   * uchinchi, o'z qolipini chizardi. Natijada maqola saytda TALABA ISHI
   * bo'lib ko'rinar, faylda esa jurnal maqolasi chiqardi (AUDIT-5 P0-2).
   * Endi model bitta joyda quriladi, bu yer faqat chizadi — `tocRows`
   * va `planSlide` bilan bir xil naqsh.
   */
  if (doc.titlePage && P.titlePage !== "none") {
    const T = titleModel(doc);
    if (T.kind === "article") {
      children.push(K.centerP(T.workLabel.toUpperCase(), { bold: true, size: 32 }));
      children.push(K.centerP(""));
      children.push(K.centerP(`«${T.topic}»`, { bold: true, italics: true }));
      children.push(K.centerP(""));
      children.push(K.centerP(""));
      if (T.authorLine) children.push(K.centerP(T.authorLine, { bold: true }));
      if (T.organization) children.push(K.centerP(T.organization));
      if (T.email) children.push(K.centerP(T.email));
      children.push(K.centerP(""));
      children.push(K.centerP(""));
      children.push(K.centerP(T.cityYear, { bold: true }));
    } else {
      for (const line of T.ministry) children.push(K.centerP(line, { bold: true, size: 24 }));
      children.push(K.centerP(""));
      // Ma'nosiz o'rinbosar («Oliy ta'lim muassasasi») `titleModel` da
      // allaqachon "" ga aylantirilgan — bu yer faqat chizadi.
      if (T.university) {
        children.push(K.centerP(T.university.toUpperCase(), { bold: true, size: 24 }));
      }
      children.push(K.centerP(""));
      if (T.faculty) children.push(K.centerP(T.faculty));
      if (T.department) children.push(K.centerP(T.department));
      children.push(K.centerP(""));
      children.push(K.centerP(""));
      // Talaba ishi: «"FAN" fanidan» ish turidan OLDINGI qatorda (AUDIT-19).
      if (T.subjectLine) children.push(K.centerP(T.subjectLine, { bold: true }));
      children.push(K.centerP(T.workLabel.toUpperCase(), { bold: true, size: 32 }));
      children.push(K.centerP(""));
      children.push(K.centerP(T.topicLabel ? `${T.topicLabel} «${T.topic}»` : `«${T.topic}»`, { bold: true, italics: true }));
      children.push(K.centerP(""));
      children.push(K.centerP(""));
      if (T.author) children.push(K.signatureP(`${T.authorLabel}: ${T.author}`));
      if (T.courseLine) children.push(K.leftP(T.courseLine));
      if (T.teacher) children.push(K.signatureP(`${T.teacherLabel}: ${T.teacher}`));
      if (T.subject && T.subject.toLowerCase() !== T.workLabel.toLowerCase()) {
        children.push(K.leftP(`${T.labels.subject}: ${T.subject}`));
      }
      children.push(K.centerP(""));
      children.push(K.centerP(""));
      children.push(K.centerP(T.academicYear));
      children.push(K.centerP(T.cityYear, { bold: true }));
    }
    children.push(new Paragraph({ children: [K.run("")], pageBreakBefore: true }));
  }

  const hasTitle = Boolean(doc.titlePage) && P.titlePage !== "none";

  if (resume) {
    children.push(...(await renderResumeDocx(resume, K, P, opts)));
  } else if (article) {
    // Titul ham, mundarija ham YO'Q (`doc.toc` e'tiborsiz) — jurnal maqolasi.
    children.push(...(await drawArticle(article, K, P, opts)));
  } else if (work) {
    // Titul yuqorida chizildi; mundarija, tana, adabiyotlar va ilovalar — rejadan.
    children.push(...(await drawWork(work, doc, K, P, opts)));
  } else if (teacher) {
    // Titul beti YO'Q (`teacherProfile.titlePage === "none"`) — shapka rejaning o'zida.
    children.push(...(await drawTeacher(teacher, K, P, opts)));
  } else if (game) {
    // Titul beti YO'Q; kartalarda umuman shapka ham yo'q (`planGame`).
    children.push(...(await drawGame(game, K, P, opts)));
  } else {
    if (doc.toc) {
      children.push(K.heading(L.toc, HeadingLevel.HEADING_1));
      /*
       * Mundarija Word MAYDONI ichida turadi, lekin tarkibini biz yozamiz.
       *
       * Yolg'iz maydon yetarli emas: LibreOffice (PDF eksporti shu orqali
       * ishlaydi) uni to'ldirmaydi va mundarija BUTUNLAY bo'sh chiqadi —
       * tekshirildi. Maydonsiz esa Word hech qachon haqiqiy sahifa
       * raqamini qo'ya olmaydi. Shuning uchun ikkalasi birga: maydon ichiga
       * tayyor paragraflar qo'yiladi — ular hamma joyda ko'rinadi, Word esa
       * hujjat ochilganda maydonni yangilab, raqamlarni o'zi hisoblaydi.
       *
       * Sahifa raqami ATAYIN yozilmaydi: bu bosqichda uni faqat taxmin
       * qilish mumkin, noto'g'ri raqam esa raqamsizdan yomonroq.
       */
      const tocEntries = tocRows(doc).map((r) =>
        K.tocLine(r.level === 1 ? r.text.toUpperCase() : r.text, r.level),
      );
      children.push(
        new TableOfContents(L.toc, {
          hyperlink: true,
          headingStyleRange: "1-2",
          contentChildren: tocEntries,
        }),
      );
      children.push(new Paragraph({ children: [K.run("")], pageBreakBefore: true }));
    }

    for (const a of doc.abstracts ?? []) {
      children.push(K.sectionHeading(a.label));
      children.push(K.bodyP(a.text));
      children.push(K.bodyP(`${L.keywords}: ${a.keywords}`));
    }

    /**
     * Bo'sh bo'lim sarlavhasi chizilmaydi.
     *
     * Yozuv yo'llari bo'sh bo'lim qoldirmasligi kerak va endi qoldirmaydi,
     * lekin renderer bunga TAYANMASLIGI lozim: matnsiz «KIRISH» sarlavhasi
     * foydalanuvchi ko'radigan eng yomon nuqson — hujjat tugallanmagandek
     * ko'rinadi. Bu yerdagi tekshiruv arzon va oxirgi to'siq.
     */
    const anchored = new Map<string, DocTable[]>();
    const trailing: DocTable[] = [];
    for (const tb of doc.tables ?? []) {
      /*
       * `anchor` — jadval qaysi bo'limdan keyin turishi.
       *
       * Ilgari BARCHA jadvallar hujjat oxirida, adabiyotlardan oldin
       * chizilardi. Dars rejasida bu shunday chiqardi: pasport → bosqichlar
       * matni → uy vazifasi → [bir necha sahifa keyin] vaqt jadvali.
       * O'qituvchi darsni jadval bilan olib boradi, matn bilan emas.
       *
       * `anchor` berilmagan jadval eski joyida qoladi, shuning uchun
       * mavjud hujjatlar o'zgarmaydi.
       */
      const key = P.tablePlacement === "anchored" ? tb.anchor : undefined;
      if (key) anchored.set(key, [...(anchored.get(key) ?? []), tb]);
      else trailing.push(tb);
    }

    for (const s of doc.sections) {
      if (s.blocks.length) {
        /*
         * Sarlavhasiz bo'lim — sarlavhasiz chiziladi.
         *
         * Tarjima (`translation` profili) manbadagi tuzilmani AYNAN
         * qaytaradi: unda «KIRISH» kabi bo'lim nomlari yo'q, sarlavhalar
         * matnning o'zida (`h1` bloki). Tekshiruvsiz bu yerda har bo'lim
         * uchun BO'SH «Heading 1» paragrafi chiqib, hujjat boshida va
         * har jadvaldan keyin sababsiz bo'sh qator qolardi.
         */
        if (s.title) children.push(K.sectionHeading(s.title));
        for (const b of s.blocks) children.push(...K.blockToParagraphs(b));
      }
      for (const tb of anchored.get(s.id) ?? []) drawTable(K, tb, children);
    }
    // Langari mavjud bo'lmagan bo'limga ishora qilsa jadval yo'qolmasin.
    for (const [id, list] of anchored) {
      if (doc.sections.some((s) => s.id === id)) continue;
      for (const tb of list) drawTable(K, tb, children);
    }

    for (const tb of trailing) drawTable(K, tb, children);

    if (doc.references?.length) {
      children.push(K.heading(L.references, HeadingLevel.HEADING_1));
      if (doc.referencesNote) children.push(K.bodyP(doc.referencesNote));
      doc.references.forEach((r, i) => children.push(K.bodyP(`${i + 1}. ${r}`)));
    }
  }

  // OTME/GOST: raqam pastida, markazda. Titul — 1-sahifa, lekin raqam chiqmaydi.
  const pageNumberRun = new TextRun({ children: [PageNumber.CURRENT], font: P.type.font, size: 22 });
  const numberedFooter = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [pageNumberRun],
      }),
    ],
  });
  const blankFooter = new Footer({ children: [new Paragraph({})] });
  const design = ESSAY_DESIGNS.find((d) => d.value === meta.design);
  /**
   * Sahifa ramkasi — FAQAT insho uchun (`essay` profili).
   *
   * Ilgari u barcha hujjatlarga (referat, kurs ishi, maqola, tezis) qora
   * `#222222` rangda tushardi. GOST 7.32 va OTME uslubiy ko'rsatmalari
   * ramka talab qilmaydi — aksincha, ilmiy ishda u havaskorlik belgisi.
   * Inshoda esa `design` tanlovi aynan shu ramka rangi orqali ko'rinadi.
   */
  const essayBorder = P.page.border && design ? design.from.replace("#", "") : null;

  const document = new Document({
    // Word hujjatni ochganda mundarija maydonini yangilaydi.
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { font: P.type.font, size: P.type.size },
          paragraph: { spacing: { line: P.type.line, lineRule: LineRuleType.AUTO } },
        },
      },
    },
    sections: [
      {
        properties: {
          titlePage: hasTitle,
          page: {
            size: {
              width: P.page.width,
              height: P.page.height,
              ...(P.page.landscape ? { orientation: PageOrientation.LANDSCAPE } : {}),
            },
            margin: P.page.margin,
            pageNumbers: { start: 1 },
            ...(essayBorder
              ? {
                  borders: {
                    pageBorders: {
                      display: PageBorderDisplay.ALL_PAGES,
                      offsetFrom: PageBorderOffsetFrom.PAGE,
                    },
                    pageBorderTop: { style: BorderStyle.SINGLE, size: 12, space: 18, color: essayBorder },
                    pageBorderRight: { style: BorderStyle.SINGLE, size: 12, space: 12, color: essayBorder },
                    pageBorderBottom: { style: BorderStyle.SINGLE, size: 12, space: 18, color: essayBorder },
                    pageBorderLeft: { style: BorderStyle.SINGLE, size: 12, space: 14, color: essayBorder },
                  },
                }
              : {}),
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
