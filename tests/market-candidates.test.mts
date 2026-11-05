import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { marketWorkDoc, bodyText } from "./helpers/market-fixtures.mts";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { FormValues, ToolId } from "../lib/types.ts";

/**
 * The candidate scan (docs/market/PLAN.md §1.2) on a real, isolated Postgres. Rows are seeded through the real path:
 * `enqueueGeneration` (charge) → `claimJob` → `commitJobResult`, then `finished_at` is moved back past the settling window.
 *
 * Every exclusion rule has a row that must NOT be picked: refunded, partially refunded, purged, opted out, blocked, admin,
 * user material (each key), a bought copy, too fresh, duplicate, per-topic limit, low quality, partial delivery, a tool off
 * the market. The other half: the second scan is idempotent, the batch is honoured, the advisory lock holds, and after the
 * scan a listing no longer depends on its source in any way.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `t.kind = 'refund'` exists-clause removed                     -> «exclusions» (refunded, partial);
 *   2. `g.files_purged_at IS NULL` removed                           -> «exclusions» (purged);
 *   3. `u.market_opt_out = FALSE` removed                            -> «exclusions» (opted out);
 *   4. `u.is_blocked = FALSE` removed                                -> «exclusions» (blocked);
 *   5. admin_accounts exists-clause removed                          -> «exclusions» (admin);
 *   6. `g.market_item_id IS NULL` removed                            -> «exclusions» (copy);
 *   7. `finished_at` window removed                                  -> «exclusions» (fresh);
 *   8. `delivered_json IS NULL` removed                              -> «exclusions» (partial delivery);
 *   9. user material filter removed                                  -> «user material»;
 *  10. empty values treated as filled (`NOT IN` list reduced)         -> «an empty form key is no material»;
 *  11. `COALESCE(g.doc_prev, g.doc_json)` → `g.doc_json`             -> «the AI original»;
 *  12. simhash gate removed                                          -> «duplicates»;
 *  13. same-(topic, size) gate removed                               -> «duplicates»;
 *  14. per-topic check removed                                       -> «per-topic limit»;
 *  15. quality threshold ignored                                     -> «quality»;
 *  16. advisory lock not taken                                       -> «advisory lock»;
 *  17. `marketCandidatesStep` runs while the market is off           -> «dark launch»;
 *  18. rejected row stores the raw topic instead of the sanitised    -> «rejected rows hold no document»;
 *  19. assets not copied                                             -> «a listing stands alone»;
 *  20. every asset of the source copied                              -> «a listing stands alone»;
 *  21. `market.tools_disabled` ignored by the scan                   -> «market.tools_disabled»;
 *  22. a placeholder without bytes kept                              -> «a deleted asset»;
 *  23. re-sanitising keeps the preview version                       -> «resanitize»;
 *  24. the previews sweep ignores the status                         -> «garbage collection»;
 *  25. the rejected sweep ignores the age                            -> «garbage collection».
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("marketcand") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};

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

let seq = 0;
async function mkUser(over: { blocked?: boolean; optOut?: boolean } = {}): Promise<string> {
  const { query } = await db();
  const id = String(
    (await query<{ id: string }>("INSERT INTO users (username, name, is_blocked, market_opt_out, balance) VALUES ($1, 'Sintetik Akkaunt', $2, $3, 1000000) RETURNING id", [`mk-${process.pid}-${seq++}`, over.blocked ?? false, over.optOut ?? false]))[0]!.id,
  );
  return id;
}

/** A finished generation through the real queue path, its `finished_at` moved `hoursAgo` back. */
async function finished(userId: string, toolId: ToolId, doc: AcademicDoc, o: { values?: FormValues; hoursAgo?: number; assets?: { assetId: string; bytes: Buffer }[]; delivered?: { got: number; want: number } } = {}): Promise<string> {
  const { query } = await db();
  const jobs = await import("../lib/server/jobs.ts");
  const res = await jobs.enqueueGeneration({ userId, toolId, topic: doc.meta.topic, price: 100, format: "docx", values: o.values ?? {}, budgetMs: 60_000 });
  assert.ok(res.ok);
  const lease = jobs.newLease(`w${seq++}`);
  const claimed = await jobs.claimJob(lease, { userMaxRunning: 1000 });
  assert.equal(claimed?.id, res.id);
  const assets = (o.assets ?? []).map((a) => ({ assetId: a.assetId, mime: "image/png", bytes: a.bytes }));
  assert.equal(await jobs.commitJobResult(res.id, lease, { bytes: new Uint8Array([1, 2, 3]), mime: "application/x", fileName: "a.docx" }, assets, { html: "", doc, fileName: "a.docx", preview: null, delivered: o.delivered }), true);
  await query("UPDATE generations SET finished_at = now() - $2::int * interval '1 hour' WHERE id = $1", [res.id, o.hoursAgo ?? 25]);
  return res.id;
}

