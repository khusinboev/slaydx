import "server-only";
import JSZip from "jszip";
import { CONVERT_MAX_PAGES, imageFormatOfName, maxBytesFor, sourceOfName, targetsFor, type ConvertSource, type ConvertTarget } from "../convert/matrix";
import { buildJpegPdf, type JpegPage } from "../convert/jpeg-pdf";
import { extractMeta } from "../generation/meta";
import { renderDocx } from "../generation/render-docx";
import { pdfBlocksToDoc, pdfToBlocks } from "../generation/translate/index";
import { PdfPageLimitError } from "../generation/translate/pdf";
import { TOOL_BY_ID } from "../tools";
import { ApiError } from "./api";
import { query } from "./db";
import { isDownloadError } from "./downloads/errors";
import { pdftoppmPages } from "./downloads/producers";
import { pdfAvailable, toPdf } from "./pdf";
import { rateLimit, windowStartOf } from "./ratelimit";
import { getSetting } from "./settings";
import { Gate, SofficeBusyError } from "./soffice-gate";
import { TASHKENT_UTC_OFFSET_SEC } from "./spend";

/**
 * FREE file converter (owner request 13). `convertFile` validates by magic
 * bytes, enforces the size caps, takes one slot in a DEDICATED lane (never the
 * shared download gate, so free conversions cannot starve paid downloads),
 * charges the per-user daily quota INSIDE the slot (a busy 503 burns nothing)
 * and returns the bytes. Nothing is stored.
 *
 * Not in v1: Excel (Calc is not in the image).
 */

export const CONVERT_BUSY_MESSAGE = "Hozir band, bir daqiqadan keyin urinib ko'ring";
const DAY_SEC = 86_400;
const BUSY_RETRY_SEC = 60;
/** PDF -> image: page images are held in memory before zipping. */
const PAGES_CAP = { pages: CONVERT_MAX_PAGES, bytes: 60 * 1024 * 1024 };
const PDF_DOCX_TIMEOUT_MS = 40_000;
/** Decompression-bomb guard for sharp (pixels). */
const MAX_PIXELS = 60_000_000;
const RASTER_DPI = 150;

/** LibreOffice lane: ONE at a time, a few waiters, 20 s wait. */
export const CONVERT_LANE = { max: 1, waitMs: 20_000, maxWaiters: 5, retryAfterSec: 20 } as const;
/** sharp / pdftoppm / pdf.js lane: a tiny semaphore of 2. */
export const CONVERT_LIGHT_LANE = { max: 2, waitMs: 20_000, maxWaiters: 5, retryAfterSec: 20 } as const;

type Globals = typeof globalThis & { __slaydxConvertGate?: Gate; __slaydxConvertLight?: Gate };
const g = globalThis as Globals;

export function convertGate(): Gate {
  g.__slaydxConvertGate ??= new Gate({ ...CONVERT_LANE });
  return g.__slaydxConvertGate;
}
export function convertLightGate(): Gate {
  g.__slaydxConvertLight ??= new Gate({ ...CONVERT_LIGHT_LANE });
  return g.__slaydxConvertLight;
}

export type ConvertResult = { bytes: Buffer; mime: string; fileName: string };
export type ConvertInput = { name: string; bytes: Uint8Array };

type Detected = { source: ConvertSource; format: string };

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MIME: Record<ConvertTarget | "zip", string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  docx: DOCX_MIME,
  zip: "application/zip",
};

function startsWith(b: Uint8Array, sig: number[], at = 0): boolean {
  return sig.every((v, i) => b[at + i] === v);
}

/** What the BYTES are (never the extension). `null` = not a supported format. */
export async function detectFormat(bytes: Uint8Array): Promise<Detected | null> {
  if (Buffer.from(bytes.subarray(0, 1024)).includes("%PDF-")) return { source: "pdf", format: "pdf" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { source: "image", format: "png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { source: "image", format: "jpg" };
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return { source: "image", format: "webp" };
  if (startsWith(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66])) return { source: "word", format: "rtf" };
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    try {
      const zip = await JSZip.loadAsync(bytes);
      if (zip.file("word/document.xml")) return { source: "word", format: "docx" };
      if (zip.file("ppt/presentation.xml")) return { source: "slides", format: "pptx" };
      const mt = (await zip.file("mimetype")?.async("string"))?.trim();
      if (mt === "application/vnd.oasis.opendocument.text") return { source: "word", format: "odt" };
      if (mt === "application/vnd.oasis.opendocument.presentation") return { source: "slides", format: "odp" };
    } catch {
      return null;
    }
    return null;
  }
  // Legacy OLE2 (.doc / .ppt): tell them apart by their stream names (UTF-16LE); .xls has neither.
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    const buf = Buffer.from(bytes);
    if (buf.includes(Buffer.from("PowerPoint Document", "utf16le"))) return { source: "slides", format: "ppt" };
    if (buf.includes(Buffer.from("WordDocument", "utf16le"))) return { source: "word", format: "doc" };
  }
  return null;
}

