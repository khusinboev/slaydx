import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import type { DownloadFormat, DownloadFormatId } from "@/lib/downloads/formats";
import type { AcademicDoc } from "@/lib/generation/types";
import type { GlossaryTerm } from "@/lib/generation/teacher/types";
import { limit } from "../api";
import { CSV_BOM, csvHeadLine, csvRecord, csvRowLine } from "../csv";
import { env } from "../env";
import { iterateAllResultRows, type GameResult } from "../game-sessions";
import { pdfAvailable, pdfFileName, PDF_TIMEOUT_MS } from "../pdf";
import { derivedSize, getOrConvertPdf, getOrDerive, touchDerived, type DerivedDiskCache, type PdfConverter } from "../pdf-cache";
import { Gate } from "../soffice-gate";
import { pdftoppmBin } from "../thumb";
import { DownloadError, isDownloadError } from "./errors";

const run = promisify(execFile);

/**
 * One producer per registry format id (`lib/downloads/formats.ts`,
 * docs/mobile/PLAN.md §4.1: "every id has a server producer"). The map is a
 * `Record<DownloadFormatId, …>`, so a new registry id without a producer fails
 * the typecheck, and `tests/download-produce.test.mts` checks the map at runtime.
 *
 * Kinds:
 *   stored  — the BYTEA file as is;
 *   derived — converted from the stored bytes, kept in the derived-file disk
 *             cache keyed {genId, sha(bytes), format} (pdf, slides-png, jpg);
 *   instant — a cheap serialization of the document model, built per request
 *             (transcript, glossary, results — results change over time).
 */

/** What producers know about the generation (ownership already checked in SQL). */
export type SourceMeta = {
  id: string;
  userId: string;
  toolId: string;
  /** Stored format (`generations.format`). */
  format: string;
  status: string;
  docVersion: number;
  fileVersion: number;
  doc: AcademicDoc | null;
  /** `generation_files` row (null = no stored file). */
  fileName: string | null;
  mime: string | null;
  sizeBytes: number | null;
};

export type ProduceDeps = {
  /** LibreOffice present (default `pdfAvailable`). */
  pdfAvailable?: () => boolean;
  /** pdftoppm present (default: binary lookup). */
  rasterAvailable?: () => boolean;
  /** DOCX/PPTX → PDF (default `toPdf` through the shared soffice gate). */
  convertPdf?: PdfConverter;
  /** PDF → one PNG per page (default pdftoppm). `null` = failed. */
  rasterize?: (pdf: Buffer, dpi: number, cap: SlidesPngCap) => Promise<Buffer[] | null>;
  /** `slides-png` page-count / total-size cap (default `SLIDES_PNG_CAP`). */
  slidesPngCap?: SlidesPngCap;
  /** PNG → JPG (default sharp). */
  toJpeg?: (png: Buffer) => Promise<Buffer>;
  cache?: DerivedDiskCache;
  /** Per-user limit for real PDF conversions (default `pdf:<user>` 10 / 10 min, shared with `…/file?format=pdf`). */
  pdfLimit?: (userId: string) => Promise<void>;
  /** Per-user limit for real rasterizations (default `raster:<user>` 10 / 10 min). */
  rasterLimit?: (userId: string) => Promise<void>;
  /** Game results of the owner (default `iterateAllResultRows`). */
  results?: (generationId: string, userId: string) => AsyncGenerator<GameResult>;
};

export type ProducerCtx = {
  meta: SourceMeta;
  format: DownloadFormat;
  /** Stored file bytes (read lazily — the stored/instant paths may not need them). */
  nativeBytes: () => Promise<Buffer>;
  deps: ProduceDeps;
};

export type ProducerSpec = {
  kind: "stored" | "derived" | "instant";
  /** Name of the file the user receives (known without producing — HEAD needs it). */
  fileName: (meta: SourceMeta) => string;
  produce: (ctx: ProducerCtx) => Promise<Buffer>;
};

/** Slide images resolution (lead decision: one ZIP at 150 dpi). */
export const SLIDES_PNG_DPI = 150;
/** pdftoppm bound — same ceiling as soffice, under nginx's 60 s. */
const RASTER_TIMEOUT_MS = PDF_TIMEOUT_MS;
const JPEG_QUALITY = 88;

