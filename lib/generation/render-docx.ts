import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  HeightRule,
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
import { CM, contentHeight, contentWidth, profileFor, type DocProfile } from "./docx-profile";
import { docLabels } from "./i18n";
import { cleanText } from "./quality";
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
      spacing: { after: P.type.after, line },
      ...(P.type.firstLine ? { indent: { firstLine: P.type.firstLine } } : {}),
      children: [run(text)],
    });

  const centerP = (text: string, extra: RunExtra = {}): Paragraph =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160, line },
      children: [run(text, extra)],
    });

  const leftP = (text: string, extra: RunExtra = {}): Paragraph =>
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 120, line },
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
      spacing: { after: 120, line },
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
      children: [run(label), new TextRun({ text: "\t", font, size }), run("____________")],
    });

  /**
   * Mundarija qatori. 2-daraja chapdan suriladi — bob va ostmavzu
   * ko'z bilan ajralib tursin.
   */
  const tocLine = (text: string, level: 1 | 2): Paragraph =>
    new Paragraph({
      spacing: { line, after: 0 },
      indent: { left: level === 2 ? Math.round(0.75 * CM) : 0 },
      children: [run(text, { bold: level === 1 })],
    });

  const heading = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph =>
    new Paragraph({
      heading: level,
      alignment: P.heading.align === "left" ? AlignmentType.LEFT : AlignmentType.CENTER,
      spacing: { before: 280, after: 200, line },
      ...(P.heading.rule
        ? { border: { bottom: { style: BorderStyle.SINGLE, size: 8, space: 2, color: "F97316" } } }
        : {}),
      children: [run(text, { bold: true, ...(P.heading.color ? { color: P.heading.color } : {}) })],
    });

  /** Bo'lim/annotatsiya sarlavhasi — profil talab qilsa BOSH HARFGA o'tadi. */
  const sectionHeading = (text: string): Paragraph =>
    heading(P.heading.upper ? text.toUpperCase() : text, HeadingLevel.HEADING_1);

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
                      spacing: { line: 276, after: 0 },
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
        return [heading(b.text, HeadingLevel.HEADING_2)];
      case "h3":
        return [
          new Paragraph({
            spacing: { before: 200, after: 120, line },
            children: [run(b.text, { bold: true })],
          }),
        ];
      case "li":
        return [
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 80, line },
            children: [run(b.text)],
          }),
        ];
      case "quote":
        return [
          new Paragraph({
            indent: { left: CM },
            spacing: { after: 200, line },
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
            spacing: { after: 40, line: 276 },
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

/**
 * Ustun kengliklari — ustun soniga qarab.
 *
 * Faqat aniq tanish shakllar uchun; boshqasida teng taqsimot qoladi.
 */
function columnWidths(headers: string[]): number[] | undefined {
  // № | Soat | Mavzu | Metod | Natija | Nazorat  (texnologik xarita)
  if (headers.length === 6) return [5, 8, 33, 15, 25, 14];
  // Bosqich | Daqiqa | Faoliyat | Natija  (dars rejasi)
  if (headers.length === 4) return [22, 10, 45, 23];
  return undefined;
}

function drawTable(K: Kit, tb: DocTable, out: Array<Paragraph | Table>) {
  if (tb.caption) out.push(K.centerP(tb.caption, { italics: true, size: 24 }));
  out.push(K.tableOf(tb.headers, tb.rows, columnWidths(tb.headers)));
}

/**
 * Rezyume tanasi — chegarasiz ikki ustunli jadval.
 *
 * `docx` da haqiqiy ustun oqimi (`column`) butun bo'limga tegadi va
 * matnning qaysi ustunga tushishini boshqarib bo'lmaydi. Jadval esa
 * Word va LibreOffice ikkalasida ham bir xil chiziladi — sayt
 * ko'ruvchisidagi tuzilma (`ResumeViewer`) aynan takrorlanadi.
 */
function resumeBody(doc: AcademicDoc, K: Kit, P: DocProfile): Array<Paragraph | Table> {
  const { meta } = doc;
  const byId = Object.fromEntries(doc.sections.map((s) => [s.id, s]));
  const blocks = (id: string) => byId[id]?.blocks ?? [];
  const title = (id: string, fallback: string) => byId[id]?.title || fallback;

  const summaryBlocks = blocks("summary");
  const summary = summaryBlocks[0]?.text ?? "";
  const contact = summaryBlocks[1]?.text ?? meta.city;
  const skills = blocks("skills").map((b) => b.text).join(" · ");

  const ASIDE_W = Math.round(72 * 56.7); // 72 mm — ko'ruvchidagi yon panel kengligi
  const MAIN_W = Math.max(K.CONTENT_W - ASIDE_W, Math.round(K.CONTENT_W / 2));

  const asideLabel = (text: string) =>
    new Paragraph({
      spacing: { before: 240, after: 60, line: P.type.line },
      children: [K.run(text.toUpperCase(), { size: 16, bold: true, color: "A8A29E" })],
    });
  const asideText = (text: string) =>
    new Paragraph({
      spacing: { after: 60, line: P.type.line },
      children: [K.run(text, { size: 18, color: "E7E5E4" })],
    });

  const aside: Paragraph[] = [
    new Paragraph({
      spacing: { after: 120, line: P.type.line },
      children: [K.run("REZYUME", { size: 16, bold: true, color: "FDBA74" })],
    }),
    new Paragraph({
      spacing: { after: 60, line: P.type.line },
      children: [K.run(meta.author || "F.I.Sh", { size: 30, bold: true, color: "F5F5F4" })],
    }),
    new Paragraph({
      spacing: { after: 60, line: P.type.line },
      children: [K.run(meta.topic, { size: 20, color: "FED7AA" })],
    }),
    asideLabel("Aloqa"),
    ...contact.split(" · ").filter(Boolean).map(asideText),
  ];
  if (skills) {
    aside.push(asideLabel("Ko‘nikmalar"));
    aside.push(asideText(skills));
  }

  const main: Array<Paragraph | Table> = [];
  if (summary) {
    main.push(K.sectionHeading(title("summary", "Qisqacha")));
    main.push(K.bodyP(summary));
  }
  for (const id of ["exp", "edu"]) {
    const bs = blocks(id);
    if (!bs.length) continue;
    main.push(K.sectionHeading(title(id, id === "exp" ? "Tajriba" : "Ta’lim")));
    for (const b of bs) main.push(...K.blockToParagraphs(b));
  }

  const noBorder = { style: BorderStyle.NONE, size: 0, color: "auto" } as const;
  const borders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
  return [
    new Table({
      width: { size: K.CONTENT_W, type: WidthType.DXA },
      columnWidths: [ASIDE_W, MAIN_W],
      borders: {
        ...borders,
        insideHorizontal: noBorder,
        insideVertical: noBorder,
      },
      rows: [
        new TableRow({
          /*
           * Yon panel sahifa balandligini to'ldiradi.
           *
           * Jadval katagi odatda faqat mazmuni qadar cho'ziladi va to'q
           * panel varaqning yarmida uzilib qolardi — ko'ruvchida esa u
           * to'liq balandlikda. `ATLEAST` tanlandi: tajriba uzun bo'lsa
           * katak yana ham cho'ziladi, qisqa bo'lsa sahifani to'ldiradi.
           */
          height: { value: contentHeight(P), rule: HeightRule.ATLEAST },
          children: [
            new TableCell({
              borders,
              width: { size: ASIDE_W, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, fill: "1C1917" },
              margins: { top: 340, bottom: 340, left: 280, right: 280 },
              verticalAlign: VerticalAlign.TOP,
              children: aside,
            }),
            new TableCell({
              borders,
              width: { size: MAIN_W, type: WidthType.DXA },
              margins: { top: 340, bottom: 200, left: 340, right: 120 },
              verticalAlign: VerticalAlign.TOP,
              children: main.length ? main : [K.bodyP("")],
            }),
          ],
        }),
      ],
    }),
  ];
}

export async function renderDocx(doc: AcademicDoc): Promise<Uint8Array> {
  const { meta } = doc;
  const P = profileFor(meta);
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
      // Ma'nosiz o'rinbosar («Oliy ta'lim muassasasi») chizilmaydi.
      if (T.university && !/^oliy ta[’']lim muassasasi$/i.test(T.university)) {
        children.push(K.centerP(T.university.toUpperCase(), { bold: true, size: 24 }));
      }
      children.push(K.centerP(""));
      if (T.faculty) children.push(K.centerP(T.faculty));
      if (T.department) children.push(K.centerP(T.department));
      children.push(K.centerP(""));
      children.push(K.centerP(""));
      children.push(K.centerP(T.workLabel.toUpperCase(), { bold: true, size: 32 }));
      children.push(K.centerP(""));
      children.push(K.centerP(`«${T.topic}»`, { bold: true, italics: true }));
      children.push(K.centerP(""));
      children.push(K.centerP(""));
      if (T.author) children.push(K.signatureP(`${T.labels.doneBy}: ${T.author}`));
      if (T.courseLine) children.push(K.leftP(T.courseLine));
      if (T.teacher) children.push(K.signatureP(`${T.labels.supervisor}: ${T.teacher}`));
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

  if (P.id === "resume") {
    children.push(...resumeBody(doc, K, P));
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
        children.push(K.sectionHeading(s.title));
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
          paragraph: { spacing: { line: P.type.line } },
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
