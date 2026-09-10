import {
  AlignmentType,
  BorderStyle,
  HeightRule,
  ImageRun,
  LineRuleType,
  Paragraph,
  ShadingType,
  Tab,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { contentHeight, type DocProfile } from "../docx-profile";
import { cleanText } from "../quality";
import type { ImageBytes } from "../slide-images";
import { RESUME_PAD_MM } from "../../viewers/metrics";
import { planResume, type ResumeItem, type ResumeLayout, type ResumeZoneId } from "./layout";
import type { ResumeModel } from "./model";
import type { ResumePalette, ResumeTemplate } from "./templates";

/**
 * Rezyume DOCX — YAGONA MANBADAN («ko'rdim = oldim»).
 *
 * Bu modul o'z maket mantiqini YOZMAYDI: `planResume` bergan zonalar va
 * itemlarni AYNAN o'sha tartibda chizadi. Sayt ko'ruvchisi
 * (`components/viewers/resume/ResumePage.tsx`) ham xuddi shu rejadan
 * chizadi, shuning uchun ikkalasining matn ketma-ketligi bir xil bo'ladi
 * — `tests/viewer/resume-parity.test.mts` shuni qulflaydi.
 *
 * Eski `resumeBody` (72 mm qat'iy qora panel, to'rt bo'lim) shu bilan
 * o'chdi: u shablon ham, palitra ham, surat ham bilmasdi va ko'ruvchi
 * bilan alohida yozilgan edi — ya'ni aynan `CLAUDE.md` ogohlantirgan
 * «ekranda bitta xil, faylda boshqa xil» naqshining o'zi.
 *
 * BIR NECHTA MUHIM QOIDA:
 *
 *   • Sarlavha BOSH HARFGA `allCaps` bilan o'tadi, `toUpperCase()` bilan
 *     EMAS — aks holda `<w:t>` matni ko'ruvchidagi (CSS `text-transform`)
 *     matndan farq qilib, paritet buzilardi.
 *   • Ko'rinadigan ajratgich («•», « — ») yozilmaydi: nuqta ro'yxat
 *     raqamlagichidan, kalit/qiymat oralig'i esa TABULATSIYADAN keladi —
 *     ikkalasi ham `<w:t>` hosil qilmaydi.
 *   • Bayt bo'lmasa surat runi UMUMAN qo'shilmaydi va xato TASHLANMAYDI:
 *     rezyume rasm tufayli yiqilmasligi kerak.
 */

export type ResumeDocxOpts = {
  /** Aktiv URL → bayt (tahrirdan keyingi qayta render). `render-pptx` bilan bitta shartnoma. */
  resolveImage?: (url: string) => Promise<ImageBytes | null>;
};

/** 1 mm = 56.7 twip (DXA). */
const MM = 56.7;
const twip = (mm: number) => Math.round(mm * MM);
const hp = (pt: number) => Math.round(pt * 2);
/** mm → piksel (96 dpi); `docx` uni 9525 EMU ga ko'paytiradi → mm × 36 000. */
const px = (mm: number) => Math.round((mm / 25.4) * 96);

const NONE = { style: BorderStyle.NONE, size: 0, color: "auto" } as const;
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };

/* ────────────────────────── surat ────────────────────────── */

const DATA_IMG = /^data:image\/(png|jpe?g);base64,/i;

/** `data:` URL yoki `ImageBytes.data` («image/png;base64,…») → xom bayt. */
function bytesOf(data: string): Buffer {
  const i = data.indexOf("base64,");
  return Buffer.from(i >= 0 ? data.slice(i + 7) : data, "base64");
}

function fromDataUrl(url: string): ImageBytes | null {
  const m = DATA_IMG.exec(url);
  if (!m) return null;
  return { data: url, type: m[1].toLowerCase() === "png" ? "png" : "jpg" };
}

/**
 * Surat runi. Tartib `render-pptx.ts` dagi bilan bir xil: AVVAL
 * `resolveImage` (saqlangan aktiv), keyin `data:` (yaratish vaqti).
 * Tashqi `https:` URL ATAYIN yuklanmaydi — rezyume surati foydalanuvchi
 * aktivi, SSRF yo'li ochilmasin.
 */
