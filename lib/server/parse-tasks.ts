import { extractFromBuffer } from "../extract-text";
import { extractSegments, stripTokens } from "../generation/translate/index";
import { parsePptxTemplate, TemplateError, type TemplateErrorCode, type TemplateProfile } from "../generation/pptx-template";
import { PdfPageLimitError } from "../generation/translate/pdf";
import type { SourceKind } from "../generation/source-types";

/**
 * Foydalanuvchi faylini tahlil qilish vazifalari — `parse-worker.ts` (alohida
 * thread) va `parse-pool.ts` ning in-process zaxirasi SHU funksiyalarni
 * chaqiradi. Modul ATAYIN `server-only` siz va Next/DB ga bog'lanmagan:
 * u worker thread ichida (dev/testda tsx, prodda esbuild to'plami) yuklanadi.
 *
 * Kirish/chiqish structured clone orqali thread chegarasidan o'tadi —
 * shuning uchun faqat oddiy obyektlar, xato esa `SerializedError`.
 */

export type ParseTask =
  | { kind: "extract"; name: string; bytes: Uint8Array }
  | { kind: "source"; source: SourceKind; bytes: Uint8Array }
  | { kind: "template"; bytes: Uint8Array };

export type ExtractResult = { text: string; error?: string; truncated?: boolean };

/** Tarjima manbasi o'lchovi — `source-upload.ts` `SourceCounter` shartnomasi. */
export type SourceCount = { chars: number; text: string; pages?: number; segments: number };

export type ParseResultOf<T extends ParseTask> = T extends { kind: "extract" }
  ? ExtractResult
  : T extends { kind: "source" }
    ? SourceCount
    : TemplateProfile;

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * `chars` — TARJIMA QILINADIGAN segmentlar yig'indisi (narx shundan), `text` —
 * ko'rish uchun tokenlarsiz matn. PDF sahifa soni `extractPdf` dan olinadi —
 * ilgari u yo'q bo'lsa PDF ikkinchi marta ochilardi, amalda esa har doim bor.
 */
export async function countSource(kind: SourceKind, bytes: Uint8Array): Promise<SourceCount> {
  const extracted = await extractSegments(kind, bytes);
  const text = extracted.segments.map((s) => stripTokens(s.text)).join("\n");
  const pages = kind === "pdf" ? extracted.pdf?.pages : undefined;
  return { chars: extracted.chars, text, pages, segments: extracted.segments.length };
}

export async function runParseTask<T extends ParseTask>(task: T): Promise<ParseResultOf<T>> {
  switch (task.kind) {
    case "extract":
      return (await extractFromBuffer(task.name, arrayBufferOf(task.bytes))) as ParseResultOf<T>;
    case "source":
      return (await countSource(task.source, task.bytes)) as ParseResultOf<T>;
    default:
      return (await parsePptxTemplate(task.bytes)) as ParseResultOf<T>;
  }
}

/** Thread chegarasidan o'tadigan xato ko'rinishi. */
export type SerializedError = { name: string; message: string; code?: string; pages?: number };

export function serializeError(e: unknown): SerializedError {
  if (e instanceof TemplateError) return { name: "TemplateError", message: e.message, code: e.code };
  if (e instanceof PdfPageLimitError) return { name: "PdfPageLimitError", message: e.message, pages: e.pages };
  if (e instanceof Error) return { name: e.name, message: e.message };
  return { name: "Error", message: String(e) };
}

/** Chaqiruvchi `instanceof` bilan ajrata olishi uchun asl xato turlari tiklanadi. */
export function reviveError(e: SerializedError): Error {
  if (e.name === "TemplateError") return new TemplateError((e.code ?? "not-pptx") as TemplateErrorCode, e.message);
  if (e.name === "PdfPageLimitError") return new PdfPageLimitError(e.pages ?? 0);
  const err = new Error(e.message);
  err.name = e.name;
  return err;
}