const scan = async (o: { batch?: number } = {}) => (await import("../lib/server/market/candidates.ts")).scanMarketCandidates({ batch: 1000, ...o });

async function clear() {
  const { query } = await db();
  await query("DELETE FROM market_assets");
  await query("DELETE FROM market_items");
  await query("DELETE FROM app_settings WHERE key LIKE 'market.%'");
  await query("UPDATE generations SET finished_at = now() WHERE status = 'COMPLETED'");
  (await import("../lib/server/settings.ts")).invalidateSettingsCache();
}

const statusOf = async (genId: string) => {
  const { query } = await db();
  return (await query<{ status: string; reject_reason: string | null }>("SELECT status, reject_reason FROM market_items WHERE source_generation_id = $1", [genId]))[0] ?? null;
};

test("an empty document topic: the public title is the tool's name, never the raw generations.topic", { skip }, async (t) => {
  quiet(t);
  await clear();
  const { query } = await db();
  const u = await mkUser();
  const gen = await finished(u, "referat", marketWorkDoc("referat", "Bir mavzu", 150));
  await query(`UPDATE generations SET topic = 'Sintetik Muallif shaxsiy ishi', doc_json = jsonb_set(doc_json, '{meta,topic}', '""') WHERE id = $1`, [gen]);
  await scan();
  const [row] = await query<{ title: string }>("SELECT title FROM market_items WHERE source_generation_id = $1", [gen]);
  assert.equal(row!.title, "Referat");
});

test("the happy path: a work becomes a sanitised candidate with its facts, no author on it", { skip }, async (t) => {
  quiet(t);
  await clear();
  const { query } = await db();
  const u = await mkUser();
  const doc = marketWorkDoc("referat", "Fotosintez jarayoni va o'simliklar", 100);
  const gen = await finished(u, "referat", doc, { values: { pages: "15-20", workKind: "informative", author: "Sintetik Muallif", extra: "" } });
  const r = await scan();
  assert.deepEqual(r, { locked: false, scanned: 1, created: 1, rejected: 0 });
  const [row] = await query<Record<string, unknown>>(
    `SELECT status, tool_id, title, summary, subject, level, language, pages, slide_count, params_json, outline_json, topic_norm, simhash::text AS simhash, original_price, max_copies, search_text, source_generation_id, source_user_id, doc_json, quality_json FROM market_items`,
  );
  assert.equal(row!.status, "candidate");
  assert.equal(row!.source_generation_id, gen);
  assert.equal(String(row!.source_user_id), u);
  assert.equal(row!.title, "Fotosintez jarayoni va o'simliklar");
  assert.equal(row!.subject, "biologiya");
  assert.equal(row!.level, "otm");
  assert.equal(row!.language, "uz");
  assert.equal(row!.pages, 2);
  assert.equal(row!.slide_count, null);
  assert.deepEqual(row!.params_json, { pages: "15-20", workKind: "informative" });
  assert.deepEqual(row!.outline_json, ["Kirish", "Asosiy qism", "Xulosa"]);
  assert.equal(row!.topic_norm, "fotosintez jarayoni va osimliklar");
  assert.notEqual(row!.simhash, "0");
  assert.equal(row!.original_price, "4000");
  assert.equal(row!.max_copies, 5, "the family's default cap");
  assert.match(row!.search_text as string, /fotosintez/);
  const stored = row!.doc_json as AcademicDoc;
  assert.equal(stored.meta.author, "");
  assert.equal(stored.work!.university, "");
  assert.ok(!JSON.stringify(stored).includes("Sintetik"));
  assert.ok(((row!.quality_json as { score: number }).score) >= 70);
  assert.ok(!(row!.summary as string).includes("energiya tizim"), "no body sentence in the public summary");
});

