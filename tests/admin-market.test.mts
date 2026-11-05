import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { marketWorkDoc } from "./helpers/market-fixtures.mts";

/**
 * /api/admin/market/** through the REAL routes on a throwaway Postgres (docs/market/PLAN.md §6, §9, §10.3). The role ×
 * route matrix itself lives in tests/admin-permission-matrix.test.mts, which discovers these routes from the tree.
 *
 * Mutations (each turned the named test red, then restored byte for byte):
 *   1. `putNeutralFile` moved after the audit-less commit (no call in `approveOne`)      -> «approve: file, status, …»;
 *   2. the render's catch removed, so a failed render still flips the status             -> covered by «failing render»: red
 *      when `throw new ApiError(... render_failed)` is replaced by a `return`-less skip;
 *   3. `original_price` left out of the approval UPDATE                                  -> «approve: file, status, …»;
 *   4. `invalidateMarketCatalogCache()` dropped from `approveMarketItem`                 -> «approve: the catalog shows it at once»;
 *   5. `parseReason` of reject made optional                                             -> «reason is required»;
 *   6. `statusForCap` always returns the status it got                                   -> «edit: raising a sold-out cap»;
 *   7. bulk: the `has_flags` refusal removed                                             -> «bulk: a work with PII hits is refused»;
 *   8. `permission: "pricing.edit"` on the price route changed to `market.manage`        -> «price: step-up», and the matrix's
 *      least-privilege test;
 *   9. `invalidateMarketPricingCache()` dropped from `setMarketToolPercent`              -> «tool percent: the next price»;
 *  10. stats: refunds not subtracted (`revenue: gross`)                                  -> «stats: hand-computed fixture»;
 *  11. stats: the Tashkent day replaced by the UTC day                                   -> «stats: hand-computed fixture»;
 *  12. `source` returned without the `users.pii` check                                   -> «detail: the author only with users.pii»;
 *  13. `market.file_read` audit removed                                                  -> «file: audited read»;
 *  14. `marketItemDoc` returns the stored doc without the placeholder rewrite            -> «doc: images through the admin route»;
 *  15. the abuse route without the state check                                           -> «abuse flag».
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.TELEGRAM_BOT_TOKEN = "123456:admin-market-test-token-never-called";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("adminmarket") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const svc = await import("../lib/server/admin-market.ts");
const { listMarketItems, invalidateMarketCatalogCache } = await import("../lib/server/market/search.ts");
const { marketPriceForItem } = await import("../lib/server/market/pricing.ts");
const { getItemRow } = await import("../lib/server/market/store.ts");
const { MARKET_ASSET_PREFIX } = await import("../lib/market/types.ts");

const R = {
  items: await import("../app/api/admin/market/items/route.ts"),
  item: await import("../app/api/admin/market/items/[id]/route.ts"),
  doc: await import("../app/api/admin/market/items/[id]/doc/route.ts"),
  file: await import("../app/api/admin/market/items/[id]/file/route.ts"),
  buyers: await import("../app/api/admin/market/items/[id]/buyers/route.ts"),
  approve: await import("../app/api/admin/market/items/[id]/approve/route.ts"),
  reject: await import("../app/api/admin/market/items/[id]/reject/route.ts"),
  retire: await import("../app/api/admin/market/items/[id]/retire/route.ts"),
  unhide: await import("../app/api/admin/market/items/[id]/unhide/route.ts"),
  resanitize: await import("../app/api/admin/market/items/[id]/resanitize/route.ts"),
  previews: await import("../app/api/admin/market/items/[id]/previews/route.ts"),
  price: await import("../app/api/admin/market/items/[id]/price/route.ts"),
  bulk: await import("../app/api/admin/market/bulk-approve/route.ts"),
  scan: await import("../app/api/admin/market/scan/route.ts"),
  overview: await import("../app/api/admin/market/overview/route.ts"),
  stats: await import("../app/api/admin/market/stats/route.ts"),
  exportCsv: await import("../app/api/admin/market/sales/export/route.ts"),
  tools: await import("../app/api/admin/market/tool-pricing/route.ts"),
  tool: await import("../app/api/admin/market/tool-pricing/[toolId]/route.ts"),
  abuse: await import("../app/api/admin/market/purchases/[id]/abuse/route.ts"),
};

after(async () => {
  if (!hasDb) return;
  await pool().end();
  await iso.drop();
});

if (hasDb && iso.isolated) await ensureMigrated();

/* ─────────────────────────── fixtures ─────────────────────────── */

type Role = "owner" | "admin" | "finance" | "support" | "moderator" | "viewer";
type Session = { cookie: string; adminId: string };
type Result = { status: number; body: Record<string, unknown>; headers: Headers; text: string };
// Route exports differ per file; the tests call them through one loose shape.
type Handler = (req: Request, ctx: never) => Promise<Response>;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function mkUser(name = "Market Test"): Promise<{ id: string; token: string }> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name) VALUES ($1, $2, $3) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `mk_${randomBytes(5).toString("hex")}`, name],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, token };
}

async function session(role: Role, reauth = true): Promise<Session> {
  const u = await mkUser();
  const acc = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc) VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u.id, role],
  );
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(u.token)]);
  const s = await transaction((client) => createAdminSession(client, { adminId: acc!.id, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "market-test", reauth }));
  return { cookie: `${SESSION_COOKIE}=${u.token}; ${adminCookieName()}=${s.token}`, adminId: acc!.id };
}

