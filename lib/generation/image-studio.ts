import { fetchImageBytes, generateFalImage } from "./slide-images";
import { imageExt } from "../viewers/kind";
import { parseLlmObject } from "./json";
import { mapPool } from "./quality";
import { extractMeta } from "./meta";
import { llmComplete, llmEnabled } from "./llm";
import { groundUzbekScene } from "./uz-gazetteer";
import type { AcademicDoc, BuiltFile, GenImage } from "./types";
import type { FormValues, ToolConfig } from "../types";

/**
 * Uslub tavsiflari — har biri o'ziga xos VOSITA (medium) so'zlari va
 * "bu FOTO EMAS" kabi inkor bilan yozilgan.
 *
 * Sababi: jonli tekshiruvda (`scripts/image-lab.mts`) bir xil sahna va
 * seed bilan 8 ta uslubning 6 tasi (foto, kino, illyustratsiya, 3D,
 * minimal, mahsulot) DEYARLI BIR XIL fotografik rasm chiqargani
 * aniqlandi — foydalanuvchi xabar qilgan xato aynan shu edi. Sabab:
 * `flux/schnell` past qadam sonida ("standard" = 4) tavsifni yuzaki
 * o'qiydi va standart holatga (fotorealizm) qaytadi; "3D render" yoki
 * "digital illustration" kabi yumshoq ishoralar buni yengolmaydi.
 * Faqat kuchli, aniq lug'aviy signal ("bu FOTO EMAS", qog'oz donadorligi,
 * moybo'yoq siljishi kabi) va inkor ishlaydi — "qalam" uslubi shu
 * tarzda yozilgani uchun ilgari ham to'g'ri chiqqan edi.
 */
export const IMAGE_STYLES = [
  {
    id: "photo",
    name: "Foto",
    blurb: "Haqiqiy surat",
    suffix:
      "Render as a photoreal photograph of THIS scene only, shot on a full-frame DSLR, natural light, realistic skin and material textures, sharp focus.",
  },
  {
    id: "cinematic",
    name: "Kino",
    blurb: "Film kadri",
    suffix:
      "Render as a still frame from a live-action movie: anamorphic lens flare, shallow depth of field with soft bokeh, teal-and-orange color grade, subtle film grain, slightly desaturated shadows, letterboxed cinematic framing of THIS scene only.",
  },
  {
    id: "illustration",
    name: "Illustratsiya",
    blurb: "Chizma uslub",
    suffix:
      "This is NOT a photograph. Render as a FLAT DIGITAL VECTOR ILLUSTRATION of THIS scene: bold clean black outlines, simplified geometric shapes, a limited flat color palette with no photographic gradients, poster-art style, zero camera grain or realistic lighting.",
  },
  {
    id: "watercolor",
    name: "Akvarel",
    blurb: "Suv bo‘yoq",
    suffix:
      "This is NOT a photograph. Render as a HAND-PAINTED WATERCOLOR of THIS scene on visibly textured cold-press paper: soft diffused pigment bleeds at every edge, dry-brush texture, visible paper grain showing through thin washes, muted pastel colors, no sharp photographic detail anywhere.",
  },
  {
    id: "render3d",
    name: "3D",
    blurb: "Render",
    suffix:
      "This is NOT a photograph. Render as a STYLIZED 3D COMPUTER-GENERATED image of THIS scene (Blender/Octane look): smooth clay-like or matte plastic materials, visible ray-traced soft shadows, clean studio three-point lighting, slightly simplified low-poly geometry, no photographic skin or fabric texture.",
  },
  {
    id: "minimal",
    name: "Minimal",
    blurb: "Toza kompozitsiya",
    suffix:
      "Render as a minimalist studio photograph of THIS scene: single flat pastel or seamless paper backdrop replacing any busy background, one subject small and centered, huge clean negative space around it, soft even studio lighting, no clutter, no crowd.",
  },
  {
    id: "pencil",
    name: "Qalam",
    blurb: "Sketch",
    suffix:
      "This is NOT a photograph and NOT color. Render THIS exact scene as a full-page black-and-white graphite pencil illustration on white paper: visible hatching and cross-hatching strokes, uneven pencil pressure, paper tooth texture, zero color, zero photographic lighting. No artist signature, no monogram, no scribbled text anywhere in the image. Not a random sketch study. Not an animal unless the scene names one.",
  },
  {
    /*
     * «Doska» — slayd uslublari (`SLIDE_IMAGE_STYLES`) uchun qo'shildi:
     * dars taqdimotining eng tabiiy vositasi, va foto bo'lmagan uslublar
     * ichida `pencil` dan aniq farqlanadi (rang bor, fon to'q, sirt
     * boshqa). Bu `SLIDE_THEME_IDS` dagi `chalk` TEMASI emas — boshqa
     * namespace, tasodifiy nom mosligi.
     */
    id: "chalk",
    name: "Doska",
    blurb: "Bo‘r chizma",
    suffix:
      "This is NOT a photograph. Render THIS scene as white and pale-yellow chalk drawing on a dark green classroom chalkboard: visible chalk dust, slightly smudged strokes, uneven hand-drawn lines, flat matte board texture, no photographic lighting.",
  },
  {
    id: "product",
    name: "Mahsulot",
    blurb: "Katalog",
    suffix:
      "Render as studio product photography of the named object only, isolated on a plain seamless white or neutral backdrop with no environment or background scene, soft even softbox lighting from multiple angles, sharp catalog-style focus.",
  },
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

export function composePrompt(scene: string, styleId: string, w: number, h: number) {
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
    /*
     * Kuchaytirilgan taqiq: jonli tekshiruvda model haqiqiy binoga
     * o'zi «CHAOSSU» kabi buzuq yozuv chizib qo'ygani aniqlandi —
     * oddiy "no text" yetarli emas edi. Devor/peshtoq sirtini aniq
     * bo'sh deb belgilash ko'proq ta'sir qiladi.
     */
    "Absolutely no text, letters, numbers, signage, plaques, inscriptions, watermark, logo, or UI anywhere in the image — walls and surfaces must be blank of any writing.",
  ].join(" ");
}

