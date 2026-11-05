/* eslint-disable @typescript-eslint/no-explicit-any -- SQL rows and JSON answers are read untyped here */
import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import sharp from "sharp";
import { buy, closeDb, db, drainJobs, fileOf, jobOf, ledger, mkItem, mkUser, neutralWork, resetSettings, skip, wallet } from "./helpers/market-buy.mts";
import type { AcademicDoc } from "../lib/generation/types.ts";

/**
 * The buyer's copy through the REAL worker path: `claimJob` → `runJob` → `buildArtifact` → `commitJobResult`
 * (docs/market/PLAN.md §2.2). Real renderers, real assets; `fetch` is stubbed to throw so one network call fails the test.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. hook line removed from `buildArtifactInner`                     -> «no network» (the LLM path runs);
 *   2. a job without a purchase row renders anyway                     -> «no purchase, no copy», «another buyer's item»;
 *   3. fingerprint not stamped                                         -> «the copy of a work», «the copy of a deck»;
 *   4. `doc.work` not merged                                           -> «the copy of a work» (`titleModel`);
 *   5. footers not recomputed                                          -> «the copy of a deck»;
 *   6. placeholders left in the document                               -> «the copy of a work», «the copy of a deck»;
 *   7. `school` not merged                                             -> «a lesson plan»;
 *   8. `article.authors` not merged                                    -> «a thesis»;
 *   9. retired items refused                                           -> «a retired item still fulfils»;
 *  10. `tool_id` of the item not compared with the job's                -> «another tool's form»;
 *  11. the merge mutates its input                                     -> «the merge is pure».
 */

after(closeDb);

const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};

const rows = async (sql: string, params: unknown[] = []) => (await db()).query<Record<string, any>>(sql, params);

function noNetwork(t: TestContext): { calls: () => number } {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("no network in a market copy");
  });
  return { calls: () => calls };
}

const png = () => sharp({ create: { width: 200, height: 120, channels: 3, background: "#3366cc" } }).png().toBuffer();

async function withAsset(itemId: string, assetId: string, bytes: Buffer): Promise<void> {
  await rows(`INSERT INTO market_assets (item_id, asset_id, mime, size_bytes, bytes) VALUES ($1, $2, 'image/png', $3, $4)`, [itemId, assetId, bytes.byteLength, bytes]);
}

const FIELDS = { author: "Sintetik Xaridor", university: "Sintetik Universiteti", faculty: "Energetika", department: "Fizika", group: "301", course: "3", teacher: "Sintetik Ustoz", city: "Samarqand" };

test("the merge is pure and fills every title-page home", { skip }, async () => {
  const { mergeBuyerFields } = await import("../lib/generation/market-copy.ts");
  const doc = neutralWork("referat", "Mavzu") as unknown as AcademicDoc;
  const copy = JSON.parse(JSON.stringify(doc));
  const out = mergeBuyerFields(doc, { marketItemId: "x", ...FIELDS });
  assert.deepEqual(doc, copy, "the stored document is untouched");
  assert.equal(out.meta.author, "Sintetik Xaridor");
  assert.equal(out.work!.university, "Sintetik Universiteti");
  assert.equal(out.work!.teacher, "Sintetik Ustoz");
  const parsed = mergeBuyerFields(doc, { marketItemId: "x", author: "Sintetik Xaridor — 2-kurs, 214-guruh" });
  assert.equal(parsed.work!.author, "Sintetik Xaridor");
  assert.equal(parsed.work!.course, "2");
  assert.equal(parsed.work!.group, "214");
});

test("no network; the copy of a work: buyer's title page, own assets, the mark, no cost", { skip }, async (t) => {
  quiet(t);
  const net = noNetwork(t);
  await resetSettings();
  const { titleModel } = await import("../lib/generation/title-model.ts");
  const { readFingerprint } = await import("../lib/market/fingerprint.ts");
  const bytes = await png();
  const assetId = "a".repeat(24);
  const doc = neutralWork("referat", "Quyosh panellari") as any;
  doc.sections[1].blocks.push({ kind: "figure", text: "Sxema", figureId: "f1" });
  doc.work.figures = [{ id: "f1", kind: "scheme", caption: "Sxema", url: `market-asset://${assetId}`, assetId }];
  const item = await mkItem({ doc, title: "Quyosh panellari" });
  await withAsset(item, assetId, bytes);

  const u = await mkUser();
  const res = await buy(u, item, { fields: FIELDS });
  const gen = res.body.generationId as string;
  await drainJobs();
  const job = await jobOf(gen);
  assert.equal(job!.status, "COMPLETED", String(job!.error));
  assert.equal(net.calls(), 0, "zero provider calls");
  assert.equal(job!.cost_json, null);

  const title = titleModel(job!.doc_json) as Record<string, unknown>;
  assert.equal(title.university, "Sintetik Universiteti");
  assert.match(String(title.author), /Sintetik Xaridor/);
  assert.match(String(title.teacher), /Sintetik Ustoz/);
  assert.match(String(title.cityYear), /Samarqand/);
  assert.equal(job!.doc_json.work.author, "Sintetik Xaridor");
  assert.equal(job!.doc_json.meta.city, "Samarqand");

  const text = JSON.stringify(job!.doc_json);
  assert.ok(!text.includes("market-asset://"), "no placeholder reaches the buyer");
  assert.ok(!text.includes("data:image"), "no inline image stays in doc_json");
  const fig = job!.doc_json.work.figures[0];
  assert.match(fig.url, new RegExp(`^/api/generations/${gen}/assets/${fig.assetId}$`));
  const [asset] = await rows("SELECT bytes FROM generation_assets WHERE generation_id = $1 AND asset_id = $2", [gen, fig.assetId]);
  assert.ok(Buffer.compare(asset!.bytes, bytes) === 0, "the asset bytes moved to the buyer's generation");

  const file = (await fileOf(gen))!;
  const [p] = await rows("SELECT fingerprint FROM market_purchases WHERE id = $1", [gen]);
  assert.deepEqual(await readFingerprint(file), { keywords: p!.fingerprint, property: p!.fingerprint });
  const zip = await JSZip.loadAsync(file);
  assert.ok(Object.keys(zip.files).some((n) => n.startsWith("word/media/")), "the figure is in the DOCX");
  assert.match(await zip.file("word/document.xml")!.async("string"), /Sintetik Xaridor/);
});

