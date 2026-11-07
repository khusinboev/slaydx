import { fetchImageBytes } from "./slide-images";
import { geminiImageModel, geminiProvider } from "./image-provider-gemini";
import { openaiImageModel, openaiProvider } from "./image-provider-openai";
import { limitedProvider, type ImageProvider, type ImageResult } from "./image-provider";
import { imageModelOf, type ImageModelId } from "./image-models";
import { mediaCoreOn } from "../media/context";
import { coreImageProvider } from "../media/image";
import { IMAGE_MODEL_TO_MEDIA } from "../media/catalog";
import { UserFacingError } from "../server/user-error";
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

/** The no-text clause of every picture prompt except a Studio text model's (`composePrompt` `text`). */
export const NO_TEXT_CLAUSE =
  "Absolutely no text, letters, numbers, signage, plaques, inscriptions, watermark, logo, or UI anywhere in the image — walls and surfaces must be blank of any writing.";

/** Longest quoted text kept for the text instruction (a poster line, not a paragraph). */
export const QUOTED_TEXT_MAX = 120;

/**
 * The texts the user put in quotes, in order, trimmed, de-duplicated: «…», „…“, “…”, "…" (the pairs Uzbek, Russian and
 * English keyboards type). Empty pairs and texts over `QUOTED_TEXT_MAX` characters are dropped. Pure.
 */
export function quotedTexts(userPrompt: string): string[] {
  const out: string[] = [];
  const re = /«([^«»]+)»|„([^„“”]+)[“”]|“([^“”]+)”|"([^"]+)"/g;
  for (const m of String(userPrompt ?? "").matchAll(re)) {
    const t = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").replace(/\s+/g, " ").trim();
    if (t && t.length <= QUOTED_TEXT_MAX && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * The text instruction of a Studio TEXT model (catalog badge `matn`, docs/studio/P2-SPEC.md): render exactly the
 * quoted texts and nothing else; without quotes, no text the user did not ask for. Pure.
 */
export function textInstruction(quoted: readonly string[]): string {
  if (!quoted.length) return "Add no text, letters, watermark or logo unless the request above explicitly asks for it.";
  // A `"` inside a quoted text («Say "hi"») would close the instruction's own quotes early: it becomes `'`.
  return `Render exactly this text, spelled exactly as given and nowhere else in the image: ${quoted.map((t) => `"${t.replace(/"/g, "'")}"`).join(", ")}. No other text, letters, watermark or logo.`;
}

/**
 * The provider prompt of one picture. `text` absent (the «Rasm» tool, every non-text Studio model) = the long-standing
 * prompt with the strict no-text clause, byte for byte. `text` given (a Studio text model) = the same prompt with the
 * no-text clause replaced by `textInstruction(text.quoted)`.
 */