test("exclusions: every rule keeps its row out of the market", { skip }, async (t) => {
  quiet(t);
  await clear();
  const { query } = await db();
  const credits = await import("../lib/server/credits.ts");
  const rows: Record<string, string> = {};
  let n = 200;
  const work = () => {
    n++;
    return marketWorkDoc("referat", `Mavzu raqam ${n}`, n);
  };
  const good = await finished(await mkUser(), "referat", work());

  rows.refunded = await finished(await mkUser(), "referat", work());
  const refunded = await query<{ user_id: string }>("SELECT user_id FROM generations WHERE id = $1", [rows.refunded]);
  await credits.refund(String(refunded[0]!.user_id), rows.refunded);

  rows.partial = await finished(await mkUser(), "referat", work());
  const partial = await query<{ user_id: string }>("SELECT user_id FROM generations WHERE id = $1", [rows.partial]);
  assert.equal(await credits.refundPartial(String(partial[0]!.user_id), rows.partial, 0.25), true);

  rows.purged = await finished(await mkUser(), "referat", work());
  await query("UPDATE generations SET files_purged_at = now() WHERE id = $1", [rows.purged]);

  rows.optedOut = await finished(await mkUser({ optOut: true }), "referat", work());
  rows.blocked = await finished(await mkUser({ blocked: true }), "referat", work());

  const adminUser = await mkUser();
  await query("INSERT INTO admin_accounts (user_id, role, status) VALUES ($1, 'admin', 'active')", [adminUser]);
  rows.admin = await finished(adminUser, "referat", work());

  rows.copy = await finished(await mkUser(), "referat", work());
  await query("UPDATE generations SET market_item_id = $2 WHERE id = $1", [rows.copy, randomUUID()]);

  rows.fresh = await finished(await mkUser(), "referat", work(), { hoursAgo: 23 });
  rows.delivered = await finished(await mkUser(), "slide", work(), { delivered: { got: 3, want: 4 } });
  rows.resume = await finished(await mkUser(), "resume", work());
  rows.article = await finished(await mkUser(), "article", work());

  const queued = await (await import("../lib/server/jobs.ts")).enqueueGeneration({ userId: await mkUser(), toolId: "referat", topic: "Hali navbatda", price: 100, format: "docx", values: {}, budgetMs: 60_000 });
  assert.ok(queued.ok);

  const r = await scan();
  assert.equal(r.created, 1, `only the good row: ${JSON.stringify(r)}`);
  assert.equal((await statusOf(good))?.status, "candidate");
  for (const [name, id] of Object.entries(rows)) assert.equal(await statusOf(id), null, `${name} must not be picked`);
  await query("DELETE FROM generations WHERE id = $1", [queued.id]);
});

