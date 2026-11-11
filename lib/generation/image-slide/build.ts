/**
 * AI slide orchestrator (docs/ai-slide/SPEC.md «Engine»): text → slide 1 → the rest in parallel with slide 1 as the
 * style reference → one deck doc whose every slide is a whole picture (`SlideModel.fullImage`).
 *
 * Money rules: no slide text at all, or not one picture → the build throws and the worker refunds everything. A
 * deck with some pictures missing is delivered (the missing slides fall back to their text layout) and
 * `delivered` refunds the missing slides' share.
 */
import type { FormValues } from "../../types";
import type { SlideProgressSink } from "../slide-progress";
import type { SlideLayout, SlideModel } from "../slide-types";
import type { AcademicDoc, Delivered, DocMeta, DocSection } from "../types";
import { checkSlideText, expectedTexts, fixNote } from "./check";
import { drawSlide, SLIDE_DRAW_MIN_MS, type DrawRef, type DrawResult } from "./draw";
import { IMAGE_SLIDE_TEXT_USD, imageSlideCount, imageSlideModelOf, imageSlideStyleOf, type ImageSlideModel } from "./models";
import { slidePrompt } from "./prompt";
import { writePictureDeck, type PictureSlide } from "./write";

/**
 * Parallel draws per deck; the process-wide `gemini-slide` limiter caps all decks together. One call took 55–113 s in
 * the first live deck, so 30 slides need about ten lanes to fit the worker's job timeout.
 */
export const DRAW_LANES = 10;
/** Stored picture: wide enough for crisp text on screen and in the PPTX, small enough for a 30-slide deck. */
export const PICTURE_WIDTH = 1920;
export const PICTURE_QUALITY = 86;
/** The style reference sent with slides 2…N: a lighter copy of slide 1 (fewer bytes per request, same look). */
const REFERENCE_WIDTH = 1024;

export class ImageSlideError extends Error {}

/**
 * Time kept free after the last draw for the PPTX (sharp re-encodes every picture), the HTML, the asset swap and the
 * commit: the worker's hard stop is only 30 s past the deadline.
 */
export const ASSEMBLY_RESERVE_MS = 45_000;
/** The last moment a draw, a retry or a redraw may run until: the job deadline minus the assembly reserve. */
export function drawDeadlineOf(deadline: number): number {
  return deadline - ASSEMBLY_RESERVE_MS;
}

/** Slide 1 (the style reference) may take at most this long, retries and redraw included: the rest wait for it. */
export const FIRST_SLIDE_CAP_MS = 200_000;
/** The picture sent to the live view: small, so many finished slides fit the live state (`LIVE_MAX_BYTES`). */
const LIVE_WIDTH = 640;

/** Re-encode a drawn slide (2752×1536) to the stored size. Falls back to the original bytes if sharp fails. */
export async function storePicture(base64: string, mime: string, width = PICTURE_WIDTH, quality = PICTURE_QUALITY): Promise<{ base64: string; mime: string }> {
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(Buffer.from(base64, "base64"), { failOn: "error" })
      .resize({ width, withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    return { base64: out.toString("base64"), mime: "image/jpeg" };
  } catch {
    return { base64, mime };
  }
}

/** The text layout a slide falls back to when its picture is missing (and the skeleton shown while it draws). */
function fallbackLayout(s: PictureSlide): SlideLayout {
  if (s.kind === "title") return "title";
  if (s.kind === "closing") return "closing";
  if (s.kind === "agenda") return "agenda";
  if (s.kind === "table" && s.table) return "table";
  if (s.kind === "quote" && s.points.length) return "quote";
  return "bullets";
}

export function toSlideModel(s: PictureSlide, index: number, footer: string): SlideModel {
  const layout = fallbackLayout(s);
  const bullets = [...s.formulas, ...s.points].slice(0, 6);
  return {
    id: `s${index}`,
    layout,
    title: s.title,
    ...(s.subtitle ? { subtitle: s.subtitle } : {}),
    ...(layout === "quote" ? { quote: s.points[0], ...(s.points[1] ? { quoteBy: s.points[1] } : {}) } : {}),
    ...(layout !== "title" && layout !== "closing" && layout !== "quote" && bullets.length ? { bullets } : {}),
    ...(layout === "table" && s.table ? { table: { headers: s.table.headers, rows: s.table.rows } } : {}),
    footer,
    ...(s.notes ? { notes: s.notes } : {}),
    fullImage: true,
  };
}

function sections(slides: PictureSlide[]): DocSection[] {
  return slides
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.kind !== "title" && s.kind !== "closing")
    .map(({ s, i }) => ({
      id: `s${i}`,
      title: s.title,
      blocks: [...s.formulas, ...s.points, ...(s.table ? s.table.rows.map((r) => r.join(" — ")) : [])]
        .concat(s.points.length || s.formulas.length || s.table ? [] : [s.subtitle || s.title])
        .map((text) => ({ kind: "p" as const, text })),
    }));
}

