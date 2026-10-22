import "./helpers/next-request.mts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomInt } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Public offer (oferta) gate -- owner decision D6 (docs/program-17/PLAN.md item 12). Real Postgres in a
 * throwaway database; the Bot API is stubbed at `fetch`; the PDF is produced by the real LibreOffice.
 *
 * Covered: text module (faithful to the approved draft, no placeholder reaches a reader), settings rules
 * (gate cannot be enabled with empty requisites), gate OFF = no behaviour change, gate ON = 403
 * `offer_required` on generation submit / order / click card / click invoice but NOT on webhooks, reads or
 * the session, accept -> allowed, version bump -> required again, admin exempt, /oferta + /api/oferta/pdf
 * (requisites rendered, cache, 503 fallbacks), the bot /start flow (PDF + button, accept -> welcome,
 * login nonce and referral untouched, file_id cache, web-link fallback).
 *
 * Mutations (each turned a test red, then restored):
 *   M1. `isAccepted` compares `===` instead of `>=` / the version check dropped -> «version bump»;
 *   M2. the `cfg.enabled` early return removed from `offerStatus` -> «gate OFF» tests;
 *   M3. the requisites check removed from `assertOfertaConsistent` -> «gate cannot be enabled with empty requisites»;
 *   M4. `assertOfferAccepted` added to the Click webhook route -> «webhooks, reads and the session are never gated»;
 *   M5. the bot /start offer step removed -> «bot: new user ...»;
 *   M6. `{{IJROCHI}}` replacement removed -> «text: requisites are rendered».
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-oferta-token";
process.env.NEXT_PUBLIC_TELEGRAM_BOT = "slaydx_test_bot";
process.env.WORKER_INLINE = "false";
process.env.CLICK_SERVICE_ID = "777";
process.env.CLICK_MERCHANT_ID = "42";
process.env.CLICK_SECRET_KEY = "click-secret-key";
process.env.CLICK_MERCHANT_USER_ID = "55";
delete process.env.PAYME_MERCHANT_ID;
delete process.env.PAYME_KEY;
delete process.env.PAYME_TEST_KEY;
delete process.env.BOT_PREMIUM_EMOJI;
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("oferta") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "Postgres kerak (DATABASE_URL)" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";
if (!hasDb) process.env.DATABASE_URL = "postgres://unused/unused";

const { query, queryOne, pool, ensureMigrated, transaction } = await import("../lib/server/db.ts");
const settings = await import("../lib/server/settings.ts");
const text = await import("../lib/oferta/text.ts");
if (!skip) await ensureMigrated();

const REQ = "Test MChJ\nSTIR 123456789\nToshkent sh., Test ko'chasi 1\nH/r 20208000900000000001\nTel. +998901234567";
const REQ2 = "Boshqa YaTT\nSTIR 987654321\nSamarqand sh., Sinov ko'chasi 2\nH/r 20208000900000000002\nTel. +998901112233";

/* ── Bot API stub (JSON and multipart) ── */
type Call = { method: string; body: Record<string, unknown>; form?: FormData };
let calls: Call[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
  const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(String(url));
  assert.ok(m, `unexpected URL ${url}`);
  const raw = init?.body;
  if (raw instanceof FormData) {
    const body: Record<string, unknown> = {};
    for (const [k, v] of raw.entries()) body[k] = typeof v === "string" ? v : `[file ${(v as File).name}]`;
    calls.push({ method: m[1]!, body, form: raw });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 3, document: { file_id: "FILEID-1" } } }));
  }
  calls.push({ method: m[1]!, body: raw ? JSON.parse(String(raw)) : {} });
  if (m[1] === "getMe") return new Response(JSON.stringify({ ok: true, result: { id: 123456, username: "slaydx_test_bot" } }));
  return new Response(JSON.stringify({ ok: true, result: m[1] === "sendMessage" || m[1] === "sendDocument" ? { message_id: 1 } : true }));
}) as typeof fetch;
const sent = (method: string) => calls.filter((c) => c.method === method);

