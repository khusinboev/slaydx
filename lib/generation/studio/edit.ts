/**
 * Studio P2b engine: edit with a prompt, upscale, background removal (docs/studio/P2B-SPEC.md). Same tool as the
 * pictures (`studio-image`), so charge, `delivered` partial refund, the result page and the gallery work unchanged;
 * the model's catalog purpose (`studio.edit` / `studio.upscale` / `studio.bgremove`) is what `runMedia` records and
 * checks (N3: a model never runs under a purpose that does not sell it).
 *
 * Inputs are the user's own pictures: asset ids in the `inputImages` param, ownership-checked in SQL before the charge
 * (`lib/server/media/inputs.ts studioInputsError`) and resolved to bytes by the worker (`studioInputsForJob`). A missing
 * input here (deleted between submit and run) fails the job → full refund; it never runs without it.
 *
 * Every picture is ONE `runMedia` call: Nano Banana's edit twin wraps the existing Gemini provider (it already sends
 * input images, as the graduation portrait does), the fal models speak through the native fal adapter.
 */
import { CORE_BASES, packImages } from "../image-studio";
import { limitedProvider, type ImageProvider, type ImageResult } from "../image-provider";
import { fetchImageBytes, imageDims } from "../slide-images";
import { parseLlmObject } from "../json";
import { llmComplete, llmEnabled } from "../llm";
import { mapPool } from "../quality";
import { extractMeta } from "../meta";
import { coreAdapterImageProvider, coreImageProvider } from "../../media/image";
import { FAL_ADAPTER_ID, falAdapter } from "../../media/adapters/fal";
import { INPUT_IMAGES_PARAM, STUDIO_BGREMOVE_PURPOSE, STUDIO_EDIT_PURPOSE, STUDIO_UPSCALE_PURPOSE } from "../../media/catalog";
import { normalize, type CatalogEntry } from "../../studio-core";
import { UserFacingError } from "../../server/user-error";
import type { AcademicDoc, BuiltFile, GenImage } from "../types";
import type { FormValues, ToolConfig } from "../../types";

/** One resolved input picture (bytes as base64, the mime stored with the upload). */
export type StudioInput = { mime: string; base64: string };
/** Resolved inputs by param name (`inputImages`), in the order the user gave them. */
export type StudioInputs = Readonly<Record<string, readonly StudioInput[]>>;

/** The Uzbek name of a utility job (doc prompt, viewer title, gallery line). */
export function toolJobLabel(purpose: string, values: Readonly<Record<string, unknown>>): string {
  if (purpose === STUDIO_UPSCALE_PURPOSE) return `Sifatini oshirish ×${String(values.factor) === "4" ? 4 : 2}`;
  if (purpose === STUDIO_BGREMOVE_PURPOSE) return "Fonni olib tashlash";
  return "Rasmni tahrirlash";
}

/** The provider prompt of an edit: the (English) instruction + «keep the rest». Pure. */
export function composeEditPrompt(instruction: string, inputs: number): string {
  const what = inputs > 1 ? `the ${inputs} attached images (the first one is the image to edit, the others are references)` : "the attached image";
  return [
    `Edit ${what} exactly as instructed: ${instruction.trim().replace(/[.!?\s]+$/, "")}.`,
    "Change only what the instruction asks for. Keep the composition, framing, lighting, the identity and faces of people and every detail that is not mentioned unchanged.",
    "Render text only where the instruction asks for it, spelled exactly as given. Return one edited image.",
  ].join(" ");
}

/**
 * The user's instruction in English for the edit model: one cheap LLM call (the «Rasm» `expandPrompt` pattern), the
 * user's text as is when the LLM is off or answers nothing usable. Quoted texts stay verbatim (the system prompt).
 */
async function editInstruction(user: string, deadline?: number): Promise<string> {
  if (!llmEnabled()) return user;
  const raw = await llmComplete(
    [
      "You translate an image-editing instruction into concise English for an image-editing model.",
      "The user may write Uzbek, Russian or mixed text. Translate the meaning; keep every detail; add no new ideas.",
      "Keep any text inside quotes exactly as written (do not translate it).",
      'Output JSON only: {"instruction":"..."}.',
    ].join(" "),
    `Instruction: «${user}»`,
    300,
    { json: true, timeoutMs: 20_000, deadline },
  );
  const out = String(parseLlmObject<{ instruction?: string }>(raw)?.instruction || "").trim();
  return out.length >= 3 ? out : user;
}

/** Pixel size of an input (PNG / JPEG head); a square 1024 when unreadable. */
function inputSize(a: StudioInput | undefined): { width: number; height: number } {
  if (!a) return { width: 1024, height: 1024 };
  const dims = imageDims(Buffer.from(a.base64, "base64"));
  return dims ? { width: dims.w, height: dims.h } : { width: 1024, height: 1024 };
}

const isRefusal = (r: ImageResult): boolean => !r.ok && r.detail.startsWith("moderation_blocked");

function mimeOf(dataUrl: string): string {
  const m = /^data:([\w.+-]+\/[\w.+-]+);base64,/.exec(dataUrl);
  return m ? m[1]!.toLowerCase() : "image/jpeg";
}

