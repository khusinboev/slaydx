import { IMAGE_COMPACT, IMAGE_NORMAL, PPTX_SIZE_LIMIT, shrinkImage, type ImageProfile } from "./pptx-image";
import { fetchImageBytes, type ImageBytes, imageDims } from "./slide-images";
import { planSlide, PPTX_FONT, slideNotes, SLIDE_IN, type SlideLayer, type SlidePlan } from "./slide-layout";
import { buildSlideDeck } from "./slides";
import { getSlideTheme } from "./slide-themes";
import type { AcademicDoc, BuiltFile } from "./types";
import { BRAND_SHORT } from "../brand";
import { log } from "../server/log";

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
/** Rasm o'lchami: provayder bergan bo'lsa undan, bo'lmasa baytlardan (bir marta, keshda saqlanadi). */
function imageDimsOf(img: ImageBytes): { w: number; h: number } | undefined {
  if (img.w && img.h) return { w: img.w, h: img.h };
  const comma = img.data.indexOf(",");
  const dims = imageDims(Buffer.from(comma === -1 ? img.data : img.data.slice(comma + 1), "base64"));
  if (dims) {
    img.w = dims.w;
    img.h = dims.h;
  }
  return dims;
}

/**
 * Per-render image state. `raw` holds the originals (shared by the normal and the
 * compact pass, so a re-pack never fetches again); `shrunk` holds what is embedded
 * in THIS pass.
 */
type ImageState = { raw: ImageCache; shrunk: ImageCache; profile: ImageProfile };

async function loadImage(
  state: ImageState,
  url: string,
  resolveImage?: (url: string) => Promise<ImageBytes | null>,
): Promise<ImageBytes | null> {
  const hit = state.shrunk.get(url);
  if (hit !== undefined) return hit;
  let orig = state.raw.get(url);
  if (orig === undefined) {
    orig = (resolveImage ? await resolveImage(url) : null) ?? (await fetchImageBytes(url));
    state.raw.set(url, orig);
  }
  // Downscale + recompress at insertion (never upscales; falls back to the original).
  const img = orig ? await shrinkImage(orig, state.profile) : null;
  state.shrunk.set(url, img);
  return img;
}

async function paintPlan(
  slide: PptxSlide,
  plan: SlidePlan,
  cache: ImageState,
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
  cache: ImageState,
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
    const fit = layer.fit ?? "cover";
    /*
     * pptxgenjs `sizing.contain/cover` rasmning HAQIQIY o'lchamini bilmaydi
     * (Node'da `image-size` ishlatilmaydi): u `w/h` ni rasm nisbati deb
     * oladi — ya'ni quti bilan bir xil nisbat → hech qanday kesish/
     * joylash bo'lmay, rasm qutiga CHO'ZILARDI. Ko'ruvchi esa `object-fit`
     * bilan to'g'ri chizadi — logotip saytda asl nisbatda, faylda eniga
     * cho'zilgan edi (AUDIT-14). Endi nisbat baytlardan (`imageDims`):
     *   contain — rasm qutining ICHIDA markazda, nisbat saqlanadi (o'zimiz
     *             hisoblab, `sizing`siz joylaymiz — manfiy `srcRect` ga
     *             tayanmaymiz);
     *   cover   — `sizing.cover` ga rasm nisbatidagi `w/h` beriladi,
     *             pptxgenjs `srcRect` bilan qutiga mos kesadi (`object-fit: cover`).
     */
    const dims = imageDimsOf(img);
    const ratio = dims && dims.w > 0 && dims.h > 0 ? dims.h / dims.w : box.h / box.w;
    if (fit === "contain" && dims) {
      const boxRatio = box.h / box.w;
      const w = ratio > boxRatio ? box.h / ratio : box.w;
      const h = ratio > boxRatio ? box.h : box.w * ratio;
      slide.addImage({
        data: img.data,
        x: box.x + (box.w - w) / 2,
        y: box.y + (box.h - h) / 2,
        w,
        h,
        ...(layer.shape === "circle" ? { rounding: true } : {}),
      });
      return;
    }
    slide.addImage({
      data: img.data,
      x: box.x,
      y: box.y,
      // `w/h` — faqat NISBAT uchun (pptxgenjs shundan `srcRect` hisoblaydi); joylashuv `sizing` qutisi bilan.
      w: box.w,
      h: box.w * ratio,
      sizing: { type: fit, w: box.w, h: box.h },
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

export type RenderPptxOpts = {
  resolveImage?: (url: string) => Promise<ImageBytes | null>;
  /** Test seam: the size limit that triggers the compact re-pack (default: the 25 MB storage limit). */
  sizeLimit?: number;
  /** Test seam: called after each pack with the profile used and the resulting size. */
  onPack?: (profile: ImageProfile["name"], bytes: number) => void;
};

/**
 * Renders the deck; images are downscaled/recompressed at insertion. When the
 * file is still over the storage limit it is packed ONCE more with stronger
 * compression instead of failing; only if that is still too big does the
 * caller's existing size check fail it.
 */
export async function renderPptx(doc: AcademicDoc, fileName: string, opts?: RenderPptxOpts): Promise<BuiltFile> {
  const raw: ImageCache = new Map();
  const limit = opts?.sizeLimit ?? PPTX_SIZE_LIMIT;
  let built = await renderPass(doc, fileName, opts?.resolveImage, { raw, shrunk: new Map(), profile: IMAGE_NORMAL });
  opts?.onPack?.("normal", built.bytes.byteLength);
  if (built.bytes.byteLength > limit) {
    log("warn", "[pptx] file over the size limit, packing again with stronger image compression", {
      bytes: built.bytes.byteLength,
      limit,
    });
    built = await renderPass(doc, fileName, opts?.resolveImage, { raw, shrunk: new Map(), profile: IMAGE_COMPACT });
    opts?.onPack?.("compact", built.bytes.byteLength);
  }
  return built;
}

async function renderPass(
  doc: AcademicDoc,
  fileName: string,
  resolveImage: ((url: string) => Promise<ImageBytes | null>) | undefined,
  imageCache: ImageState,
): Promise<BuiltFile> {
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
      custom: deck.custom,
    });
    await paintPlan(slide, plan, imageCache, resolveImage);
    // Notiq eslatmasi. Ilgari `notesSlide` yaratilardi-yu, ichi bo'sh qolardi:
    // foydalanuvchi saytda eslatmani ko'rib, yuklab olgach yo'qotardi.
    const notes = slideNotes(deck.slides[i], deck.speakerNotes);
    if (notes) slide.addNotes?.(notes);
  }

  // DEFLATE: XML parts shrink; JPEG/PNG media stay as they are.
  const buf = (await pptx.write({ outputType: "nodebuffer", compression: true })) as Buffer;
  return {
    html: "",
    bytes: new Uint8Array(buf),
    fileName,
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    doc,
  };
}
