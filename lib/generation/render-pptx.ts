import { fetchImageBytes, type ImageBytes } from "./slide-images";
import { planSlide, slideNotes, SLIDE_IN, type SlideLayer, type SlidePlan } from "./slide-layout";
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

async function loadImage(cache: ImageCache, url: string): Promise<ImageBytes | null> {
  const hit = cache.get(url);
  if (hit !== undefined) return hit;
  const img = await fetchImageBytes(url);
  cache.set(url, img);
  return img;
}

async function paintPlan(slide: PptxSlide, plan: SlidePlan, cache: ImageCache) {
  slide.addShape("rect", { x: 0, y: 0, w: W, h: H, fill: { color: hx(plan.bg) } });
  for (const layer of plan.layers) {
    await paintLayer(slide, layer, cache);
  }
}

async function paintLayer(slide: PptxSlide, layer: SlideLayer, cache: ImageCache) {
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
    });
    return;
  }
  if (layer.t === "image") {
    if (!slide.addImage) return;
    const img = await loadImage(cache, layer.url);
    if (!img) return;
    const box = layer.box;
    slide.addImage({
      data: img.data,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      sizing: { type: "cover", w: box.w, h: box.h },
    });
    return;
  }
  const raw = layer.uppercase ? (layer.text || "").toUpperCase() : layer.text;
  const payload = layer.lines
    ? layer.lines.map((line) => ({ text: line, options: { bullet: Boolean(layer.bullets), breakLine: true } }))
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
    fontFace: layer.font || "Calibri",
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

export async function renderPptx(doc: AcademicDoc, fileName: string): Promise<BuiltFile> {
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
    const plan = planSlide(deck.slides[i], theme, deck.visual, i, deck.slides.length, deck.audience, deck.templateId);
    await paintPlan(slide, plan, imageCache);
    // Notiq eslatmasi. Ilgari `notesSlide` yaratilardi-yu, ichi bo'sh qolardi:
    // foydalanuvchi saytda eslatmani ko'rib, yuklab olgach yo'qotardi.
    const notes = slideNotes(deck.slides[i]);
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