async function photoRun(url: string, sizeMm: number, opts: ResumeDocxOpts): Promise<ImageRun | null> {
  if (!url) return null;
  const img = (opts.resolveImage ? await opts.resolveImage(url).catch(() => null) : null) ?? fromDataUrl(url);
  if (!img) return null;
  const data = bytesOf(img.data);
  if (!data.byteLength) return null;
  const side = px(sizeMm);
  /*
   * Doira surat KESILGAN holda keladi (klient shaffof PNG yasaydi) —
   * `ImageRun` doim kvadrat, DOCX da doira niqob yo'q.
   */
  return new ImageRun({ type: img.type === "png" ? "png" : "jpg", data, transformation: { width: side, height: side } });
}

/* ────────────────────────── chizish konteksti ────────────────────────── */

type Draw = {
  t: ResumeTemplate;
  P: ResumePalette;
  /** To'q fon ustida (panel/banner) — matn ranglari almashadi. */
  dark: boolean;
  /** Zona ichidagi foydali kenglik (twip) — tabulatsiya to'xtashi uchun. */
  width: number;
  /** Bir ustunli oqimda chap/o'ng chekinish (banner: 18 mm). */
  indent: number;
  photo: ImageRun | null;
};

function colors(d: Draw) {
  return {
    ink: d.dark ? d.P.onDark : d.P.ink,
    muted: d.dark ? d.P.accentSoft : d.P.muted,
    accent: d.dark ? d.P.accentSoft : d.P.accent,
  };
}

type RunOpts = { size?: number; bold?: boolean; color?: string; caps?: boolean; fill?: string };

function run(d: Draw, text: string, o: RunOpts = {}): TextRun {
  return new TextRun({
    text: cleanText(text),
    font: d.t.type.font,
    size: hp(o.size ?? d.t.type.body),
    ...(o.bold ? { bold: true } : {}),
    ...(o.color ? { color: o.color } : {}),
    ...(o.caps ? { allCaps: true } : {}),
    ...(o.fill ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: o.fill } } : {}),
  });
}

/**
 * Qator oralig'i — DOIM `lineRule: auto`.
 *
 * `w:lineRule` berilmasa LibreOffice `w:line` ni QAT'IY balandlik deb
 * o'qiydi va matn qatoriga sig'magan hamma narsani — birinchi navbatda
 * SURATNI — siqib qo'yadi: 36 mm li surat ~5 mm lik tasmaga aylanardi
 * (LibreOffice ko'zdan kechiruvida topilgan).
 */
function spacing(d: Draw, over: Record<string, unknown> = {}) {
  return { line: Math.round(240 * d.t.type.line), after: 60, ...over, lineRule: LineRuleType.AUTO };
}

/** Tabulatsiya RUN ICHIDA bo'lishi shart — yalang'och `Tab` XML ga chiqmaydi. */
function tab(d: Draw): TextRun {
  return new TextRun({ children: [new Tab()], font: d.t.type.font, size: hp(d.t.type.small) });
}

/** Har paragrafga zonaning chekinishi va qator oralig'i beriladi. */
function para(d: Draw, children: (TextRun | ImageRun)[], extra: Record<string, unknown> = {}): Paragraph {
  const { spacing: over, ...rest } = extra as { spacing?: Record<string, unknown> };
  return new Paragraph({
    ...(d.indent ? { indent: { left: d.indent, right: d.indent } } : {}),
    ...rest,
    spacing: spacing(d, over),
    children,
  });
}

/* ────────────────────────── bo'lim sarlavhasi ────────────────────────── */