/**
 * O'zbekistonga oid so'rovlarga aniq vizual faktlarni qo'shadi.
 *
 * LLM o'chirilgan yoki mavzuni tarjima qilishda tafsilotni tushirib
 * qoldirgan taqdirda ham, tanilgan joy/taom uchun HAQIQIY ko'rinish
 * har doim promptga yetib borishi kerak — shuning uchun bu qo'shimcha
 * `expandPrompt` natijasidan QAT'IY NAZAR alohida qo'shiladi.
 */
export function withGrounding(scene: string, grounding: string): string {
  return grounding ? `${scene.trim()} Known visual facts about this exact subject: ${grounding}.` : scene.trim();
}

async function expandPrompt(user: string, styleId: string, ratioId: string): Promise<string> {
  const grounding = groundUzbekScene(user);
  if (!llmEnabled()) return withGrounding(user, grounding);
  const style = imageStyleById(styleId);
  const raw = await llmComplete(
    [
      "You write English prompts for a text-to-image model.",
      "The user may write Uzbek, Russian, or mixed text. Translate meaning, do not ignore it.",
      "Output JSON only: {\"scene\":\"...\"}.",
      "scene = 1–4 sentences, concrete visual English: place, objects, time of day, camera.",
      "Keep every named place, object, and action. Do not replace the subject with a different idea.",
      "If the request names a specific real place, food, or object, describe its ACTUAL known visual details precisely — do not fall back to a generic version of that category.",
      "Do not mention style, medium, pencil, camera brand, or text-in-image.",
    ].join(" "),
    `User request: «${user}».\nStyle (ignore for subject, only know the medium later): ${style.name}.\nFrame: ${ratioId}.${grounding ? `\nKnown visual facts about this exact subject — reflect them: ${grounding}.` : ""}`,
    500,
    { json: true, timeoutMs: 20_000 },
  );
  const scene = String(parseLlmObject<{ scene?: string }>(raw)?.scene || "").trim();
  return withGrounding(scene.length > 12 ? scene : user, grounding);
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
    /*
     * `rasm` — mustaqil pullik mahsulot (slaydga qo'shilgan to'ldiruvchi
     * surat emas), shuning uchun `premium` bosqichni ishlatamiz: 4 emas,
     * 8 qadam. Uslub ta'siri asosan promptga bog'liq (yuqoridagi izoh),
     * lekin ko'proq qadam umumiy tafsilot va kompozitsiya sifatini
     * oshiradi — ayniqsa haqiqiy joy nomlari uchun.
     */
    const im = await generateFalImage(full, size, undefined, { premium: true });
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