after(async () => {
  globalThis.fetch = realFetch;
  if (skip) return;
  await pool().end();
  await iso.drop();
});

/* ── helpers ── */
async function setSetting(key: string, value: unknown): Promise<void> {
  await query(
    "INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, JSON.stringify(value)],
  );
  settings.invalidateSettingsCache();
}
async function gate(on: boolean, requisites = REQ, version = 1): Promise<void> {
  await setSetting("oferta.requisites", requisites);
  await setSetting("oferta.version", version);
  await setSetting("oferta.gate_enabled", on);
}
let userSeq = 0;
async function webUser(balance = 100_000): Promise<string> {
  const r = await queryOne<{ id: string }>(
    "INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Oferta Test', 0, 0, $2) RETURNING id::text AS id",
    [`of-${Date.now()}-${++userSeq}-${randomInt(0, 1e9)}`, balance],
  );
  return r!.id;
}
const offerCols = (uid: string) =>
  queryOne<{ offer_version: number | null; accepted: boolean }>("SELECT offer_version, offer_accepted_at IS NOT NULL AS accepted FROM users WHERE id = $1", [uid]);

const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const cookieOf = async (uid: string) => `${SESSION_COOKIE}=${(await createSession(uid)).token}`;
type Json = Record<string, unknown>;
async function call(route: { GET?: (r: Request) => Promise<Response>; POST?: (r: Request) => Promise<Response> }, method: "GET" | "POST", path: string, uid: string | null, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (uid) headers.cookie = await cookieOf(uid);
  const req = new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await inRequest(req, () => route[method]!(req));
  return { res, status: res.status, json: (await res.clone().json().catch(() => ({}))) as Json };
}

/* ───────────────────────── text module ───────────────────────── */

test("text: faithful to the approved draft; requisites are rendered; no placeholder reaches a reader", () => {
  const view = text.renderOferta(REQ, 1);
  const plain = text.ofertaPlainText(view);
  assert.ok(!text.hasPlaceholder(plain), "no ⟦ ⟧ / {{ }} left");
  assert.match(view.sections[0]!.clauses[0]!.text, /^Ushbu hujjat Test MChJ \(bundan keyin — «Ijrochi»\)/, "1.1 carries the Ijrochi name (first requisites line)");
  const s9 = view.sections.at(-1)!;
  assert.equal(s9.heading, "9. Rekvizitlar");
  assert.deepEqual(s9.clauses.map((c) => c.text), REQ.split("\n"), "section 9 = the requisites lines");
  assert.ok(plain.includes("Tahrir: v1 · 22.10.2026"));

  // Every numbered clause of the draft is present, word for word (placeholders aside).
  const md = readFileSync(new URL("../docs/program-17/oferta-draft.uz.md", import.meta.url), "utf8").split("\n");
  const clauses: string[] = [];
  for (const ln of md) {
    if (/^\d+\.\d+\./.test(ln)) clauses.push(ln.trim());
    else if (clauses.length && ln.trim() && !ln.startsWith("#") && !ln.startsWith(">") && !ln.startsWith("Tahrir") && !ln.startsWith("⟦")) clauses[clauses.length - 1] += " " + ln.trim();
  }
  assert.equal(clauses.length, 25, "the draft has 25 numbered clauses");
  const rendered = view.sections.flatMap((s) => s.clauses).filter((c) => c.no).map((c) => `${c.no} ${c.text}`);
  assert.deepEqual(rendered, clauses.map((c) => c.replace("⟦Ijrochi: YaTT/MChJ nomi, STIR⟧", "Test MChJ")));
  assert.deepEqual(view.sections.map((s) => s.heading), md.filter((l) => l.startsWith("## ")).map((l) => l.slice(3)));
});

