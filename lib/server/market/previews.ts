import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { query, queryOne, transaction } from "../db";
import { env } from "../env";
import { pdfAvailable, toPdf } from "../pdf";
import { Gate } from "../soffice-gate";
import { pdftoppmBin } from "../thumb";
import { isDeckTool } from "../../market/registry";
import { isPartialPreview, PARTIAL_SHARE, readablePages } from "../../market/preview-policy";
import { previewPagesOf, renderNeutralFile } from "./items";
import { getItemRow, getNeutralFile, isHiddenForReview, isUuid, PUBLIC_STATUSES, putNeutralFile } from "./store";

const run = promisify(execFile);

/**
 * Shop-window rasters (docs/market/PLAN.md §3.2, M8). The only body bytes that leave the server before a purchase:
 * first N pages as small watermarked JPEGs, the pages after them as blurred stubs nobody can read. Built lazily on the
 * first request (the `thumb.ts` pattern: one build per item + version, an inner gate under the shared `soffice` gate,
 * `SofficeBusyError` → the route answers 503 and the card shows its placeholder).
 *
 * `preview_version` versions the set: a new version makes every old raster unreachable by key.
 */

/** Widest raster served; decks arrive at 800 px from 60 dpi, documents at about 500. */
export const PREVIEW_MAX_WIDTH = 720;
/** A document page stays a shop window: the layout shows, reading the body is work. Slides carry big text and keep more. */
export const DOC_PREVIEW_MAX_WIDTH = 560;
export const PREVIEW_QUALITY = 60;
const DECK_PREVIEW_DPI = 60;
export const DOC_PREVIEW_DPI = 45;
/** A stub is unreadable by construction: 64 px across, then blurred. */
export const STUB_WIDTH = 64;
const STUB_BLUR = 1.5;
const STUB_QUALITY = 40;
/** Readable + stub pages together never go past this page. */
const MAX_PAGE = 6;

export const WATERMARK_TEXT = "SlaydX · namuna";

export type MarketPreview = { bytes: Buffer; mime: string; kind: "page" | "stub"; version: number };

export type PreviewDeps = {
  /** Test seams; routes never pass them. */
  available?: () => boolean;
  /** Neutral file bytes → page JPEGs in page order (the standard path: LibreOffice → pdftoppm). */
  rasterize?: (bytes: Uint8Array, fileName: string, lastPage: number, dpi: number) => Promise<Buffer[] | null>;
};

type Globals = typeof globalThis & { __slaydxMarketPreviewGate?: Gate; __slaydxMarketPreviewInflight?: Map<string, Promise<void>> };
const g = globalThis as Globals;

/** Previews never take the last `soffice` slot: a user's own PDF download stays first in line (same rule as thumbnails). */
function previewGate(): Gate {
  g.__slaydxMarketPreviewGate ??= new Gate({ max: Math.max(1, env.pdf.maxConcurrency - 1), waitMs: 20_000, maxWaiters: 20, retryAfterSec: 15 });
  return g.__slaydxMarketPreviewGate;
}

function inflight(): Map<string, Promise<void>> {
  g.__slaydxMarketPreviewInflight ??= new Map();
  return g.__slaydxMarketPreviewInflight;
}

export const previewsAvailable = (): boolean => pdfAvailable() && Boolean(pdftoppmBin());