function headingParagraph(d: Draw, text: string): Paragraph {
  const c = colors(d);
  const base = {
    spacing: spacing(d, { before: twip(4), after: twip(1.5) }),
    ...(d.indent ? { indent: { left: d.indent, right: d.indent } } : {}),
  };
  const label = (caps: boolean) => run(d, text, { size: d.t.type.h2, bold: true, color: c.accent, caps });

  switch (d.t.heading) {
    case "caps":
      return new Paragraph({ ...base, children: [label(true)] });
    case "hairline":
      // Ingichka (0.25 pt) chiziq — ko'ruvchidagi `border-bottom: 0.2mm`.
      return new Paragraph({
        ...base,
        border: { bottom: { style: BorderStyle.SINGLE, size: 2, space: 2, color: c.muted } },
        children: [label(true)],
      });
    case "block":
      // Bo'yalgan blok + chapdagi aksent chizig'i (creative).
      return new Paragraph({
        ...base,
        shading: { type: ShadingType.CLEAR, color: "auto", fill: d.P.panel },
        border: { left: { style: BorderStyle.SINGLE, size: 18, space: 6, color: c.accent } },
        indent: { left: (d.indent || 0) + twip(2), right: d.indent || 0 },
        children: [label(true)],
      });
    default:
      // `rule` — sarlavha ostidagi aksent chizig'i (modern, twocol).
      return new Paragraph({
        ...base,
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, space: 2, color: c.accent } },
        children: [label(false)],
      });
  }
}

/* ────────────────────────── itemlar ────────────────────────── */

function drawItem(d: Draw, it: ResumeItem): Array<Paragraph | Table> {
  const c = colors(d);
  switch (it.k) {
    case "photo":
      return d.photo ? [para(d, [d.photo], { spacing: { after: twip(3) } })] : [];
    case "name":
      return it.text
        ? [para(d, [run(d, it.text, { size: d.t.type.h1, bold: true, color: c.ink })], { spacing: { after: twip(1.5), line: 240 } })]
        : [];
    case "headline":
      return it.text ? [para(d, [run(d, it.text, { color: c.accent })], { spacing: { after: twip(2) } })] : [];
    case "h2":
      return [headingParagraph(d, it.text)];
    case "p":
      return it.text
        ? [
            para(d, [run(d, it.text, { color: c.ink })], {
              alignment: AlignmentType.LEFT,
              spacing: { after: twip(2) },
            }),
          ]
        : [];
    case "row": {
      const out: Paragraph[] = [];
      const head: TextRun[] = [];
      if (it.title) head.push(run(d, it.title, { bold: true, color: c.ink }));
      if (it.period) {
        // Tabulatsiya `<w:tab/>` beradi — MATN TUGUNI hosil qilmaydi.
        if (head.length) head.push(tab(d));
        head.push(run(d, it.period, { size: d.t.type.small, color: c.muted }));
      }
      if (head.length) {
        out.push(
          para(d, head, {
            tabStops: [{ type: TabStopType.RIGHT, position: (d.indent || 0) + d.width - 20 }],
            spacing: { before: twip(1.5), after: 0 },
          }),
        );
      }
      if (it.sub) out.push(para(d, [run(d, it.sub, { size: d.t.type.small, color: c.muted })], { spacing: { after: twip(1) } }));
      return out;
    }
    case "li":
      return it.text
        ? [
            new Paragraph({
              bullet: { level: 0 },
              spacing: spacing(d, { after: twip(1) }),
              ...(d.indent ? { indent: { left: d.indent + twip(5), right: d.indent } } : {}),
              children: [run(d, it.text, { color: c.ink })],
            }),
          ]
        : [];
    case "kv": {
      const children: TextRun[] = [run(d, it.key, { size: d.t.type.small, color: c.ink })];
      if (it.val) {
        children.push(tab(d), run(d, it.val, { size: d.t.type.small, color: c.muted }));
      }
      return [
        para(d, children, {
          tabStops: [{ type: TabStopType.RIGHT, position: (d.indent || 0) + d.width - 20 }],
          spacing: { after: twip(1) },
        }),
      ];
    }
    case "chips": {
      if (!it.items.length) return [];
      const children: TextRun[] = [];
      it.items.forEach((s, i) => {
        // Ajratgich — FAQAT bo'sh joy: paritet testi bo'sh matn tugunlarini
        // hisobga olmaydi, ko'ruvchi esa oraliqni `gap` bilan beradi.
        if (i) children.push(new TextRun({ text: "  ", font: d.t.type.font, size: hp(d.t.type.small) }));
        // Ochiq fonda `panel` deyarli oq — LibreOffice ko'zdan kechiruvida
        // "chip" umuman ko'rinmasdi; `accentSoft` ikkala tomonda ham ajralib turadi.
        children.push(run(d, s.text, { size: d.t.type.small, color: d.dark ? d.P.onDark : d.P.ink, fill: d.dark ? d.P.accent : d.P.accentSoft }));
      });
      return [para(d, children, { spacing: { after: twip(2) } })];
    }
    case "contact":
      return it.lines
        .filter((l) => l.text)
        .map((l) => para(d, [run(d, l.text, { size: d.t.type.small, color: d.dark ? d.P.onDark : d.P.muted })], { spacing: { after: twip(1) } }));
    default:
      return [];
  }
}