function safeBase(name: string): string {
  const base = name
    .replace(/\.[A-Za-z0-9]{1,8}$/, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return base || "fayl";
}

function apiBusy(): ApiError {
  return new ApiError(CONVERT_BUSY_MESSAGE, 503, { code: "busy", retryAfter: BUSY_RETRY_SEC });
}
const FAILED = () => new ApiError("Faylni o'girib bo'lmadi — fayl buzilgan yoki qo'llab-quvvatlanmaydi", 422, { code: "failed" });
const DISABLED_TEXT = "Fayl konvertatsiyasi vaqtincha o'chirilgan";

/* ───────────────────────────── quota ───────────────────────────── */

const dayBucket = (userId: string) => `convert:day:${userId}`;

export async function convertPolicy(): Promise<{ enabled: boolean; limit: number }> {
  const [disabled, limit] = await Promise.all([getSetting("convert.disabled"), getSetting("convert.daily_limit")]);
  return { enabled: !disabled && limit > 0, limit };
}

/** «Bugun qoldi» without charging anything. */
export async function convertStatus(userId: string, now = Date.now()): Promise<{ enabled: boolean; limit: number; used: number; remaining: number }> {
  const policy = await convertPolicy();
  const start = windowStartOf(now, DAY_SEC, TASHKENT_UTC_OFFSET_SEC);
  const rows = await query<{ hits: number }>("SELECT hits FROM rate_limits WHERE bucket = $1 AND window_start = $2", [dayBucket(userId), start]).catch(() => []);
  const used = Math.min(rows[0]?.hits ?? 0, policy.limit);
  return { ...policy, used, remaining: Math.max(0, policy.limit - used) };
}

async function charge(userId: string, limit: number): Promise<number> {
  const at = Date.now();
  const r = await rateLimit(dayBucket(userId), limit, DAY_SEC, { offsetSec: TASHKENT_UTC_OFFSET_SEC, failClosed: true, now: at });
  if (!r.ok) {
    throw new ApiError(
      r.error ? "Xizmat hozir band — birozdan keyin qayta urinib ko'ring" : `Bugungi limit tugadi (${limit} ta). Ertaga (Toshkent vaqti bilan 00:00 dan keyin) qayta urinib ko'ring`,
      r.error ? 503 : 429,
      { code: r.error ? "busy" : "daily_limit", retryAfter: r.retryAfterSec },
    );
  }
  return at;
}

/** A conversion that produced nothing does not use up the user's quota. */
async function refund(userId: string, at: number): Promise<void> {
  await query("UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE bucket = $1 AND window_start = $2", [
    dayBucket(userId),
    windowStartOf(at, DAY_SEC, TASHKENT_UTC_OFFSET_SEC),
  ]).catch((e) => console.error("[convert] refund", e instanceof Error ? e.message : e));
}

/* ───────────────────────────── converters ───────────────────────────── */

async function sharpOf(bytes: Uint8Array) {
  const sharp = (await import("sharp")).default;
  return sharp(Buffer.from(bytes), { limitInputPixels: MAX_PIXELS, failOn: "error" }).rotate();
}

async function imageToImage(bytes: Uint8Array, target: "png" | "jpg" | "webp"): Promise<Buffer> {
  const img = await sharpOf(bytes);
  if (target === "png") return img.png().toBuffer();
  if (target === "webp") return img.webp({ quality: 88 }).toBuffer();
  return img.flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

async function imageToPdf(bytes: Uint8Array): Promise<Buffer> {
  const img = await sharpOf(bytes);
  const { data, info } = await img
    .flatten({ background: "#ffffff" })
    .resize({ width: 3500, height: 3500, fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  const page: JpegPage = { jpeg: data, width: info.width, height: info.height };
  return buildJpegPdf([page]);
}

async function pdfToPages(bytes: Uint8Array, target: "png" | "jpg", base: string): Promise<ConvertResult> {
  let pages: Buffer[] | null;
  try {
    pages = await pdftoppmPages(Buffer.from(bytes), RASTER_DPI, PAGES_CAP);
  } catch (e) {
    if (isDownloadError(e) && e.code === "too_large") {
      throw new ApiError(`PDF ${CONVERT_MAX_PAGES} sahifadan oshmasligi kerak`, 413, { code: "too_many_pages" });
    }
    throw e;
  }
  if (!pages?.length) throw FAILED();
  const files = await Promise.all(
    pages.map(async (png) => (target === "png" ? png : (await sharpOf(png)).flatten({ background: "#ffffff" }).jpeg({ quality: 88, mozjpeg: true }).toBuffer())),
  );
  if (files.length === 1) return { bytes: files[0]!, mime: MIME[target], fileName: `${base}.${target}` };
  const zip = new JSZip();
  const width = Math.max(2, String(files.length).length);
  files.forEach((f, i) => zip.file(`${base}-${String(i + 1).padStart(width, "0")}.${target}`, f, { compression: "STORE" }));
  return { bytes: await zip.generateAsync({ type: "nodebuffer", compression: "STORE" }), mime: MIME.zip, fileName: `${base}-sahifalar.zip` };
}

async function pdfToDocx(bytes: Uint8Array, base: string): Promise<ConvertResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const parsed = await Promise.race([
      pdfToBlocks(bytes),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error("pdf.js timeout")), PDF_DOCX_TIMEOUT_MS);
      }),
    ]);
    if (!parsed.blocks.length) {
      throw new ApiError("PDF dan matn chiqmadi — skaner (rasmli) PDF bo'lishi mumkin", 422, { code: "no_text" });
    }
    const meta = { ...extractMeta(TOOL_BY_ID.essay, { topic: base } as never), toolId: "translation" as const };
    const doc = pdfBlocksToDoc(parsed.blocks, new Map(), meta);
    return { bytes: Buffer.from(await renderDocx(doc)), mime: MIME.docx, fileName: `${base}.docx` };
  } catch (e) {
    if (e instanceof PdfPageLimitError) throw new ApiError("PDF juda uzun — Word ga o'girish uchun sahifalar soni oshib ketdi", 413, { code: "too_many_pages" });
    if (e instanceof ApiError) throw e;
    console.warn("[convert] pdf->docx", e instanceof Error ? e.message : e);
    throw FAILED();
  } finally {
    clearTimeout(timer);
  }
}

