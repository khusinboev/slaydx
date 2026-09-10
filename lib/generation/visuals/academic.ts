import { LAYOUT_KIT, type Box, type PlanCtx, type SlideLayer, type SlidePlan } from "../slide-layout";
import type { SlideModel, SlideTheme } from "../slide-types";
import type { VisualSpec } from "./spec";

/**
 * «Akademik» dizayni — universitet ma'ruzasi («Ma'ruza» shabloni, `atlas`).
 *
 * Naqsh: yorug' sahifa, yuqorida ingichka aksent tasma, matn USTUNI chapda,
 * rasm o'ngda YUMSHOQ BURCHAKLI kartada (surface matisa + ichkariga surilgan
 * kadr). Bo'lim slaydida rasm YO'Q — uning o'rnida yirik dekorativ raqam va
 * tik aksent chizig'i. Bandlar `surface` kartasida, chap chetida aksent
 * chizig'i. Iqtibos — serif (Georgia), markazda. Yakun — to'q sahifa,
 * ingichka ramka va pastda kadr tasmasi.
 *
 * Ranglar: yorug' sahifada faqat `text`/`muted`/`accentInk`, to'q sahifada
 * `titleText`/`titleMuted`; `accent`/`accent2` — faqat to'ldirish.
 */

/** Titul kartasi (matisa) va uning ichidagi kadr. */
const TITLE_CARD: Box = { x: 8.05, y: 1.25, w: 4.75, h: 5.0 };
const TITLE_PHOTO: Box = { x: 8.23, y: 1.43, w: 4.39, h: 4.64 };
/** Bandlar slaydidagi o'ng karta va kadr. */
const BULLETS_CARD: Box = { x: 8.5, y: 1.9, w: 4.3, h: 4.4 };
const BULLETS_PHOTO: Box = { x: 8.66, y: 2.06, w: 3.98, h: 4.08 };
/** Yakun slaydidagi pastki kadr tasmasi. */
const CLOSING_PHOTO: Box = { x: 0.75, y: 5.05, w: 11.83, h: 1.45 };

const TEXT_X = 0.8;
/** Kontent zonasi kengligi (chekkalar 0.8 / 12.53). */
const ZONE_W = 11.73;

/** Sarlavha + ikki qatlamli aksent tagchizig'i — bandlar va reja uchun bitta naqsh. */
function pushAcademicHead(
  layers: SlideLayer[],
  s: SlideModel,
  theme: SlideTheme,
  reserve: number,
): void {
  const { fitSize } = LAYOUT_KIT;
  const headBox: Box = { x: TEXT_X, y: 0.52, w: Math.max(3, ZONE_W - reserve), h: 0.82 };
  layers.push({
    t: "text",
    box: headBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, headBox, 26, 16),
    bold: true,
    src: { f: "title" },
  });
  // Ingichka to'la kenglikdagi chiziq + uning ustida qisqa qalin bo'lak.
  layers.push({ t: "rect", box: { x: TEXT_X, y: 1.42, w: ZONE_W, h: 0.016 }, fill: { color: theme.accent, alpha: 0.45 } });
  layers.push({ t: "rect", box: { x: TEXT_X, y: 1.4, w: 1.6, h: 0.055 }, fill: { color: theme.accent } });
}