function drawItems(d: Draw, items: ResumeItem[]): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  for (const it of items) out.push(...drawItem(d, it));
  return out;
}

function zoneItems(layout: ResumeLayout, id: ResumeZoneId): ResumeItem[] {
  return layout.zones.find((z) => z.id === id)?.items ?? [];
}

/* ────────────────────────── katak/jadval ────────────────────────── */

function cell(widthTwip: number, children: Array<Paragraph | Table>, o: { fill?: string; padXmm: number; padYmm: number }): TableCell {
  return new TableCell({
    borders: NO_BORDERS,
    width: { size: widthTwip, type: WidthType.DXA },
    ...(o.fill ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: o.fill } } : {}),
    margins: { top: twip(o.padYmm), bottom: twip(o.padYmm), left: twip(o.padXmm), right: twip(o.padXmm) },
    verticalAlign: VerticalAlign.TOP,
    children: children.length ? children : [new Paragraph({ children: [] })],
  });
}

/**
 * Chegarasiz ikki ustunli jadval — `docx` da haqiqiy ustun oqimi
 * (`column`) butun bo'limga tegadi va matnning qaysi ustunga tushishini
 * boshqarib bo'lmaydi. Jadval esa Word va LibreOffice ikkalasida ham bir
 * xil chiziladi (eski `resumeBody` dagi asoslanish shu, u saqlanadi).
 *
 * Qator balandligi `ATLEAST` + `contentHeight(P)`: panel qisqa mazmunda
 * ham varaqni to'ldiradi, uzunida esa keyingi varaqqa cho'ziladi.
 */
function twoColumn(cells: TableCell[], widths: number[], total: number, P: DocProfile): Table {
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE },
    rows: [new TableRow({ height: { value: contentHeight(P), rule: HeightRule.ATLEAST }, children: cells })],
  });
}

/* ────────────────────────── kirish nuqtasi ────────────────────────── */

type Kit = { CONTENT_W: number };

/**
 * `planResume(model)` dan DOCX bloklarini yasaydi.
 *
 * `K` — `makeKit` natijasi (`CONTENT_W` uchun), `P` — `resumeProfile`
 * bergan profil (sahifa chegarasi va balandligi shu yerdan).
 */