test("two buyers of one item differ only by their marks and title pages", { skip }, async (t) => {
  quiet(t);
  noNetwork(t);
  await resetSettings();
  const { readFingerprint } = await import("../lib/market/fingerprint.ts");
  const item = await mkItem();
  const a = await buy(await mkUser(), item, { fields: { author: "Birinchi Xaridor", university: "Bir Akademiya" } });
  const b = await buy(await mkUser(), item, { fields: { author: "Ikkinchi Xaridor", university: "Ikki Akademiya" } });
  await drainJobs();
  const [x, y] = await Promise.all([fileOf(a.body.generationId), fileOf(b.body.generationId)]);
  const fx = await readFingerprint(x!);
  const fy = await readFingerprint(y!);
  assert.ok(fx.keywords && fy.keywords);
  assert.notEqual(fx.keywords, fy.keywords);
  const docA = (await jobOf(a.body.generationId))!.doc_json;
  const docB = (await jobOf(b.body.generationId))!.doc_json;
  assert.deepEqual(docA.sections, docB.sections, "the body is identical");
  const sourceBody = neutralWork("referat", "x").sections;
  assert.deepEqual(docA.sections, JSON.parse(JSON.stringify(sourceBody)));
});

test("the copy of a deck: footers follow the buyer, images are his, the PPTX carries the mark", { skip }, async (t) => {
  quiet(t);
  const net = noNetwork(t);
  await resetSettings();
  const { readFingerprint } = await import("../lib/market/fingerprint.ts");
  const bytes = await png();
  const assetId = "b".repeat(24);
  const doc = {
    meta: { ...neutralWork("slide", "Deka").meta, toolId: "slide", workLabel: "Taqdimot" },
    titlePage: false,
    toc: false,
    sections: [],
    slides: [
      { id: "s0", layout: "title", title: "Quyosh", subtitle: "Taqdimot", footer: "" },
      { id: "s1", layout: "bullets", title: "Asosiy", bullets: ["Birinchi", "Ikkinchi"], footer: "", image: { url: `market-asset://${assetId}`, alt: "rasm" } },
    ],
  };
  const item = await mkItem({ tool: "slide", doc, params: { slideCount: 8 } });
  await withAsset(item, assetId, bytes);
  const res = await buy(await mkUser(), item, { fields: { author: "Sintetik Xaridor", university: "Sintetik Universiteti" } });
  const gen = res.body.generationId as string;
  await drainJobs();
  const job = await jobOf(gen);
  assert.equal(job!.status, "COMPLETED", String(job!.error));
  assert.equal(net.calls(), 0);
  for (const s of job!.doc_json.slides) assert.equal(s.footer, "Sintetik Xaridor · Sintetik Universiteti");
  const url = job!.doc_json.slides[1].image.url;
  assert.match(url, new RegExp(`^/api/generations/${gen}/assets/`));
  assert.ok(!JSON.stringify(job!.doc_json).includes("market-asset://"));
  const file = (await fileOf(gen))!;
  const [p] = await rows("SELECT fingerprint FROM market_purchases WHERE id = $1", [gen]);
  assert.deepEqual(await readFingerprint(file), { keywords: p!.fingerprint, property: p!.fingerprint });
  const zip = await JSZip.loadAsync(file);
  assert.ok(zip.file("ppt/presentation.xml"), "a real PPTX");
  assert.ok(Object.keys(zip.files).some((n) => n.startsWith("ppt/media/")), "the slide image is in the PPTX");
});

