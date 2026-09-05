import { fetchImageBytes, generateFalImage } from "./slide-images";
import { imageExt } from "../viewers/kind";
import { parseLlmObject } from "./json";
import { extractMeta } from "./meta";
import { llmComplete, llmEnabled } from "./llm";
import type { AcademicDoc, BuiltFile, GenImage } from "./types";
import type { FormValues, ToolConfig } from "../types";

export const IMAGE_STYLES = [
  { id: "photo", name: "Foto", blurb: "Haqiqiy surat", suffix: "Render as a photoreal photograph of THIS scene only." },
  { id: "cinematic", name: "Kino", blurb: "Film kadri", suffix: "Render as a cinematic film still of THIS scene only." },
  { id: "illustration", name: "Illustratsiya", blurb: "Chizma uslub", suffix: "Render as a polished digital illustration of THIS scene only." },
  { id: "watercolor", name: "Akvarel", blurb: "Suv bo‘yoq", suffix: "Render as a watercolor painting of THIS scene only." },
  { id: "render3d", name: "3D", blurb: "Render", suffix: "Render as a detailed 3D still of THIS scene only." },
  { id: "minimal", name: "Minimal", blurb: "Toza kompozitsiya", suffix: "Render as a clean minimal photograph of THIS scene only." },
  { id: "pencil", name: "Qalam", blurb: "Sketch", suffix: "Render THIS exact scene as a full-page graphite pencil illustration. Not a random sketch study. Not an animal unless the scene names one." },
  { id: "product", name: "Mahsulot", blurb: "Katalog", suffix: "Render as catalog product photography of the named object only." },
] as const;

export const IMAGE_RATIOS = [
  { id: "1:1", label: "1:1", hint: "Post", w: 1024, h: 1024 },
  { id: "16:9", label: "16:9", hint: "Slayd", w: 1024, h: 576 },
  { id: "9:16", label: "9:16", hint: "Stories", w: 576, h: 1024 },
  { id: "4:3", label: "4:3", hint: "Klassik", w: 1024, h: 768 },
  { id: "3:4", label: "3:4", hint: "Portret", w: 768, h: 1024 },
  { id: "3:2", label: "3:2", hint: "Foto", w: 1024, h: 688 },
] as const;

export function imageStyleById(id: string) {
  return IMAGE_STYLES.find((s) => s.id === id) ?? IMAGE_STYLES[0];
}

export function imageRatioById(id: string) {
  return IMAGE_RATIOS.find((s) => s.id === id) ?? IMAGE_RATIOS[0];
}

function composePrompt(scene: string, styleId: string, w: number, h: number) {
  const style = imageStyleById(styleId);
  const portrait = h > w;
  const frame = portrait
    ? `Vertical ${w}x${h} composition. Subject fills the height. No empty lower or upper band.`
    : `Wide ${w}x${h} composition. Scene stretches edge to edge. No empty side panel.`;
  return [
    `MAIN SUBJECT (must appear): ${scene.trim()}`,
    style.suffix,
    frame,
    "Fill the entire frame. No large blank paper. No random animals or faces unless named.",
    "No text, no letters, no watermark, no logo, no UI.",
  ].join(" ");
}

