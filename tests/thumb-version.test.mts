import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * FAYL KARTASI ESKIZI — VERSIYA KALITI VA POYGA (AUDIT prod-readiness DB-14,
 * CONC-15, W4-B). Haqiqiy Postgres, alohida baza.
 *
 * Ilgari eskiz sobit `THUMB_ASSET_ID` bilan keshlanardi:
 *   1. «Sayqal» (`commitPolishedDoc`) faylni qayta yozib `file_version` ni
 *      oshiradi, lekin eskizni o'chirmaydi — kartada ABADIY eski hujjat;
 *   2. `rebuildFile` eskizni o'chirgan paytda yo'lda bo'lgan qurilish ESKI
 *      baytdan yasalgan eskizni qayta yozardi (qator yo'q — `ON CONFLICT`
 *      to'qnashmaydi) — «ko'rdim = oldim» kartada buzilardi.
 * Endi eskiz aktivi `file_version` bo'yicha (`thumbAssetId(v)`), o'qish joriy
 * versiya kaliti bilan; yozish faqat `file_version` hali o'sha bo'lsa
 * (`WHERE EXISTS …`), eski versiya eskizlari shu yozuvda o'chiriladi.
 *
 * Tuzatishsiz: ikkala asosiy test ham ESKI eskizni oladi.
 * MUTATSIYA: o'qish kaliti `THUMB_ASSET_ID` ga qaytarilsa — «sayqal» testi;
 * yozuvdagi versiya sharti olib tashlansa — «poyga» testi qizaradi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("thumbv") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test("eskiz: file_version kaliti va rebuild poygasi", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { putGenerationFile } = await import("../lib/server/storage.ts");
  const thumb = await import("../lib/server/thumb.ts");
  await migrate();
  t.after(async () => {
    await pool().end().catch(() => {});
    await iso.drop();
  });

  const uid = String((await query<{ id: string }>(`INSERT INTO users (username, name) VALUES ('thumbv', 'T') RETURNING id`))[0].id);
  const mkDone = async (bytes: string) => {
    const id = randomUUID();
    await query(`INSERT INTO generations (id, user_id, tool_id, topic, status) VALUES ($1, $2, 'essay', 'x', 'COMPLETED')`, [id, uid]);
    await putGenerationFile(id, { bytes: new Uint8Array(Buffer.from(bytes)), mime: DOCX, fileName: "a.docx" });
    return id;
  };
  /** `rebuildFile`/`commitPolishedDoc` kabi: yangi bayt + `file_version` bitta tranzaksiyada. */
  const rewrite = async (id: string, bytes: string, v: number, dropLegacyThumb: boolean) => {
    const { transaction } = await import("../lib/server/db.ts");
    await transaction(async (c) => {
      await c.query(`UPDATE generations SET file_version = $2 WHERE id = $1`, [id, v]);
      await putGenerationFile(id, { bytes: new Uint8Array(Buffer.from(bytes)), mime: DOCX, fileName: "a.docx" }, c);
      if (dropLegacyThumb) await c.query(`DELETE FROM generation_assets WHERE generation_id = $1 AND asset_id = $2`, [id, thumb.THUMB_ASSET_ID]);
    });
  };
  /** Eskiz = fayl baytlarining nusxasi (qaysi versiyadan yasalgani ko'rinsin). */
  let builds = 0;
  const deps = (gate?: Promise<void>) => ({
    available: () => true,
    build: async (bytes: Uint8Array) => {
      builds += 1;
      const out = Buffer.from(`JPEG:${Buffer.from(bytes).toString()}`);
      await gate;
      return out;
    },
  });
  const thumbRows = async (id: string) =>
    (await query<{ asset_id: string }>(`SELECT asset_id FROM generation_assets WHERE generation_id = $1 ORDER BY asset_id`, [id])).map(
      (r) => r.asset_id,
    );

  await t.test("thumbAssetId: v0 — eski doimiy id (mavjud keshlar yaroqli), har versiya boshqa hex id", () => {
    assert.equal(thumb.thumbAssetId(0), thumb.THUMB_ASSET_ID);
    const ids = [1, 2, 255, 2_147_483_647].map(thumb.thumbAssetId);
    for (const id of ids) assert.match(id, /^[0-9a-f]{8,64}$/, "aktiv marshruti regexi");
    assert.equal(new Set([thumb.THUMB_ASSET_ID, ...ids]).size, 5);
  });

  await t.test("sayqal (fayl + file_version, eskiz o'chirilmaydi) → karta YANGI baytdan", async () => {
    const id = await mkDone("v0-bayt");
    assert.equal(String(await thumb.getOrBuildThumb(id, uid, deps())), "JPEG:v0-bayt");
    // Keshdan — qayta yasalmaydi.
    const before = builds;
    assert.equal(String(await thumb.getOrBuildThumb(id, uid, deps())), "JPEG:v0-bayt");
    assert.equal(builds, before, "kesh ishlamadi");

    await rewrite(id, "v1-sayqal", 1, false);
    assert.equal(String(await thumb.getOrBuildThumb(id, uid, deps())), "JPEG:v1-sayqal", "karta eski hujjatni ko'rsatyapti");
    // Eski versiya eskizi yangi yozuv bilan tozalangan — faqat joriy qoldi.
    assert.deepEqual(await thumbRows(id), [thumb.thumbAssetId(1)]);
  });

  await t.test("poyga: yo'ldagi qurilish rebuild dan keyin ESKI eskizni joriy versiyaga yozmaydi", async () => {
    const id = await mkDone("v0-bayt");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inflight = thumb.getOrBuildVersionedThumb(id, uid, deps(gate));
    await new Promise((r) => setTimeout(r, 150)); // qurilish v0 baytni o'qidi va kutmoqda
    await rewrite(id, "v1-rebuild", 1, true);
    release();
    const served = await inflight;
    assert.equal(String(served?.jpeg), "JPEG:v0-bayt", "so'ralgan paytdagi eskiz qaytadi");
    // Route `?v=1` ni shu bilan solishtiradi — eski eskiz yangi URL ostida immutable bo'lmaydi.
    assert.equal(served?.fileVersion, 0);
    // MUTATSIYA: yozuvdagi versiya sharti olib tashlansa — eskirgan eskiz qatori yoziladi.
    assert.deepEqual(await thumbRows(id), [], "eskirgan (v0) eskiz rebuild dan keyin yozildi");
    // MUTATSIYA: versiya sharti bo'lmasa — eski eskiz joriy kalitga tushib, bu yerda qaytardi.
    assert.equal(String(await thumb.getOrBuildThumb(id, uid, deps())), "JPEG:v1-rebuild", "rebuild dan keyin karta eski");
    assert.deepEqual(await thumbRows(id), [thumb.thumbAssetId(1)], "eskirgan eskiz qatori qoldi");
  });

  await t.test("route: ?v= eskiz yasalgan versiyaga teng → immutable, aks holda no-store", async () => {
    const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
    const route = await import("../app/api/generations/[id]/thumb/route.ts");
    const { putAssets } = await import("../lib/server/assets.ts");
    const id = randomUUID();
    await query(`INSERT INTO generations (id, user_id, tool_id, topic, status, file_version) VALUES ($1, $2, 'essay', 'x', 'COMPLETED', 3)`, [id, uid]);
    const jpeg = Buffer.from("ffd8ffe000104a464946", "hex");
    await putAssets(id, [{ assetId: thumb.thumbAssetId(3), mime: "image/jpeg", bytes: jpeg }]);
    const { token } = await createSession(uid);
    const get = (qs: string) => {
      const req = new Request(`http://localhost/api/generations/${id}/thumb${qs}`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
      return inRequest(req, () => route.GET(req, { params: Promise.resolve({ id }) }));
    };
    const cur = await get("?v=3");
    assert.equal(cur.status, 200);
    assert.equal(cur.headers.get("cache-control"), "private, max-age=86400, immutable");
    assert.deepEqual(Buffer.from(await cur.arrayBuffer()), jpeg);
    for (const qs of ["?v=2", ""]) assert.equal((await get(qs)).headers.get("cache-control"), "private, no-store", qs);
  });

  await t.test("begona foydalanuvchi va tayyor bo'lmagan ish — eskiz yo'q", async () => {
    const id = await mkDone("v0-bayt");
    const other = String((await query<{ id: string }>(`INSERT INTO users (username, name) VALUES ('thumbv2', 'T') RETURNING id`))[0].id);
    assert.equal(await thumb.getOrBuildThumb(id, other, deps()), null);
    await query(`UPDATE generations SET status = 'FAILED' WHERE id = $1`, [id]);
    assert.equal(await thumb.getOrBuildThumb(id, uid, deps()), null);
  });
});