/* ───────────────────────────── entry ───────────────────────────── */

export async function convertFile(userId: string, file: ConvertInput, target: ConvertTarget): Promise<ConvertResult> {
  const policy = await convertPolicy();
  if (!policy.enabled) throw new ApiError(DISABLED_TEXT, 503, { code: "disabled" });

  const declared = sourceOfName(file.name);
  if (!declared) throw new ApiError("Bu fayl turi qo'llab-quvvatlanmaydi (Word, PowerPoint, PDF, PNG/JPG/WebP)", 400, { code: "unsupported" });
  if (!file.bytes.byteLength) throw new ApiError("Fayl bo'sh", 400);
  const cap = maxBytesFor(declared);
  if (file.bytes.byteLength > cap) {
    throw new ApiError(`Fayl ${Math.round(cap / 1024 / 1024)} MB dan katta bo'lmasligi kerak`, 413, { code: "too_large" });
  }
  const detected = await detectFormat(file.bytes);
  if (!detected || detected.source !== declared) {
    throw new ApiError("Fayl mazmuni kengaytmasiga mos emas yoki buzilgan", 400, { code: "mismatch" });
  }
  // The cap for the DETECTED family (a pdf renamed .png is already a mismatch above).
  const valid = targetsFor(detected.source, `x.${detected.format}`);
  if (!valid.includes(target)) {
    throw new ApiError(
      detected.source === "image" && imageFormatOfName(file.name) === target ? "Fayl allaqachon shu formatda" : "Bu fayl turini tanlangan formatga o'girib bo'lmaydi",
      400,
      { code: "bad_target" },
    );
  }

  const base = safeBase(file.name);
  let chargedAt = 0;
  const pay = async () => {
    chargedAt = await charge(userId, policy.limit);
  };
  try {
    if (detected.source === "word" || detected.source === "slides") {
      if (!pdfAvailable()) throw new ApiError("Bu o'girish hozir serverda mavjud emas", 503, { code: "unavailable" });
      const pdf = await toPdf(file.bytes, `manba.${detected.format}`, { gate: convertGate(), beforeRun: pay });
      if (!pdf) throw FAILED();
      return { bytes: pdf, mime: MIME.pdf, fileName: `${base}.pdf` };
    }
    return await convertLightGate().run(async () => {
      await pay();
      if (detected.source === "image") {
        if (target === "pdf") return { bytes: await imageToPdf(file.bytes), mime: MIME.pdf, fileName: `${base}.pdf` };
        const t = target as "png" | "jpg" | "webp";
        return { bytes: await imageToImage(file.bytes, t), mime: MIME[t], fileName: `${base}.${t}` };
      }
      return target === "docx" ? pdfToDocx(file.bytes, base) : pdfToPages(file.bytes, target as "png" | "jpg", base);
    });
  } catch (e) {
    if (e instanceof SofficeBusyError) throw apiBusy();
    // sharp rejects a corrupt image / a pixel bomb with a plain Error: that is the user's file.
    const refundable = chargedAt > 0;
    if (refundable) await refund(userId, chargedAt);
    if (e instanceof ApiError) throw e;
    console.warn("[convert]", e instanceof Error ? e.message : e);
    throw FAILED();
  }
}