test("a lesson plan: the school head is the buyer's", { skip }, async () => {
  const { mergeBuyerFields } = await import("../lib/generation/market-copy.ts");
  const doc = {
    meta: { toolId: "lesson-plan" },
    sections: [],
    teacher: { school: { institution: "", author: "", subject: "Fizika", grade: 7, language: "uz" } },
  } as unknown as AcademicDoc;
  const out = mergeBuyerFields(doc, { marketItemId: "x", author: "Sintetik Ustoz", university: "12-maktab" });
  assert.equal(out.teacher!.school.institution, "12-maktab");
  assert.equal(out.teacher!.school.author, "Sintetik Ustoz");
  assert.equal(out.teacher!.school.subject, "Fizika", "content of the head stays");
});

test("a thesis: the author line comes from the buyer", { skip }, async () => {
  const { mergeBuyerFields } = await import("../lib/generation/market-copy.ts");
  const doc = { meta: { toolId: "thesis" }, sections: [], article: { authors: [], figures: [], references: [], language: "uz" } } as unknown as AcademicDoc;
  const out = mergeBuyerFields(doc, { marketItemId: "x", author: "Sintetik Xaridor", university: "Sintetik Universiteti" });
  assert.deepEqual(out.article!.authors, [{ name: "Sintetik Xaridor", org: "Sintetik Universiteti" }]);
  assert.equal(out.meta.organization, "Sintetik Universiteti");
});

test("a retired item still fulfils a paid copy", { skip }, async (t) => {
  quiet(t);
  noNetwork(t);
  await resetSettings();
  const item = await mkItem();
  const res = await buy(await mkUser(), item);
  await rows("UPDATE market_items SET status = 'retired' WHERE id = $1", [item]);
  await drainJobs();
  assert.equal((await jobOf(res.body.generationId))!.status, "COMPLETED");
});

test("no purchase, no copy: a job that names an item by hand fails, is refunded and holds nothing", { skip }, async (t) => {
  quiet(t);
  const net = noNetwork(t);
  await resetSettings();
  const jobs = await import("../lib/server/jobs.ts");
  const secret = "Bu jumla faqat sotuvdagi ish ichida turadi.";
  const doc = neutralWork("referat", "Sir") as any;
  doc.sections[0].blocks[0].text = secret;
  const item = await mkItem({ doc });
  const u = await mkUser({ balance: 10_000 });
  const res = await jobs.enqueueGeneration({ userId: u.id, toolId: "referat", topic: "x", price: 3000, format: "docx", values: { marketItemId: item }, budgetMs: 60_000 });
  assert.ok(res.ok);
  await drainJobs();
  const job = await jobOf(res.id);
  assert.equal(job!.status, "FAILED");
  assert.equal(job!.doc_json, null);
  assert.equal(await fileOf(res.id), null);
  assert.equal(net.calls(), 0);
  assert.equal((await wallet(u.id)).balance, 10_000, "the worker's refund path ran");
  assert.ok(!JSON.stringify(job).includes(secret));
});

test("another buyer's item: a purchase of one user does not open the item for another", { skip }, async (t) => {
  quiet(t);
  noNetwork(t);
  await resetSettings();
  const jobs = await import("../lib/server/jobs.ts");
  const item = await mkItem();
  await buy(await mkUser(), item);
  const thief = await mkUser({ balance: 10_000 });
  const res = await jobs.enqueueGeneration({ userId: thief.id, toolId: "referat", topic: "x", price: 100, format: "docx", values: { marketItemId: item }, budgetMs: 60_000 });
  assert.ok(res.ok);
  await rows("UPDATE generations SET market_item_id = $2 WHERE id = $1", [res.id, item]);
  await drainJobs();
  assert.equal((await jobOf(res.id))!.status, "FAILED", "a purchase row must point at this very job");
});

test("another tool's form: a purchase row of a referat does not render under a slide job", { skip }, async (t) => {
  quiet(t);
  noNetwork(t);
  await resetSettings();
  const item = await mkItem();
  const u = await mkUser();
  const res = await buy(u, item);
  await rows("UPDATE generations SET tool_id = 'essay' WHERE id = $1", [res.body.generationId]);
  await drainJobs();
  assert.equal((await jobOf(res.body.generationId))!.status, "FAILED");
});

test("a render failure: FAILED, full refund through the worker path, the purchase stays", { skip }, async (t) => {
  quiet(t);
  noNetwork(t);
  await resetSettings();
  const item = await mkItem();
  const u = await mkUser({ balance: 50_000 });
  const res = await buy(u, item);
  const gen = res.body.generationId as string;
  await rows(`UPDATE market_items SET doc_json = '{}'::jsonb WHERE id = $1`, [item]);
  await drainJobs();
  assert.equal((await jobOf(gen))!.status, "FAILED");
  assert.equal((await wallet(u.id)).balance, 50_000);
  assert.deepEqual((await ledger(u.id)).map((l) => [l.kind, l.reference]), [["charge", gen], ["refund", gen]]);
  const [p] = await rows("SELECT generation_id FROM market_purchases WHERE id = $1", [gen]);
  assert.equal(p!.generation_id, gen);
  assert.equal(Number((await rows("SELECT sold_count FROM market_items WHERE id = $1", [item]))[0]!.sold_count), 1, "§9: not decremented");
});
