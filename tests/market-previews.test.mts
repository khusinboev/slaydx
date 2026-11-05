import "./helpers/next-request.mts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import sharp from "sharp";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { marketWorkDoc } from "./helpers/market-fixtures.mts";
import { MARKET_ASSET_PREFIX } from "../lib/market/types.ts";

/**
 * Shop-window rasters (docs/market/PLAN.md §3.2, M8) on a real Postgres: the readable pages are small and watermarked,
 * later pages are unreadable stubs, a build happens once, and only publicly visible items answer. The last test is the
 * real chain: sanitised document → neutral DOCX → LibreOffice → pdftoppm → sharp, with images resolved from the item's
 * own bytes (needs soffice + pdftoppm, skipped where they are absent).
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `watermarkPage` returns the resized page without the composite  -> «watermark»;
 *   2. `PREVIEW_MAX_WIDTH` removed from the resize                     -> «resolution»;
 *   3. `blurStub` skips the 64 px resize                               -> «stubs»;
 *   4. `i < readable` → `true` (every page readable)                   -> «stubs»;
 *   5. public status check removed in `getMarketPreview`               -> «not on sale»;
 *   6. hidden check removed                                            -> «not on sale»;
 *   7. in-flight map bypassed                                          -> «one build»;
 *   8. stored lookup without `version`                                 -> «version»;
 *   9. `marketAssetResolver` without `item_id` in the WHERE            -> «images resolve»;
 *  10. the page upper bound removed                                    -> «page range».
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("marketprev") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

let ready: Promise<void> | null = null;
async function db() {
  const mod = await import("../lib/server/db.ts");
  ready ??= mod.migrate();
  await ready;
  return mod;
}
after(async () => {
  if (!ready) return;
  const { pool } = await import("../lib/server/db.ts");
  await pool().end();
  await iso.drop();
});

/** A page with structure: text lines, so a blur or a watermark really changes pixels. */
async function pageJpeg(width: number, height: number): Promise<Buffer> {
  const lines = Array.from({ length: 30 }, (_, i) => `<rect x="20" y="${30 + i * 24}" width="${width - 40}" height="6" fill="#111"/>`).join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/>${lines}</svg>`)).jpeg({ quality: 90 }).toBuffer();
}

let seq = 0;
async function mkItem(o: { status?: string; hidden?: boolean; tool?: string; doc?: unknown } = {}): Promise<string> {
  const { query } = await db();
  const [row] = await query<{ id: string }>(
    `INSERT INTO market_items (tool_id, title, doc_json, topic_norm, status, quality_json)
     VALUES ($1, 'Namuna ish', $2::jsonb, $3, $4, $5::jsonb) RETURNING id`,
    [o.tool ?? "referat", JSON.stringify(o.doc ?? { meta: {} }), `n${seq++}`, o.status ?? "active", JSON.stringify(o.hidden ? { hidden_until_review: true } : {})],
  );
  await query(`INSERT INTO market_item_files (item_id, file_name, mime, size_bytes, bytes) VALUES ($1, 'n.docx', 'application/x', 1, '\\x00')`, [row!.id]);
  return row!.id;
}

const previews = () => import("../lib/server/market/previews.ts");

const opts = async (pages = 8) => {
  const raw = await pageJpeg(1000, 700);
  let calls = 0;
  return {
    available: () => true,
    rasterize: async (_b: Uint8Array, _f: string, last: number) => {
      calls++;
      return Array.from({ length: Math.min(pages, last) }, () => raw);
    },
    calls: () => calls,
  };
};

test("watermark: the mark is baked into the bytes", async () => {
  const { watermarkPage } = await previews();
  const page = await pageJpeg(500, 700);
  const marked = await watermarkPage(page);
  const [a, b] = await Promise.all([sharp(page).raw().toBuffer(), sharp(marked).raw().toBuffer()]);
  let changed = 0;
  for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i]! - b[i]!) > 24) changed++;
  assert.ok(changed > 1500, `watermark pixels: ${changed}`);
  const blank = await sharp({ create: { width: 500, height: 700, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
  const stats = await sharp(await watermarkPage(blank)).stats();
  assert.ok(stats.channels[0]!.min < 200, "a blank page shows the mark too: no page escapes it");
});

test("resolution: at most 720 px wide, never enlarged", async () => {
  const { watermarkPage, PREVIEW_MAX_WIDTH } = await previews();
  assert.equal(PREVIEW_MAX_WIDTH, 720);
  assert.equal((await sharp(await watermarkPage(await pageJpeg(1600, 900))).metadata()).width, 720);
  assert.equal((await sharp(await watermarkPage(await pageJpeg(496, 700))).metadata()).width, 496);
});

test("stubs: 64 px across and blurred, unreadable by construction", async () => {
  const { blurStub, STUB_WIDTH } = await previews();
  assert.equal(STUB_WIDTH, 64);
  const page = await pageJpeg(500, 700);
  const stub = await blurStub(page);
  assert.equal((await sharp(stub).metadata()).width, 64);
  assert.ok(stub.byteLength < 2500, `${stub.byteLength} bytes`);
});

test("first request builds the set: N readable pages, then stubs up to page 6, nothing past that", { skip }, async () => {
  const { getMarketPreview } = await previews();
  const id = await mkItem();
  const o = await opts();
  assert.equal((await getMarketPreview(id, 1, o))?.kind, "page");
  assert.equal((await getMarketPreview(id, 2, o))?.kind, "page");
  const stub = await getMarketPreview(id, 3, o);
  assert.equal(stub?.kind, "stub");
  assert.equal((await sharp(stub!.bytes).metadata()).width, 64);
  assert.equal((await getMarketPreview(id, 6, o))?.kind, "stub");
  assert.equal(o.calls(), 1, "stored after the first build");
  assert.equal(await getMarketPreview(id, 7, o), null);
});

test("decks show one more readable page; a short document has no pages past its end", { skip }, async () => {
  const { getMarketPreview } = await previews();
  const deck = await mkItem({ tool: "slide" });
  const o = await opts();
  assert.equal((await getMarketPreview(deck, 3, o))?.kind, "page");
  assert.equal((await getMarketPreview(deck, 4, o))?.kind, "stub");
  const short = await mkItem();
  assert.equal((await getMarketPreview(short, 2, await opts(1))), null);
});

test("market.preview_pages steers the count", { skip }, async () => {
  const { transaction } = await db();
  const s = await import("../lib/server/settings.ts");
  const { getMarketPreview } = await previews();
  await transaction((c) => s.setSettingInTx(c, "market.preview_pages", 3, null));
  s.invalidateSettingsCache();
  const id = await mkItem();
  assert.equal((await getMarketPreview(id, 3, await opts()))?.kind, "page");
  await transaction((c) => s.resetSettingInTx(c, "market.preview_pages"));
  s.invalidateSettingsCache();
});

test("not on sale: retired, rejected, candidates, report-hidden and unknown items are 404 to the public; the admin reaches a candidate", { skip }, async () => {
  const { getMarketPreview } = await previews();
  const o = await opts();
  for (const status of ["candidate", "retired", "rejected"]) assert.equal(await getMarketPreview(await mkItem({ status }), 1, o), null, status);
  assert.equal(await getMarketPreview(await mkItem({ hidden: true }), 1, o), null);
  assert.equal(await getMarketPreview("00000000-0000-4000-8000-000000000000", 1, o), null);
  assert.equal(await getMarketPreview("nope", 1, o), null);
  assert.equal(o.calls(), 0, "nothing was rendered for them");
  assert.equal((await getMarketPreview(await mkItem({ status: "candidate" }), 1, { ...o, admin: true }))?.kind, "page");
  assert.equal((await getMarketPreview(await mkItem({ status: "sold_out" }), 1, o))?.kind, "page", "a sold-out item keeps its window");
});

test("page range: only whole pages from 1 to 6", { skip }, async () => {
  const { getMarketPreview } = await previews();
  const id = await mkItem();
  const o = await opts();
  for (const page of [0, -1, 1.5, 7, Number.NaN]) assert.equal(await getMarketPreview(id, page, o), null, String(page));
  assert.equal(o.calls(), 0);
});

test("one build: concurrent requests for an item share one LibreOffice run", { skip }, async () => {
  const { getMarketPreview } = await previews();
  const id = await mkItem();
  const o = await opts();
  const all = await Promise.all([1, 2, 3, 1, 2, 3].map((p) => getMarketPreview(id, p, o)));
  assert.ok(all.every(Boolean));
  assert.equal(o.calls(), 1);
});

test("version: a new preview_version makes the old set unreachable and the next request rebuilds", { skip }, async () => {
  const { getMarketPreview, bumpPreviewVersion } = await previews();
  const { query } = await db();
  const id = await mkItem();
  const o = await opts();
  assert.equal((await getMarketPreview(id, 1, o))?.version, 1);
  assert.equal(await bumpPreviewVersion(id), 2);
  assert.equal((await getMarketPreview(id, 1, o))?.version, 2);
  assert.equal(o.calls(), 2);
  assert.deepEqual((await query<{ v: number }>("SELECT DISTINCT version AS v FROM market_previews WHERE item_id = $1", [id])).map((r) => r.v), [2]);
  assert.equal(await bumpPreviewVersion("nope"), null);
});

test("unavailable or busy: no tools → null (the card shows its placeholder); a busy gate reaches the route", { skip }, async () => {
  const { getMarketPreview } = await previews();
  const { SofficeBusyError } = await import("../lib/server/soffice-gate.ts");
  const id = await mkItem();
  assert.equal(await getMarketPreview(id, 1, { available: () => false }), null);
  await assert.rejects(
    getMarketPreview(id, 1, {
      available: () => true,
      rasterize: async () => {
        throw new SofficeBusyError(15);
      },
    }),
    SofficeBusyError,
  );
  const o = await opts();
  assert.equal((await getMarketPreview(id, 1, o))?.kind, "page", "a failed build leaves nothing stuck");
});

test("images resolve: `market-asset://` reads only this item's bytes; the deck really embeds them", { skip }, async () => {
  const { query } = await db();
  const { marketAssetResolver } = await import("../lib/server/market/store.ts");
  const { renderNeutralFile } = await import("../lib/server/market/items.ts");
  const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#3366cc" } }).png().toBuffer();
  const slides = [
    { id: "a", layout: "title", title: "Mavzu" },
    { id: "b", layout: "bullets", title: "Rasmli", bullets: ["Birinchi band matni", "Ikkinchi band matni"], image: { url: `${MARKET_ASSET_PREFIX}aa11` } },
  ];
  const doc = { meta: { ...marketWorkDoc("slide", "Mavzu", 1).meta, toolId: "slide", workLabel: "Slayd" }, titlePage: true, toc: false, sections: [], slides, slideTheme: "atlas" };
  const id = await mkItem({ tool: "slide", doc });
  const other = await mkItem();
  await query(`INSERT INTO market_assets (item_id, asset_id, mime, size_bytes, bytes) VALUES ($1, 'aa11', 'image/png', $2, $3)`, [id, png.byteLength, png]);
  const mine = await marketAssetResolver(id)(`${MARKET_ASSET_PREFIX}aa11`);
  assert.equal(mine?.type, "png");
  assert.equal(await marketAssetResolver(other)(`${MARKET_ASSET_PREFIX}aa11`), null, "another item's id reads nothing");
  assert.equal(await marketAssetResolver(id)("https://example.com/x.png"), null, "no URL other than a placeholder is ever fetched");
  const file = await renderNeutralFile({ id, tool_id: "slide", title: "Mavzu" });
  assert.equal(file.fileName, "Mavzu.pptx");
  const zip = await JSZip.loadAsync(file.bytes);
  assert.ok(Object.keys(zip.files).some((n) => /ppt\/media\/.*\.(png|jpg|jpeg)$/.test(n)), "the picture is inside the file");
});