test("user material: a filled source, template, logo, photo, facts or sources field disqualifies; the row is not even read", { skip }, async (t) => {
  quiet(t);
  await clear();
  const { USER_MATERIAL_KEYS } = await import("../lib/server/market/candidates.ts");
  assert.deepEqual([...USER_MATERIAL_KEYS], ["sourceAssetId", "sourceText", "templateAssetId", "logoAssetId", "photoAssetId", "userFacts", "userRefs", "userData"]);
  let n = 300;
  const ids: string[] = [];
  for (const key of USER_MATERIAL_KEYS) {
    n++;
    ids.push(await finished(await mkUser(), "referat", marketWorkDoc("referat", `Mavzu ${key}`, n), { values: { [key]: key === "userRefs" ? '[{"raw":"Kitob"}]' : "abc123" } }));
  }
  const r = await scan();
  assert.equal(r.scanned, 0);
  for (const id of ids) assert.equal(await statusOf(id), null);
});

test("an empty form key is no material: the forms send these keys blank on every normal submit", { skip }, async (t) => {
  quiet(t);
  await clear();
  const id = await finished(await mkUser(), "referat", marketWorkDoc("referat", "Bo'sh maydonlar", 320), { values: { sourceAssetId: "", sourceText: "   ", userRefs: "[]", userData: "{}", logoAssetId: "", userFacts: "" } });
  assert.equal((await scan()).created, 1);
  assert.equal((await statusOf(id))?.status, "candidate");
});

test("the document can still say so: material only the document knows of rejects the row, keeping no text", { skip }, async (t) => {
  quiet(t);
  await clear();
  const { query } = await db();
  const doc = marketWorkDoc("referat", "Hujjatdagi manba", 330);
  doc.work!.userFacts = "Mening shaxsiy tajribam";
  const id = await finished(await mkUser(), "referat", doc);
  assert.equal((await scan()).rejected, 1);
  assert.deepEqual(await statusOf(id), { status: "rejected", reject_reason: "user_material" });
  const [row] = await query<{ doc_json: unknown }>("SELECT doc_json FROM market_items WHERE source_generation_id = $1", [id]);
  assert.deepEqual(row!.doc_json, {});
});

test("the AI original: an edited work is read from `doc_prev`, what the user typed or uploaded after does not enter", { skip }, async (t) => {
  quiet(t);
  await clear();
  const { query } = await db();
  const original = marketWorkDoc("referat", "Tahrirlangan ish", 340);
  const id = await finished(await mkUser(), "referat", original);
  const edited = JSON.parse(JSON.stringify(original)) as AcademicDoc;
  edited.sections[0]!.blocks = [{ kind: "p", text: "Foydalanuvchi yozdi: uyim Chilonzor, kvartira 12" }];
  await query("UPDATE generations SET doc_prev = doc_json, doc_json = $2::jsonb, doc_version = 1 WHERE id = $1", [id, JSON.stringify(edited)]);
  assert.equal((await scan()).created, 1);
  const [row] = await query<{ doc_json: AcademicDoc }>("SELECT doc_json FROM market_items WHERE source_generation_id = $1", [id]);
  assert.ok(!JSON.stringify(row!.doc_json).includes("Chilonzor"));
  assert.ok(row!.doc_json.sections[0]!.blocks[0]!.text.length > 100);
});

test("duplicates: one body (any topic) and one (topic, size) enter once; the second row is rejected and stays out", { skip }, async (t) => {
  quiet(t);
  await clear();
  const [a, sameBody] = [await finished(await mkUser(), "referat", marketWorkDoc("referat", "Birinchi sarlavha", 400)), await finished(await mkUser(), "referat", marketWorkDoc("referat", "Butunlay boshqa sarlavha", 400))];
  const b = await finished(await mkUser(), "referat", marketWorkDoc("referat", "ЎЗБЕКИСТОН ТАРИХИ", 410), { values: { pages: "15-20" } });
  const c = await finished(await mkUser(), "referat", marketWorkDoc("referat", "O'zbekiston tarixi", 420), { values: { pages: "15-20" } });
  const d = await finished(await mkUser(), "referat", marketWorkDoc("referat", "Oʻzbekiston tarixi", 430), { values: { pages: "25-30" } });
  const r = await scan();
  assert.equal(r.scanned, 5);
  const states = await Promise.all([a, sameBody, b, c, d].map(statusOf));
  const reasons = states.map((s) => s?.reject_reason ?? s?.status);
  // Newest first: `d` and the earlier rows are decided in `finished_at` order; every pair has exactly one survivor.
  assert.equal(reasons.filter((x) => x === "candidate").length, 3, reasons.join());
  assert.equal(reasons.filter((x) => x === "duplicate").length, 2, reasons.join());
  assert.equal(reasons[4], "candidate", "the same topic at another size is another product");
  assert.equal([reasons[0], reasons[1]].filter((x) => x === "duplicate").length, 1);
  assert.equal([reasons[2], reasons[3]].filter((x) => x === "duplicate").length, 1);
});