async function call(fn: Handler, method: string, s: Session, opts: { path?: string; params?: Record<string, string>; body?: unknown; key?: string | null; qs?: string } = {}): Promise<Result> {
  const headers: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.2.3.4", "user-agent": "market-test", cookie: s.cookie };
  const mutation = method !== "GET";
  if (mutation) {
    headers.origin = "http://localhost:3000";
    headers["content-type"] = "application/json";
    if (opts.key !== null) headers["Idempotency-Key"] = opts.key ?? randomUUID();
  }
  const req = new Request(`http://localhost:3000/api/admin/market/${opts.path ?? "x"}${opts.qs ?? ""}`, { method, headers, body: mutation ? JSON.stringify(opts.body ?? {}) : undefined });
  const res = await inRequest(req, () => fn(req, { params: Promise.resolve(opts.params ?? {}) } as never));
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body, headers: res.headers, text };
}

const REASON = "Ko'rib chiqildi, sifat yaxshi";
let seq = 0;

type ItemOpts = { status?: string; tool?: string; title?: string; doc?: unknown; flags?: unknown[]; sourceUser?: string | null; soldCount?: number; maxCopies?: number | null; hidden?: boolean; subject?: string; quality?: number; params?: unknown; rejectReason?: string };

async function mkItem(o: ItemOpts = {}): Promise<string> {
  const n = ++seq;
  const tool = o.tool ?? "referat";
  const doc = o.doc === undefined ? marketWorkDoc(tool, `Mavzu ${n}`, n, { words: 150 }) : o.doc;
  const row = await queryOne<{ id: string }>(
    `INSERT INTO market_items (tool_id, title, summary, subject, doc_json, params_json, topic_norm, status, quality_json, pii_flags, source_user_id, sold_count, max_copies, reject_reason, outline_json)
     VALUES ($1, $2, 'Qisqa tavsif', $3, $4::jsonb, $5::jsonb, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, '["Kirish","Xulosa"]'::jsonb) RETURNING id`,
    [
      tool,
      o.title ?? `Sinov ishi ${n}`,
      o.subject ?? "boshqa",
      JSON.stringify(doc),
      JSON.stringify(o.params ?? { pages: 10 }),
      `topic-${n}`,
      o.status ?? "candidate",
      JSON.stringify({ score: o.quality ?? 90, ...(o.hidden ? { hidden_until_review: true } : {}) }),
      JSON.stringify(o.flags ?? []),
      o.sourceUser ?? null,
      o.soldCount ?? 0,
      o.maxCopies ?? null,
      o.rejectReason ?? null,
    ],
  );
  return row!.id;
}

const audits = (action: string, target: string) =>
  query<{ reason: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; meta: Record<string, unknown> | null }>(
    `SELECT reason, before, after, meta FROM admin_audit_log WHERE action = $1 AND target_id = $2 ORDER BY id`,
    [action, target],
  );

const statusOf = async (id: string): Promise<string | undefined> => (await getItemRow(id))?.status;