export async function renderResumeDocx(
  model: ResumeModel,
  K: Kit,
  P: DocProfile,
  opts: ResumeDocxOpts = {},
): Promise<Array<Paragraph | Table>> {
  const layout = planResume(model);
  const t = layout.template;
  const photoItem = layout.zones.flatMap((z) => z.items).find((it) => it.k === "photo");
  const photo = photoItem && photoItem.k === "photo" ? await photoRun(photoItem.url, photoItem.sizeMm, opts) : null;

  const base: Omit<Draw, "width" | "dark" | "indent"> = { t, P: layout.palette, photo };
  const CONTENT_W = K.CONTENT_W;

  if (t.columns === "sidebar-left" || t.columns === "sidebar-right") {
    const asideW = twip(layout.asideWidthMm);
    const mainW = CONTENT_W - asideW;
    const asideD: Draw = { ...base, dark: t.darkAside, indent: 0, width: asideW - twip(RESUME_PAD_MM.aside.x * 2) };
    const mainD: Draw = { ...base, dark: false, indent: 0, width: mainW - twip(RESUME_PAD_MM.mainSide.x * 2) };
    const asideCell = cell(asideW, drawItems(asideD, zoneItems(layout, "aside")), {
      fill: t.darkAside ? layout.palette.dark : layout.palette.panel,
      padXmm: RESUME_PAD_MM.aside.x,
      padYmm: RESUME_PAD_MM.aside.y,
    });
    const mainCell = cell(mainW, drawItems(mainD, zoneItems(layout, "main")), {
      padXmm: RESUME_PAD_MM.mainSide.x,
      padYmm: RESUME_PAD_MM.mainSide.y,
    });
    const left = t.columns === "sidebar-left";
    return [
      twoColumn(
        left ? [asideCell, mainCell] : [mainCell, asideCell],
        left ? [asideW, mainW] : [mainW, asideW],
        CONTENT_W,
        P,
      ),
    ];
  }

  if (t.columns === "banner") {
    /*
     * Banner varaq CHETIGA tegib turadi (ko'ruvchida ham — manfiy
     * chekinish bilan), shuning uchun `resumeProfile` bannerli shablonda
     * sahifaning chap/o'ng chegarasini 0 qiladi va matn oqimi chekinishni
     * paragrafning o'zidan (`indent`) oladi.
     */
    const indent = twip(t.marginsMm.left);
    const bannerD: Draw = { ...base, dark: t.darkAside, indent: 0, width: CONTENT_W - twip(RESUME_PAD_MM.banner.x * 2) };
    const headerItems = zoneItems(layout, "header");
    const textItems = headerItems.filter((it) => it.k !== "photo");
    const photoItems = headerItems.filter((it) => it.k === "photo");

    let inner: Array<Paragraph | Table>;
    if (photo && photoItems.length) {
      // Surat va matn yonma-yon — ichki ikki ustunli jadval.
      const pw = twip(t.photo.sizeMm + 6);
      const tw = CONTENT_W - twip(RESUME_PAD_MM.banner.x * 2) - pw;
      const innerD: Draw = { ...bannerD, width: tw };
      inner = [
        new Table({
          width: { size: pw + tw, type: WidthType.DXA },
          columnWidths: [pw, tw],
          layout: TableLayoutType.FIXED,
          borders: { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE },
          rows: [
            new TableRow({
              children: [
                cell(pw, drawItems(innerD, photoItems), { padXmm: 0, padYmm: 0 }),
                cell(tw, drawItems(innerD, textItems), { padXmm: 2, padYmm: 0 }),
              ],
            }),
          ],
        }),
      ];
    } else {
      inner = drawItems(bannerD, textItems);
    }

    const bannerTable = new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: [CONTENT_W],
      layout: TableLayoutType.FIXED,
      borders: { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE },
      rows: [
        new TableRow({
          height: { value: twip(t.bannerMm), rule: HeightRule.ATLEAST },
          children: [
            cell(CONTENT_W, inner, {
              fill: t.darkAside ? layout.palette.dark : layout.palette.panel,
              padXmm: RESUME_PAD_MM.banner.x,
              padYmm: RESUME_PAD_MM.banner.y,
            }),
          ],
        }),
      ],
    });

    const mainD: Draw = { ...base, dark: false, indent, width: CONTENT_W - indent * 2 };
    return [bannerTable, new Paragraph({ spacing: { after: twip(RESUME_PAD_MM.bannerGap) }, children: [] }), ...drawItems(mainD, zoneItems(layout, "main"))];
  }

  // `single` — oddiy paragraf oqimi (classic, minimal, creative).
  const d: Draw = { ...base, dark: false, indent: 0, width: CONTENT_W };
  return [...drawItems(d, zoneItems(layout, "header")), ...drawItems(d, zoneItems(layout, "main"))];
}