/** First `lastPage` pages of a PDF as JPEGs; the tool numbers its files, the order is by that number. */
async function pdfPages(pdf: Buffer, lastPage: number, dpi: number): Promise<Buffer[] | null> {
  const bin = pdftoppmBin();
  if (!bin) return null;
  const dir = await mkdtemp(join(tmpdir(), "slaydx-market-"));
  try {
    const src = join(dir, "d.pdf");
    await writeFile(src, pdf);
    await run(bin, ["-f", "1", "-l", String(lastPage), "-r", String(dpi), "-jpeg", "-jpegopt", "quality=85", src, join(dir, "p")], { timeout: 30_000 });
    const names = (await readdir(dir)).filter((n) => /^p-\d+\.jpg$/.test(n)).sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]));
    return Promise.all(names.map((n) => readFile(join(dir, n))));
  } catch (e) {
    console.warn("[market] preview", e instanceof Error ? e.message : e);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function rasterizeFile(bytes: Uint8Array, fileName: string, lastPage: number, dpi: number): Promise<Buffer[] | null> {
  const pdf = await previewGate().run(() => toPdf(bytes, fileName));
  return pdf ? pdfPages(pdf, lastPage, dpi) : null;
}

/** Diagonal tiles over the whole page: cropping a corner does not remove the mark. */
function watermarkSvg(w: number, h: number): Buffer {
  const fontSize = Math.max(12, Math.round(w / 22));
  const stepX = fontSize * 11;
  const stepY = fontSize * 6;
  const tiles: string[] = [];
  for (let y = -h; y < h * 2; y += stepY) {
    for (let x = -w; x < w * 2; x += stepX) {
      tiles.push(`<text x="${x}" y="${y}" font-family="sans-serif" font-size="${fontSize}" font-weight="700" fill="#64748b" fill-opacity="0.32" transform="rotate(-30 ${x} ${y})">${WATERMARK_TEXT}</text>`);
    }
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${tiles.join("")}</svg>`);
}

/** A readable page: at most `maxWidth` wide, tiled watermark baked in, JPEG quality 60. */
export async function watermarkPage(jpeg: Buffer, maxWidth = PREVIEW_MAX_WIDTH): Promise<Buffer> {
  const resized = await sharp(jpeg).resize({ width: maxWidth, withoutEnlargement: true }).toBuffer({ resolveWithObject: true });
  const { width, height } = resized.info;
  return sharp(resized.data)
    .composite([{ input: watermarkSvg(width, height), blend: "over" }])
    .jpeg({ quality: PREVIEW_QUALITY })
    .toBuffer();
}

/** One page is the whole work: its top stays readable, the rest becomes a stub stretched back over the page. */
export async function partialPage(jpeg: Buffer, maxWidth = PREVIEW_MAX_WIDTH): Promise<Buffer> {
  const page = await sharp(jpeg).resize({ width: maxWidth, withoutEnlargement: true }).toBuffer({ resolveWithObject: true });
  const { width, height } = page.info;
  const top = Math.max(1, Math.round(height * PARTIAL_SHARE));
  const small = await sharp(page.data).extract({ left: 0, top, width, height: height - top }).resize({ width: STUB_WIDTH }).blur(STUB_BLUR).toBuffer();
  const rest = await sharp(small).resize({ width, height: height - top, fit: "fill" }).blur(4).jpeg().toBuffer();
  return sharp(page.data)
    .composite([
      { input: rest, top, left: 0 },
      { input: watermarkSvg(width, height), blend: "over" },
    ])
    .jpeg({ quality: PREVIEW_QUALITY })
    .toBuffer();
}

export async function blurStub(jpeg: Buffer): Promise<Buffer> {
  return sharp(jpeg).resize({ width: STUB_WIDTH }).blur(STUB_BLUR).jpeg({ quality: STUB_QUALITY }).toBuffer();
}

async function buildPreviews(itemId: string, version: number, deps: PreviewDeps): Promise<void> {
  const row = await getItemRow(itemId);
  if (!row) return;
  let file = await getNeutralFile(itemId);
  if (!file) {
    const rendered = await renderNeutralFile(row);
    await transaction((c) => putNeutralFile(c, itemId, rendered));
    file = { fileName: rendered.fileName, mime: rendered.mime, bytes: Buffer.from(rendered.bytes) };
  }
  const deck = isDeckTool(row.tool_id);
  const pages = await (deps.rasterize ?? rasterizeFile)(file.bytes, file.fileName, MAX_PAGE, deck ? DECK_PREVIEW_DPI : DOC_PREVIEW_DPI);
  if (!pages?.length) return;
  // Fewer rasters than asked is the exact length; a full set means «at least that», so the listing's own count decides.
  const total = pages.length < MAX_PAGE ? pages.length : Math.max(MAX_PAGE, row.pages ?? row.slide_count ?? MAX_PAGE);
  const readable = readablePages(await previewPagesOf(row.tool_id), total);
  const width = deck ? PREVIEW_MAX_WIDTH : DOC_PREVIEW_MAX_WIDTH;
  const rendered = await Promise.all(
    pages.map(async (jpeg, i) => {
      const kind: "page" | "stub" = i < readable ? "page" : "stub";
      const bytes = kind === "stub" ? await blurStub(jpeg) : isPartialPreview(total) ? await partialPage(jpeg, width) : await watermarkPage(jpeg, width);
      return { page: i + 1, kind, bytes };
    }),
  );
  await transaction(async (c) => {
    await c.query("DELETE FROM market_previews WHERE item_id = $1", [itemId]);
    for (const p of rendered) {
      await c.query(
        `INSERT INTO market_previews (item_id, page, kind, mime, size_bytes, bytes, version) VALUES ($1, $2, $3, 'image/jpeg', $4, $5, $6)`,
        [itemId, p.page, p.kind, p.bytes.byteLength, p.bytes, version],
      );
    }
  });
}

async function storedPreview(itemId: string, page: number, version: number): Promise<MarketPreview | null> {
  const row = await queryOne<{ bytes: Buffer; mime: string; kind: "page" | "stub"; version: number }>(
    "SELECT bytes, mime, kind, version FROM market_previews WHERE item_id = $1 AND page = $2 AND version = $3",
    [itemId, page, version],
  );
  return row ? { bytes: row.bytes, mime: row.mime, kind: row.kind, version: row.version } : null;
}

/**
 * One raster of a publicly visible item, built on first use. `null` = 404: unknown id, not on sale, or no such page.
 * `SofficeBusyError` passes through (503 + `Retry-After`). `admin: true` also reaches a candidate for the admin queue.
 */
export async function getMarketPreview(itemId: string, page: number, opts: PreviewDeps & { admin?: boolean } = {}): Promise<MarketPreview | null> {
  if (!isUuid(itemId) || !Number.isInteger(page) || page < 1 || page > MAX_PAGE) return null;
  const row = await getItemRow(itemId);
  if (!row) return null;
  if (!opts.admin && (!PUBLIC_STATUSES.includes(row.status) || isHiddenForReview(row))) return null;
  const version = row.preview_version;
  const stored = await storedPreview(itemId, page, version);
  if (stored) return stored;
  if (!(opts.available ?? previewsAvailable)()) return null;
  const key = `${itemId}:${version}`;
  const jobs = inflight();
  let job = jobs.get(key);
  if (!job) {
    job = buildPreviews(itemId, version, opts).finally(() => jobs.delete(key));
    jobs.set(key, job);
  }
  await job;
  return storedPreview(itemId, page, version);
}

/** «Qayta chizish»: a new version makes the next request build fresh rasters; returns the new version. */
export async function bumpPreviewVersion(itemId: string): Promise<number | null> {
  if (!isUuid(itemId)) return null;
  const rows = await query<{ preview_version: number }>("UPDATE market_items SET preview_version = preview_version + 1, updated_at = now() WHERE id = $1 RETURNING preview_version", [itemId]);
  return rows[0]?.preview_version ?? null;
}