test("the real chain: neutral DOCX → LibreOffice → pdftoppm → watermarked JPEG, the neutral file stored once", { skip }, async (t) => {
  const { getMarketPreview, previewsAvailable } = await previews();
  if (!previewsAvailable()) return t.skip("LibreOffice or pdftoppm is not installed");
  const { query } = await db();
  const { sanitizeForMarket } = await import("../lib/market/sanitize.ts");
  const clean = sanitizeForMarket({ toolId: "referat", doc: marketWorkDoc("referat", "Fotosintez jarayoni", 7, { words: 3000 }), values: {}, sourceId: "s" });
  const id = await mkItem({ doc: clean.doc });
  await query("DELETE FROM market_item_files WHERE item_id = $1", [id]);
  const first = await getMarketPreview(id, 1);
  assert.ok(first, "built");
  assert.equal(first!.kind, "page");
  const meta = await sharp(first!.bytes).metadata();
  assert.ok(meta.width! <= 720 && meta.width! > 300, String(meta.width));
  assert.ok(first!.bytes.byteLength < 200_000, String(first!.bytes.byteLength));
  const third = await getMarketPreview(id, 3);
  if (third) assert.equal((await sharp(third.bytes).metadata()).width, 64);
  assert.equal((await query("SELECT 1 FROM market_item_files WHERE item_id = $1", [id])).length, 1);
  if (process.env.MARKET_PREVIEW_OUT) await sharp(first!.bytes).toFile(process.env.MARKET_PREVIEW_OUT);
});