const PDF_LIMIT = 10;
const RASTER_LIMIT = 10;
const LIMIT_WINDOW_SEC = 600;

type Globals = typeof globalThis & { __slaydxRasterGate?: Gate };
const g = globalThis as Globals;

/** pdftoppm is CPU-heavy (2–8 s per deck at 150 dpi): bounded like soffice, its own pool. */
function rasterGate(): Gate {
  g.__slaydxRasterGate ??= new Gate({
    max: Math.max(1, env.pdf.maxConcurrency),
    waitMs: 20_000,
    maxWaiters: 20,
    retryAfterSec: 15,
  });
  return g.__slaydxRasterGate;
}

/**
 * `slides-png` bounds (m4): page images are held in memory and zipped there,
 * so the deck is capped by page count and by total uncompressed PNG size
 * (peak ≈ 2 × bytes while the ZIP is built). A 30-slide deck at 150 dpi is
 * ~10–45 MB; beyond the cap the user gets a clear 413 (PDF still works).
 */
export type SlidesPngCap = { pages: number; bytes: number };
export const SLIDES_PNG_CAP: SlidesPngCap = { pages: 100, bytes: 100 * 1024 * 1024 };

function tooManySlides(cap: SlidesPngCap): DownloadError {
  return new DownloadError("too_large", {
    message: `Slayd rasmlari uchun juda katta (${cap.pages} slayd / ${Math.round(cap.bytes / 1024 / 1024)} MB dan ortiq) — PDF yuklab oling`,
  });
}

/** Refuses a page set above the cap (applies to any rasterizer, stubs included). */
export function checkSlidesPngCap(pages: readonly Buffer[], cap: SlidesPngCap): void {
  if (pages.length > cap.pages) throw tooManySlides(cap);
  if (pages.reduce((n, p) => n + p.byteLength, 0) > cap.bytes) throw tooManySlides(cap);
}

/**
 * PDF → PNG per page with pdftoppm (page order kept). Renders at most
 * `cap.pages + 1` pages (`-l`: one more only to detect an oversized deck) and
 * checks the total size on disk before reading anything into memory.
 */
