import { fetchImageBytes, type ImageBytes } from "./slide-images";
import { planSlide, PPTX_FONT, slideNotes, SLIDE_IN, type SlideLayer, type SlidePlan } from "./slide-layout";
import { buildSlideDeck } from "./slides";
import { getSlideTheme } from "./slide-themes";
import type { AcademicDoc, BuiltFile } from "./types";
import { BRAND_SHORT } from "../brand";

const W = SLIDE_IN.w;
const H = SLIDE_IN.h;

function hx(c: string) {
  return c.replace("#", "");
}

type PptxSlide = {
  addShape: (name: string, opts: Record<string, unknown>) => void;
  addText: (text: unknown, opts: Record<string, unknown>) => void;
  addImage?: (opts: Record<string, unknown>) => void;
  addNotes?: (text: string) => void;
};

/**
 * Rasm keshi — har bir render uchun alohida.
 * Ilgari modul darajasida edi: parallel so'rovlar bir-birining keshini
 * tozalab yuborardi va oxirgi renderning megabaytlari xotirada qolib ketardi.
 */
type ImageCache = Map<string, ImageBytes | null>;

/**
 * `opts.resolveImage` — tahrirdan keyingi qayta render uchun: saqlangan
 * `doc_json` dagi rasm URL'lari `/api/generations/…/assets/…` (aktiv),
 * `fetchImageBytes` esa faqat `data:`/`https:` ni tushunadi. Berilgan
 * bo'lsa AVVAL shu chaqiriladi, `null` qaytsa (begona/nomos URL) odatdagi
 * yo'lga (`fetchImageBytes`) qaytiladi.
 */
async function loadImage(
  cache: ImageCache,
  url: string,
  resolveImage?: (url: string) => Promise<ImageBytes | null>,
): Promise<ImageBytes | null> {
  const hit = cache.get(url);
  if (hit !== undefined) return hit;
  const img = (resolveImage ? await resolveImage(url) : null) ?? (await fetchImageBytes(url));
  cache.set(url, img);
  return img;
}

async function paintPlan(
  slide: PptxSlide,
  plan: SlidePlan,
  cache: ImageCache,
  resolveImage?: (url: string) => Promise<ImageBytes | null>,
) {
  slide.addShape("rect", { x: 0, y: 0, w: W, h: H, fill: { color: hx(plan.bg) } });
  for (const layer of plan.layers) {
    await paintLayer(slide, layer, cache, resolveImage);
  }
}

async function paintLayer(
  slide: PptxSlide,
  layer: SlideLayer,
  cache: ImageCache,
  resolveImage?: (url: string) => Promise<ImageBytes | null>,
) {
  if (layer.t === "rect") {
    const fill = layer.fill
      ? {
          color: hx(layer.fill.color),
          transparency: layer.fill.alpha == null ? 0 : Math.round((1 - layer.fill.alpha) * 100),
        }
      : undefined;
    slide.addShape(layer.radius ? "roundRect" : "rect", {
      x: layer.box.x,
      y: layer.box.y,
      w: layer.box.w,
      h: layer.box.h,
      fill: fill ?? { type: "none" },
      line: layer.line ? { color: hx(layer.line.color), width: layer.line.width } : { type: "none" },
      ...(layer.radius ? { rectRadius: layer.radius } : {}),
      // Ko'ruvchi bilan bir xil yumshoq soya (`SlideCanvas` `box-shadow`).
      ...(layer.shadow ? { shadow: { type: "outer", blur: 6, offset: 2, angle: 90, color: "000000", opacity: 0.22 } } : {}),
    });
    return;
  }
  if (layer.t === "image") {
    if (!slide.addImage) return;
    const img = await loadImage(cache, layer.url, resolveImage);
    if (!img) return;
    const box = layer.box;
    slide.addImage({
      data: img.data,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      // `fit` ko'ruvchi bilan BIR XIL o'qiladi (`SlideCanvas` `objectFit`) — logo `contain`.
      sizing: { type: layer.fit ?? "cover", w: box.w, h: box.h },
      // Dumaloq rasm — ko'ruvchida `border-radius: 50%`.
      ...(layer.shape === "circle" ? { rounding: true } : {}),
    });
    return;
  }
  // `uppercase` — matnga ham, ro'yxat bandlariga ham (sayt ko'ruvchisi
  // CSS `text-transform` bilan ikkalasini ham o'zgartiradi).
  const up = (s: string) => (layer.uppercase ? s.toUpperCase() : s);
  const raw = up(layer.text || "");
  const payload = layer.lines
    ? layer.lines.map((line) => ({ text: up(line), options: { bullet: Boolean(layer.bullets), breakLine: true } }))
    : raw || "";
  if (Array.isArray(payload) ? payload.length === 0 : !payload) return;
  slide.addText(payload, {
    x: layer.box.x,
    y: layer.box.y,
    w: layer.box.w,
    h: layer.box.h,
    fontSize: layer.size,
    color: hx(layer.color),
    bold: layer.bold,
    italic: layer.italic,
    align: layer.align || "left",
    valign: layer.valign || "top",
    fontFace: layer.font || PPTX_FONT,
    wrap: true,
    // Shrift `slide-layout.ts` dagi `fitSize`/`fitLines` bilan oldindan
    // hisoblanadi. `shrinkText` yoqilsa PowerPoint uni yana kichraytiradi
    // va sayt ko'ruvchisi bilan mos kelmay qoladi — preview ≠ eksport.
    shrinkText: false,
    paraSpaceAfter: layer.paraSpace,
    charSpacing: layer.tracking,
    margin: 0,
  });
}

export async function renderPptx(
  doc: AcademicDoc,
  fileName: string,
  opts?: { resolveImage?: (url: string) => Promise<ImageBytes | null> },
): Promise<BuiltFile> {
  const imageCache: ImageCache = new Map();
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: W, height: H });
  pptx.layout = "WIDE";
  pptx.author = doc.meta.author || BRAND_SHORT;
  pptx.title = doc.meta.topic;
  pptx.subject = doc.meta.workLabel;

  const deck = buildSlideDeck(doc);
  const theme = getSlideTheme(deck.themeId);

  for (let i = 0; i < deck.slides.length; i++) {
    const slide = pptx.addSlide() as unknown as PptxSlide;
    const plan = planSlide(deck.slides[i], theme, deck.visual, i, deck.slides.length, deck.audience, deck.templateId, {
      bodyType: deck.bodyType,
      logo: deck.logo,
    });
    await paintPlan(slide, plan, imageCache, opts?.resolveImage);
    // Notiq eslatmasi. Ilgari `notesSlide` yaratilardi-yu, ichi bo'sh qolardi:
    // foydalanuvchi saytda eslatmani ko'rib, yuklab olgach yo'qotardi.
    const notes = slideNotes(deck.slides[i], deck.speakerNotes);
    if (notes) slide.addNotes?.(notes);
  }

  const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return {
    html: "",
    bytes: new Uint8Array(buf),
    fileName,
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    doc,
  };
}