async function expandPrompt(user: string, styleId: string, ratioId: string): Promise<string> {
  if (!llmEnabled()) return user;
  const style = imageStyleById(styleId);
  const raw = await llmComplete(
    [
      "You write English prompts for a text-to-image model.",
      "The user may write Uzbek, Russian, or mixed text. Translate meaning, do not ignore it.",
      "Output JSON only: {\"scene\":\"...\"}.",
      "scene = 1–3 sentences, concrete visual English: place, objects, time of day, camera.",
      "Keep every named place, object, and action. Do not replace the subject with a different idea.",
      "Do not mention style, medium, pencil, camera brand, or text-in-image.",
    ].join(" "),
    `User request: «${user}».\nStyle (ignore for subject, only know the medium later): ${style.name}.\nFrame: ${ratioId}.`,
    400,
    { json: true, timeoutMs: 20_000 },
  );
  const scene = String(parseLlmObject<{ scene?: string }>(raw)?.scene || "").trim();
  return scene.length > 12 ? scene : user;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const ret: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      ret[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return ret;
}

/** `data:image/png;base64,...` dan MIME. Topilmasa JPEG deb hisoblanadi. */
function mimeOf(dataUrl: string): string {
  const m = /^data:([\w.+-]+\/[\w.+-]+);base64,/.exec(dataUrl);
  return m ? m[1].toLowerCase() : "image/jpeg";
}

/**
 * `data:` URL dan baytlarni ajratadi.
 *
 * Ilgari bu funksiya har qanday satrni yutar edi: `fetchImageBytes`
 * muvaffaqiyatsiz bo'lganda chaqiruvchi unga `"data:"` uzatardi va
 * natijada 3 baytlik buzuq «JPEG» saqlanardi — foydalanuvchi ochilmaydigan
 * fayl yuklab olardi. Endi noto'g'ri kirishda `null` qaytadi.
 */
function dataToBytes(dataUrl: string): Uint8Array | null {
  const i = dataUrl.indexOf("base64,");
  if (i < 0) return null;
  const b64 = dataUrl.slice(i + "base64,".length).trim();
  if (b64.length < 100) return null;
  try {
    const bytes = new Uint8Array(Buffer.from(b64, "base64"));
    return bytes.byteLength > 100 ? bytes : null;
  } catch {
    return null;
  }
}

export async function buildImageArtifact(tool: ToolConfig, values: FormValues): Promise<BuiltFile> {
  const meta = extractMeta(tool, { ...values, topic: String(values.prompt || values.topic || "Rasm") });
  const prompt = String(values.prompt || "").trim();
  if (prompt.length < 3) throw new Error("Rasm uchun tavsif yozing");
  const styleId = String(values.imageStyle || "photo");
  const ratio = imageRatioById(String(values.imageRatio || "1:1"));
  const count = Math.max(1, Math.min(4, Number(values.imageCount || 1)));
  const size = { width: ratio.w, height: ratio.h };
  const scene = await expandPrompt(prompt, styleId, ratio.id);
  const full = composePrompt(scene, styleId, ratio.w, ratio.h);

  const raw = await mapPool(Array.from({ length: count }, (_, i) => i), 2, async (i) => {
    const im = await generateFalImage(full, size);
    if (!im) return null;
    const bytes = await fetchImageBytes(im.url);
    const url = bytes ? `data:${bytes.data}` : im.url;
    const out: GenImage = {
      id: `img${i + 1}`,
      url,
      alt: prompt.slice(0, 80),
      w: bytes?.w || ratio.w,
      h: bytes?.h || ratio.h,
      mime: url.startsWith("data:") ? mimeOf(url) : undefined,
    };
    return out;
  });
  const images = raw.filter((x): x is GenImage => Boolean(x));
  if (!images.length) throw new Error("Rasm yaratilmadi. Qayta urinib ko‘ring.");

  const doc: AcademicDoc = {
    meta,
    titlePage: false,
    toc: false,
    sections: [
      {
        id: "prompt",
        title: "So‘rov",
        blocks: [{ kind: "p", text: prompt }],
      },
    ],
    images,
    imagePrompt: prompt,
    imageScene: scene,
    imageStyle: styleId,
    imageRatio: ratio.id,
  };

  const files = await resolveImageFiles(images);
  if (!files.length) {
    throw new Error("Rasm yuklab olinmadi. Qayta urinib ko‘ring.");
  }

  const html = `<article><h1>${escapeHtml(prompt)}</h1><p>${images.length} rasm · ${ratio.id} · ${imageStyleById(styleId).name}</p></article>`;
  const packed = await packImages(files, meta.fileNameHint || "rasm", count);
  return { html, doc, ...packed };
}

export type ImageFile = { name: string; bytes: Uint8Array; mime: string };

/**
 * Rasmlarni baytga aylantiradi (kerak bo'lsa tarmoqdan yuklab).
 *
 * Ilgari faqat BIRINCHISI olinardi: foydalanuvchi 4 ta rasm uchun
 * 6 000 tanga to'lar, `Yuklab olish` tugmasi esa bittasini berardi.
 */
async function resolveImageFiles(images: GenImage[]): Promise<ImageFile[]> {
  const out: ImageFile[] = [];
  for (const [i, im] of images.entries()) {
    let url = im.url;
    if (!url.startsWith("data:")) {
      const fetched = await fetchImageBytes(url);
      url = fetched ? `data:${fetched.data}` : "";
    }
    const bytes = url ? dataToBytes(url) : null;
    if (!bytes) continue;
    const mime = mimeOf(url);
    out.push({ name: `rasm-${i + 1}.${imageExt(mime)}`, bytes, mime });
  }
  return out;
}

/**
 * Yuklab olinadigan faylni yig'adi.
 *
 * Tarmoqdan ajratilgan: qadoqlash mantig'i (bittami yoki arxivmi,
 * kengaytma qanday, kam yetkazildimi) sof funksiya bo'lib, sinovdan
 * o'tkaziladi.
 */
export async function packImages(
  files: ImageFile[],
  base: string,
  want: number,
): Promise<Pick<BuiltFile, "bytes" | "fileName" | "mime" | "delivered">> {
  /*
   * Va'da qilinganidan kam chiqsa worker farqni qaytaradi.
   *
   * `fal` 429 yoki kontent filtri qaytarishi odatiy hol, ya'ni bu
   * nazariy holat emas. Ilgari yagona tekshiruv `images.length === 0`
   * edi: 4 tadan 1 tasi kelsa ish `COMPLETED` bo'lardi.
   */
  const delivered = files.length < want ? { got: files.length, want } : undefined;

  if (files.length === 1) {
    return {
      // Kengaytma haqiqiy turga mos bo'lsin — ilgari PNG ham `.jpg`
      // nomi bilan saqlanardi va ba'zi dasturlar uni ochmasdi.
      fileName: `${base}.${imageExt(files[0].mime)}`,
      mime: files[0].mime,
      bytes: files[0].bytes,
      ...(delivered ? { delivered } : {}),
    };
  }

  // Bir nechta rasm — bitta arxiv. Bitta rasm uchun ZIP noqulay bo'lardi.
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.bytes);
  return {
    bytes: await zip.generateAsync({ type: "uint8array" }),
    fileName: `${base}-${files.length}ta.zip`,
    mime: "application/zip",
    ...(delivered ? { delivered } : {}),
  };
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