test("text: empty requisites still leave no placeholder (neutral fallback)", () => {
  const plain = text.ofertaPlainText(text.renderOferta("", 1));
  assert.ok(!text.hasPlaceholder(plain));
  assert.ok(plain.includes(text.OFERTA_NO_NAME) && plain.includes(text.OFERTA_NO_REQUISITES));
  assert.ok(!text.hasPlaceholder(text.ofertaPlainText(text.renderOferta("  \n \r\n", 1))));
});

/* ───────────────────────── settings ───────────────────────── */

test("settings: oferta keys, defaults, validators", () => {
  assert.equal(settings.settingDef("oferta.gate_enabled").envDefault(), false, "OFF on deploy");
  assert.equal(settings.settingDef("oferta.version").envDefault(), 1);
  assert.equal(settings.settingDef("oferta.requisites").envDefault(), "");
  for (const bad of [0, -1, 1.5, "1", null, 1001]) assert.equal(settings.validateSetting("oferta.version", bad).ok, false, String(bad));
  assert.equal(settings.validateSetting("oferta.version", 2).ok, true);
  for (const bad of [1, "true", null]) assert.equal(settings.validateSetting("oferta.gate_enabled", bad).ok, false, String(bad));
  const r = settings.validateSetting("oferta.requisites", "  Nom  \r\n\r\n\r\n\r\n STIR 1 \n");
  assert.deepEqual(r, { ok: true, value: "Nom\n\nSTIR 1" });
  assert.equal(settings.validateSetting("oferta.requisites", 5).ok, false);
  assert.equal(settings.validateSetting("oferta.requisites", "x".repeat(2001)).ok, false);
  assert.equal(settings.validateSetting("oferta.requisites", "⟦Ijrochi⟧").ok, false, "a leftover placeholder is refused");
  assert.equal(settings.validateSetting("oferta.requisites", "").ok, true, "empty is a valid VALUE (it only blocks enabling the gate)");
});

test("settings: the gate cannot be enabled with empty requisites; requisites cannot be emptied while it is on", { skip }, async () => {
  await query("DELETE FROM app_settings WHERE key LIKE 'oferta.%'");
  settings.invalidateSettingsCache();
  const put = (key: string, value: unknown) => transaction((c) => settings.setSettingInTx(c, key, value, null));
  await assert.rejects(put("oferta.gate_enabled", true), (e: { status: number; message: string }) => e.status === 400 && /rekvizit/i.test(e.message));
  await put("oferta.gate_enabled", false); // switching OFF is always fine
  await put("oferta.requisites", "   "); // empty while the gate is off is fine
  await put("oferta.requisites", REQ);
  await put("oferta.gate_enabled", true);
  await assert.rejects(put("oferta.requisites", ""), (e: { status: number }) => e.status === 400, "emptied while on");
  await assert.rejects(transaction((c) => settings.resetSettingInTx(c, "oferta.requisites")), (e: { status: number }) => e.status === 400, "reset while on");
  await put("oferta.requisites", REQ2); // changing is fine
  await put("oferta.gate_enabled", false);
  await transaction((c) => settings.resetSettingInTx(c, "oferta.requisites")); // reset while off is fine
  settings.invalidateSettingsCache();
});

/* ───────────────────────── gate ───────────────────────── */

const genRoute = await import("../app/api/generations/route.ts");
const ordersRoute = await import("../app/api/payments/orders/route.ts");
const cardRoute = await import("../app/api/payments/click/card/route.ts");
const invoiceRoute = await import("../app/api/payments/click/invoice/route.ts");
const shopRoute = await import("../app/api/payments/click/route.ts");
const acceptRoute = await import("../app/api/oferta/accept/route.ts");
const sessionRoute = await import("../app/api/auth/session/route.ts");
const channelsRoute = await import("../app/api/channels/required/route.ts");
const { env } = await import("../lib/server/env.ts");
Object.assign(env.worker, { inline: false });
Object.assign(env.queue, { userMaxInflight: 50, totalSlots: 8, meanServiceSec: 200, maxWaitSec: 100_000 });

