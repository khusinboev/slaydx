/**
 * Download format registry — the single source of truth for "which files can
 * the user get for this result" (docs/mobile/PLAN.md §4.1, owner decision O1
 * "wide set", docs/mobile/R1-download.md §3).
 *
 * Pure and client-safe: no server imports, no DOM. The same list drives
 *  - the «Yuklab olish» sheet rows (label, hint, order, spinner for `convert`),
 *  - the server prepare route, which rejects any format this module does not
 *    return for that generation (`formatById`),
 *  - «Yuklab olish», «Ulashish» and «Saqlash»: all three sheets list this registry's order
 *    (todo sprint 2026-10-07); `defaultShareFormat` is the format used when a material has a
 *    single format and no sheet is shown.
 *
 * Every id has a server producer (`lib/server/downloads/`) and a differential
 * test: there are no decorative options.
 *
 * Ordering rule: the stored ("native") file first, then derived formats —
 * except the resume, where PDF comes first (that is what employers ask for).
 * `features.pdf === false` (no LibreOffice on this deployment) removes PDF and
 * everything produced from the PDF (slide images).
 */
import type { ToolId } from "../types";

/** Every downloadable variant. `native` = the stored file, whatever its format. */
export const DOWNLOAD_FORMAT_IDS = [
  "native",
  "pdf",
  "slides-png",
  "jpg",
  "transcript-txt",
  "glossary-csv",
  "results-csv",
] as const;

export type DownloadFormatId = (typeof DOWNLOAD_FORMAT_IDS)[number];

export type DownloadFormat = {
  id: DownloadFormatId;
  /** Row title in Uzbek, e.g. «PowerPoint (PPTX)». */
  label: string;
  /** Short purpose line under the title, e.g. «Tahrirlash uchun». */
  hint?: string;
  /** File extension without the dot (the file name the user receives ends with it). */
  ext: string;
  /**
   * Expected media type. For `native` it is derived from the stored format; the
   * server may send the stored row's exact mime (same type, maybe other params).
   */
  mime: string;
  /** `instant` — bytes exist or are a cheap serialization; `convert` — the server converts (show a spinner). */
  cost: "instant" | "convert";
  /** Server capability required: `pdf` = LibreOffice, `pdftoppm` = LibreOffice + pdftoppm (both behind `features.pdf`). */
  needs?: "pdf" | "pdftoppm";
};

/**
 * What the registry needs to know about a finished generation.
 *
 * - `type`: `Generation.type` (a `ToolId`; unknown strings get the stored file only).
 * - `format`: `Generation.format` (stored extension: docx, pptx, png, jpg, zip, xlsx, txt, md, csv, mp3).
 * - `translationKind`: `doc.translation.sourceKind` ("text", "pdf", "docx", …) for the translator.
 * - `imageCount`: `doc.images.length` (image tool; shown in the ZIP hint).
 * - `hasResults`: the interactive game (sorting, listening) has at least one player result.
 *
 * `downloadSubject()` fills the first four from a generation row.
 */
export type DownloadSubject = {
  type: string;
  format: string;
  translationKind?: string | null;
  imageCount?: number;
  hasResults?: boolean;
};

/** Server capabilities the client learns from `/api/auth/me` `features`. */
export type DownloadFeatures = { pdf: boolean };

/** Derived (non-native) formats a tool may offer, in sheet order. `native` is implied. */
type Extra = Exclude<DownloadFormatId, "native">;
type ToolPlan = {
  /** Derived formats after the native file (or around it, see `pdfFirst`). */
  extras: readonly Extra[];
  /** List PDF before the native file (resume). */
  pdfFirst?: boolean;
};

const DOC: ToolPlan = { extras: ["pdf"] };

/**
 * One explicit decision per tool. A `Record<ToolId, …>` so adding a tool to
 * `ToolId` without a decision fails the typecheck; `tests/download-formats.test.mts`
 * additionally pins the full matrix against `lib/tools.ts TOOLS`.
 */