export async function buildStudioTool(
  tool: ToolConfig,
  values: FormValues,
  entry: CatalogEntry,
  purpose: string,
  inputs: StudioInputs | undefined,
  deadline?: number,
  onStage?: (ev: { progress: number; step: string }) => void,
): Promise<BuiltFile> {
  const stage = (progress: number, step: string) => onStage?.({ progress, step });
  stage(0, "So‘rov tayyorlanmoqda");
  const p = normalize(entry.params, values);
  const ids = Array.isArray(p[INPUT_IMAGES_PARAM]) ? (p[INPUT_IMAGES_PARAM] as readonly string[]) : [];
  const pictures = inputs?.[INPUT_IMAGES_PARAM] ?? [];
  if (ids.length === 0 || pictures.length !== ids.length) {
    throw new UserFacingError("Yuklangan rasm topilmadi — rasmni qayta yuklang. Kredit qaytariladi.");
  }
  const editing = purpose === STUDIO_EDIT_PURPOSE;
  const userPrompt = editing ? String(p.prompt ?? "").trim() : "";
  if (editing && userPrompt.length < 3) throw new Error("Nimani o‘zgartirish kerakligini yozing");
  const label = editing ? userPrompt : toolJobLabel(purpose, p);
  const count = editing ? Math.max(1, Math.min(4, Number(p.imageCount) || 1)) : 1;
  const size = inputSize(pictures[0]);

  // Limiter OUTSIDE the core call (the «Rasm» wiring rule, lib/media/image.ts).
  let provider: ImageProvider;
  if (entry.routes[0]?.adapter === FAL_ADAPTER_ID) {
    const { imageCount: _c, ...own } = p;
    void _c;
    provider = limitedProvider(coreAdapterImageProvider(purpose, entry.id, falAdapter(), { id: "fal", minMs: 8_000, values: { ...own, imageCount: 1 } }));
  } else if (entry.id === "google/nano-banana-edit") {
    const base = CORE_BASES.gemini;
    provider = limitedProvider(coreImageProvider(purpose, entry.id, base.provider, { upstream: base.upstream, values: { prompt: userPrompt, [INPUT_IMAGES_PARAM]: ids, imageCount: 1 } }));
  } else {
    throw new UserFacingError("Tanlangan model mavjud emas. Kredit qaytariladi.");
  }

  // Utility jobs carry no prompt: the provider ask is tagged with the op + inputs (idempotency step tag only).
  const prompt = editing ? composeEditPrompt(await editInstruction(userPrompt, deadline), pictures.length) : `${purpose} ${ids.join(",")} ${String(p.factor ?? "")}`;
  stage(10, editing ? (count > 1 ? `Rasm tahrirlanmoqda · 0/${count}` : "Rasm tahrirlanmoqda") : "Rasm ishlanmoqda");

  const refused: ImageResult[] = [];
  let done = 0;
  const raw = await mapPool(Array.from({ length: count }, (_, i) => i), 2, async (i) => {
    const res = await provider.fetchImage({ prompt, size, styleId: "photo", inputImages: pictures.map((x) => ({ mime: x.mime, base64: x.base64 })) }, deadline);
    if (isRefusal(res)) refused.push(res);
    done++;
    if (count > 1) stage(10 + Math.round((70 * done) / count), `Rasm tahrirlanmoqda · ${done}/${count}`);
    if (!res.ok) return null;
    const bytes = await fetchImageBytes(res.image.url);
    if (!bytes) return null;
    const url = `data:${bytes.data}`;
    const out: GenImage = { id: `img${i + 1}`, url, alt: label.slice(0, 80), w: bytes.w || size.width, h: bytes.h || size.height, mime: mimeOf(url) };
    return out;
  });
  const images = raw.filter((x): x is GenImage => Boolean(x));
  if (!images.length) {
    if (refused.length) throw new UserFacingError("So‘rov rasm modelining kontent qoidalariga mos kelmadi — mazmunini o‘zgartirib, qayta urinib ko‘ring. Kredit qaytariladi.");
    throw new Error("Rasm ishlanmadi. Qayta urinib ko‘ring.");
  }
  stage(85, "Fayl saqlanmoqda");

  const meta = extractMeta(tool, { ...values, topic: label });
  const doc: AcademicDoc = {
    meta,
    titlePage: false,
    toc: false,
    sections: [{ id: "prompt", title: "So‘rov", blocks: [{ kind: "p", text: label }] }],
    images,
    imagePrompt: label,
    imageModel: entry.id,
  };
  const files = images.map((im, i) => {
    const b64 = im.url.slice(im.url.indexOf("base64,") + "base64,".length);
    const mime = im.mime ?? "image/png";
    return { name: `rasm-${i + 1}.${mime === "image/png" ? "png" : "jpg"}`, bytes: new Uint8Array(Buffer.from(b64, "base64")), mime };
  });
  const packed = await packImages(files, meta.fileNameHint || "rasm", count);
  const html = `<article><h1>${label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</h1><p>${images.length} rasm</p></article>`;
  return { html, doc, ...packed };
}