export function composePrompt(scene: string, styleId: string, w: number, h: number, text?: { quoted: readonly string[] }) {
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
    text ? textInstruction(text.quoted) : NO_TEXT_CLAUSE,
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
const IMAGE_PROVIDERS: Record<ImageModelId, ImageProvider> = {
  gemini: limitedProvider(geminiProvider),
  openai: limitedProvider(openaiProvider),
};

/** The provider that draws for the form's `model` choice (`image-models.ts`); absent = Gemini, as always. */
export function imageProviderFor(values: { model?: unknown }): ImageProvider {
  return IMAGE_PROVIDERS[imageModelOf(values)];
}

/**
 * The same providers behind the media core (`media.core.image`, docs/studio/P0-SPEC.md §6.3): every picture goes through
 * the router with breaker health and a `media_jobs` row, and comes back as the provider's own `ImageResult`. The limiter
 * stays OUTSIDE the core call (same `${id}-image` semaphore as above), so concurrency and queue timeouts are unchanged.
 * `recorded` is what `media_jobs.params` shows: the user's prompt and style (the engine sends the composed prompt).
 */
export const CORE_BASES: Record<ImageModelId, { provider: ImageProvider; upstream: () => string }> = {
  gemini: { provider: geminiProvider, upstream: geminiImageModel },
  openai: { provider: openaiProvider, upstream: openaiImageModel },
};

function coreImageProviderFor(model: ImageModelId, recorded: { prompt: string; imageStyle: string; imageRatio: string }): ImageProvider {
  const { provider, upstream } = CORE_BASES[model];
  return limitedProvider(coreImageProvider("rasm.image", IMAGE_MODEL_TO_MEDIA[model], provider, { upstream, values: recorded }));
}

/** `moderation_blocked` is the detail prefix the OpenAI adapter gives to a content-policy refusal. */
const isRefusal = (r: ImageResult): boolean => !r.ok && r.detail.startsWith("moderation_blocked");

export async function buildImageArtifact(
  tool: ToolConfig,
  values: FormValues,
  deadline?: number,
  onStage?: (ev: { progress: number; step: string }) => void,
): Promise<BuiltFile> {
  // Real stages for the running panel (`lib/progress-stages.ts` "image"); otherwise only the time-based fallback curve.
  onStage?.({ progress: 0, step: "So‘rov tayyorlanmoqda" });
  const prompt = String(values.prompt || "").trim();
  if (prompt.length < 3) throw new Error("Rasm uchun tavsif yozing");
  const styleId = String(values.imageStyle || "photo");
  const ratio = imageRatioById(String(values.imageRatio || "1:1"));
  const count = Math.max(1, Math.min(4, Number(values.imageCount || 1)));
  const model = imageModelOf(values);
  // Decided per job at the worker (`media.core.image`); off or outside a job = today's providers, untouched.
  const imageProvider = mediaCoreOn("image") ? coreImageProviderFor(model, { prompt, imageStyle: styleId, imageRatio: ratio.id }) : imageProviderFor(values);
  return drawImageJob({ tool, values, prompt, styleId, ratio, count, provider: imageProvider, imageModel: model, deadline, onStage });
}

export type ImageJob = {
  tool: ToolConfig;
  values: FormValues;
  /** The user's description, trimmed (≥ 3 characters, checked by the caller). */
  prompt: string;
  styleId: string;
  ratio: ReturnType<typeof imageRatioById>;
  count: number;
  /** Draws ONE picture; the caller decides which provider (and whether it goes through the media core). */
  provider: ImageProvider;
  /** `doc.imageModel`: what the viewer names («Rasm»: the form's model id; Studio: the catalog id). */
  imageModel: string;
  /** A Studio text model (catalog badge `matn`): the prompt renders the user's quoted text instead of forbidding text. */
  allowText?: boolean;
  /** The scene as decided before the job (Studio «AI yaxshilash»); absent = `expandPrompt` writes it. */
  scene?: string;
  /** The user's own scene, when `scene` is a rewrite: a picture the provider refuses on safety is asked once more with it. */
  ownScene?: string;
  deadline?: number;
  onStage?: (ev: { progress: number; step: string }) => void;
};

/**
 * The picture job shared by «Rasm» and the Studio (`lib/generation/studio/`): prompt expansion, `count` pictures two at
 * a time, the refusal message, the doc and the packed file with its `delivered` gap (partial refund in the worker).
 * Moved out of `buildImageArtifact` unchanged; only the provider and the `imageModel` label differ per caller.
 */
export async function drawImageJob(job: ImageJob): Promise<BuiltFile> {
  const { tool, values, prompt, styleId, ratio, count, deadline, onStage } = job;
  const stage = (progress: number, step: string) => onStage?.({ progress, step });
  const meta = extractMeta(tool, { ...values, topic: String(values.prompt || values.topic || "Rasm") });
  const size = { width: ratio.w, height: ratio.h };
  const imageProvider = job.provider;
  const refused: ImageResult[] = [];
  const scene = job.scene ?? (await expandPrompt(prompt, styleId, ratio.id, deadline));
  const compose = (text: string) => composePrompt(text, styleId, ratio.w, ratio.h, job.allowText ? { quoted: quotedTexts(prompt) } : undefined);
  const full = compose(scene);
  let fromScene = 0;
  stage(10, count > 1 ? `Rasm chizilmoqda · 0/${count}` : "Rasm chizilmoqda");

  let drawn = 0;
  const raw = await mapPool(Array.from({ length: count }, (_, i) => i), 2, async (i) => {
    /*
     * `rasm` — mustaqil pullik mahsulot. Provayder
     * foydalanuvchi tanlovidan (`model`: Gemini yoki ChatGPT). Gemini
     * lite ($0.034) matnni (ayniqsa o'zbekcha mavzu) aniq o'qiydi —
     * uslub farqi asosan promptga bog'liq (yuqoridagi izoh).
     */
    // Muddat (EXT-03): har so'rov byudjeti ish muddati bilan cheklanadi (ilgari 120 s shift, muddatsiz).
    const first = await imageProvider.fetchImage({ prompt: full, size, styleId: "photo" }, deadline);
    if (first.ok) fromScene++;
    // Only a true refusal of a rewrite: the user never saw that text. No charge either way, the job is one purchase.
    const res = job.ownScene !== undefined && isRefusal(first) ? await imageProvider.fetchImage({ prompt: compose(job.ownScene), size, styleId: "photo" }, deadline) : first;
    const im = res.ok ? res.image : null;
    if (isRefusal(res)) refused.push(res);
    drawn++;
    if (count > 1) stage(10 + Math.round((70 * drawn) / count), `Rasm chizilmoqda · ${drawn}/${count}`);
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
  if (!images.length) {
    // A content-policy refusal gets its own message (the prompt has to change; a plain retry would be refused again).
    if (refused.length) throw new UserFacingError("Tavsif rasm modelining kontent qoidalariga mos kelmadi — mazmunini o‘zgartirib, qayta urinib ko‘ring. Pul balansingizga qaytariladi.");
    throw new Error("Rasm yaratilmadi. Qayta urinib ko‘ring.");
  }
  stage(85, "Fayl saqlanmoqda");

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
    imageScene: job.ownScene !== undefined && fromScene === 0 ? job.ownScene : scene,
    imageStyle: styleId,
    imageRatio: ratio.id,
    // Which model drew the pictures: the viewer names it.
    imageModel: job.imageModel,
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