function planTitle(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, pushFooter, photo, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  // Sahifa boshidagi aksent tasma — butun oilaning imzosi.
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: 0.16 }, fill: { color: theme.accent } });

  const tw = 6.9;
  // Rukn: kichik aksent kvadrat + kichik matn.
  layers.push({ t: "rect", box: { x: TEXT_X, y: 1.98, w: 0.19, h: 0.19 }, fill: { color: theme.accent } });
  if (s.kicker) {
    layers.push({
      t: "text",
      box: { x: TEXT_X + 0.36, y: 1.86, w: tw - 0.36, h: 0.4 },
      text: s.kicker,
      color: theme.accentInk,
      size: 13,
      bold: true,
      uppercase: true,
      tracking: 2,
      valign: "middle",
      src: { f: "kicker" },
    });
  }
  const titleBox: Box = { x: TEXT_X, y: 2.45, w: tw, h: 2.1 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 36, 22),
    bold: true,
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: TEXT_X, y: 4.7, w: 1.5, h: 0.06 }, fill: { color: theme.accent } });
  if (s.subtitle) {
    const subBox: Box = { x: TEXT_X, y: 4.95, w: tw, h: 1.4 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 18, 12),
      src: { f: "subtitle" },
    });
  }

  // O'ng karta: matisa (rasmdan kattaroq) + ichkariga surilgan kadr.
  layers.push({ t: "rect", box: { ...TITLE_CARD }, fill: { color: theme.surface }, radius: 0.18, shadow: true });
  if (s.image?.url) {
    photo(layers, s.image.url, { ...TITLE_PHOTO }, 0);
  } else {
    // Rasmsiz karta bo'sh qolmasin: «kitob javoni» — turli balandlikdagi ustunlar.
    const bars = [1.6, 2.45, 1.15, 2.05];
    const alphas = [1, 0.72, 0.45, 0.85];
    bars.forEach((bh, i) => {
      layers.push({
        t: "rect",
        box: { x: 8.62 + i * 1.05, y: 5.25 - bh, w: 0.72, h: bh },
        fill: { color: theme.accent, alpha: alphas[i] },
        radius: 0.04,
      });
    });
    layers.push({ t: "rect", box: { x: 8.62, y: 5.32, w: 3.61, h: 0.05 }, fill: { color: theme.accent, alpha: 0.55 } });
  }
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: tw }, false);
  return { bg: theme.bg, layers };
}

function planSection(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, inkHeight, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });

  const x = 4.65;
  const tw = 8.05;
  const top = 1.6;
  const bottom = 5.9;
  const titleSize = fitSize(s.title, { x, y: 0, w: tw, h: 2.4 }, 40, 24);
  const subSize = s.subtitle ? fitSize(s.subtitle, { x, y: 0, w: tw, h: 1.7 }, 19, 13) : 0;
  const avail = bottom - top - (s.subtitle ? 0.32 : 0);
  const titleH = Math.min(avail * (s.subtitle ? 0.62 : 1), Math.max(0.6, inkHeight(s.title, tw, titleSize)));
  const subH = s.subtitle ? Math.min(avail - titleH, Math.max(0.34, inkHeight(s.subtitle, tw, subSize))) : 0;
  const blockH = titleH + (s.subtitle ? 0.32 + subH : 0);
  const y0 = top + Math.max(0, (bottom - top - blockH) / 2);

  /*
   * Yirik dekorativ raqam va tik chiziq BLOK bilan bir qatorga tushadi —
   * qat'iy koordinatalarda ular matndan mustaqil «suzib» yurardi.
   * `accent` yorug' sahifada matn rangi sifatida o'lchanmagan (atlas
   * oltini deyarli o'qilmaydi), shuning uchun `accentInk`. Raqam
   * modeldan emas — `src` YO'Q.
   */
  const ruleTop = Math.max(1.2, y0 - 0.45);
  const ruleBottom = Math.min(6.3, y0 + blockH + 0.45);
  layers.push({ t: "rect", box: { x: 4.15, y: ruleTop, w: 0.07, h: ruleBottom - ruleTop }, fill: { color: theme.accent } });
  const numH = 2.2;
  const numY = Math.max(0.3, Math.min(H - numH - 0.9, (ruleTop + ruleBottom) / 2 - numH / 2));
  layers.push({
    t: "text",
    box: { x: 0.72, y: numY, w: 3.1, h: numH },
    text: String(index + 1).padStart(2, "0"),
    color: theme.accentInk,
    size: 110,
    bold: true,
    valign: "middle",
  });
  layers.push({
    t: "text",
    box: { x, y: y0, w: tw, h: titleH },
    text: s.title,
    color: theme.text,
    size: titleSize,
    bold: true,
    src: { f: "title" },
  });
  if (s.subtitle) {
    layers.push({
      t: "text",
      box: { x, y: y0 + titleH + 0.32, w: tw, h: subH },
      text: s.subtitle,
      color: theme.muted,
      size: subSize,
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, false);
  return { bg: theme.bg, layers };
}

function planBullets(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { fitLines, bulletGap, pushFooter, photo, W, H, BULLET_GAP_MIN } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushAcademicHead(layers, s, theme, ctx.reserve);

  const img = s.image?.url;
  const cardW = img ? 7.3 : ZONE_W;
  const card: Box = { x: TEXT_X, y: 1.9, w: cardW, h: 4.95 };
  layers.push({ t: "rect", box: { ...card }, fill: { color: theme.surface }, radius: 0.14, shadow: true });
  // Kartaning chap chetidagi aksent chizig'i — «konspekt hoshiyasi».
  layers.push({ t: "rect", box: { x: card.x, y: card.y, w: 0.1, h: card.h }, fill: { color: theme.accent } });

  const items = (s.bullets ?? []).slice(0, ctx.bodyType.maxBullets);
  if (items.length) {
    const box: Box = { x: card.x + 0.58, y: card.y + 0.3, w: card.w - 0.98, h: card.h - 0.6 };
    const size = fitLines(items, box, ctx.bodyType.bodyPt, ctx.bodyType.minPt, BULLET_GAP_MIN);
    layers.push({
      t: "text",
      box,
      lines: items,
      bullets: true,
      color: theme.text,
      size,
      paraSpace: bulletGap(items, box, size),
      valign: "middle",
      srcLines: items.map((_, i) => ({ f: "bullets", i })),
    });
  }
  if (img) {
    layers.push({ t: "rect", box: { ...BULLETS_CARD }, fill: { color: theme.surface }, radius: 0.18, shadow: true });
    photo(layers, img, { ...BULLETS_PHOTO }, 0);
  }
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, false);
  return { bg: theme.bg, layers };
}

