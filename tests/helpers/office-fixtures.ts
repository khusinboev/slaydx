/**
 * Tarjima adapterlari uchun HAQIQIY office fiksturalari.
 *
 * Nega qo'lda yozilgan XML emas: adapter Word/PowerPoint/Excel
 * CHIQARADIGAN faylni o'qishi kerak, biz o'ylab topgan soddalashtirilgan
 * XML ni emas. `docx` va `pptxgenjs` aynan shu haqiqiy tuzilmani
 * (`w:fldChar` guruhlari, `w:numPr`, `a:hlinkClick`, `p:ph`) chiqaradi,
 * ya'ni test o'zi bilan o'zi kelishib qolmaydi. XLSX esa qo'lda
 * yig'iladi — loyihada Excel yozuvchisi yo'q, lekin sharedStrings/
 * inlineStr/formula kombinatsiyasi aniq kerak.
 */

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * `docx` kutubxonasi chiqara olmaydigan ikki tuzilma — XOM XML bilan.
 *
 *  • MATN QUTISI (`w:txbxContent`): ichidagi `w:p` mustaqil paragraf,
 *    tashqarisidagi run esa opaque. Adapterda bu eng nozik ichma-ich
 *    holat, shuning uchun fiksturada bo'lishi SHART.
 *  • `w:fldChar` guruhli TOC maydoni: natija runlari — foydalanuvchi
 *    ko'radigan MATN, ya'ni tarjima qilinishi kerak (`PAGE`/`PAGEREF`
 *    dan farqli o'laroq).
 */
const RAW_EXTRAS = [
  '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">',
  '<wp:extent cx="2160000" cy="900000"/><wp:docPr id="99" name="Matn qutisi"/>',
  '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
  '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">',
  '<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/>',
  '<a:ext cx="2160000" cy="900000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
  '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>',
  "<a:ln><a:solidFill><a:srgbClr val=\"000000\"/></a:solidFill></a:ln></wps:spPr>",
  "<wps:txbx><w:txbxContent><w:p><w:r><w:t>Matn qutisi ichidagi jumla</w:t></w:r></w:p></w:txbxContent></wps:txbx>",
  '<wps:bodyPr rot="0" vert="horz" wrap="square" anchor="t"/></wps:wsp>',
  "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>",
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>',
  '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h </w:instrText></w:r>',
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>',
  "<w:r><w:t>Mundarija sarlavhasi</w:t></w:r>",
  '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
].join("");

async function injectRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  const at = xml.indexOf("<w:sectPr");
  const cut = at >= 0 ? at : xml.indexOf("</w:body>");
  zip.file("word/document.xml", xml.slice(0, cut) + RAW_EXTRAS + xml.slice(cut));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function makeDocx(): Promise<Uint8Array> {
  const {
    Document,
    ExternalHyperlink,
    Footer,
    FootnoteReferenceRun,
    Header,
    HeadingLevel,
    ImageRun,
    LevelFormat,
    PageNumber,
    Packer,
    Paragraph,
    SimpleField,
    Tab,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = await import("docx");

  const cell = (text: string) =>
    new TableCell({
      width: { size: 33, type: WidthType.PERCENTAGE },
      children: [new Paragraph({ children: [new TextRun(text)] })],
    });

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "royxat",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: "left" }],
        },
      ],
    },
    footnotes: {
      1: { children: [new Paragraph({ children: [new TextRun("Izoh matni fikstura uchun")] })] },
    },
    sections: [
      {
        headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun("Yuqori kolontitul")] })] }) },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [new TextRun("Sahifa "), new TextRun({ children: [PageNumber.CURRENT] })],
              }),
            ],
          }),
        },
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun("Hujjat sarlavhasi")] }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Birinchi bob")] }),
          // Qalin + oddiy run: markerlar (⟦r1⟧…) aynan shu yerda sinaladi.
          new Paragraph({
            children: [
              new TextRun({ text: "Muhim so'z", bold: true }),
              new TextRun(" va oddiy davomi shu yerda."),
            ],
          }),
          // Tabulyatsiya bitta run ichida.
          new Paragraph({ children: [new TextRun({ children: ["Chap ustun", new Tab(), "O'ng ustun"] })] }),
          new Paragraph({
            children: [
              new TextRun("Havola: "),
              new ExternalHyperlink({ children: [new TextRun("saytga o'ting")], link: "https://example.com" }),
            ],
          }),
          new Paragraph({ numbering: { reference: "royxat", level: 0 }, children: [new TextRun("Birinchi band")] }),
          new Paragraph({ numbering: { reference: "royxat", level: 0 }, children: [new TextRun("Ikkinchi band")] }),
          new Paragraph({ children: [new TextRun("Izohli jumla"), new FootnoteReferenceRun(1)] }),
          // Mundarija satri: PAGEREF maydoni — butun guruh opaque bo'lishi kerak.
          new Paragraph({
            children: [
              new TextRun("Birinchi bob"),
              new TextRun({ children: [new Tab()] }),
              new SimpleField("PAGEREF _Toc001 \\h", "2"),
            ],
          }),
          new Paragraph({
            children: [
              new ImageRun({
                type: "png",
                data: Buffer.from(PNG_1PX, "base64"),
                transformation: { width: 40, height: 40 },
              }),
            ],
          }),
          // Olti xil formatli run — markerlar chegarasidan (4) oshadi,
          // ya'ni butun paragraf DOMINANT runga tushishi kerak.
          new Paragraph({
            children: [
              new TextRun({ text: "bir ", bold: true }),
              new TextRun({ text: "ikki ", italics: true }),
              new TextRun({ text: "uch ", underline: {} }),
              new TextRun({ text: "to'rt ", color: "FF0000" }),
              new TextRun({ text: "besh ", size: 32 }),
              new TextRun({ text: "olti va eng uzun qism shu yerda turadi", strike: true }),
            ],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: [cell("Ustun A"), cell("Ustun B"), cell("Ustun D")] }),
              new TableRow({ children: [cell("Qator bir"), cell("Qator ikki"), cell("Qator uch")] }),
            ],
          }),
        ],
      },
    ],
  });

  return injectRaw(new Uint8Array(await Packer.toBuffer(doc)));
}