test("a same-topic rejected row does not block; a retired one neither", { skip }, async (t) => {
  quiet(t);
  await clear();
  const { query } = await db();
  const first = await finished(await mkUser(), "referat", marketWorkDoc("referat", "Takroriy mavzu", 440), { values: { pages: "15-20" } });
  await scan();
  await query("UPDATE market_items SET status = 'retired' WHERE source_generation_id = $1", [first]);
  const second = await finished(await mkUser(), "referat", marketWorkDoc("referat", "Takroriy mavzu", 441), { values: { pages: "15-20" } });
  await scan();
  assert.equal((await statusOf(second))?.status, "candidate");
});

test("per-topic limit: market.per_topic_limit items per (tool, topic), other tools untouched", { skip }, async (t) => {
  quiet(t);
  await clear();
  const s = await import("../lib/server/settings.ts");
  const { transaction } = await db();
  await transaction((c) => s.setSettingInTx(c, "market.per_topic_limit", 2, null));
  s.invalidateSettingsCache();
  const ids: string[] = [];
  for (const [i, pages] of ["10-15", "15-20", "20-25"].entries()) {
    ids.push(await finished(await mkUser(), "referat", marketWorkDoc("referat", "Ommabop mavzu", 450 + i), { values: { pages } }));
  }
  const other = await finished(await mkUser(), "mustaqil-ish", marketWorkDoc("mustaqil-ish", "Ommabop mavzu", 460), { values: { pages: "15-20" } });
  await scan();
  const reasons = await Promise.all(ids.map(statusOf));
  assert.equal(reasons.filter((r) => r?.status === "candidate").length, 2);
  assert.equal(reasons.filter((r) => r?.reject_reason === "per_topic").length, 1);
  assert.equal((await statusOf(other))?.status, "candidate");
});

test("quality: a low score is a rejected row with the score kept, and the next scan does not re-evaluate it", { skip }, async (t) => {
  quiet(t);
  await clear();
  const { query } = await db();
  const id = await finished(await mkUser(), "referat", marketWorkDoc("referat", "Sifatsiz ish", 470, { score: 30 }));
  const first = await scan();
  assert.deepEqual([first.created, first.rejected], [0, 1]);
  assert.equal((await statusOf(id))?.reject_reason, "quality");
  const [row] = await query<{ quality_json: { score: number }; doc_json: unknown }>("SELECT quality_json, doc_json FROM market_items WHERE source_generation_id = $1", [id]);
  assert.ok(row!.quality_json.score < 70);
  assert.deepEqual(row!.doc_json, {});
  assert.equal((await scan()).scanned, 0);
});

test("legacy: a work without its model is a rejected row, not a crash; a broken document is `sanitize_error`, the scan goes on", { skip }, async (t) => {
  quiet(t);
  await clear();
  const legacy = marketWorkDoc("referat", "Eski ish", 480);
  delete legacy.work;
  const legacyId = await finished(await mkUser(), "referat", legacy);
  const good = await finished(await mkUser(), "referat", marketWorkDoc("referat", "Yaxshi ish", 481));
  await scan();
  assert.equal((await statusOf(legacyId))?.reject_reason, "legacy");
  assert.equal((await statusOf(good))?.status, "candidate");
});