const ESSAY = { slug: "essay", values: { topic: "Suv aylanishi", essayContext: "academic", essayKind: "argumentative" } };
const postGen = (uid: string) => call(genRoute, "POST", "/api/generations", uid, ESSAY);
const postOrder = (uid: string) => call(ordersRoute, "POST", "/api/payments/orders", uid, { provider: "click", amount: 25_000 });
const state = async (uid: string) =>
  (await queryOne<{ balance: number; jobs: number; orders: number }>(
    `SELECT u.balance::int AS balance,
            (SELECT count(*)::int FROM generations g WHERE g.user_id = u.id) AS jobs,
            (SELECT count(*)::int FROM payment_orders o WHERE o.user_id = u.id) AS orders
       FROM users u WHERE u.id = $1`,
    [uid],
  ))!;

test("gate OFF: generation, orders, card and invoice behave exactly as before (nothing reads the columns)", { skip }, async () => {
  await gate(false);
  const u = await webUser();
  const g = await postGen(u);
  assert.equal(g.status, 202, JSON.stringify(g.json));
  const o = await postOrder(u);
  assert.equal(o.status, 201, JSON.stringify(o.json));
  const orderId = String((o.json.order as Json).id);
  const card = await call(cardRoute, "POST", "/api/payments/click/card", u, { orderId, cardNumber: "8600123412341234", expireDate: "12/99" });
  assert.notEqual(card.json.code, "offer_required");
  const inv = await call(invoiceRoute, "POST", "/api/payments/click/invoice", u, { orderId, phone: "+998901234567" });
  assert.notEqual(inv.json.code, "offer_required");
  assert.deepEqual(await offerCols(u), { offer_version: null, accepted: false }, "the gate off never writes the columns");
  // Even with requisites empty and the flag forced on in the DB (validator bypassed), the gate stays off.
  await setSetting("oferta.requisites", "");
  await setSetting("oferta.gate_enabled", true);
  assert.equal((await postGen(u)).status, 202, "flag on + empty requisites = effectively off");
  assert.equal((await settings_status(u)).required, false);
});
async function settings_status(uid: string) {
  const { offerStatus } = await import("../lib/server/oferta.ts");
  return offerStatus(uid);
}

test("gate ON: 403 offer_required on generation / order / card / invoice, nothing charged or created; accept -> allowed; version bump -> required again", { skip }, async () => {
  await gate(false);
  const u = await webUser();
  const pre = await postOrder(u); // an order that exists before the gate is on
  assert.equal(pre.status, 201);
  const preId = String((pre.json.order as Json).id);
  const before = await state(u);

  await gate(true, REQ, 1);
  const g = await postGen(u);
  assert.equal(g.status, 403, JSON.stringify(g.json));
  assert.equal(g.json.code, "offer_required");
  assert.equal(g.json.version, 1);
  assert.match(String(g.json.error), /oferta/i);
  const o = await postOrder(u);
  assert.equal(o.status, 403);
  assert.equal(o.json.code, "offer_required");
  const card = await call(cardRoute, "POST", "/api/payments/click/card", u, { orderId: preId, cardNumber: "8600123412341234", expireDate: "12/99" });
  assert.equal(card.status, 403);
  assert.equal(card.json.code, "offer_required");
  const inv = await call(invoiceRoute, "POST", "/api/payments/click/invoice", u, { orderId: preId, phone: "+998901234567" });
  assert.equal(inv.status, 403);
  assert.equal(inv.json.code, "offer_required");
  assert.deepEqual(await state(u), before, "no job, no charge, no new order");
  assert.deepEqual(await offerCols(u), { offer_version: null, accepted: false });

  // accept -> allowed
  const acc = await call(acceptRoute, "POST", "/api/oferta/accept", u);
  assert.equal(acc.status, 200);
  assert.deepEqual(acc.json, { ok: true, version: 1 });
  const first = await queryOne<{ at: Date }>("SELECT offer_accepted_at AS at FROM users WHERE id = $1", [u]);
  assert.deepEqual(await offerCols(u), { offer_version: 1, accepted: true });
  assert.equal((await postGen(u)).status, 202);
  assert.equal((await postOrder(u)).status, 201);
  // idempotent: a second accept keeps the original timestamp
  await call(acceptRoute, "POST", "/api/oferta/accept", u);
  assert.equal((await queryOne<{ at: Date }>("SELECT offer_accepted_at AS at FROM users WHERE id = $1", [u]))!.at.getTime(), first!.at.getTime());

  // version bump -> required again, until accepted again
  await setSetting("oferta.version", 2);
  const again = await postGen(u);
  assert.equal(again.status, 403);
  assert.equal(again.json.code, "offer_required");
  assert.equal(again.json.version, 2);
  assert.equal((await postOrder(u)).status, 403);
  await call(acceptRoute, "POST", "/api/oferta/accept", u);
  assert.deepEqual(await offerCols(u), { offer_version: 2, accepted: true });
  assert.equal((await postGen(u)).status, 202);
  // accepting is anonymous-proof
  assert.equal((await call(acceptRoute, "POST", "/api/oferta/accept", null)).status, 401);
});

