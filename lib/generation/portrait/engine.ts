/**
 * «Bitiruvchi portreti» engine (program-17 item 14): the user's selfie + gown/background/stola
 * options -> 1 or 2 graduation portraits through the Gemini image model (image-to-image edit).
 *
 * Money rules (same as the `image` tool, `packImages`):
 *   - NO picture at all (no clear face, model refused, provider down) -> the job THROWS, the worker
 *     fails it and refunds in full;
 *   - fewer pictures than paid for (2 asked, 1 came) -> `delivered {got, want}`, the worker refunds the
 *     difference (`refundPartial`).
 *
 * The selfie never reaches any provider other than Gemini (no chain, no fallback to a text-to-image
 * source that would draw a stranger), and it is NOT stored in the result: the document keeps only the
 * options and the finished pictures. The worker deletes the uploaded selfie after a successful build.
 */
import { geminiProvider } from "../image-provider-gemini";
import { limitedProvider, type ImageFail, type ImageProvider } from "../image-provider";
import { fetchImageBytes, sniffImageType } from "../slide-images";
import { extractMeta } from "../meta";
import { mapPool } from "../quality";
import { packImages, type ImageFile } from "../image-studio";
import { imageExt } from "../../viewers/kind";
import type { AcademicDoc, BuiltFile, GenImage } from "../types";
import type { FormValues, ToolConfig } from "../../types";
import { UserFacingError } from "../../server/user-error";
import { portraitPrompt } from "./prompt";
import { portraitBackgroundOf, portraitGownOf, portraitInputFromValues, portraitSashOf } from "./registry";

/** 4:5 portrait slot -> `aspectFor` picks the provider's "4:5". */
export const PORTRAIT_SIZE = { width: 896, height: 1120 } as const;

export type PortraitBuildOptions = {
  deadline?: number;
  onStage?: (ev: { progress: number; step: string }) => void;
  /** The selfie as a `data:` URL (the worker resolves `photoAssetId` from `photo_uploads`). */
  photo?: { url: string };
  /** Tests inject a stub; production uses Gemini behind the process-wide limiter. */
  provider?: ImageProvider;
};

let defaultProvider: ImageProvider | undefined;
const geminiLimited = () => (defaultProvider ??= limitedProvider(geminiProvider));

/** The user-facing reason for an all-failed run. */
export function portraitFailureMessage(fails: ImageFail[]): string {
  if (fails.some((f) => f.detail.startsWith("javobda rasm yo'q"))) {
    return "Suratda bitta aniq yuz topilmadi. Yuzingiz yaxshi ko‘rinadigan, yolg‘iz o‘zingiz tushgan suratni yuklang. Pul qaytariladi.";
  }
  if (fails.some((f) => f.reason === "no-key" || f.reason === "blocked")) {
    return "Rasm xizmati vaqtincha ishlamayapti. Keyinroq urinib ko‘ring. Pul qaytariladi.";
  }
  return "Portret yaratilmadi. Pul qaytariladi — qayta urinib ko‘ring.";
}

export async function buildPortraitArtifact(tool: ToolConfig, values: FormValues, opts: PortraitBuildOptions = {}): Promise<BuiltFile> {
  const stage = (progress: number, step: string) => opts.onStage?.({ progress, step });
  stage(0, "Surat tekshirilmoqda");
  const input = portraitInputFromValues(values);

  const src = opts.photo?.url ? await fetchImageBytes(opts.photo.url) : null;
  if (!src) throw new UserFacingError("Surat topilmadi. Suratni qayta yuklang. Pul qaytariladi.");
  const mime = src.type === "png" ? "image/png" : "image/jpeg";
  const base64 = src.data.slice(src.data.indexOf("base64,") + "base64,".length);

  const provider = opts.provider ?? geminiLimited();
  const want = input.variants;
  const meta = extractMeta(tool, { ...values, topic: "Bitiruvchi portreti" });
  stage(10, want > 1 ? `Portret chizilmoqda · 0/${want}` : "Portret chizilmoqda");

  let drawn = 0;
  const fails: ImageFail[] = [];
  const raw = await mapPool(Array.from({ length: want }, (_, i) => i), 2, async (i) => {
    const res = await provider.fetchImage(
      {
        prompt: portraitPrompt(input, i),
        size: PORTRAIT_SIZE,
        styleId: "photo",
        inputImages: [{ mime, base64 }],
      },
      opts.deadline,
    );
    drawn++;
    if (want > 1) stage(10 + Math.round((70 * drawn) / want), `Portret chizilmoqda · ${drawn}/${want}`);
    if (!res.ok) {
      fails.push(res);
      return null;
    }
    // Sniff the bytes: a provider that lies about the type must not slip a non-image through.
    const bytes = await fetchImageBytes(res.image.url);
    if (!bytes) return null;
    const out: GenImage = {
      id: `img${i + 1}`,
      url: `data:${bytes.data}`,
      alt: "Bitiruvchi portreti",
      w: bytes.w || PORTRAIT_SIZE.width,
      h: bytes.h || PORTRAIT_SIZE.height,
      mime: bytes.type === "png" ? "image/png" : "image/jpeg",
    };
    return out;
  });
  const images = raw.filter((x): x is GenImage => Boolean(x));
  if (!images.length) throw new UserFacingError(portraitFailureMessage(fails));
  stage(85, "Fayl saqlanmoqda");

  const files: ImageFile[] = images.map((im, i) => {
    const b64 = im.url.slice(im.url.indexOf("base64,") + "base64,".length);
    const bytes = new Uint8Array(Buffer.from(b64, "base64"));
    const kind = sniffImageType(Buffer.from(bytes.subarray(0, 16)));
    const fileMime = kind === "png" ? "image/png" : "image/jpeg";
    return { name: `portret-${i + 1}.${imageExt(fileMime)}`, bytes, mime: fileMime };
  });

  const gown = portraitGownOf(input.gown);
  const bg = portraitBackgroundOf(input.background);
  const sash = portraitSashOf(input.sash);
  const summary = [`${gown.label} xalat`, bg.label, sash.id === "none" ? "" : `${sash.label} stola`].filter(Boolean).join(" · ");
  const doc: AcademicDoc = {
    meta,
    titlePage: false,
    toc: false,
    sections: [{ id: "options", title: "Sozlamalar", blocks: [{ kind: "p", text: summary }] }],
    images,
    imagePrompt: "Bitiruvchi portreti",
    imageScene: summary,
    imageStyle: "photo",
    imageRatio: "3:4",
    portrait: { gown: input.gown, background: input.background, sash: input.sash, variants: want },
  };
  const packed = await packImages(files, "bitiruvchi-portreti", want);
  return { html: `<article><h1>Bitiruvchi portreti</h1><p>${images.length} rasm · ${summary}</p></article>`, doc, ...packed };
}