function planAgenda(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { fitSize, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushAcademicHead(layers, s, theme, ctx.reserve);

  const items = (s.bullets ?? []).slice(0, ctx.bodyType.agendaMax);
  const top = 1.9;
  const zoneH = 4.95;
  const rowH = zoneH / Math.max(1, items.length);
  items.forEach((line, i) => {
    const y = top + i * rowH;
    const side = Math.max(0.3, Math.min(0.56, rowH - 0.22));
    const sq: Box = { x: TEXT_X, y: y + (rowH - side) / 2, w: side, h: side };
    // Aksent konturli kvadrat, ichida raqam (dekorativ — `src` yo'q).
    layers.push({ t: "rect", box: { ...sq }, line: { color: theme.accent, width: 1.5 }, radius: 0.04 });
    layers.push({
      t: "text",
      box: { ...sq },
      text: String(i + 1),
      color: theme.accentInk,
      size: 15,
      bold: true,
      align: "center",
      valign: "middle",
    });
    const lineBox: Box = { x: TEXT_X + side + 0.42, y, w: ZONE_W - side - 0.42, h: rowH - 0.14 };
    layers.push({
      t: "text",
      box: lineBox,
      text: line,
      color: theme.text,
      size: fitSize(line, lineBox, ctx.bodyType.bodyPt, ctx.bodyType.minPt - 1),
      valign: "middle",
      src: { f: "bullets", i },
    });
    layers.push({
      t: "rect",
      box: { x: TEXT_X, y: y + rowH - 0.03, w: ZONE_W, h: 0.012 },
      fill: { color: theme.accent, alpha: 0.3 },
    });
  });
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, false);
  return { bg: theme.bg, layers };
}