test("gate ON: webhooks, reads and the session are never gated; admin accounts are exempt", { skip }, async () => {
  await gate(true, REQ, 1);
  const u = await webUser();
  const { createOrder } = await import("../lib/server/payments.ts");
  const order = await createOrder({ userId: u, provider: "click", purpose: "topup", amountSoum: 25_000 });

  // Click Shop API Prepare (the provider's webhook) for a user who has NOT accepted.
  const md5 = (s: string) => createHash("md5").update(s).digest("hex");
  const full: Record<string, string> = { service_id: "777", sign_time: "2026-10-09 10:00:00", error: "0", click_trans_id: String(990_000 + randomInt(0, 9999)), merchant_trans_id: order.id, amount: `${order.amountSoum}.00`, action: "0" };
  const sign_string = md5(full.click_trans_id! + full.service_id + "click-secret-key" + full.merchant_trans_id + full.amount + full.action + full.sign_time);
  const hook = await shopRoute.POST(new Request("http://x/api/payments/click", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...full, sign_string }).toString() }));
  const hookBody = (await hook.json()) as { error: number; error_note: string };
  assert.equal(hookBody.error, 0, `webhook must not be gated: ${JSON.stringify(hookBody)}`);

  // Reads and the session.
  const list = await call(ordersRoute, "GET", "/api/payments/orders", u);
  assert.equal(list.status, 200);
  const sess = await call(sessionRoute, "GET", "/api/auth/session", u);
  assert.equal(sess.status, 200);
  assert.equal((sess.json.user as Json).id, u);
  assert.equal((await call(channelsRoute, "GET", "/api/channels/required", u)).status, 200);

  // Admin accounts (active, pending) are exempt; a disabled admin is an ordinary user.
  const a = await webUser();
  const acc = await queryOne<{ id: string }>("INSERT INTO admin_accounts (user_id, role, status) VALUES ($1, 'viewer', 'active') RETURNING id::text AS id", [a]);
  assert.equal((await postGen(a)).status, 202);
  assert.equal((await postOrder(a)).status, 201);
  await query("UPDATE admin_accounts SET status = 'pending' WHERE id = $1", [acc!.id]);
  assert.equal((await postGen(a)).status, 202);
  await query("UPDATE admin_accounts SET status = 'disabled' WHERE id = $1", [acc!.id]);
  assert.equal((await postGen(a)).status, 403);
});

/* ───────────────────────── page + PDF ───────────────────────── */