async function setSetting(key: string, value: unknown): Promise<void> {
  await query(`INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, JSON.stringify(value)]);
  const { invalidateSettingsCache } = await import("../lib/server/settings.ts");
  invalidateSettingsCache();
}

/* ─────────────────────────── approve ─────────────────────────── */

test("approve: file, status, approved_*, price snapshot, the family's cap and one audit row", { skip }, async () => {
  const s = await session("moderator");
  const id = await mkItem({ tool: "referat" });
  const r = await call(R.approve.POST as Handler, "POST", s, { params: { id }, body: { reason: REASON, title: "  Yangi   sarlavha ", subject: "tarix", level: "kollej" } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { id, status: "active" });
  const row = await queryOne<{ status: string; approved_at: Date | null; approved_by: string | null; original_price: string; max_copies: number; title: string; subject: string; level: string; search_text: string }>(
    "SELECT status, approved_at, approved_by::text, original_price, max_copies, title, subject, level, search_text FROM market_items WHERE id = $1",
    [id],
  );
  assert.equal(row!.status, "active");
  assert.ok(row!.approved_at);
  assert.equal(row!.approved_by, s.adminId);
  assert.ok(Number(row!.original_price) > 0, "the snapshot of the original price");
  assert.equal(row!.max_copies, 5, "work family default");
  assert.equal(row!.title, "Yangi sarlavha");
  assert.equal(row!.subject, "tarix");
  assert.equal(row!.level, "kollej");
  assert.match(row!.search_text, /yangi sarlavha/);
  const file = await queryOne<{ size_bytes: string; mime: string; file_name: string }>("SELECT size_bytes, mime, file_name FROM market_item_files WHERE item_id = $1", [id]);
  assert.ok(file && Number(file.size_bytes) > 1000, "a real DOCX");
  assert.match(file.mime, /wordprocessingml/);
  assert.match(file.file_name, /^Yangi sarlavha\.docx$/);
  const a = await audits("market.approve", id);
  assert.equal(a.length, 1);
  assert.equal(a[0]!.reason, REASON);
  assert.equal(a[0]!.after!.status, "active");
  assert.equal(a[0]!.after!.maxCopies, 5);
});

test("approve: the catalog shows it at once", { skip }, async () => {
  const s = await session("admin");
  const id = await mkItem({ title: "Darhol ko'rinadigan ish" });
  invalidateMarketCatalogCache();
  const before = await listMarketItems({ sort: "new", limit: 48 });
  assert.ok(!before.items.some((i) => i.id === id));
  assert.equal((await call(R.approve.POST as Handler, "POST", s, { params: { id }, body: { reason: REASON } })).status, 200);
  const after2 = await listMarketItems({ sort: "new", limit: 48 });
  assert.ok(after2.items.some((i) => i.id === id), "the 15 s page cache was dropped");
});

test("approve: a failing render rolls back: still a candidate, no file, no audit row", { skip }, async () => {
  const s = await session("admin");
  const id = await mkItem({ doc: {} });
  const r = await call(R.approve.POST as Handler, "POST", s, { params: { id }, body: { reason: REASON } });
  assert.equal(r.status, 422, r.text);
  assert.equal(r.body.code, "render_failed");
  assert.equal(await statusOf(id), "candidate");
  assert.equal((await queryOne<{ n: string }>("SELECT count(*) AS n FROM market_item_files WHERE item_id = $1", [id]))!.n, "0");
  assert.equal((await audits("market.approve", id)).length, 0);
});

test("approve: only a candidate; the same key replays, another body is 422", { skip }, async () => {
  const s = await session("admin");
  const id = await mkItem();
  const key = randomUUID();
  const first = await call(R.approve.POST as Handler, "POST", s, { params: { id }, body: { reason: REASON }, key });
  assert.equal(first.status, 200, first.text);
  const again = await call(R.approve.POST as Handler, "POST", s, { params: { id }, body: { reason: REASON }, key });
  assert.equal(again.status, 200);
  assert.equal(again.headers.get("Idempotent-Replayed"), "true");
  assert.equal((await audits("market.approve", id)).length, 1, "no second effect");
  const conflict = await call(R.approve.POST as Handler, "POST", s, { params: { id }, body: { reason: `${REASON} boshqa` }, key });
  assert.equal(conflict.status, 422);
  assert.equal(conflict.body.code, "idempotency_conflict");
  const fresh = await call(R.approve.POST as Handler, "POST", s, { params: { id }, body: { reason: REASON } });
  assert.equal(fresh.status, 409);
  assert.equal(fresh.body.code, "state");
  const noKey = await call(R.approve.POST as Handler, "POST", s, { params: { id }, body: { reason: REASON }, key: null });
  assert.equal(noKey.status, 400);
  assert.equal(noKey.body.code, "idempotency_key");
});

test("reason is required on every mutation; validation failures write nothing", { skip }, async () => {
  const s = await session("owner");
  const id = await mkItem({ status: "active", maxCopies: 5 });
  const cand = await mkItem();
  const cases: [Handler, string, Record<string, string>, Record<string, unknown>][] = [
    [R.approve.POST as Handler, "POST", { id: cand }, {}],
    [R.reject.POST as Handler, "POST", { id: cand }, { code: "other" }],
    [R.retire.POST as Handler, "POST", { id }, { code: "copyright", reason: "abc" }],
    [R.item.PATCH as Handler, "PATCH", { id }, { title: "Yangi" }],
    [R.resanitize.POST as Handler, "POST", { id: cand }, {}],
    [R.price.POST as Handler, "POST", { id }, { price: 1000 }],
    [R.scan.POST as Handler, "POST", {}, {}],
    [R.tool.PUT as Handler, "PUT", { toolId: "essay" }, { percent: 40 }],
  ];
  for (const [fn, method, params, body] of cases) {
    const r = await call(fn, method, s, { params, body });
    assert.equal(r.status, 400, `${JSON.stringify(params)} ${r.text}`);
  }
  assert.equal(await statusOf(cand), "candidate");
  assert.equal(await statusOf(id), "active");
  const noCode = await call(R.reject.POST as Handler, "POST", s, { params: { id: cand }, body: { reason: REASON } });
  assert.equal(noCode.status, 400, "the reason code is required too");
});

/* ─────────────────────────── reject, retire, unhide ─────────────────────────── */

test("reject: stores the code, audits, cannot run twice", { skip }, async () => {
  const s = await session("moderator");
  const id = await mkItem();
  const r = await call(R.reject.POST as Handler, "POST", s, { params: { id }, body: { reason: REASON, code: "medical_legal" } });
  assert.equal(r.status, 200, r.text);
  const row = await getItemRow(id);
  assert.equal(row!.status, "rejected");
  assert.equal(row!.reject_reason, "medical_legal");
  assert.equal((await audits("market.reject", id)).length, 1);
  assert.equal((await call(R.reject.POST as Handler, "POST", s, { params: { id }, body: { reason: REASON, code: "other" } })).status, 409);
});

test("retire: off the shelf, purchases stay; a candidate cannot be retired", { skip }, async () => {
  const s = await session("moderator");
  const id = await mkItem({ status: "active", title: "Olib tashlanadigan ish" });
  const buyer = await mkUser();
  await query(`INSERT INTO market_purchases (item_id, buyer_user_id, price, original_price, fingerprint) VALUES ($1, $2, 1000, 2000, 'SLX-TEST')`, [id, buyer.id]);
  const r = await call(R.retire.POST as Handler, "POST", s, { params: { id }, body: { reason: "Muallif shikoyat qildi", code: "copyright" } });
  assert.equal(r.status, 200, r.text);
  const row = await getItemRow(id);
  assert.equal(row!.status, "retired");
  assert.ok(row!.retired_at);
  assert.equal(row!.reject_reason, "copyright");
  assert.equal((await queryOne<{ n: string }>("SELECT count(*) AS n FROM market_purchases WHERE item_id = $1", [id]))!.n, "1");
  const cand = await mkItem();
  assert.equal((await call(R.retire.POST as Handler, "POST", s, { params: { id: cand }, body: { reason: REASON, code: "other" } })).status, 409);
});

test("unhide: a hidden item returns; one that is not hidden is 409", { skip }, async () => {
  const s = await session("admin");
  const id = await mkItem({ status: "active", hidden: true });
  assert.equal((await call(R.unhide.POST as Handler, "POST", s, { params: { id }, body: { reason: REASON } })).status, 200);
  assert.equal((await getItemRow(id))!.quality_json.hidden_until_review, undefined);
  assert.equal((await audits("market.edit", id)).length, 1);
  assert.equal((await call(R.unhide.POST as Handler, "POST", s, { params: { id }, body: { reason: REASON } })).status, 409);
});

/* ─────────────────────────── edit ─────────────────────────── */

test("edit: raising a sold-out cap reopens, lowering to the sold count closes, the audit has only the change", { skip }, async () => {
  const s = await session("moderator");
  const id = await mkItem({ status: "sold_out", soldCount: 5, maxCopies: 5 });
  const open = await call(R.item.PATCH as Handler, "PATCH", s, { params: { id }, body: { reason: REASON, maxCopies: 8 } });
  assert.equal(open.status, 200, open.text);
  assert.equal(open.body.status, "active");
  const close = await call(R.item.PATCH as Handler, "PATCH", s, { params: { id }, body: { reason: REASON, maxCopies: 5 } });
  assert.equal(close.body.status, "sold_out");
  const a = await audits("market.edit", id);
  assert.equal(a.length, 2);
  assert.deepEqual(a[0]!.before, { maxCopies: 5, status: "sold_out" });
  assert.deepEqual(a[0]!.after, { maxCopies: 8, status: "active" });
  const same = await call(R.item.PATCH as Handler, "PATCH", s, { params: { id }, body: { reason: REASON, maxCopies: 5 } });
  assert.equal(same.status, 400);
  assert.equal(same.body.code, "unchanged");
  for (const bad of [{ maxCopies: 0 }, { maxCopies: 1001 }, { title: "" }, { title: "x".repeat(161) }, { subject: "nope" }, { level: "phd" }, { summary: "x".repeat(401) }]) {
    assert.equal((await call(R.item.PATCH as Handler, "PATCH", s, { params: { id }, body: { reason: REASON, ...bad } })).status, 400, JSON.stringify(bad).slice(0, 40));
  }
});

/* ─────────────────────────── re-sanitise, previews ─────────────────────────── */

test("re-sanitise: a missed phone goes, flags are stored, previews get a new version; a listed item gets a fresh file", { skip }, async () => {
  const s = await session("moderator");
  const doc = marketWorkDoc("referat", "Mavzu", 901, { words: 90 }) as unknown as { sections: { blocks: { text: string }[] }[] };
  doc.sections[0]!.blocks[0]!.text = "Bog'lanish uchun +998901234567 raqami.";
  const id = await mkItem({ doc, status: "active" });
  await query(`INSERT INTO market_item_files (item_id, file_name, mime, size_bytes, bytes) VALUES ($1, 'old.docx', 'application/x', 1, '\\x00')`, [id]);
  const v0 = (await getItemRow(id))!.preview_version;
  const r = await call(R.resanitize.POST as Handler, "POST", s, { params: { id }, body: { reason: REASON } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.flags, 1);
  const row = await getItemRow(id);
  assert.equal(row!.preview_version, v0 + 1);
  assert.equal(row!.pii_flags.length, 1);
  const stored = await queryOne<{ doc_json: { sections: { blocks: { text: string }[] }[] } }>("SELECT doc_json FROM market_items WHERE id = $1", [id]);
  assert.ok(!JSON.stringify(stored!.doc_json).includes("998901234567"));
  const file = await queryOne<{ file_name: string; size_bytes: string }>("SELECT file_name, size_bytes FROM market_item_files WHERE item_id = $1", [id]);
  assert.ok(file && file.file_name !== "old.docx" && Number(file.size_bytes) > 1000, "rendered from the cleaned text");
  const rejected = await mkItem({ status: "rejected", rejectReason: "other" });
  assert.equal((await call(R.resanitize.POST as Handler, "POST", s, { params: { id: rejected }, body: { reason: REASON } })).status, 409);
});

test("«Qayta chizish» bumps the preview version", { skip }, async () => {
  const s = await session("moderator");
  const id = await mkItem({ status: "active" });
  const v0 = (await getItemRow(id))!.preview_version;
  const r = await call(R.previews.POST as Handler, "POST", s, { params: { id }, body: { reason: REASON } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.previewVersion, v0 + 1);
  assert.equal((await getItemRow(id))!.preview_version, v0 + 1);
});

/* ─────────────────────────── money ─────────────────────────── */

test("price: step-up, reason, audit; price_version moves; null returns to the formula", { skip }, async () => {
  const id = await mkItem({ status: "active" });
  const stale = await session("admin", false);
  const refused = await call(R.price.POST as Handler, "POST", stale, { params: { id }, body: { price: 1500, reason: REASON } });
  assert.equal(refused.status, 401);
  assert.equal(refused.body.code, "reauth");
  const moderator = await session("moderator");
  assert.equal((await call(R.price.POST as Handler, "POST", moderator, { params: { id }, body: { price: 1500, reason: REASON } })).status, 403, "approval rights do not reach prices");
  const s = await session("admin");
  const v0 = (await getItemRow(id))!.price_version;
  const key = randomUUID();
  const ok = await call(R.price.POST as Handler, "POST", s, { params: { id }, body: { price: 1500, reason: REASON }, key });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.priceOverride, 1500);
  assert.equal(ok.body.price, 1500);
  const replay = await call(R.price.POST as Handler, "POST", s, { params: { id }, body: { price: 1500, reason: REASON }, key });
  assert.equal(replay.headers.get("Idempotent-Replayed"), "true");
  assert.equal((await getItemRow(id))!.price_version, v0 + 1, "the replay changed nothing");
  const a = await audits("market.price", id);
  assert.equal(a.length, 1);
  assert.deepEqual(a[0]!.before, { priceOverride: null });
  const clear = await call(R.price.POST as Handler, "POST", s, { params: { id }, body: { price: null, reason: REASON } });
  assert.equal(clear.status, 200);
  assert.equal(clear.body.priceOverride, null);
  assert.equal((await getItemRow(id))!.price_override, null);
  for (const bad of [-1, 1.5, "1000", 10_000_001]) {
    assert.equal((await call(R.price.POST as Handler, "POST", s, { params: { id }, body: { price: bad, reason: REASON } })).status, 400, String(bad));
  }
});

test("tool percent: the next price uses it at once; null returns to the global share; tools outside the market are 404", { skip }, async () => {
  const s = await session("admin");
  const id = await mkItem({ status: "active", tool: "essay", params: { pages: 2 } });
  const row = (await getItemRow(id))!;
  const before = await marketPriceForItem(row);
  const r = await call(R.tool.PUT as Handler, "PUT", s, { params: { toolId: "essay" }, body: { percent: 100, reason: REASON } });
  assert.equal(r.status, 200, r.text);
  const now = await marketPriceForItem(row);
  assert.ok(now.price > before.price, `${before.price} → ${now.price}: the 15 s cache was dropped`);
  assert.equal((await getItemRow(id))!.price_version, row.price_version + 1);
  const list = await call(R.tools.GET as Handler, "GET", s);
  const essay = (list.body.items as { toolId: string; percent: number | null; effective: number }[]).find((t) => t.toolId === "essay")!;
  assert.equal(essay.percent, 100);
  assert.equal(essay.effective, 100);
  assert.equal((await audits("market.tool_pricing", "essay")).length, 1);
  const reset = await call(R.tool.PUT as Handler, "PUT", s, { params: { toolId: "essay" }, body: { percent: null, reason: REASON } });
  assert.equal(reset.status, 200, reset.text);
  assert.equal((await marketPriceForItem(row)).price, before.price);
  assert.equal((await call(R.tool.PUT as Handler, "PUT", s, { params: { toolId: "essay" }, body: { percent: 5, reason: REASON } })).status, 400);
  assert.equal((await call(R.tool.PUT as Handler, "PUT", s, { params: { toolId: "resume" }, body: { percent: 50, reason: REASON } })).status, 404);
});

/* ─────────────────────────── bulk ─────────────────────────── */

test("bulk: one audit row per item; a bad render costs only that item; a retry replays the done ones", { skip }, async () => {
  const s = await session("admin");
  const a = await mkItem();
  const b = await mkItem({ doc: {} });
  const key = randomUUID();
  const r = await call(R.bulk.POST as Handler, "POST", s, { body: { ids: [a, b, a], reason: REASON }, key });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.approved, 1);
  const results = r.body.results as { id: string; ok: boolean; code?: string }[];
  assert.equal(results.length, 2, "duplicates collapse");
  assert.equal(results.find((x) => x.id === b)!.code, "render_failed");
  assert.equal(await statusOf(a), "active");
  assert.equal(await statusOf(b), "candidate");
  const retry = await call(R.bulk.POST as Handler, "POST", s, { body: { ids: [a, b], reason: REASON }, key });
  assert.equal(retry.body.approved, 1);
  const audit = await audits("market.approve", a);
  assert.equal(audit.length, 1, "the retry replayed");
  assert.equal(audit[0]!.meta!.bulk, true);
});

test("bulk: a work with PII hits is refused and stays in the queue; over 20 ids is 400", { skip }, async () => {
  const s = await session("admin");
  const flagged = await mkItem({ flags: [{ kind: "phone", path: "sections.0.blocks.0.text" }] });
  const r = await call(R.bulk.POST as Handler, "POST", s, { body: { ids: [flagged], reason: REASON } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.approved, 0);
  assert.equal((r.body.results as { code?: string }[])[0]!.code, "has_flags");
  assert.equal(await statusOf(flagged), "candidate");
  // One by one it passes: the admin has looked at it.
  assert.equal((await call(R.approve.POST as Handler, "POST", s, { params: { id: flagged }, body: { reason: REASON } })).status, 200);
  const many = Array.from({ length: 21 }, () => randomUUID());
  assert.equal((await call(R.bulk.POST as Handler, "POST", s, { body: { ids: many, reason: REASON } })).status, 400);
  assert.equal((await call(R.bulk.POST as Handler, "POST", s, { body: { ids: ["nope"], reason: REASON } })).status, 400);
});

/* ─────────────────────────── reads ─────────────────────────── */

test("list: filters and views; never the document", { skip }, async () => {
  const s = await session("viewer");
  const marker = `Qidiruv ${randomBytes(3).toString("hex")}`;
  const cand = await mkItem({ title: `${marker} navbat` });
  const err = await mkItem({ status: "rejected", doc: {}, rejectReason: "sanitize_error: TypeError", title: `${marker} xato` });
  const plain = await mkItem({ status: "rejected", rejectReason: "quality", title: `${marker} past` });
  const reported = await mkItem({ status: "active", title: `${marker} shikoyat` });
  const u = await mkUser();
  await query(`INSERT INTO market_reports (item_id, user_id, reason) VALUES ($1, $2, 'Xato bor')`, [reported, u.id]);
  const ids = async (qs: string): Promise<string[]> => {
    const r = await call(R.items.GET as Handler, "GET", s, { qs: `?q=${encodeURIComponent(marker)}${qs}` });
    assert.equal(r.status, 200, r.text);
    assert.ok(!r.text.includes("sections"), "no body in a list");
    return (r.body.items as { id: string }[]).map((i) => i.id);
  };
  assert.deepEqual(await ids("&status=candidate"), [cand]);
  assert.deepEqual((await ids("&status=rejected")).sort(), [err, plain].sort());
  assert.deepEqual(await ids("&status=rejected&view=errors"), [err]);
  assert.deepEqual(await ids("&view=reports"), [reported]);
  assert.equal((await ids("")).length, 4);
  assert.equal((await call(R.items.GET as Handler, "GET", s, { qs: "?status=nope" })).status, 400);
  assert.equal((await call(R.items.GET as Handler, "GET", s, { qs: "?tool=resume" })).status, 400);
  const row = (await call(R.items.GET as Handler, "GET", s, { qs: `?q=${encodeURIComponent(marker)}&view=reports` })).body.items as { reports: number; price: number }[];
  assert.equal(row[0]!.reports, 1);
  assert.ok(row[0]!.price > 0);
});

test("list: `%` in the search is literal", { skip }, async () => {
  const s = await session("viewer");
  const r = await call(R.items.GET as Handler, "GET", s, { qs: `?q=${encodeURIComponent("%%%")}` });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items, []);
});

test("detail: flags with excerpts; the author only with users.pii", { skip }, async () => {
  const author = await mkUser();
  const doc = marketWorkDoc("referat", "Mavzu", 902, { words: 90 }) as unknown as { sections: { blocks: { text: string }[] }[] };
  doc.sections[0]!.blocks[0]!.text = `Bu ishni ____ tayyorladi. ${"Davomi ".repeat(30)}`;
  const id = await mkItem({ doc, flags: [{ kind: "name", path: "sections.0.blocks.0.text" }], sourceUser: author.id });
  const pii = await call(R.item.GET as Handler, "GET", await session("support"), { params: { id } });
  assert.equal(pii.status, 200, pii.text);
  assert.deepEqual(pii.body.source, { userId: author.id, generationId: null });
  const flags = pii.body.flagsList as { kind: string; excerpt: string }[];
  assert.equal(flags.length, 1);
  assert.match(flags[0]!.excerpt, /Bu ishni ____ tayyorladi/);
  assert.ok(flags[0]!.excerpt.length < 120, "a window, not the paragraph");
  const noPii = await call(R.item.GET as Handler, "GET", await session("moderator"), { params: { id } });
  assert.equal(noPii.status, 200);
  assert.equal(noPii.body.source, null);
  assert.equal(noPii.body.hasDoc, true);
  assert.ok(!noPii.text.includes(`"${author.id}"`));
  assert.equal((await call(R.item.GET as Handler, "GET", await session("viewer"), { params: { id: randomUUID() } })).status, 404);
  assert.equal((await call(R.item.GET as Handler, "GET", await session("viewer"), { params: { id: "1 OR 1=1" } })).status, 404);
});

test("detail: a row the scan rejected has no document", { skip }, async () => {
  const id = await mkItem({ status: "rejected", doc: {}, rejectReason: "quality" });
  const r = await call(R.item.GET as Handler, "GET", await session("viewer"), { params: { id } });
  assert.equal(r.body.hasDoc, false);
  assert.equal((await call(R.doc.GET as Handler, "GET", await session("moderator"), { params: { id } })).status, 404);
});

test("detail: an author who opted out later is marked", { skip }, async () => {
  const author = await mkUser();
  await query("UPDATE users SET market_opt_out = TRUE WHERE id = $1", [author.id]);
  const id = await mkItem({ status: "active", sourceUser: author.id });
  const r = await call(R.item.GET as Handler, "GET", await session("viewer"), { params: { id } });
  assert.equal(r.body.authorOptOut, true);
});

test("doc: images through the admin route, no placeholder reaches the browser", { skip }, async () => {
  const doc = marketWorkDoc("referat", "Mavzu", 903, { words: 60 }) as unknown as Record<string, unknown>;
  (doc as { slideImage?: string }).slideImage = `${MARKET_ASSET_PREFIX}abc`;
  const id = await mkItem({ doc });
  await query(`INSERT INTO market_assets (item_id, asset_id, mime, size_bytes, bytes) VALUES ($1, 'abc', 'image/png', 1, '\\x89')`, [id]);
  const r = await call(R.doc.GET as Handler, "GET", await session("moderator"), { params: { id } });
  assert.equal(r.status, 200, r.text);
  assert.ok(!r.text.includes(MARKET_ASSET_PREFIX));
  assert.ok(r.text.includes(`/api/admin/market/items/${id}/assets/abc`));
  assert.equal((await call(R.doc.GET as Handler, "GET", await session("viewer"), { params: { id } })).status, 403, "the whole body needs market.manage");
});

test("file: audited read; 404 before approval", { skip }, async () => {
  const s = await session("moderator");
  const id = await mkItem();
  assert.equal((await call(R.file.GET as Handler, "GET", s, { params: { id } })).status, 404);
  assert.equal((await audits("market.file_read", id)).length, 0);
  await call(R.approve.POST as Handler, "POST", s, { params: { id }, body: { reason: REASON } });
  const r = await call(R.file.GET as Handler, "GET", s, { params: { id } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
  assert.match(r.headers.get("Content-Disposition") ?? "", /attachment/);
  assert.equal((await audits("market.file_read", id)).length, 1);
  assert.equal((await call(R.file.GET as Handler, "GET", await session("viewer"), { params: { id } })).status, 403);
});

/* ─────────────────────────── buyers, abuse ─────────────────────────── */

async function mkCopy(buyerId: string, itemId: string, opts: { refund?: number; downloads?: number } = {}): Promise<string> {
  const id = randomUUID();
  await query(`INSERT INTO generations (id, user_id, tool_id, topic, status, market_item_id) VALUES ($1, $2, 'referat', 'Nusxa', 'COMPLETED', $3)`, [id, buyerId, itemId]);
  if (opts.downloads !== undefined) {
    await query(`INSERT INTO generation_files (generation_id, file_name, mime, size_bytes, bytes, downloads) VALUES ($1, 'a.docx', 'x', 1, '\\x00', $2)`, [id, opts.downloads]);
  }
  if (opts.refund) await query(`INSERT INTO transactions (user_id, kind, balance_delta, reference) VALUES ($1, 'refund', $2, $3)`, [buyerId, opts.refund, id]);
  return id;
}

test("buyers: masked names, downloads, refund mark; the flag can be set once and taken off", { skip }, async () => {
  const s = await session("moderator");
  const id = await mkItem({ status: "active" });
  const buyer = await mkUser("Ali Valiyev");
  const gen = await mkCopy(buyer.id, id, { refund: 1000, downloads: 3 });
  const purchase = await queryOne<{ id: string }>(
    `INSERT INTO market_purchases (item_id, buyer_user_id, generation_id, price, original_price, fingerprint) VALUES ($1, $2, $3, 1000, 2000, 'SLX-ABCDE') RETURNING id`,
    [id, buyer.id, gen],
  );
  const r = await call(R.buyers.GET as Handler, "GET", await session("viewer"), { params: { id } });
  assert.equal(r.status, 200, r.text);
  const b = (r.body.items as Record<string, unknown>[])[0]!;
  assert.equal(b.buyer, "A*** V***");
  assert.ok(!r.text.includes("Valiyev"));
  assert.equal(b.downloads, 3);
  assert.equal(b.refunded, true);
  assert.equal(b.fingerprint, "SLX-ABCDE");
  const params = { id: purchase!.id };
  const set = await call(R.abuse.POST as Handler, "POST", s, { params, body: { reason: "Fayl tarqatilgan" } });
  assert.equal(set.status, 200, set.text);
  assert.equal((await queryOne<{ abuse_flag: string }>("SELECT abuse_flag FROM market_purchases WHERE id = $1", [purchase!.id]))!.abuse_flag, "Fayl tarqatilgan");
  assert.equal((await call(R.abuse.POST as Handler, "POST", s, { params, body: { reason: "Yana bir marta" } })).status, 409);
  assert.equal((await call(R.abuse.POST as Handler, "POST", s, { params, body: { reason: "Xato belgilangan", clear: true } })).status, 200);
  assert.equal((await queryOne<{ abuse_flag: string | null }>("SELECT abuse_flag FROM market_purchases WHERE id = $1", [purchase!.id]))!.abuse_flag, null);
  assert.equal((await audits("market.abuse_flag", purchase!.id)).length, 2);
});

/* ─────────────────────────── scan, overview ─────────────────────────── */

test("scan: works while dark, audited, replayed by the key", { skip }, async () => {
  const s = await session("moderator");
  assert.equal((await call(R.overview.GET as Handler, "GET", s)).body.enabled, false);
  const key = randomUUID();
  const r = await call(R.scan.POST as Handler, "POST", s, { body: { reason: REASON }, key });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.locked, false);
  assert.equal(typeof r.body.scanned, "number");
  const again = await call(R.scan.POST as Handler, "POST", s, { body: { reason: REASON }, key });
  assert.equal(again.headers.get("Idempotent-Replayed"), "true");
  const rows = await query("SELECT 1 FROM admin_audit_log WHERE action = 'market.scan' AND admin_id = $1", [s.adminId]);
  assert.equal(rows.length, 1);
  assert.equal((await call(R.scan.POST as Handler, "POST", await session("viewer"), { body: { reason: REASON } })).status, 403);
});

test("overview: counts by status", { skip }, async () => {
  const s = await session("viewer");
  const base = (await call(R.overview.GET as Handler, "GET", s)).body;
  await mkItem();
  await mkItem({ status: "rejected", doc: {}, rejectReason: "sanitize_error" });
  const now = (await call(R.overview.GET as Handler, "GET", s)).body;
  assert.equal(now.candidates, Number(base.candidates) + 1);
  assert.equal(now.errors, Number(base.errors) + 1);
});

/* ─────────────────────────── stats, CSV (run last: they own a fresh window) ─────────────────────────── */

test("stats: hand-computed fixture over Tashkent days", { skip }, async () => {
  await query("DELETE FROM market_purchases");
  await query("DELETE FROM market_views");
  await query("UPDATE generations SET market_item_id = NULL");
  const s = await session("finance");
  const a = await mkItem({ status: "active", title: "Birinchi ish", tool: "referat", subject: "tarix" });
  const b = await mkItem({ status: "active", title: "Ikkinchi ish", tool: "essay", subject: "fizika" });
  const u1 = await mkUser();
  const u2 = await mkUser();
  const u3 = await mkUser();
  const buy = async (item: string, user: string, price: number, at: string, gen?: string) =>
    query(`INSERT INTO market_purchases (item_id, buyer_user_id, generation_id, price, original_price, fingerprint, created_at) VALUES ($1, $2, $3, $4::bigint, $4::bigint * 2, 'SLX-X', $5::timestamptz)`, [item, user, gen ?? null, price, at]);

  // Today in Tashkent, as a date: the fixture sits at 00:30 and 23:00 of yesterday so it is inside every window.
  const today = (await queryOne<{ d: string }>(`SELECT to_char((now() AT TIME ZONE 'Asia/Tashkent')::date, 'YYYY-MM-DD') AS d`))!.d;
  const yesterday = (await queryOne<{ d: string }>(`SELECT to_char((now() AT TIME ZONE 'Asia/Tashkent')::date - 1, 'YYYY-MM-DD') AS d`))!.d;
  const refundedGen = await mkCopy(u1.id, a, { refund: 2000 });
  await buy(a, u1.id, 2000, `${yesterday}T00:30:00+05:00`, refundedGen); // 19:30 UTC of the day before: still yesterday in Tashkent.
  await buy(a, u2.id, 3000, `${yesterday}T23:00:00+05:00`);
  await buy(b, u3.id, 1000, `${yesterday}T12:00:00+05:00`);
  await query(`INSERT INTO market_views (item_id, day, views) VALUES ($1, $2::date, 25), ($3, $2::date, 5)`, [a, yesterday, b]);

  const r = await call(R.stats.GET as Handler, "GET", s, { qs: "?days=7" });
  assert.equal(r.status, 200, r.text);
  const st = r.body as unknown as Record<string, never> & {
    purchases: number;
    gross: number;
    revenue: number;
    avgPrice: number;
    views: number;
    conversion: number;
    refunds: { count: number; amount: number };
    daily: { day: string; purchases: number; revenue: number }[];
    topItems: { label: string; purchases: number; revenue: number }[];
    byTool: { id: string; label: string; purchases: number }[];
    bySubject: { id: string; label: string; revenue: number }[];
  };
  assert.equal(st.purchases, 3);
  assert.equal(st.gross, 6000);
  assert.deepEqual(st.refunds, { count: 1, amount: 2000 });
  assert.equal(st.revenue, 4000, "gross minus the ledger refund");
  assert.equal(st.avgPrice, 2000);
  assert.equal(st.views, 30);
  assert.equal(st.conversion, 10, "3 of 30 views");
  assert.equal(st.daily.length, 7);
  assert.equal(st.daily.at(-1)!.day, today);
  assert.deepEqual(st.daily.at(-1), { day: today, purchases: 0, revenue: 0 });
  assert.deepEqual(st.daily.at(-2), { day: yesterday, purchases: 3, revenue: 6000 });
  assert.deepEqual(st.topItems.map((t) => [t.label, t.purchases, t.revenue]), [["Birinchi ish", 2, 5000], ["Ikkinchi ish", 1, 1000]]);
  assert.deepEqual(st.byTool.map((t) => [t.id, t.purchases]), [["referat", 2], ["essay", 1]]);
  assert.equal(st.byTool[0]!.label, "Referat");
  assert.deepEqual(st.bySubject.map((t) => [t.id, t.label, t.revenue]), [["tarix", "Tarix", 5000], ["fizika", "Fizika", 1000]]);
  assert.equal((await call(R.stats.GET as Handler, "GET", s, { qs: "?days=8" })).status, 400);

  // CSV: same fixture, the same refund, step-up permission, one audit row.
  const csv = await call(R.exportCsv.GET as Handler, "GET", s, { qs: `?from=${yesterday}&to=${today}` });
  assert.equal(csv.status, 200, csv.text);
  const lines = csv.text.trim().split("\r\n");
  assert.equal(lines.length, 4, "header + three purchases");
  assert.ok(lines.some((l) => l.includes(`"Birinchi ish"`) && l.includes(`"2000"`) && l.includes(`"4000"`)));
  const rows = await query("SELECT 1 FROM admin_audit_log WHERE action = 'export.market' AND admin_id = $1", [s.adminId]);
  assert.equal(rows.length, 1);
  assert.equal((await call(R.exportCsv.GET as Handler, "GET", await session("moderator"))).status, 403);
  const stale = await call(R.exportCsv.GET as Handler, "GET", await session("finance", false));
  assert.equal(stale.status, 401);
  assert.equal(stale.body.code, "reauth");
});

test("stats: an empty window has no conversion, not a division by zero", { skip }, async () => {
  await query("DELETE FROM market_purchases");
  await query("DELETE FROM market_views");
  await query("UPDATE generations SET market_item_id = NULL");
  const r = await call(R.stats.GET as Handler, "GET", await session("viewer"), { qs: "?days=30" });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.conversion, null);
  assert.equal(r.body.avgPrice, 0);
  assert.equal((r.body.daily as unknown[]).length, 30);
});

/* ─────────────────────────── pure helpers ─────────────────────────── */

test("settings gate: a disabled tool does not break the table", { skip }, async () => {
  await setSetting("market.tools_disabled", ["essay"]);
  const r = await call(R.tools.GET as Handler, "GET", await session("viewer"));
  assert.equal((r.body.items as { toolId: string; disabled: boolean }[]).find((t) => t.toolId === "essay")!.disabled, true);
  await query("DELETE FROM app_settings WHERE key = 'market.tools_disabled'");
  const { invalidateSettingsCache } = await import("../lib/server/settings.ts");
  invalidateSettingsCache();
});

test("maskBuyerName, textAtPath, flagExcerpt, statusForCap", () => {
  assert.equal(svc.maskBuyerName("Ali Valiyev"), "A*** V***");
  assert.equal(svc.maskBuyerName("  "), "—");
  assert.equal(svc.maskBuyerName(null), "—");
  const doc = { sections: [{ blocks: [{ text: "salom" }] }] };
  assert.equal(svc.textAtPath(doc, "sections.0.blocks.0.text"), "salom");
  assert.equal(svc.textAtPath(doc, "sections.1.blocks.0.text"), null);
  assert.equal(svc.textAtPath(null, "a.b"), null);
  assert.equal(svc.flagExcerpt(null), null);
  assert.equal(svc.flagExcerpt("qisqa"), "qisqa");
  assert.equal(svc.flagExcerpt(`${"a".repeat(100)} ____ ${"b".repeat(100)}`), `…${"a".repeat(47)} ____ ${"b".repeat(47)}…`);
  assert.equal(svc.statusForCap("sold_out", 6, 5), "active");
  assert.equal(svc.statusForCap("sold_out", 5, 5), "sold_out");
  assert.equal(svc.statusForCap("active", 5, 5), "sold_out");
  assert.equal(svc.statusForCap("active", 6, 5), "active");
  assert.equal(svc.statusForCap("retired", 6, 5), "retired");
  assert.equal(svc.statusForCap("candidate", null, 0), "candidate");
});