test("rejected rows hold no document: only the sanitised title, even when the topic carries a phone", { skip }, async (t) => {
  quiet(t);
  await clear();
  const { query } = await db();
  const doc = marketWorkDoc("referat", "Mavzu +998901234567 raqami", 490, { score: 10 });
  await finished(await mkUser(), "referat", doc);
  await scan();
  const [row] = await query<{ title: string; topic_norm: string }>("SELECT title, topic_norm FROM market_items");
  assert.ok(!row!.title.includes("998"), row!.title);
  assert.ok(!row!.topic_norm.includes("998"));
});

test("idempotent: a second scan creates nothing; the batch size is honoured, newest first", { skip }, async (t) => {
  quiet(t);
  await clear();
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) ids.push(await finished(await mkUser(), "referat", marketWorkDoc("referat", `Partiya ${i}`, 500 + i), { hoursAgo: 25 + i }));
  assert.equal((await scan({ batch: 2 })).scanned, 2);
  assert.equal((await statusOf(ids[0]!))?.status, "candidate");
  assert.equal(await statusOf(ids[3]!), null, "the oldest waits for the next scan");
  assert.equal((await scan({ batch: 2 })).scanned, 2);
  assert.deepEqual(await scan({ batch: 2 }), { locked: false, scanned: 0, created: 0, rejected: 0 });
  assert.deepEqual(await scan({ batch: 0 }), { locked: false, scanned: 0, created: 0, rejected: 0 }, "0 = the scanner is off");
});

test("market.tools_disabled: a withdrawn tool is not scanned", { skip }, async (t) => {
  quiet(t);
  await clear();
  const s = await import("../lib/server/settings.ts");
  const { transaction } = await db();
  await transaction((c) => s.setSettingInTx(c, "market.tools_disabled", ["referat"], null));
  s.invalidateSettingsCache();
  const off = await finished(await mkUser(), "referat", marketWorkDoc("referat", "Olib qo'yilgan vosita", 510));
  const on = await finished(await mkUser(), "mustaqil-ish", marketWorkDoc("mustaqil-ish", "Ochiq vosita", 511));
  await scan();
  assert.equal(await statusOf(off), null);
  assert.equal((await statusOf(on))?.status, "candidate");
});

test("advisory lock: while another session holds it the scan touches nothing and says so", { skip }, async (t) => {
  quiet(t);
  await clear();
  const { pool } = await db();
  const { MARKET_SCAN_LOCK_ID } = await import("../lib/server/market/candidates.ts");
  assert.equal(MARKET_SCAN_LOCK_ID, 727_000_006);
  const id = await finished(await mkUser(), "referat", marketWorkDoc("referat", "Qulf", 520));
  const other = await pool().connect();
  try {
    await other.query("SELECT pg_advisory_lock($1)", [MARKET_SCAN_LOCK_ID]);
    assert.deepEqual(await scan(), { locked: true, scanned: 0, created: 0, rejected: 0 });
    assert.equal(await statusOf(id), null);
  } finally {
    await other.query("SELECT pg_advisory_unlock($1)", [MARKET_SCAN_LOCK_ID]);
    other.release();
  }
  assert.equal((await scan()).created, 1, "released: the next scan runs");
});

test("dark launch: the 6 hour step does nothing while the market is off, the admin's manual scan still works", { skip }, async (t) => {
  quiet(t);
  await clear();
  const s = await import("../lib/server/settings.ts");
  const { transaction } = await db();
  const c = await import("../lib/server/market/candidates.ts");
  const id = await finished(await mkUser(), "referat", marketWorkDoc("referat", "Qorong'i ishga tushirish", 530));
  assert.equal(await c.marketCandidatesStep(), 0);
  assert.equal(await statusOf(id), null);
  await transaction((client) => s.setSettingInTx(client, "market.enabled", true, null));
  s.invalidateSettingsCache();
  assert.equal(await c.marketCandidatesStep(), 1);
});

