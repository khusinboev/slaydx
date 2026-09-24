import { fetchImageBytes } from "./slide-images";
import { geminiProvider } from "./image-provider-gemini";
import { limitedProvider } from "./image-provider";
import { imageExt } from "../viewers/kind";
import { parseLlmObject } from "./json";
import { mapPool } from "./quality";
import { extractMeta } from "./meta";
import { llmComplete, llmEnabled } from "./llm";
import { groundUzbekScene } from "./uz-gazetteer";
import type { AcademicDoc, BuiltFile, GenImage } from "./types";
import type { FormValues, ToolConfig } from "../types";

// Katalog klient uchun xavfsiz modulda (`image-studio-options.ts`) — bu yerdan ham eksport (eski importlar).
import { imageStyleById, imageRatioById } from "./image-studio-options";
export { IMAGE_STYLES, IMAGE_RATIOS, imageStyleById, imageRatioById } from "./image-studio-options";

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

async function expandPrompt(user: string, styleId: string, ratioId: string, deadline?: number): Promise<string> {
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
    // Ish muddati (EXT-03): vaqt tugagan bo'lsa `DeadlineError` — ish yiqiladi, pul qaytadi.
    { json: true, timeoutMs: 20_000, deadline },
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

/**
 * Rasm provayderi — jarayon bo'yicha CHEKLAGICH ortida (`gemini-image`,
 * audit EXT-03/EXT-09): ilgari rasm vositasi `requestGeminiImage` ni
 * to'g'ridan-to'g'ri chaqirardi, ya'ni pro-slayd yo'laklari bilan bitta
 * kvotani cheklagichsiz bo'lishardi. Modul darajasida bitta o'rovchi —
 * semafor baribir `limiterFor` reyestridan (jarayonda yagona).
 */
const imageProvider = limitedProvider(geminiProvider);

export async function buildImageArtifact(tool: ToolConfig, values: FormValues, deadline?: number): Promise<BuiltFile> {
  const meta = extractMeta(tool, { ...values, topic: String(values.prompt || values.topic || "Rasm") });
  const prompt = String(values.prompt || "").trim();
  if (prompt.length < 3) throw new Error("Rasm uchun tavsif yozing");
  const styleId = String(values.imageStyle || "photo");
  const ratio = imageRatioById(String(values.imageRatio || "1:1"));
  const count = Math.max(1, Math.min(4, Number(values.imageCount || 1)));
  const size = { width: ratio.w, height: ratio.h };
  const scene = await expandPrompt(prompt, styleId, ratio.id, deadline);
  const full = composePrompt(scene, styleId, ratio.w, ratio.h);

  const raw = await mapPool(Array.from({ length: count }, (_, i) => i), 2, async (i) => {
    /*
     * `rasm` — mustaqil pullik mahsulot, fal endi ishlatilmaydi. Gemini
     * lite ($0.034) matnni (ayniqsa o'zbekcha mavzu) aniq o'qiydi —
     * uslub farqi asosan promptga bog'liq (yuqoridagi izoh).
     */
    // Muddat (EXT-03): har so'rov byudjeti ish muddati bilan cheklanadi (ilgari 120 s shift, muddatsiz).
    const res = await imageProvider.fetchImage({ prompt: full, size, styleId: "photo" }, deadline);
    const im = res.ok ? res.image : null;
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
   * provayder 429/kontent filtri qaytarishi odatiy hol, ya'ni bu
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