function planQuote(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, inkHeight, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: 0.16 }, fill: { color: theme.accent } });

  /*
   * Blok SIYOH balandligi bo'yicha yig'iladi va zonada markazlashtiriladi:
   * qat'iy koordinatalar qisqa iqtibosda matn bilan muallif orasida bir
   * dyuymlik bo'sh joy qoldirardi (PDF da ko'rindi).
   */
  const text = s.quote || s.title;
  const tw = W - 3.8;
  const qBox: Box = { x: 1.9, y: 0, w: tw, h: 2.6 };
  const qSize = fitSize(text, qBox, 30, 18);
  const qH = Math.min(qBox.h, Math.max(0.5, inkHeight(text, tw, qSize)));
  const byH = s.quoteBy ? 0.45 : 0;
  const blockH = 0.06 + 0.42 + qH + (s.quoteBy ? 0.46 + byH + 0.34 + 0.016 : 0);
  const y0 = 1.5 + Math.max(0, (5.9 - 1.5 - blockH) / 2);
  layers.push({ t: "rect", box: { x: (W - 1.8) / 2, y: y0, w: 1.8, h: 0.06 }, fill: { color: theme.accent } });
  layers.push({
    t: "text",
    box: { x: 1.9, y: y0 + 0.48, w: tw, h: qH },
    text,
    color: theme.text,
    size: qSize,
    align: "center",
    font: "Georgia",
    src: { f: "quote" },
  });
  if (s.quoteBy) {
    layers.push({
      t: "text",
      box: { x: 1.9, y: y0 + 0.48 + qH + 0.46, w: tw, h: byH },
      text: s.quoteBy,
      color: theme.muted,
      size: 14,
      uppercase: true,
      tracking: 1.6,
      align: "center",
      src: { f: "quoteBy" },
    });
    layers.push({
      t: "rect",
      box: { x: (W - 1.8) / 2, y: y0 + 0.48 + qH + 0.46 + byH + 0.34, w: 1.8, h: 0.016 },
      fill: { color: theme.accent, alpha: 0.5 },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, false);
  return { bg: theme.bg, layers };
}

function planClosing(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, pushFooter, photo, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.titleBg } });
  // Ingichka ramka — kolontituldan yuqorida tugaydi.
  layers.push({
    t: "rect",
    box: { x: 0.45, y: 0.45, w: W - 0.9, h: 6.35 },
    line: { color: theme.accent, width: 1.25 },
  });
  layers.push({ t: "rect", box: { x: (W - 0.22) / 2, y: 1.15, w: 0.22, h: 0.22 }, fill: { color: theme.accent } });

  const titleBox: Box = { x: 1.6, y: 1.65, w: W - 3.2, h: 1.5 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.titleText,
    size: fitSize(s.title, titleBox, 40, 24),
    bold: true,
    align: "center",
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: (W - 1.6) / 2, y: 3.32, w: 1.6, h: 0.06 }, fill: { color: theme.accent } });
  if (s.subtitle) {
    const subBox: Box = { x: 2.2, y: 3.64, w: W - 4.4, h: 1.05 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.titleMuted,
      size: fitSize(s.subtitle, subBox, 18, 12),
      align: "center",
      src: { f: "subtitle" },
    });
  }
  // Pastki kadr tasmasi — rasm bo'lmasa aksent tasma bo'lib qoladi.
  layers.push({ t: "rect", box: { ...CLOSING_PHOTO }, fill: { color: theme.accent, alpha: 0.18 } });
  photo(layers, s.image?.url, { ...CLOSING_PHOTO }, 0.12);
  pushFooter(layers, s, theme, index, total, { x: CLOSING_PHOTO.x, w: CLOSING_PHOTO.w }, true);
  return { bg: theme.titleBg, layers };
}

export const academicVisual: VisualSpec = {
  id: "academic",
  base: "classic",
  photo: {
    title: { ...TITLE_PHOTO },
    section: null,
    bullets: { ...BULLETS_PHOTO },
    agenda: null,
    quote: null,
    closing: { ...CLOSING_PHOTO },
  },
  plan: {
    title: (s, theme, index, total) => planTitle(s, theme, index, total),
    section: (s, theme, index, total) => planSection(s, theme, index, total),
    bullets: (s, theme, index, total, ctx) => planBullets(s, theme, index, total, ctx),
    agenda: (s, theme, index, total, ctx) => planAgenda(s, theme, index, total, ctx),
    quote: (s, theme, index, total) => planQuote(s, theme, index, total),
    closing: (s, theme, index, total) => planClosing(s, theme, index, total),
  },
};