test("a listing stands alone: assets copied, and deleting the source, its assets and its author changes nothing", { skip }, async (t) => {
  quiet(t);
  await clear();
  const { query } = await db();
  const { collectPlaceholders } = await import("../lib/market/sanitize.ts");
  const u = await mkUser();
  const doc = marketWorkDoc("referat", "Rasmli ish", 540);
  const [a1, a2, thumbLike] = [Buffer.from("rasm-bir"), Buffer.from("rasm-ikki"), Buffer.from("eskiz")];
  const gen = randomUUID();
  doc.work!.figures = [{ id: "f1", kind: "scheme", caption: "Sxema", spec: { kind: "process", steps: ["a", "b"] }, url: "PLACEHOLDER", assetId: "aa11", w: 10, h: 10 }];
  const id = await finished(u, "referat", doc, { assets: [{ assetId: "aa11", bytes: a1 }, { assetId: "bb22", bytes: a2 }, { assetId: "cc33", bytes: thumbLike }] });
  // The real doc carries this generation's own URL: rewritten after the id is known.
  await query(`UPDATE generations SET doc_json = jsonb_set(doc_json, '{work,figures,0,url}', to_jsonb($2::text)) WHERE id = $1`, [id, `/api/generations/${id}/assets/aa11`]);
  assert.ok(gen);
  await scan();
  const [row] = await query<{ id: string; doc_json: AcademicDoc }>("SELECT id, doc_json FROM market_items WHERE source_generation_id = $1", [id]);
  const text = JSON.stringify(row!.doc_json);
  assert.ok(!text.includes("/api/generations/"), "no URL points at the source");
  assert.ok(!text.includes(id), "the source's id is nowhere in the document");
  assert.deepEqual(collectPlaceholders(row!.doc_json), ["aa11"]);
  const assets = await query<{ asset_id: string; bytes: Buffer }>("SELECT asset_id, bytes FROM market_assets WHERE item_id = $1", [row!.id]);
  assert.deepEqual(assets.map((a) => a.asset_id), ["aa11"], "only what the sanitised document references");
  assert.equal(assets[0]!.bytes.toString(), "rasm-bir");

  await query("DELETE FROM generations WHERE id = $1", [id]);
  await query("DELETE FROM users WHERE id = $1", [u]);
  const [after] = await query<{ source_generation_id: string | null; source_user_id: string | null; doc_json: AcademicDoc }>("SELECT source_generation_id, source_user_id, doc_json FROM market_items WHERE id = $1", [row!.id]);
  assert.deepEqual([after!.source_generation_id, after!.source_user_id], [null, null]);
  assert.deepEqual(after!.doc_json, row!.doc_json);
  assert.equal((await query("SELECT 1 FROM market_assets WHERE item_id = $1", [row!.id])).length, 1);
});

test("a deleted asset leaves no empty frame: an edited-away picture drops from the listing", { skip }, async (t) => {
  quiet(t);
  await clear();
  const { query } = await db();
  const doc = marketWorkDoc("referat", "Rasmi yo'qolgan ish", 550);
  doc.work!.figures = [{ id: "f1", kind: "scheme", caption: "S", spec: { kind: "process", steps: ["a", "b"] }, url: "x", assetId: "dd44", w: 1, h: 1 }];
  const id = await finished(await mkUser(), "referat", doc);
  await query(`UPDATE generations SET doc_json = jsonb_set(doc_json, '{work,figures,0,url}', to_jsonb($2::text)) WHERE id = $1`, [id, `/api/generations/${id}/assets/dd44`]);
  await scan();
  const [row] = await query<{ doc_json: AcademicDoc }>("SELECT doc_json FROM market_items");
  assert.equal(row!.doc_json.work!.figures[0]!.url, undefined);
});