test("page: /oferta renders the module with the requisites; PDF: real conversion carries the requisites, cached, 503 fallbacks", { skip }, async () => {
  await gate(true, REQ, 1);
  // tsx compiles JSX to the classic runtime here (Next uses the automatic one).
  (globalThis as { React?: unknown }).React = await import("react");
  const page = (await import("../app/oferta/page.tsx")).default;
  // The page is a server component returning a plain element tree: collect its text without a renderer.
  const flat = (n: unknown): string => {
    if (n === null || n === undefined || typeof n === "boolean") return "";
    if (typeof n === "string" || typeof n === "number") return String(n);
    if (Array.isArray(n)) return n.map(flat).join("");
    const props = (n as { props?: { children?: unknown } }).props;
    return flat(props?.children) + " ";
  };
  const html = flat(await page());
  assert.ok(html.includes("Test MChJ") && html.includes("STIR 123456789") && html.includes("20208000900000000001"));
  assert.ok(html.includes("OMMAVIY OFERTA") && html.includes("naqd pulga almashtirilmaydi"));
  assert.ok(!/[⟦⟧]|\{\{/.test(html), "no placeholder in the page");
  const tree = JSON.stringify(await page(), (_k, v) => (typeof v === "symbol" ? String(v) : v));
  assert.ok(tree.includes('"href":"/api/oferta/pdf"'));

  const pdfRoute = await import("../app/api/oferta/pdf/route.ts");
  const get = async () => {
    const req = new Request("http://localhost/api/oferta/pdf");
    return inRequest(req, () => pdfRoute.GET(req));
  };
  const res = await get();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  const dir = mkdtempSync(join(tmpdir(), "oferta-test-"));
  const file = join(dir, "o.pdf");
  writeFileSync(file, bytes);
  const txt = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" }).replace(/\s+/g, " ");
  for (const needle of ["OMMAVIY OFERTA", "Test MChJ", "STIR 123456789", "20208000900000000001", "Rekvizitlar", "naqd pulga almashtirilmaydi"]) {
    assert.ok(txt.includes(needle), `PDF text has «${needle}»`);
  }
  assert.ok(!/[⟦⟧]|\{\{/.test(txt), "no placeholder in the PDF");

  // Cached: the same bytes come back with LibreOffice unavailable.
  const prevBin = process.env.SOFFICE_BIN;
  process.env.SOFFICE_BIN = "/nonexistent/soffice";
  try {
    const cached = await get();
    assert.equal(cached.status, 200, "served from the derived cache");
    assert.ok(Buffer.from(await cached.arrayBuffer()).equals(bytes));
    // Other requisites -> another cache key -> converter needed -> unavailable -> 503 pdf_unavailable.
    await gate(true, REQ2, 1);
    const none = await get();
    assert.equal(none.status, 503);
    assert.equal(((await none.json()) as Json).code, "pdf_unavailable");
  } finally {
    if (prevBin === undefined) delete process.env.SOFFICE_BIN;
    else process.env.SOFFICE_BIN = prevBin;
  }

  // Gate busy -> 503 + Retry-After (a different key again: a version bump changes the text).
  const { Gate } = await import("../lib/server/soffice-gate.ts");
  const g = globalThis as typeof globalThis & { __slaydxSofficeGate?: unknown };
  const realGate = g.__slaydxSofficeGate;
  g.__slaydxSofficeGate = new Gate({ max: 0, waitMs: 5, maxWaiters: 0, retryAfterSec: 7 });
  try {
    await gate(true, REQ2, 5);
    const busy = await get();
    assert.equal(busy.status, 503);
    assert.equal(busy.headers.get("retry-after"), "7");
  } finally {
    g.__slaydxSofficeGate = realGate;
  }
});

/* ───────────────────────── bot ───────────────────────── */

let updSeq = 960_000_000 + randomInt(0, 9_000_000);
const upd = (from: number, body: string) => ({
  update_id: ++updSeq,
  message: { message_id: 5, from: { id: from, first_name: "Ali" }, chat: { id: from, type: "private" as const }, date: Math.floor(Date.now() / 1000), text: body },
});
const newTg = () => 7_900_000_000 + randomInt(0, 99_999_999);
const userByTg = (tg: number) => queryOne<{ id: string; offer_version: number | null }>("SELECT id::text AS id, offer_version FROM users WHERE telegram_id = $1", [String(tg)]);
const buttonsOf = (body: Record<string, unknown>) => {
  const mk = typeof body.reply_markup === "string" ? JSON.parse(body.reply_markup) : body.reply_markup;
  return ((mk as { inline_keyboard?: { text: string; url?: string; callback_data?: string; web_app?: unknown }[][] } | undefined)?.inline_keyboard ?? []).flat();
};
const welcomeSent = () => sent("sendMessage").some((c) => /Kirish|taklif|SlaydX/i.test(String(c.body.text)) && buttonsOf(c.body).some((b) => b.web_app || b.url));

test("bot: new user at /start gets the PDF + «Qabul qilaman»; the button accepts, then the normal welcome follows; accepted users get the welcome at once", { skip }, async () => {
  await gate(true, REQ, 1);
  const tgm = await import("../lib/server/telegram.ts");
  const router = await import("../lib/server/bot/router.ts");
  const tg = newTg();
  calls = [];
  await tgm.handleUpdate(upd(tg, "/start") as never);
  const docs = sent("sendDocument");
  assert.equal(docs.length, 1, `one offer document: ${calls.map((c) => c.method).join(",")}`);
  assert.match(String(docs[0]!.body.document), /^\[file SlaydX-oferta-v1\.pdf\]$/);
  assert.match(String(docs[0]!.body.caption), /Ommaviy oferta/);
  const btns = buttonsOf(docs[0]!.body);
  assert.deepEqual(btns.map((b) => b.callback_data ?? b.url), ["https://slaydx.test/oferta", "o:a"]);
  assert.match(btns[1]!.text, /Qabul qilaman$/);
  assert.equal(sent("sendMessage").length, 0, "no welcome before the acceptance");
  const me = await userByTg(tg);
  assert.ok(me, "the account exists (created at /start)");
  assert.equal(me.offer_version, null);

  // The button.
  calls = [];
  await router.handleCallback({ id: "q1", from: { id: tg }, message: { message_id: 3, chat: { id: tg, type: "private" } }, data: "o:a" }, ++updSeq);
  assert.equal((await userByTg(tg))!.offer_version, 1);
  assert.equal(sent("editMessageReplyMarkup").length, 1, "the button is removed");
  assert.match(String(sent("answerCallbackQuery")[0]!.body.text), /Oferta qabul qilindi/);
  assert.ok(welcomeSent(), `the welcome follows: ${JSON.stringify(sent("sendMessage").map((c) => String(c.body.text).slice(0, 30)))}`);
  assert.ok(sent("sendMessage").length >= 2, "welcome card + main keyboard");

  // Accepted: the next /start is the plain welcome (no document).
  calls = [];
  await tgm.handleUpdate(upd(tg, "/start") as never);
  assert.equal(sent("sendDocument").length, 0);
  assert.ok(welcomeSent());

  // A second new user: the Telegram file_id is reused (JSON resend, no upload).
  const tg2 = newTg();
  calls = [];
  await tgm.handleUpdate(upd(tg2, "/start") as never);
  assert.equal(sent("sendDocument").length, 1);
  assert.equal(sent("sendDocument")[0]!.body.document, "FILEID-1");
  assert.equal(sent("sendDocument")[0]!.form, undefined, "no multipart the second time");
});

test("bot: gate OFF -> /start is the unchanged welcome (no offer, no document)", { skip }, async () => {
  await gate(false);
  const tgm = await import("../lib/server/telegram.ts");
  const tg = newTg();
  calls = [];
  await tgm.handleUpdate(upd(tg, "/start") as never);
  assert.equal(sent("sendDocument").length, 0);
  assert.ok(welcomeSent());
  assert.equal(calls.filter((c) => c.method === "sendMessage").length, 2, "welcome card + main keyboard, as before");
});

test("bot: login-nonce /start and referral attribution are untouched by the offer", { skip }, async () => {
  await gate(true, REQ, 1);
  const tgm = await import("../lib/server/telegram.ts");
  const { upsertTelegramUser, SIGNUP_BONUS_POINTS } = await import("../lib/server/auth.ts");
  const { ensureRefCode } = await import("../lib/server/referrals.ts");
  const inviterTg = newTg();
  const inv = await upsertTelegramUser({ telegramId: String(inviterTg), username: null, name: "Taklifchi", photoUrl: null });
  const code = await ensureRefCode(inv.id);

  // Referral: attributed on account creation even though the offer is not accepted yet; the offer comes first.
  const ref = newTg();
  calls = [];
  await tgm.handleUpdate(upd(ref, `/start ref_${code}`) as never);
  const me = await userByTg(ref);
  assert.ok(me);
  const row = await queryOne<{ referrer_user_id: string; reward_points: number }>("SELECT referrer_user_id::text AS referrer_user_id, reward_points FROM referrals WHERE referee_user_id = $1", [me.id]);
  assert.deepEqual(row, { referrer_user_id: inv.id, reward_points: 1000 });
  assert.equal(sent("sendDocument").length, 1, "the offer is shown first");
  assert.equal(me.offer_version, null);
  assert.ok(SIGNUP_BONUS_POINTS >= 0);

  // Login nonce: the one-time site link, exactly as before -- no offer document.
  const ticket = await tgm.createTicket("slaydx_test_bot", null);
  const nonceUser = newTg();
  calls = [];
  await tgm.handleUpdate(upd(nonceUser, `/start ${ticket.nonce}`) as never);
  assert.equal(sent("sendDocument").length, 0, "login flow is never interrupted by the offer");
  assert.equal(calls.length, 1);
  assert.match(String(calls[0]!.body.text), /Kirish uchun quyidagi tugmani bosing/);
});

test("bot: PDF unavailable -> a text message with the web link and the accept button", { skip }, async () => {
  const prevBin = process.env.SOFFICE_BIN;
  process.env.SOFFICE_BIN = "/nonexistent/soffice";
  try {
    await gate(true, "Zaxira MChJ\nSTIR 555", 7);
    const tgm = await import("../lib/server/telegram.ts");
    const tg = newTg();
    calls = [];
    await tgm.handleUpdate(upd(tg, "/start") as never);
    assert.equal(sent("sendDocument").length, 0);
    const msgs = sent("sendMessage");
    assert.equal(msgs.length, 1);
    assert.match(String(msgs[0]!.body.text), /PDF hozir tayyor emas/);
    assert.deepEqual(buttonsOf(msgs[0]!.body).map((b) => b.callback_data ?? b.url), ["https://slaydx.test/oferta", "o:a"]);
    // The accept button works the same.
    const router = await import("../lib/server/bot/router.ts");
    await router.handleCallback({ id: "q2", from: { id: tg }, message: { message_id: 4, chat: { id: tg, type: "private" } }, data: "o:a" }, ++updSeq);
    assert.equal((await userByTg(tg))!.offer_version, 7);
  } finally {
    if (prevBin === undefined) delete process.env.SOFFICE_BIN;
    else process.env.SOFFICE_BIN = prevBin;
  }
});

test("bot i18n: oferta.* keys exist in uz / ru / en and only with that prefix", async () => {
  const i18n = await import("../lib/server/bot/i18n.ts");
  const keys = i18n.TEXT_KEYS.filter((k) => k.startsWith("oferta."));
  assert.deepEqual([...keys].sort(), ["oferta.accept", "oferta.accepted", "oferta.caption", "oferta.captionLink", "oferta.read"]);
  for (const k of keys) {
    const e = i18n.rawEntry(k);
    for (const l of ["uz", "ru", "en"] as const) assert.ok(String(e[l]).trim().length > 3, `${k}.${l}`);
  }
});
