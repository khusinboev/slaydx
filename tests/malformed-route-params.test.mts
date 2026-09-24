import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { inRequest } from "./helpers/next-request.mts";

/**
 * BEA-13 reproduksiyalari route darajasida — 500 emas, 4xx.
 *
 *   • `POST /api/auth/telegram {"widget":{"hash":1}}` — `safeEqual` ga son
 *     tushib `Buffer.from(1)` TypeError → 500 edi. Endi widget shakli
 *     (obyekt, `hash` — 64 belgili hex) imzodan OLDIN tekshiriladi → 400,
 *     buzuq urinish IP chelagiga sanaladi.
 *   • `/api/admin/users/{id}` — raqam bo'lmagan yoki `bigint` dan tashqari
 *     `id` Postgres cast xatosi (22P02/22003) bilan 500 berardi. Endi 404
 *     (admin route'lari «yo'q» ni 404 bilan aytadi).
 *
 * HAQIQIY route funksiyalari, throwaway Postgres.
 */

const ADMIN_PHONE = `+99890${String(randomInt(1_000_000, 9_999_999))}`;
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.TRUST_PROXY = "true";
process.env.TELEGRAM_BOT_TOKEN = "123:test-token-never-called";
process.env.APP_URL = "http://localhost:3000";
process.env.ADMIN_PHONES = ADMIN_PHONE;
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const users: string[] = [];
after(async () => {
  if (!hasDb) return;
  const { query, pool } = await import("../lib/server/db.ts");
  for (const id of users) await query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
  await pool().end();
});

function tgReq(body: unknown): Request {
  const ip = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`;
  return new Request("http://localhost:3000/api/auth/telegram", {
    method: "POST",
    headers: { "x-forwarded-for": ip, origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("telegram: widget.hash son/yaroqsiz shakl — 400 (500 emas); to'g'ri shakl, noto'g'ri imzo — 401", { skip }, async () => {
  const { POST } = await import("../app/api/auth/telegram/route.ts");
  const now = Math.floor(Date.now() / 1000);
  for (const widget of [
    { id: 1, auth_date: now, hash: 1 },
    { id: 1, auth_date: now, hash: { a: 1 } },
    { id: 1, auth_date: now, hash: "zz" },
    { id: 1, auth_date: now, hash: "g".repeat(64) },
    [1, 2],
    "matn",
  ]) {
    const res = await POST(tgReq({ widget }));
    assert.equal(res.status, 400, `MUTATSIYA: widget ${JSON.stringify(widget)} → ${res.status}`);
  }
  const res = await POST(tgReq({ initData: 5 }));
  assert.equal(res.status, 400, "initData satr bo'lishi kerak");
  // Shakli to'g'ri, imzosi noto'g'ri — oldingidek 401.
  const wrong = await POST(tgReq({ widget: { id: 1, auth_date: now, hash: "a".repeat(64) } }));
  assert.equal(wrong.status, 401);
});

test("admin/users/[id]: raqam bo'lmagan yoki chegaradan tashqari id — 404 (500 emas)", { skip }, async () => {
  const { queryOne } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const route = await import("../app/api/admin/users/[id]/route.ts");
  const row = await queryOne<{ id: string }>(`INSERT INTO users (username, phone) VALUES ($1, $2) RETURNING id::text AS id`, [
    `w4e_adm_${randomBytes(5).toString("hex")}`,
    ADMIN_PHONE,
  ]);
  users.push(row!.id);
  const { token } = await createSession(row!.id);
  const cookie = `${SESSION_COOKIE}=${token}`;

  const call = async (method: "GET" | "PATCH" | "PUT", id: string, body?: unknown) => {
    const req = new Request(`http://localhost:3000/api/admin/users/${encodeURIComponent(id)}`, {
      method,
      headers: { cookie, origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const fn = route[method] as (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>;
    return (await inRequest(req, () => fn(req, { params: Promise.resolve({ id }) }))).status;
  };

  for (const id of ["abc", "1.5", "-1", "0", "99999999999999999999", "1e3", " 1"]) {
    assert.equal(await call("GET", id), 404, `MUTATSIYA: GET id=${id}`);
    assert.equal(await call("PUT", id, { blocked: true }), 404, `PUT id=${id}`);
    assert.equal(await call("PATCH", id, { wallet: "balance", delta: 1 }), 404, `PATCH id=${id}`);
  }
  // Haqiqiy id — oddiy yo'l ishlaydi.
  assert.equal(await call("GET", row!.id), 200);
});