test("garbage collection: old retired previews and rejected documents go, recent ones and the row stay", { skip }, async (t) => {
  quiet(t);
  await clear();
  const { query } = await db();
  const { gcMarketPreviews, gcRejectedItems } = await import("../lib/server/market/candidates.ts");
  const make = async (status: string, days: number, topic: string) => {
    const [row] = await query<{ id: string }>(
      `INSERT INTO market_items (tool_id, title, doc_json, topic_norm, status, updated_at) VALUES ('referat', 'T', '{"meta":{}}'::jsonb, $1, $2, now() - $3::int * interval '1 day') RETURNING id`,
      [topic, status, days],
    );
    await query(`INSERT INTO market_previews (item_id, page, kind, mime, size_bytes, bytes, version) VALUES ($1, 1, 'page', 'image/jpeg', 1, '\\x00', 1)`, [row!.id]);
    await query(`INSERT INTO market_assets (item_id, asset_id, mime, size_bytes, bytes) VALUES ($1, 'aa', 'image/png', 1, '\\x00')`, [row!.id]);
    return row!.id;
  };
  const [oldRetired, newRetired, active, oldRejected, newRejected] = [
    await make("retired", 31, "a"),
    await make("retired", 29, "b"),
    await make("active", 400, "c"),
    await make("rejected", 91, "d"),
    await make("rejected", 89, "e"),
  ];
  assert.equal(await gcMarketPreviews(), 3, "every retired or rejected item older than 30 days");
  const has = async (id: string) => (await query("SELECT 1 FROM market_previews WHERE item_id = $1", [id])).length;
  assert.deepEqual([await has(oldRetired), await has(newRetired), await has(active), await has(oldRejected), await has(newRejected)], [0, 1, 1, 0, 0]);
  assert.equal(await gcRejectedItems(), 1);
  const doc = async (id: string) => (await query<{ doc_json: unknown }>("SELECT doc_json FROM market_items WHERE id = $1", [id]))[0]!.doc_json;
  assert.deepEqual(await doc(oldRejected), {}, "the row stays, so the scan never evaluates that work again");
  assert.deepEqual(await doc(newRejected), { meta: {} });
  assert.equal((await query("SELECT 1 FROM market_assets WHERE item_id = $1", [oldRejected])).length, 0);
  assert.equal(await gcRejectedItems(), 0, "idempotent");
});

test("resanitize: a stored candidate is re-cleaned from its own document, the preview version moves, the source stays unread", { skip }, async (t) => {
  quiet(t);
  await clear();
  const { query, transaction } = await db();
  const { resanitizeItemInTx } = await import("../lib/server/market/candidates.ts");
  await finished(await mkUser(), "referat", marketWorkDoc("referat", "Qayta tozalanadigan ish", 560));
  await scan();
  const [row] = await query<{ id: string; doc_json: AcademicDoc; preview_version: number }>("SELECT id, doc_json, preview_version FROM market_items");
  row!.doc_json.sections[0]!.blocks = [{ kind: "p", text: "Telefon +998901112233 topildi" }];
  await query("UPDATE market_items SET doc_json = $2::jsonb, source_generation_id = NULL WHERE id = $1", [row!.id, JSON.stringify(row!.doc_json)]);
  assert.deepEqual(await transaction((c) => resanitizeItemInTx(c, row!.id)), { flags: 1 });
  const [after] = await query<{ doc_json: AcademicDoc; preview_version: number; pii_flags: { kind: string }[] }>("SELECT doc_json, preview_version, pii_flags FROM market_items WHERE id = $1", [row!.id]);
  assert.ok(!JSON.stringify(after!.doc_json).includes("998901112233"));
  assert.equal(after!.preview_version, row!.preview_version + 1);
  assert.deepEqual(after!.pii_flags.map((f) => f.kind), ["phone"]);
  assert.equal(await transaction((c) => resanitizeItemInTx(c, "not-a-uuid")), null);
});

test("the fixture sanity: pseudo-random bodies differ between seeds", () => {
  assert.notEqual(bodyText(1, 50), bodyText(2, 50));
});
