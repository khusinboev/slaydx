import test from "node:test";
import assert from "node:assert/strict";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Kesh sarlavhalari (prod-readiness C08: SCALE-01, BEA-07, FE-05).
 *
 * Next 15 `next.config` `headers()` ni route ishlashidan OLDIN `res` ga
 * yozadi, route'ning o'z sarlavhasi esa «allaqachon bor» bo'lsa tashlab
 * yuboriladi (`send-response.js`). Ilgari `/api/:path*` → `private,
 * no-store` qoidasi rasm/eskiz/surat/audio route'larining o'z
 * `max-age … immutable` sarlavhasini yutib yuborardi: har ko'rishda bayt
 * Postgres'dan qayta o'qilardi. `tests/game-routes.test.mts` handler'ni
 * to'g'ridan-to'g'ri chaqirgani uchun buni ko'rmasdi.
 *
 * Shu sababli bu yerda IKKI qatlam sinaladi:
 *   1. konfiguratsiya — Next'ning O'Z yuklovchisi (`loadCustomRoutes`) va
 *      moslashtiruvchisi (`buildCustomRoute` + `matchHas`) bilan, ya'ni
 *      prod'dagi `resolve-routes.js` bilan bir xil yo'l;
 *   2. route — haqiqiy handler (Postgres bo'lsa): muvaffaqiyatda o'z keshi,
 *      xatoda `private, no-store` (konfiguratsiya endi ularni yopmaydi).
 */

process.env.SESSION_SECRET ||= "test-session-secret-at-least-32-characters";

type HasItem = { type: "header" | "cookie" | "query" | "host"; key: string; value?: string };
type HeaderRule = { source: string; headers: { key: string; value: string }[]; has?: HasItem[]; missing?: HasItem[] };

const nextConfig = (await import("../next.config.ts")).default;
const loadCustomRoutes = (await import("next/dist/lib/load-custom-routes.js")).default as unknown as (
  c: unknown,
) => Promise<{ headers: HeaderRule[] }>;
const { buildCustomRoute } = (await import("next/dist/server/lib/router-utils/filesystem.js")) as unknown as {
  buildCustomRoute: (
    type: "header",
    item: HeaderRule,
    basePath?: string,
    caseSensitive?: boolean,
  ) => HeaderRule & { match: (p: string) => false | Record<string, string> };
};
const { matchHas } = (await import("next/dist/shared/lib/router/utils/prepare-destination.js")) as unknown as {
  matchHas: (req: unknown, query: Record<string, string>, has?: HasItem[], missing?: HasItem[]) => false | object;
};

/** Next `resolve-routes.js` qanday yig'sa, shunday: mos qoidalar tartib bilan, keyingisi ustidan yozadi. */
async function configHeaders(pathname: string, query: Record<string, string> = {}): Promise<Record<string, string>> {
  const { headers } = await loadCustomRoutes({ ...nextConfig, basePath: "", trailingSlash: false, i18n: null });
  const out: Record<string, string> = {};
  for (const item of headers) {
    const route = buildCustomRoute("header", item, "", false);
    if (!route.match(pathname)) continue;
    if ((route.has || route.missing) && !matchHas({ headers: {} }, query, route.has, route.missing)) continue;
    for (const h of route.headers) out[h.key.toLowerCase()] = h.value;
  }
  return out;
}

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ASSET = "0123456789abcdef01234567";

test("konfiguratsiya: JSON/foydalanuvchi ma'lumoti route'lari `private, no-store` bo'lib qoladi", async () => {
  for (const path of [
    "/api/generations",
    `/api/generations/${ID}`,
    `/api/generations/${ID}/file`,
    `/api/generations/${ID}/doc`,
    `/api/generations/${ID}/results`,
    `/api/generations/${ID}/slides/3/image`,
    `/api/generations/${ID}/assets`,
    `/api/users/me`,
    `/api/payments/orders`,
    `/api/o/${"a".repeat(22)}`,
    `/api/uploads/photo`,
    `/api/uploads/source/${ASSET}`,
    `/api/uploads/template/${ASSET}`,
  ]) {
    const h = await configHeaders(path);
    assert.equal(h["cache-control"], "private, no-store", `${path}: no-store yo'qoldi`);
  }
});

test("konfiguratsiya: bayt route'lariga `Cache-Control` qo'yilmaydi — route'ning o'z keshi yetib boradi", async () => {
  for (const path of [
    `/api/generations/${ID}/assets/${ASSET}`,
    `/api/o/${"a".repeat(22)}/audio/${ASSET}`,
    `/api/uploads/photo/${ASSET}`,
  ]) {
    const h = await configHeaders(path);
    // MUTATSIYA: istisnoni olib tashlash (eski `/api/:path*`) → bu yerda `private, no-store`.
    assert.equal(h["cache-control"], undefined, `${path}: konfiguratsiya route keshini yopib qo'ydi`);
    // Xavfsizlik sarlavhalari bayt route'larida ham saqlanadi.
    assert.equal(h["x-content-type-options"], "nosniff", `${path}: nosniff yo'qoldi`);
  }
});

test("konfiguratsiya: eskiz URL'i versiyasiz bo'lsa `no-store`, `?v=` bilan esa route keshi", async () => {
  /*
   * Eskiz aktiv id si doimiy (`THUMB_ASSET_ID`) — URL o'zgarmaydi, tahrirdan
   * keyin brauzer 1 kun eski rasmni ko'rsatardi. Shuning uchun faqat
   * versiyalangan URL (`?v=<fileVersion>`) keshlanadi.
   */
  const bare = await configHeaders(`/api/generations/${ID}/thumb`);
  assert.equal(bare["cache-control"], "private, no-store");
  const versioned = await configHeaders(`/api/generations/${ID}/thumb`, { v: "4" });
  assert.equal(versioned["cache-control"], undefined);
});

test("konfiguratsiya: istisno faqat aniq bayt yo'llariga — qo'shni/uzunroq yo'l no-store", async () => {
  for (const path of [
    `/api/generations/${ID}/assets/${ASSET}/extra`,
    `/api/generations/${ID}/thumbnail`,
    `/api/o/${"a".repeat(22)}/audio`,
    `/api/uploads/photo/${ASSET}/crop`,
  ]) {
    const h = await configHeaders(path);
    assert.equal(h["cache-control"], "private, no-store", `${path}: istisno juda keng`);
  }
});

// ─────────────────────────────── route darajasi (Postgres bo'lsa)

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");

test("route: bayt javobi o'z keshini, xato javobi `private, no-store` ni beradi", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, migrate } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { putAssetBytes } = await import("../lib/server/assets.ts");
  const { putPhoto } = await import("../lib/server/photo.ts");
  const assetRoute = await import("../app/api/generations/[id]/assets/[assetId]/route.ts");
  const photoRoute = await import("../app/api/uploads/photo/[assetId]/route.ts");
  const audioRoute = await import("../app/api/o/[token]/audio/[assetId]/route.ts");
  await migrate();

  const suffix = `test-cache-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const uid = String(
    (await query<{ id: string }>(`INSERT INTO users (username, name) VALUES ($1, 'Test') RETURNING id`, [suffix]))[0].id,
  );
  const gid = crypto.randomUUID();
  await query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status) VALUES ($1, $2, 'image', 'kesh', 'COMPLETED')`,
    [gid, uid],
  );
  t.after(async () => {
    await query("DELETE FROM users WHERE id = $1", [uid]);
  });
  const { token } = await createSession(uid);
  const cookie = `${SESSION_COOKIE}=${token}`;
  const get = (url: string) => new Request(`http://localhost${url}`, { headers: { cookie } });

  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const assetId = await putAssetBytes(gid, "image/png", png);

  await t.test("aktiv: 200 → `private, max-age=86400, immutable`, bayt aynan o'zi", async () => {
    const req = get(`/api/generations/${gid}/assets/${assetId}`);
    const res = await inRequest(req, () => assetRoute.GET(req, { params: Promise.resolve({ id: gid, assetId }) }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, max-age=86400, immutable");
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), png);
  });

  await t.test("aktiv: 404 → `private, no-store` (xato keshlanmasin)", async () => {
    const missing = "f".repeat(24);
    const req = get(`/api/generations/${gid}/assets/${missing}`);
    const res = await inRequest(req, () => assetRoute.GET(req, { params: Promise.resolve({ id: gid, assetId: missing }) }));
    assert.equal(res.status, 404);
    // MUTATSIYA: `noStoreOnError` o'rami olib tashlansa — sarlavha yo'q (null).
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  });

  await t.test("surat: 200 → kontent hashi, `immutable`; 404 → no-store", async () => {
    const photoId = await putPhoto(uid, png, "image/png");
    const req = get(`/api/uploads/photo/${photoId}`);
    const res = await inRequest(req, () => photoRoute.GET(req, { params: Promise.resolve({ assetId: photoId }) }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, max-age=86400, immutable");
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), png);

    const bad = get(`/api/uploads/photo/${"e".repeat(24)}`);
    const miss = await inRequest(bad, () => photoRoute.GET(bad, { params: Promise.resolve({ assetId: "e".repeat(24) }) }));
    assert.equal(miss.status, 404);
    assert.equal(miss.headers.get("cache-control"), "private, no-store");
  });

  await t.test("ochiq audio: 404 → no-store (`public` kesh faqat haqiqiy baytga)", async () => {
    const tok = "a".repeat(22);
    const req = new Request(`http://localhost/api/o/${tok}/audio/${ASSET}`);
    const res = await audioRoute.GET(req, { params: Promise.resolve({ token: tok, assetId: ASSET }) });
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  });

  /*
   * Eskiz (review W2-B R2): route `BYTE_ROUTES` da, ya'ni `?v=` bilan
   * konfiguratsiya uni YOPMAYDI — xato javobi ham, eski versiya ham
   * keshlanmasligi kerak. Uzoq kesh faqat `v` joriy `file_version` ga teng bo'lsa.
   */
  await t.test("eskiz: ?v= joriy file_version → immutable; eski/yo'q v → no-store; 404 → no-store", async () => {
    const { putAssets } = await import("../lib/server/assets.ts");
    const { thumbAssetId } = await import("../lib/server/thumb.ts");
    const thumbRoute = await import("../app/api/generations/[id]/thumb/route.ts");
    const tg = crypto.randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, status, file_version) VALUES ($1, $2, 'essay', 'eskiz', 'COMPLETED', 3)`,
      [tg, uid],
    );
    const jpeg = Buffer.from("ffd8ffe000104a464946", "hex");
    // Eskiz fayl versiyasi kaliti bilan keshlanadi (DB-14, W4-B) — joriy `file_version = 3` eskizi.
    await putAssets(tg, [{ assetId: thumbAssetId(3), mime: "image/jpeg", bytes: jpeg }]);
    const thumb = async (gid2: string, qs: string) => {
      const req = get(`/api/generations/${gid2}/thumb${qs}`);
      return inRequest(req, () => thumbRoute.GET(req, { params: Promise.resolve({ id: gid2 }) }));
    };
    const cur = await thumb(tg, "?v=3");
    assert.equal(cur.status, 200);
    // MUTATSIYA: versiya solishtiruvini olib tashlash → eski `?v=2` ham immutable bo'lardi.
    assert.equal(cur.headers.get("cache-control"), "private, max-age=86400, immutable");
    assert.deepEqual(Buffer.from(await cur.arrayBuffer()), jpeg);
    for (const qs of ["?v=2", "", "?v=abc"]) {
      const r = await thumb(tg, qs);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("cache-control"), "private, no-store", `eskiz ${qs || "(v yo'q)"} keshlanmasligi kerak`);
    }
    const missing = crypto.randomUUID();
    const nf = await thumb(missing, "?v=1");
    assert.equal(nf.status, 404);
    // MUTATSIYA: `noStoreOnError` o'rami olib tashlansa — sarlavha yo'q.
    assert.equal(nf.headers.get("cache-control"), "private, no-store");
  });

  await t.test("aktiv route: o'zgaruvchan eskiz id si (THUMB_ASSET_ID) immutable bo'lib ketmaydi (N3)", async () => {
    const { putAssets } = await import("../lib/server/assets.ts");
    const { THUMB_ASSET_ID } = await import("../lib/server/thumb.ts");
    await putAssets(gid, [{ assetId: THUMB_ASSET_ID, mime: "image/jpeg", bytes: Buffer.from("ffd8ff", "hex") }]);
    const req = get(`/api/generations/${gid}/assets/${THUMB_ASSET_ID}`);
    const res = await inRequest(req, () => assetRoute.GET(req, { params: Promise.resolve({ id: gid, assetId: THUMB_ASSET_ID }) }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  });
});
