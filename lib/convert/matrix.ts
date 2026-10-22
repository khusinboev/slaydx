/**
 * Free file converter: the source/target matrix, shared by the server
 * (`lib/server/convert.ts`) and the page, so the UI offers exactly the targets
 * the route accepts.
 *
 * NOT in v1: Excel (xls/xlsx/ods/csv). Calc is not in the web image (only
 * Writer and Impress are installed), so no source or target here is a
 * spreadsheet and the page has no such option.
 */

export type ConvertSource = "word" | "slides" | "pdf" | "image";
export type ConvertTarget = "pdf" | "png" | "jpg" | "webp" | "docx";

/** Declared extension -> source family (the bytes are checked separately, by magic). */
export const EXTENSION_SOURCE: Readonly<Record<string, ConvertSource>> = {
  docx: "word",
  doc: "word",
  odt: "word",
  rtf: "word",
  pptx: "slides",
  ppt: "slides",
  odp: "slides",
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
};

/** Targets per source family. Image -> same format is removed by `targetsFor`. */
const TARGETS: Readonly<Record<ConvertSource, readonly ConvertTarget[]>> = {
  word: ["pdf"],
  slides: ["pdf"],
  pdf: ["png", "jpg", "docx"],
  image: ["pdf", "png", "jpg", "webp"],
};

export const TARGET_LABEL: Readonly<Record<ConvertTarget, string>> = {
  pdf: "PDF",
  png: "PNG",
  jpg: "JPG",
  webp: "WebP",
  docx: "Word (DOCX)",
};

export const SOURCE_LABEL: Readonly<Record<ConvertSource, string>> = {
  word: "Word hujjat",
  slides: "Taqdimot",
  pdf: "PDF",
  image: "Rasm",
};

export const CONVERT_MAX_BYTES = 20 * 1024 * 1024;
export const CONVERT_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
/** PDF -> image/Word: at most this many pages (more -> 413). */
export const CONVERT_MAX_PAGES = 30;

export function isConvertTarget(v: unknown): v is ConvertTarget {
  return v === "pdf" || v === "png" || v === "jpg" || v === "webp" || v === "docx";
}

export function extensionOf(fileName: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(fileName.trim());
  return m ? m[1]!.toLowerCase() : "";
}

/** Source family implied by the file name, or `null` for an unsupported extension. */
export function sourceOfName(fileName: string): ConvertSource | null {
  return EXTENSION_SOURCE[extensionOf(fileName)] ?? null;
}

/** Image format id of an extension (`jpeg` = `jpg`); `null` for non-images. */
export function imageFormatOfName(fileName: string): "png" | "jpg" | "webp" | null {
  const e = extensionOf(fileName);
  if (e === "png") return "png";
  if (e === "jpg" || e === "jpeg") return "jpg";
  if (e === "webp") return "webp";
  return null;
}

/** Valid targets for a source; for an image the file's own format is not offered. */
export function targetsFor(source: ConvertSource, fileName = ""): ConvertTarget[] {
  const all = [...TARGETS[source]];
  if (source !== "image") return all;
  const own = imageFormatOfName(fileName);
  return all.filter((t) => t !== own);
}

export function maxBytesFor(source: ConvertSource): number {
  return source === "image" ? CONVERT_IMAGE_MAX_BYTES : CONVERT_MAX_BYTES;
}