/**
 * PDF sinovi uchun manba DOCX — LibreOffice bilan PDF ga o'giriladi.
 *
 * Uch sahifa SHART: takrorlanuvchi kolontitul qoidasi «sahifalarning
 * ≥60% ida» deb ishlaydi va ikki sahifada ishonchli o'lchanmaydi.
 */
export async function makeLongDocx(): Promise<Uint8Array> {
  const { Document, Footer, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun, Table, TableCell, TableRow, WidthType } =
    await import("docx");

  const long = (n: number) =>
    `Bu ${n}-paragraf va u yetarlicha uzun yozilgan, chunki PDF dan tuzilma tiklanayotganda ` +
    "qator birlashtirish qoidalari faqat haqiqiy ko'p qatorli matnda sinaladi. Shuning uchun " +
    "bu jumla bir necha qatorga cho'ziladi va tarjimon uni bitta paragraf deb ko'rishi kerak.";

  const cell = (t: string) =>
    new TableCell({ width: { size: 33, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun(t)] })] });

  const doc = new Document({
    numbering: {
      config: [{ reference: "pdf-royxat", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: "left" }] }],
    },
    sections: [
      {
        footers: {
          default: new Footer({ children: [new Paragraph({ children: [new TextRun("Yillik hisobot 2025")] })] }),
        },
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Yagona bo'lim sarlavhasi")] }),
          new Paragraph({ children: [new TextRun(long(1))] }),
          new Paragraph({ children: [new TextRun(long(2))] }),
          new Paragraph({ numbering: { reference: "pdf-royxat", level: 0 }, children: [new TextRun("Birinchi ro'yxat bandi")] }),
          new Paragraph({ numbering: { reference: "pdf-royxat", level: 0 }, children: [new TextRun("Ikkinchi ro'yxat bandi")] }),
          new Paragraph({ numbering: { reference: "pdf-royxat", level: 0 }, children: [new TextRun("Uchinchi ro'yxat bandi")] }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: [cell("Ustun bir"), cell("Ustun ikki"), cell("Ustun uch")] }),
              new TableRow({ children: [cell("Qator A bir"), cell("Qator A ikki"), cell("Qator A uch")] }),
              new TableRow({ children: [cell("Qator B bir"), cell("Qator B ikki"), cell("Qator B uch")] }),
            ],
          }),
          new Paragraph({ pageBreakBefore: true, children: [new TextRun(long(3))] }),
          new Paragraph({ pageBreakBefore: true, children: [new TextRun(long(4))] }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

/**
 * Matn qatlamisiz PDF — «skaner nusxa» holati.
 *
 * Qo'lda yozilgan, chunki bo'sh PDF chiqaradigan kutubxona yo'q va
 * WP1 dagi 422 `scanned` tekshiruvi aynan shu holatga tayanadi.
 */
export function makeBlankPdf(): Uint8Array {
  const objects = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<<>>>>endobj\n",
    "4 0 obj<</Length 0>>stream\n\nendstream\nendobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const o of objects) {
    offsets.push(pdf.length);
    pdf += o;
  }
  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${startxref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export async function makePptx(): Promise<Uint8Array> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
  pptx.layout = "WIDE";

  // Muqova MASTER orqali: `p:ph type="title"` bo'lgandagina segment
  // turi `title` bo'ladi — oddiy matn qutisi buni bermaydi.
  pptx.defineSlideMaster({
    title: "COVER",
    objects: [
      { placeholder: { options: { name: "t", type: "title", x: 0.8, y: 2.4, w: 11.7, h: 1.4, fontSize: 40 }, text: " " } },
      { placeholder: { options: { name: "s", type: "body", x: 0.8, y: 4.0, w: 11.7, h: 0.8, fontSize: 18 }, text: " " } },
    ],
  });

  const cover = pptx.addSlide({ masterName: "COVER" });
  cover.addText("Taqdimot sarlavhasi", { placeholder: "t" });
  cover.addText("Kichik izoh qatori", { placeholder: "s" });

  const bullets = pptx.addSlide();
  bullets.addText("Asosiy bandlar", { x: 0.7, y: 0.5, w: 11.9, h: 1.0, fontSize: 28 });
  bullets.addText(
    [
      { text: "Qalin qism", options: { bold: true } },
      { text: " va oddiy davomi", options: { breakLine: true } },
      { text: "Ikkinchi band", options: { bullet: true } },
    ],
    { x: 0.7, y: 1.7, w: 11.9, h: 4.0, fontSize: 18 },
  );
  // Bitta paragraf ichida `\n` → `<a:br/>` (⟦br⟧ tokeni shu yerda sinaladi).
  bullets.addText("Birinchi qator\nIkkinchi qator", { x: 0.7, y: 5.6, w: 11.9, h: 1.0, fontSize: 16 });
  bullets.addNotes("Ma'ruzachi uchun izoh matni.");

  const tableSlide = pptx.addSlide();
  tableSlide.addText("Jadval slaydi", { x: 0.7, y: 0.5, w: 11.9, h: 1.0, fontSize: 28 });
  tableSlide.addTable(
    [
      [{ text: "Ustun bir" }, { text: "Ustun ikki" }],
      [{ text: "Qiymat bir" }, { text: "Qiymat ikki" }],
    ],
    { x: 0.7, y: 1.7, w: 11.9 },
  );

  const bytes = new Uint8Array((await pptx.write({ outputType: "nodebuffer" })) as Buffer);

  /*
   * Diagramma qismi XOM holda qo'shiladi.
   *
   * `pptxgenjs` diagramma matnini `<c:v>` ichida chiqaradi, bizga esa
   * `<a:t>` li HAQIQIY holat kerak (SmartArt keshi va diagramma
   * sarlavhasi shunday). Qism SLAYDGA ulanmagan — testning maqsadi
   * ogohlantirish va BAYT-BA-BAYT tegilmaslikni tekshirish.
   */
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);

  /*
   * `<a:br/>` XOM holda qo'shiladi: `pptxgenjs` `breakLine`/`\n` ni
   * YANGI `<a:p>` ga aylantiradi va haqiqiy `<a:br/>` ni hech qachon
   * chiqarmaydi. PowerPoint da esa Shift+Enter aynan `<a:br/>` beradi —
   * bu adapterdagi eng nozik joy (run YONIDAGI element).
   */
  const slide2 = await zip.file("ppt/slides/slide2.xml")!.async("string");
  zip.file("ppt/slides/slide2.xml", slide2.replace("Qalin qism</a:t></a:r>", "Qalin qism</a:t></a:r><a:br/>"));

  /*
   * Slayd raqami maydoni (`<a:fld>`) — `pptxgenjs` da bunday
   * placeholder yo'q. Adapter uni OPAQUE deb bilishi va matnini
   * tarjima qilmasligi kerak: raqamni PowerPoint o'zi qo'yadi.
   */
  const slide3 = await zip.file("ppt/slides/slide3.xml")!.async("string");
  zip.file(
    "ppt/slides/slide3.xml",
    slide3.replace(
      "Jadval slaydi</a:t></a:r>",
      'Jadval slaydi</a:t></a:r><a:fld id="{7B2A1C64-0000-0000-0000-000000000001}" type="slidenum"><a:rPr lang="en-US"/><a:t>3</a:t></a:fld>',
    ),
  );

  zip.file(
    "ppt/charts/chart1.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:title><c:tx><c:rich><a:p><a:r><a:t>Diagramma sarlavhasi</a:t></a:r></a:p></c:rich></c:tx></c:title></c:chartSpace>',
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Hisobot" sheetId="1" r:id="rId1"/><sheet name="Ikkinchi" sheetId="2" r:id="rId2"/></sheets></workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;

/**
 * Umumiy satrlar: oddiy `<t>`, boy `<r>` (qalin + oddiy), raqamli satr
 * va formula ko'rinishidagi satr.
 */
const SHARED_STRINGS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="6" uniqueCount="5"><si><t>Mahsulot nomi</t></si><si><r><rPr><b/></rPr><t>Qalin sarlavha</t></r><r><t xml:space="preserve"> va oddiy qismi</t></r></si><si><t>Jami summa</t></si><si><t>2024</t></si><si><t>=SUM(A1:A2)</t></si></sst>`;

const SHEET1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>120</v></c><c r="B2"><v>240</v></c></row><row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3"><f>SUM(A1:A2)</f><v>360</v></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>Katak ichidagi matn</t></is></c><c r="B4" t="s"><v>3</v></c></row></sheetData></worksheet>`;

const SHEET2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>4</v></c></row></sheetData></worksheet>`;

export async function makeXlsx(): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("xl/workbook.xml", WORKBOOK);
  zip.file("xl/_rels/workbook.xml.rels", WORKBOOK_RELS);
  zip.file("xl/sharedStrings.xml", SHARED_STRINGS);
  zip.file("xl/worksheets/sheet1.xml", SHEET1);
  zip.file("xl/worksheets/sheet2.xml", SHEET2);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/**
 * Soxta «tarjimon»: ko'rinadigan har bo'lakka `[T]` qo'shadi, TOKENLARGA
 * tegmaydi.
 *
 * Nima uchun aynan shunday: haqiqiy modelning yagona majburiyati —
 * tokenlarni saqlash. Fikstura shu shartnomani bajaradi, ya'ni test
 * adapterni sinaydi, LLM ni emas.
 */
export function fakeTranslate(s: string): string {
  return s.replace(/(^|⟧)([^⟦]+)/g, (_m, lead: string, body: string) =>
    /\p{L}/u.test(body) ? `${lead}[T]${body}` : `${lead}${body}`,
  );
}
