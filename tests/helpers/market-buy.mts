/* eslint-disable @typescript-eslint/no-explicit-any -- SQL rows and JSON answers are read untyped here */
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./isolated-db.mts";
import { marketWorkDoc } from "./market-fixtures.mts";
import { inRequest } from "./next-request.mts";

/**
 * Harness of the buying tests (`tests/market-{purchase,clone,restore,ratings,routes-guard}.test.mts`): an isolated
 * database, synthetic users with a real session cookie, listings inserted directly (supply is WP-A's and has its own
 * tests) and the REAL route handlers behind a real `Request`.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.WORKER_INLINE = "false";

export const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("marketbuy") : { isolated: false, drop: async () => {} };
export const skip = hasDb && iso.isolated ? false : "isolated Postgres database is not available";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

let ready: Promise<void> | null = null;
export async function db() {
  const mod = await import("../../lib/server/db.ts");
  ready ??= mod.migrate();
  await ready;
  return mod;
}

export async function closeDb(): Promise<void> {
  if (!ready) return;
  const { pool } = await import("../../lib/server/db.ts");
  await pool().end();
  await iso.drop();
}

let seq = 0;

export type TestUser = { id: string; cookie: string };

export async function mkUser(o: { balance?: number; points?: number; blocked?: boolean; admin?: boolean } = {}): Promise<TestUser> {
  const { query } = await db();
  const { createSession, SESSION_COOKIE } = await import("../../lib/server/session.ts");
  const [row] = await query<{ id: string }>("INSERT INTO users (username, name, balance, points) VALUES ($1, 'Sintetik Xaridor', $2, $3) RETURNING id", [
    `mb-${process.pid}-${seq++}`,
    o.balance ?? 100_000,
    o.points ?? 0,
  ]);
  const id = String(row!.id);
  const cookie = `${SESSION_COOKIE}=${(await createSession(id)).token}`;
  if (o.admin) await query("INSERT INTO admin_accounts (user_id, role, status) VALUES ($1, 'owner', 'active')", [id]);
  if (o.blocked) await query("UPDATE users SET is_blocked = TRUE WHERE id = $1", [id]);
  return { id, cookie };
}

export type ItemOpts = {
  tool?: string;
  status?: string;
  maxCopies?: number | null;
  doc?: unknown;
  params?: Record<string, unknown>;
  title?: string;
  source?: string | null;
  override?: number | null;
  hidden?: boolean;
};

export async function mkItem(o: ItemOpts = {}): Promise<string> {
  const { query } = await db();
  const tool = o.tool ?? "referat";
  const title = o.title ?? `Quyosh energiyasi ${seq++}`;
  const doc = o.doc ?? neutralWork(tool, title);
  const [row] = await query<{ id: string }>(
    `INSERT INTO market_items (tool_id, title, summary, doc_json, params_json, topic_norm, status, max_copies, source_user_id, price_override, quality_json, outline_json, original_price, approved_at, pages, search_text)
     VALUES ($1, $2, 'Namuna tavsifi', $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9, $10::jsonb, '["Kirish","Xulosa"]'::jsonb, 6000, now(), 18, lower($2)) RETURNING id`,
    [
      tool,
      title,
      JSON.stringify(doc),
      JSON.stringify(o.params ?? { pages: "15-20" }),
      `t${seq++}`,
      o.status ?? "active",
      o.maxCopies === undefined ? null : o.maxCopies,
      o.source ?? null,
      o.override ?? null,
      JSON.stringify(o.hidden ? { hidden_until_review: true } : {}),
    ],
  );
  return row!.id;
}

/** A sanitised-looking work document: title-page fields empty, as the sanitiser leaves them. */
export function neutralWork(tool: string, title: string, seed = 7) {
  const doc = marketWorkDoc(tool, title, seed, { words: 300 }) as unknown as { meta: Record<string, unknown>; work: Record<string, unknown>; sections: unknown[] };
  for (const k of ["author", "university", "faculty", "department", "teacher", "city", "group", "course"]) {
    doc.meta[k] = "";
    doc.work[k] = "";
  }
  delete doc.work.review;
  return doc;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const { query } = await db();
  await query("INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, JSON.stringify(value)]);
  (await import("../../lib/server/settings.ts")).invalidateSettingsCache();
}

export async function resetSettings(over: Record<string, unknown> = { "market.enabled": true }): Promise<void> {
  const { query } = await db();
  await query("DELETE FROM app_settings");
  await query("DELETE FROM rate_limits");
  (await import("../../lib/server/settings.ts")).invalidateSettingsCache();
  (await import("../../lib/server/market/search.ts")).invalidateMarketCatalogCache();
  for (const [k, v] of Object.entries(over)) await setSetting(k, v);
}

export type Answer = { status: number; body: Record<string, any>; headers: Headers; text: string };

const URL_BASE = "http://localhost:3000";

export function marketRequest(path: string, o: { method?: string; cookie?: string; body?: unknown; key?: string; origin?: string } = {}): Request {
  const headers: Record<string, string> = { host: "localhost:3000" };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.key) headers["idempotency-key"] = o.key;
  if (o.origin) headers.origin = o.origin;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${URL_BASE}${path}`, { method: o.method ?? "GET", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
}

export async function call<C>(handler: (req: Request, ctx: C) => Promise<Response>, req: Request, ctx?: C): Promise<Answer> {
  const res = await inRequest(req, () => handler(req, ctx as C));
  const text = await res.clone().text();
  let body: Record<string, any> = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* a binary answer */
  }
  return { status: res.status, body, headers: res.headers, text };
}

const paramsOf = <T,>(p: T) => ({ params: Promise.resolve(p) });

export async function buy(user: TestUser, itemId: string, o: { expectedPrice?: number; fields?: Record<string, unknown>; key?: string } = {}): Promise<Answer> {
  const route = await import("../../app/api/market/items/[id]/purchase/route.ts");
  const price = o.expectedPrice ?? (await priceOf(itemId));
  const fields = o.fields ?? { author: "Sintetik Xaridor", university: `Sintetik Universitet ${seq++}` };
  const req = marketRequest(`/api/market/items/${itemId}/purchase`, { method: "POST", cookie: user.cookie, key: o.key ?? randomUUID(), body: { expectedPrice: price, fields } });
  return call(route.POST, req, paramsOf({ id: itemId }));
}

export async function restore(user: TestUser, purchaseId: string, fields?: Record<string, unknown>): Promise<Answer> {
  const route = await import("../../app/api/market/purchases/[id]/restore/route.ts");
  const req = marketRequest(`/api/market/purchases/${purchaseId}/restore`, { method: "POST", cookie: user.cookie, body: fields ? { fields } : {} });
  return call(route.POST, req, paramsOf({ id: purchaseId }));
}

export const ctxOf = paramsOf;

export async function priceOf(itemId: string): Promise<number> {
  const { getItemRow } = await import("../../lib/server/market/store.ts");
  const { marketPriceInTx } = await import("../../lib/server/market/pricing.ts");
  const { transaction } = await db();
  const row = await getItemRow(itemId);
  return (await transaction((c) => marketPriceInTx(c, row!))).price;
}

export async function wallet(userId: string): Promise<{ balance: number; points: number }> {
  const { query } = await db();
  const [r] = await query<{ balance: string; points: string }>("SELECT balance, points FROM users WHERE id = $1", [userId]);
  return { balance: Number(r!.balance), points: Number(r!.points) };
}

export async function ledger(userId: string): Promise<{ kind: string; reference: string; balance_delta: string; points_delta: string }[]> {
  const { query } = await db();
  return query("SELECT kind, reference, balance_delta, points_delta FROM transactions WHERE user_id = $1 ORDER BY id", [userId]);
}

/** Runs the queue dry through the REAL worker path, the real `buildArtifact` included. */
export async function drainJobs(): Promise<void> {
  const jobs = await import("../../lib/server/jobs.ts");
  const { runJob } = await import("../../lib/server/worker.ts");
  for (;;) {
    const job = await jobs.claimJob(jobs.newLease(`mb${seq++}`), { userMaxRunning: 1000 });
    if (!job) return;
    await runJob(job);
  }
}

export async function jobOf(id: string): Promise<{ status: string; doc_json: any; values_json: any; cost_json: unknown; price: string; market_item_id: string | null; error: string | null } | null> {
  const { queryOne } = await db();
  return queryOne("SELECT status, doc_json, values_json, cost_json, price, market_item_id, error FROM generations WHERE id = $1", [id]);
}

export async function fileOf(id: string): Promise<Buffer | null> {
  const { queryOne } = await db();
  return (await queryOne<{ bytes: Buffer }>("SELECT bytes FROM generation_files WHERE generation_id = $1", [id]))?.bytes ?? null;
}