/** One draw with one retry on a passing failure (never on a blocked key, never without time for a full call). */
async function drawWithRetry(model: ImageSlideModel, prompt: string, ref: DrawRef | null, deadline: number): Promise<DrawResult> {
  const first = await drawSlide(model, prompt, ref, deadline);
  if (first.ok || first.reason === "blocked" || first.reason === "no-key") return first;
  if (deadline - Date.now() < SLIDE_DRAW_MIN_MS + 5_000) return first;
  if (first.reason === "rate") await new Promise((r) => setTimeout(r, 4_000));
  const second = await drawSlide(model, prompt, ref, deadline);
  return second.ok ? second : first;
}

export type ImageSlideBuild = { doc: AcademicDoc; delivered?: Delivered };

export async function buildImageSlideDoc(
  meta: DocMeta,
  values: FormValues,
  deadline: number,
  opts: { onProgress?: SlideProgressSink } = {},
): Promise<ImageSlideBuild> {
  const live = opts.onProgress;
  const want = imageSlideCount(values);
  const model = imageSlideModelOf(values);
  const style = imageSlideStyleOf(values);
  const footer = [meta.author, meta.organization].filter(Boolean).join(" · ");

  // No live event before `plan`: the live reducer refuses a stage that comes first (`slide-progress.ts`).
  const drawDeadline = drawDeadlineOf(deadline);
  // The text must leave time for at least the first slide and one parallel round.
  const textDeadline = drawDeadline - 2 * SLIDE_DRAW_MIN_MS - 20_000;
  const pictures = await writePictureDeck(meta, values, want, textDeadline);
  if (!pictures.length) throw new ImageSlideError("AI taqdimot matnini yozmadi");

  const slides = pictures.map((p, i) => toSlideModel(p, i, footer));
  live?.({ type: "plan", slides, roles: pictures.map((p) => p.kind), meta, theme: "atlas", template: "lecture" });
  live?.({ type: "deck", slides });
  live?.({ type: "stage", stage: "images" });
  live?.({ type: "images", wait: slides.map((_, i) => i) });

  const prompts = pictures.map((p, i) => slidePrompt(p, { meta, style, index: i, total: pictures.length, withReference: i > 0 }));
  const failures: string[] = [];
  let blocked = false;
  let drawn = 0;

  let redrawn = 0;
  let flagged = 0;

  /** Store a finished picture on its slide and show a light copy of it live. */
  const put = async (i: number, stored: { base64: string; mime: string }) => {
    const url = `data:${stored.mime};base64,${stored.base64}`;
    slides[i] = { ...slides[i], image: { url, alt: pictures[i].title } };
    drawn += 1;
    if (live) {
      const small = await storePicture(stored.base64, stored.mime, LIVE_WIDTH, 72);
      live({ type: "image", index: i, url: `data:${small.mime};base64,${small.base64}` });
    }
  };

  /**
   * Draw one slide, proofread it, and redraw once with the exact spelling of what came out wrong (only while a full
   * call still fits). Of the two pictures the one with fewer wrong items is kept. Returns the kept draw (for the
   * style reference), or `null` when the slide has no picture.
   */
  const produce = async (i: number, refImage: DrawRef | null, until: number): Promise<{ base64: string; mime: string } | null> => {
    const first = await drawWithRetry(model, prompts[i], refImage, until);
    if (!first.ok) {
      failures.push(`${i + 1}: ${first.reason} ${first.detail}`.slice(0, 200));
      if (first.reason === "blocked" || first.reason === "no-key") blocked = true;
      return null;
    }
    const expected = expectedTexts(pictures[i], i, pictures.length);
    let kept = await storePicture(first.base64, first.mime);
    let issues = await checkSlideText(kept.base64, kept.mime, expected, until);
    // A redraw only while a full call plus its check still fits before `until`.
    if (issues.length && !blocked && until - Date.now() > SLIDE_DRAW_MIN_MS + 30_000) {
      redrawn += 1;
      const again = await drawSlide(model, `${prompts[i]}\n\n${fixNote(issues)}`, refImage, until);
      if (again.ok) {
        const second = await storePicture(again.base64, again.mime);
        const issues2 = await checkSlideText(second.base64, second.mime, expected, until);
        if (issues2.length < issues.length) {
          kept = second;
          issues = issues2;
        }
      }
    }
    if (issues.length) {
      flagged += 1;
      console.warn(`[image-slide] slayd ${i + 1}: matnda ${issues.length} ta farq qoldi`, issues.map((x) => `${x.expected} → ${x.seen}`).join("; ").slice(0, 300));
    }
    await put(i, kept);
    return kept;
  };

  // Slide 1 alone: it becomes the style reference of the rest.
  const firstKept = await produce(0, null, Math.min(drawDeadline, Date.now() + FIRST_SLIDE_CAP_MS));
  let ref: DrawRef | null = null;
  if (firstKept) {
    const small = await storePicture(firstKept.base64, firstKept.mime, REFERENCE_WIDTH, 80);
    ref = { base64: small.base64, mime: small.mime };
  } else {
    // Without slide 1 the others keep the style block only; their prompt must not mention an attachment.
    for (let i = 1; i < prompts.length; i += 1) {
      prompts[i] = slidePrompt(pictures[i], { meta, style, index: i, total: pictures.length, withReference: false });
    }
  }

  const rest = pictures.map((_, i) => i).slice(1);
  let next = 0;
  async function lane() {
    while (next < rest.length && !blocked) {
      const i = rest[next];
      next += 1;
      await produce(i, ref, drawDeadline);
    }
  }
  await Promise.all(Array.from({ length: Math.min(DRAW_LANES, rest.length) }, () => lane()));

  if (redrawn) console.warn(`[image-slide] ${redrawn} slayd matni xato chiqib qayta chizildi, ${flagged} tasida farq qoldi`);
  if (failures.length) console.warn(`[image-slide] ${failures.length}/${pictures.length} slayd chizilmadi:`, failures.join("; "));
  if (drawn === 0) throw new ImageSlideError(blocked ? "Rasm xizmati hozir ishlamayapti" : "AI slaydlarni chiza olmadi");

  live?.({ type: "stage", stage: "assembly" });
  const doc: AcademicDoc = {
    meta,
    titlePage: true,
    toc: true,
    sections: sections(pictures),
    slideTheme: "atlas",
    slideTemplate: "lecture",
    slides,
    slideImages: { want: pictures.length, got: drawn, blocked: blocked ? pictures.length - drawn : 0, skipped: 0, failed: pictures.length - drawn },
  };

  // Every slide not delivered as a picture — short text or a failed draw — is refunded at its share of the cost.
  const slideShare = (want * model.usdPerSlide) / (IMAGE_SLIDE_TEXT_USD + want * model.usdPerSlide);
  const delivered: Delivered | undefined = drawn < want ? { got: drawn, want, unit: "AI slayd", refundShare: slideShare } : undefined;
  return { doc, ...(delivered ? { delivered } : {}) };
}