export async function pdftoppmPages(pdf: Buffer, dpi: number, cap: SlidesPngCap = SLIDES_PNG_CAP): Promise<Buffer[] | null> {
  const bin = pdftoppmBin();
  if (!bin) return null;
  return rasterGate().run(async () => {
    const dir = await mkdtemp(join(tmpdir(), "slaydx-raster-"));
    try {
      const src = join(dir, "d.pdf");
      await writeFile(src, pdf);
      await run(bin, ["-r", String(dpi), "-l", String(cap.pages + 1), "-png", src, join(dir, "p")], {
        timeout: RASTER_TIMEOUT_MS,
        killSignal: "SIGKILL",
      });
      const pages = (await readdir(dir))
        .map((name) => ({ name, n: Number(/^p-(\d+)\.png$/.exec(name)?.[1] ?? NaN) }))
        .filter((p) => Number.isFinite(p.n))
        .sort((a, b) => a.n - b.n);
      if (!pages.length) return null;
      if (pages.length > cap.pages) throw tooManySlides(cap);
      let total = 0;
      for (const p of pages) total += (await stat(join(dir, p.name))).size;
      if (total > cap.bytes) throw tooManySlides(cap);
      return Promise.all(pages.map((p) => readFile(join(dir, p.name))));
    } catch (e) {
      if (isDownloadError(e)) throw e;
      console.warn("[downloads] pdftoppm:", e instanceof Error ? e.message : e);
      return null;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

async function sharpJpeg(png: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  // Transparent areas become white (JPG has no alpha; black would be the default).
  return sharp(png).flatten({ background: "#ffffff" }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
}

/** File name without its extension («Fotosintez.pptx» → «Fotosintez»). */
export function baseName(fileName: string | null, fallback = "fayl"): string {
  const name = (fileName ?? "").trim();
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim();
  return base || fallback;
}

/** Two-digit page numbers keep ZIP entries sorted in every file manager. */
function pageName(i: number, total: number): string {
  return `slayd-${String(i + 1).padStart(Math.max(2, String(total).length), "0")}.png`;
}

/** Glossary terms: the teacher model (AUDIT-20); older documents — `h3` term + following `p` definition. */
export function glossaryTerms(doc: AcademicDoc | null): GlossaryTerm[] {
  const model = doc?.teacher?.glossary?.terms;
  if (model?.length) return model;
  const out: GlossaryTerm[] = [];
  for (const s of doc?.sections ?? []) {
    const blocks = s.blocks ?? [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.kind !== "h3" || !b.text.trim()) continue;
      const next = blocks[i + 1];
      if (next?.kind === "p" && next.text.trim()) out.push({ term: b.text.trim(), def: next.text.trim() });
    }
  }
  return out;
}

/** Glossary CSV: Atama, Ta’rif (+ Misol, Ruscha, Inglizcha when any term has them). BOM + CRLF. */
export function glossaryCsv(terms: readonly GlossaryTerm[]): string {
  const hasExample = terms.some((t) => t.example?.trim());
  const hasRu = terms.some((t) => t.ru?.trim());
  const hasEn = terms.some((t) => t.en?.trim());
  const head = ["Atama", "Ta’rif", ...(hasExample ? ["Misol"] : []), ...(hasRu ? ["Ruscha"] : []), ...(hasEn ? ["Inglizcha"] : [])];
  const rows = terms.map((t) => [
    t.term,
    t.def,
    ...(hasExample ? [t.example ?? ""] : []),
    ...(hasRu ? [t.ru ?? ""] : []),
    ...(hasEn ? [t.en ?? ""] : []),
  ]);
  return CSV_BOM + csvRecord(head) + rows.map(csvRecord).join("");
}

/**
 * Audio transcript: the spoken script (`doc.audio.script` — the same text the
 * TTS read and the viewer shows). Several voices → «A: …» lines. Older
 * documents without the audio model fall back to the readable sections.
 */
export function transcriptText(doc: AcademicDoc | null): string {
  const script = doc?.audio?.script ?? [];
  const lines = script.filter((l) => l.text?.trim());
  const title = doc?.meta?.topic?.trim();
  let body: string;
  if (lines.length) {
    const voices = new Set(lines.map((l) => l.speaker));
    body = lines.map((l) => (voices.size > 1 ? `${l.speaker}: ${l.text.trim()}` : l.text.trim())).join("\n\n");
  } else {
    body = (doc?.sections ?? [])
      .flatMap((s) => (s.blocks ?? []).map((b) => b.text?.trim() ?? ""))
      .filter(Boolean)
      .join("\n\n");
  }
  if (!body) return "";
  return title ? `${title}\n\n${body}\n` : `${body}\n`;
}

async function resultsCsv(rows: AsyncGenerator<GameResult>): Promise<string> {
  let out = CSV_BOM + csvHeadLine();
  for await (const r of rows) out += csvRowLine(r);
  return out;
}

function pdfLimitOf(deps: ProduceDeps): (userId: string) => Promise<void> {
  return deps.pdfLimit ?? ((u) => limit(`pdf:${u}`, PDF_LIMIT, LIMIT_WINDOW_SEC));
}

async function cachedPdf(ctx: ProducerCtx, bytes: Buffer): Promise<Buffer> {
  const { meta, deps } = ctx;
  const pdf = await getOrConvertPdf({
    generationId: meta.id,
    bytes,
    fileName: meta.fileName ?? `fayl.${meta.format}`,
    beforeConvert: () => pdfLimitOf(deps)(meta.userId),
    convert: deps.convertPdf,
    cache: deps.cache,
  });
  if (!pdf) throw new DownloadError("failed");
  return pdf;
}

export const PRODUCERS: Readonly<Record<DownloadFormatId, ProducerSpec>> = {
  native: {
    kind: "stored",
    fileName: (meta) => meta.fileName ?? `fayl.${meta.format}`,
    produce: (ctx) => ctx.nativeBytes(),
  },

  pdf: {
    kind: "derived",
    fileName: (meta) => pdfFileName(meta.fileName ?? "fayl"),
    produce: async (ctx) => cachedPdf(ctx, await ctx.nativeBytes()),
  },

  "slides-png": {
    kind: "derived",
    fileName: (meta) => `${baseName(meta.fileName)}-slaydlar.zip`,
    async produce(ctx) {
      const { meta, deps } = ctx;
      const bytes = await ctx.nativeBytes();
      const zip = await getOrDerive({
        generationId: meta.id,
        bytes,
        format: "slides-png",
        cache: deps.cache,
        produce: async () => {
          const pdf = await cachedPdf(ctx, bytes);
          await (deps.rasterLimit ?? ((u) => limit(`raster:${u}`, RASTER_LIMIT, LIMIT_WINDOW_SEC)))(meta.userId);
          const cap = deps.slidesPngCap ?? SLIDES_PNG_CAP;
          const pages = await (deps.rasterize ?? pdftoppmPages)(pdf, SLIDES_PNG_DPI, cap);
          if (!pages?.length) return null;
          // m4: bounded in-memory ZIP — refuse before building it.
          checkSlidesPngCap(pages, cap);
          const z = new JSZip();
          // PNG is already deflated: STORE zips 12 MB in ~35 ms.
          pages.forEach((png, i) => z.file(pageName(i, pages.length), png, { compression: "STORE" }));
          return z.generateAsync({ type: "nodebuffer", compression: "STORE" });
        },
      });
      if (!zip) throw new DownloadError("failed");
      return zip;
    },
  },

  jpg: {
    kind: "derived",
    fileName: (meta) => `${baseName(meta.fileName)}.jpg`,
    async produce(ctx) {
      const { meta, deps } = ctx;
      const png = await ctx.nativeBytes();
      const jpg = await getOrDerive({
        generationId: meta.id,
        bytes: png,
        format: "jpg",
        cache: deps.cache,
        produce: async () => {
          try {
            return await (deps.toJpeg ?? sharpJpeg)(png);
          } catch (e) {
            console.warn("[downloads] jpg:", e instanceof Error ? e.message : e);
            return null;
          }
        },
      });
      if (!jpg) throw new DownloadError("failed");
      return jpg;
    },
  },

  "transcript-txt": {
    kind: "instant",
    fileName: (meta) => `${baseName(meta.fileName)}-matn.txt`,
    async produce(ctx) {
      const text = transcriptText(ctx.meta.doc);
      if (!text) throw new DownloadError("empty");
      return Buffer.from(text, "utf8");
    },
  },

  "glossary-csv": {
    kind: "instant",
    fileName: (meta) => `${baseName(meta.fileName)}-atamalar.csv`,
    async produce(ctx) {
      const terms = glossaryTerms(ctx.meta.doc);
      if (!terms.length) throw new DownloadError("empty");
      return Buffer.from(glossaryCsv(terms), "utf8");
    },
  },

  "results-csv": {
    kind: "instant",
    fileName: (meta) => `${baseName(meta.fileName, "natijalar")}-natijalar.csv`,
    async produce(ctx) {
      const { meta, deps } = ctx;
      const csv = await resultsCsv((deps.results ?? iterateAllResultRows)(meta.id, meta.userId));
      return Buffer.from(csv, "utf8");
    },
  },
};

/**
 * Size of a derived file already in the cache, without converting (HEAD and the
 * prepare fast path). `null` = not cached yet.
 */
export async function cachedDerivedSize(ctx: ProducerCtx): Promise<number | null> {
  return derivedSize(ctx.meta.id, await ctx.nativeBytes(), ctx.format.id, ctx.deps.cache);
}

/**
 * `cachedDerivedSize` for a link about to be minted: also pins the entry
 * (20 min, LRU-safe) and refreshes its age, so the 15-minute `/api/dl` URL
 * finds it (mobile sprint m1). Never converts.
 */
export async function touchCachedDerived(ctx: ProducerCtx): Promise<number | null> {
  return touchDerived(ctx.meta.id, await ctx.nativeBytes(), ctx.format.id, ctx.deps.cache);
}

/** Whether the server can produce `id` right now (tools installed). */
export function producerAvailable(id: DownloadFormatId, deps: ProduceDeps): boolean {
  if (id !== "pdf" && id !== "slides-png") return true;
  const pdf = (deps.pdfAvailable ?? pdfAvailable)();
  if (id === "pdf") return pdf;
  return pdf && (deps.rasterAvailable ?? (() => pdftoppmBin() !== null))();
}