const TOOL_PLANS: Readonly<Record<ToolId, ToolPlan>> = {
  slide: { extras: ["pdf", "slides-png"] },
  "pro-slide": { extras: ["pdf", "slides-png"] },
  coursework: DOC,
  referat: DOC,
  "mustaqil-ish": DOC,
  essay: DOC,
  article: DOC,
  thesis: DOC,
  resume: { extras: ["pdf"], pdfFirst: true },
  translation: DOC,
  "lesson-plan": DOC,
  "texnologik-xarita": DOC,
  keys: DOC,
  test: DOC,
  glossary: { extras: ["pdf", "glossary-csv"] },
  crossword: DOC,
  flashcards: DOC,
  sorting: { extras: ["pdf", "results-csv"] },
  listening: { extras: ["pdf", "results-csv"] },
  image: { extras: ["jpg"] },
  infographic: { extras: ["jpg"] },
  podcast: { extras: ["transcript-txt"] },
  greeting: { extras: ["transcript-txt"] },
};

/** Tool ids that have a download decision (equals every `ToolId`). */
export const DOWNLOAD_TOOL_IDS: readonly ToolId[] = Object.keys(TOOL_PLANS) as ToolId[];

/** LibreOffice converts only these stored formats (the web image has no Calc, so no XLSX → PDF). */
const PDF_SOURCE_FORMATS: ReadonlySet<string> = new Set(["docx", "pptx"]);

const EDIT_HINT = "Tahrirlash uchun";

/** Native row presentation per stored format. */
const NATIVE: Readonly<Record<string, { label: string; hint?: string; mime: string }>> = {
  pptx: {
    label: "PowerPoint (PPTX)",
    hint: EDIT_HINT,
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  docx: {
    label: "Word (DOCX)",
    hint: EDIT_HINT,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  xlsx: {
    label: "Excel (XLSX)",
    hint: EDIT_HINT,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  png: { label: "Rasm (PNG)", hint: "Asl sifatda", mime: "image/png" },
  jpg: { label: "Rasm (JPG)", hint: "Asl sifatda", mime: "image/jpeg" },
  zip: { label: "Barcha rasmlar (ZIP)", mime: "application/zip" },
  mp3: { label: "Audio (MP3)", hint: "Tinglash va yuborish uchun", mime: "audio/mpeg" },
  txt: { label: "Matn (TXT)", mime: "text/plain; charset=utf-8" },
  md: { label: "Markdown (MD)", mime: "text/markdown; charset=utf-8" },
  csv: { label: "Jadval (CSV)", mime: "text/csv; charset=utf-8" },
};

/** Translator inputs whose output keeps the source file format (text and PDF input become DOCX). */
const SAME_FORMAT_TRANSLATION: ReadonlySet<string> = new Set(["docx", "pptx", "xlsx", "txt", "md", "csv"]);

function nativeFormat(g: DownloadSubject): DownloadFormat {
  const ext = g.format.toLowerCase();
  const known = NATIVE[ext];
  const base: DownloadFormat = known
    ? { id: "native", label: known.label, ext, mime: known.mime, cost: "instant" }
    : { id: "native", label: `Fayl (${ext.toUpperCase()})`, ext, mime: "application/octet-stream", cost: "instant" };
  let hint = known?.hint;
  if (ext === "zip" && g.imageCount && g.imageCount > 1) hint = `${g.imageCount} ta rasm`;
  if (g.type === "translation" && g.translationKind && SAME_FORMAT_TRANSLATION.has(g.translationKind)) {
    hint = "Asl fayl formatida";
  }
  return hint ? { ...base, hint } : base;
}

const PDF_HINT = "Chop etish va yuborish uchun";

function extraFormat(id: Extra, g: DownloadSubject): DownloadFormat {
  switch (id) {
    case "pdf":
      return {
        id,
        label: "PDF",
        hint: g.type === "resume" ? "Ish beruvchiga yuborish uchun" : PDF_HINT,
        ext: "pdf",
        mime: "application/pdf",
        cost: "convert",
        needs: "pdf",
      };
    case "slides-png":
      return {
        id,
        label: "Slaydlar rasm (PNG, ZIP)",
        hint: "Har slayd alohida rasm",
        ext: "zip",
        mime: "application/zip",
        cost: "convert",
        needs: "pdftoppm",
      };
    case "jpg":
      return { id, label: "Rasm (JPG)", hint: "Kichikroq hajm", ext: "jpg", mime: "image/jpeg", cost: "convert" };
    case "transcript-txt":
      return {
        id,
        label: "Audio matni (TXT)",
        hint: "Aytilgan matn",
        ext: "txt",
        mime: "text/plain; charset=utf-8",
        cost: "instant",
      };
    case "glossary-csv":
      return {
        id,
        label: "Atamalar jadvali (CSV)",
        hint: "Excel yoki Google Sheets uchun",
        ext: "csv",
        mime: "text/csv; charset=utf-8",
        cost: "instant",
      };
    case "results-csv":
      return {
        id,
        label: "Natijalar (CSV)",
        hint: "O‘yinchilar natijalari jadvali",
        ext: "csv",
        mime: "text/csv; charset=utf-8",
        cost: "instant",
      };
  }
}

/** Whether a derived format applies to this generation (format/feature/data preconditions). */
function applies(id: Extra, g: DownloadSubject, features: DownloadFeatures): boolean {
  const fmt = g.format.toLowerCase();
  switch (id) {
    case "pdf":
      return features.pdf && PDF_SOURCE_FORMATS.has(fmt);
    case "slides-png":
      return features.pdf && fmt === "pptx";
    case "jpg":
      // Only a single PNG becomes a JPG; a stored JPG is already one, a ZIP holds several images.
      return fmt === "png";
    case "transcript-txt":
      return fmt === "mp3";
    case "glossary-csv":
      return fmt === "docx";
    case "results-csv":
      return g.hasResults === true;
  }
}

function planOf(type: string): ToolPlan | null {
  return Object.prototype.hasOwnProperty.call(TOOL_PLANS, type) ? TOOL_PLANS[type as ToolId] : null;
}

/**
 * Ordered download rows for a finished generation. Never empty: the stored
 * file is always offered. An unknown `type` gets the stored file only.
 */
export function downloadFormats(g: DownloadSubject, features: DownloadFeatures): DownloadFormat[] {
  const native = nativeFormat(g);
  const plan = planOf(g.type);
  if (!plan) return [native];
  const extras = plan.extras.filter((id) => applies(id, g, features)).map((id) => extraFormat(id, g));
  if (plan.pdfFirst) {
    const pdf = extras.find((f) => f.id === "pdf");
    if (pdf) return [pdf, native, ...extras.filter((f) => f !== pdf)];
  }
  return [native, ...extras];
}

/**
 * The row for `id` if it is offered for this generation, else `null`.
 * The server prepare route uses this to validate the requested format.
 */
export function formatById(g: DownloadSubject, features: DownloadFeatures, id: string): DownloadFormat | null {
  if (!isDownloadFormatId(id)) return null;
  return downloadFormats(g, features).find((f) => f.id === id) ?? null;
}

/** Type guard for untrusted input (request bodies, URL params). */
export function isDownloadFormatId(v: unknown): v is DownloadFormatId {
  return typeof v === "string" && (DOWNLOAD_FORMAT_IDS as readonly string[]).includes(v);
}

/**
 * Format used by «Ulashish» and «Saqlash» for a material that has only one format (no sheet
 * is shown): the stored file (owner decision O2: editable, no conversion, images sent as
 * documents to keep quality). Materials with several formats open the sheet instead, in
 * registry order.
 */
export function defaultShareFormat(g: DownloadSubject): DownloadFormat {
  return nativeFormat(g);
}

/**
 * Builds a `DownloadSubject` from a generation row (client `Generation` /
 * `GenerationDetail`, or the server row with `doc_json`). `hasResults` is not in
 * the row — pass it from the results endpoint for sorting/listening.
 */
export function downloadSubject(
  g: {
    type: string;
    format: string;
    doc?: { translation?: { sourceKind?: string } | null; images?: readonly unknown[] | null } | null;
  },
  extra: { hasResults?: boolean } = {},
): DownloadSubject {
  const s: DownloadSubject = { type: g.type, format: g.format };
  const kind = g.doc?.translation?.sourceKind;
  if (kind) s.translationKind = kind;
  const n = g.doc?.images?.length;
  if (typeof n === "number") s.imageCount = n;
  if (extra.hasResults !== undefined) s.hasResults = extra.hasResults;
  return s;
}
