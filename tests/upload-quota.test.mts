import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

/**
 * Yuklamalar kvotasi va tozalash (C13: DB-02, EXT-08; BEA-03).
 *
 * Ilgari bitta bepul hisob soatiga ≈ 5.6 GB `bytea` yoza olardi, logotip
 * va shablonlar abadiy qolardi, `source_cache` hech qachon
 * tozalanmasdi. Testlar HAQIQIY `put*`/`upload*` funksiyalarini haqiqiy
 * Postgres bilan chaqiradi va «rad etildi → HECH NARSA yozilmadi» ni
 * bazaning o'zidan tekshiradi.
 *
 * Katta hajmni sinash uchun 200 MB yozilmaydi: `size_bytes` ustuniga
 * katta son, `bytes` ga esa kichik bayt qo'yiladi — kvota aynan
 * `size_bytes` ni sanaydi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { ApiError } = await import("../lib/server/api.ts");
const { query, queryOne, pool } = await import("../lib/server/db.ts");
const { UPLOAD_QUOTA, purgeUnusedUploads, putGenerationUpload, quotaMessage } = await import("../lib/server/upload-quota.ts");
const { putLogo } = await import("../lib/server/logo.ts");
const { uploadPhoto } = await import("../lib/server/photo.ts");
const { uploadTemplate } = await import("../lib/server/template-upload.ts");
const { uploadSource } = await import("../lib/server/source-upload.ts");
const { purgeSourceCache } = await import("../lib/generation/research/cache.ts");

const MB = 1024 * 1024;
const users: string[] = [];

after(async () => {
  if (!hasDb) return;
  for (const id of users) await query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
  await pool().end();
});

async function newUser(): Promise<string> {
  const row = await queryOne<{ id: string }>(`INSERT INTO users (username) VALUES ($1) RETURNING id::text AS id`, [
    `quota_${randomBytes(6).toString("hex")}`,
  ]);
  users.push(row!.id);
  return row!.id;
}

/** PNG imzosi + 10×10 IHDR + tasodifiy dum (har chaqiruv — yangi `asset_id`). */
function png(n = 32): Buffer {
  const ihdr = Buffer.alloc(8);
  ihdr.writeUInt32BE(10, 0);
  ihdr.writeUInt32BE(10, 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
    Buffer.from("IHDR"),
    ihdr,
    randomBytes(n),
  ]);
}

function blobPart(b: Buffer): Uint8Array<ArrayBuffer> {
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  return new Uint8Array(ab);
}

async function expectQuota(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ApiError, `ApiError kutilgan edi: ${e}`);
    assert.equal((e as InstanceType<typeof ApiError>).status, 413);
    assert.equal((e as InstanceType<typeof ApiError>).extra.code, "quota");
    return;
  }
  assert.fail("MUTATSIYA: kvotadan oshgan yuklama qabul qilindi");
}

/** Katta «soxta» qator: `size_bytes` kvotaga kiradi, bayt esa kichik. */
async function seedBytes(uid: string, table: "logo_uploads" | "source_uploads", sizeBytes: number): Promise<void> {
  if (table === "logo_uploads") {
    await query(`INSERT INTO logo_uploads (user_id, asset_id, mime, size_bytes, bytes) VALUES ($1, $2, 'image/png', $3, '\\x00')`, [
      uid,
      randomBytes(12).toString("hex"),
      sizeBytes,
    ]);
  } else {
    await query(
      `INSERT INTO source_uploads (user_id, asset_id, name, kind, mime, size_bytes, bytes) VALUES ($1, $2, 'a.txt', 'txt', 'text/plain', $3, '\\x00')`,
      [uid, randomBytes(12).toString("hex"), sizeBytes],
    );
  }
}

const count = async (table: string, uid: string) =>
  Number((await queryOne<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE user_id = $1`, [uid]))!.n);

test("logo: son chegarasi — 21-logotip 413, bazada 20 ta qoladi; qayta yuklash o'tadi", { skip }, async () => {
  const uid = await newUser();
  const first = png();
  await putLogo(uid, first, "image/png");
  for (let i = 1; i < UPLOAD_QUOTA.count.logo; i++) await putLogo(uid, png(), "image/png");
  assert.equal(await count("logo_uploads", uid), UPLOAD_QUOTA.count.logo);

  await expectQuota(putLogo(uid, png(), "image/png"));
  assert.equal(await count("logo_uploads", uid), UPLOAD_QUOTA.count.logo, "rad etilgan logotip yozildi");
  // Bir xil bayt — o'sha qator, yangi qator emas: kvota to'la bo'lsa ham o'tadi.
  await putLogo(uid, first, "image/png");
});

test("umumiy hajm: 200 MB dan oshsa 413 va hech narsa yozilmaydi", { skip }, async () => {
  const uid = await newUser();
  await seedBytes(uid, "source_uploads", UPLOAD_QUOTA.totalBytes - 100);
  await expectQuota(putLogo(uid, png(200), "image/png"));
  assert.equal(await count("logo_uploads", uid), 0);
});

test("logo: parallel 8 yuklama chegarada — faqat bittasi o'tadi (qulf)", { skip }, async () => {
  const uid = await newUser();
  for (let i = 0; i < UPLOAD_QUOTA.count.logo - 1; i++) await seedBytes(uid, "logo_uploads", 10);
  // Ulanishlar oldindan ochiladi — aks holda ularni o'rnatish (SCRAM) so'rovlarni
  // ketma-ket qilib qo'yib, poyga umuman yuz bermasdi.
  const warm = await Promise.all(Array.from({ length: 8 }, () => pool().connect()));
  for (const c of warm) c.release();
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => putLogo(uid, png(MB), "image/png")));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "MUTATSIYA: poyga chegaradan o'tib ketdi");
  assert.equal(await count("logo_uploads", uid), UPLOAD_QUOTA.count.logo);
});

test("photo: kesilgan + asl juftligi — sig'masa IKKALASI ham yozilmaydi", { skip }, async () => {
  const uid = await newUser();
  for (let i = 0; i < UPLOAD_QUOTA.count.photo - 1; i++) {
    await query(`INSERT INTO photo_uploads (user_id, asset_id, mime, size_bytes, bytes) VALUES ($1, $2, 'image/png', 10, '\\x00')`, [
      uid,
      randomBytes(12).toString("hex"),
    ]);
  }
  const fd = new FormData();
  fd.set("file", new File([blobPart(png())], "c.png", { type: "image/png" }));
  fd.set("original", new File([blobPart(png())], "o.png", { type: "image/png" }));
  await expectQuota(uploadPhoto(new Request("http://x/api/uploads/photo", { method: "POST", body: fd }), uid));
  assert.equal(await count("photo_uploads", uid), UPLOAD_QUOTA.count.photo - 1, "asl nusxa kvotani chetlab yozildi");
});

test("template: kvota to'la — tahlil/rasterlashdan OLDIN 413", { skip }, async () => {
  const uid = await newUser();
  await seedBytes(uid, "source_uploads", UPLOAD_QUOTA.totalBytes);
  let rasterized = 0;
  const pptx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("ppt/presentation.xml"), Buffer.alloc(64)]);
  const fd = new FormData();
  fd.set("file", new File([blobPart(pptx)], "n.pptx"));
  await expectQuota(
    uploadTemplate(new Request("http://x/api/uploads/template", { method: "POST", body: fd }), uid, {
      rasterize: async () => {
        rasterized++;
        return {};
      },
    }),
  );
  assert.equal(rasterized, 0);
  assert.equal(await count("template_uploads", uid), 0);
});

test("source: kvota to'la — sanash (PDF da soniyalar) boshlanmaydi, 413", { skip }, async () => {
  const uid = await newUser();
  await seedBytes(uid, "source_uploads", UPLOAD_QUOTA.totalBytes);
  let counted = 0;
  const fd = new FormData();
  fd.set("file", new File(["Salom dunyo. ".repeat(50)], "a.txt", { type: "text/plain" }));
  await expectQuota(
    uploadSource(new Request("http://x/api/uploads/source", { method: "POST", body: fd }), uid, {
      count: async () => {
        counted++;
        return { chars: 600, text: "x" };
      },
    }),
  );
  assert.equal(counted, 0);
  assert.equal(await count("source_uploads", uid), 1, "faqat urug' qatori");
});

async function newGeneration(uid: string): Promise<string> {
  const gid = randomUUID();
  await query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status, finished_at) VALUES ($1, $2, 'slide', 'Sinov', 'COMPLETED', now() - interval '1 minute')`,
    [gid, uid],
  );
  return gid;
}

test("generation: begona hujjatga rasm YOZILMAYDI (404, BEA-03); hajmdan oshsa 413", { skip }, async () => {
  const owner = await newUser();
  const stranger = await newUser();
  const gid = await newGeneration(owner);
  const assets = async () =>
    Number((await queryOne<{ n: string }>(`SELECT count(*) AS n FROM generation_assets WHERE generation_id = $1`, [gid]))!.n);

  await assert.rejects(putGenerationUpload(gid, stranger, "image/png", png()), (e: unknown) => e instanceof ApiError && e.status === 404);
  assert.equal(await assets(), 0, "begona foydalanuvchi bayti yozildi");

  await putGenerationUpload(gid, owner, "image/png", png());
  assert.equal(await assets(), 1);

  await seedBytes(owner, "source_uploads", UPLOAD_QUOTA.totalBytes);
  await expectQuota(putGenerationUpload(gid, owner, "image/png", png()));
  assert.equal(await assets(), 1);
});

test("purgeUnusedUploads: eski + foydalanilmagan o'chadi; ishora qilingan va yangi QOLADI", { skip }, async () => {
  const uid = await newUser();
  const ids = { oldFree: "", oldUsed: "", oldDraft: "", fresh: "", tplOld: "", tplDoc: "" };
  for (const k of Object.keys(ids) as (keyof typeof ids)[]) ids[k] = randomBytes(12).toString("hex");

  for (const [id, days] of [[ids.oldFree, 120], [ids.oldUsed, 120], [ids.oldDraft, 120], [ids.fresh, 10]] as const) {
    await query(
      `INSERT INTO logo_uploads (user_id, asset_id, mime, size_bytes, bytes, created_at) VALUES ($1, $2, 'image/png', 1, '\\x00', now() - ($3 || ' days')::interval)`,
      [uid, id, String(days)],
    );
  }
  for (const id of [ids.tplOld, ids.tplDoc]) {
    await query(
      `INSERT INTO template_uploads (user_id, asset_id, name, size_bytes, bytes, profile, created_at) VALUES ($1, $2, 'n.pptx', 1, '\\x00', '{}'::jsonb, now() - interval '200 days')`,
      [uid, id],
    );
  }
  await query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status, values_json, doc_json)
     VALUES ($1, $2, 'pro-slide', 'Sinov', 'COMPLETED', $3::jsonb, $4::jsonb)`,
    [randomUUID(), uid, JSON.stringify({ logoAssetId: ids.oldUsed }), JSON.stringify({ customTemplate: { assetId: ids.tplDoc } })],
  );
  await query(`INSERT INTO form_drafts (user_id, tool_id, data) VALUES ($1, 'slide', $2::jsonb)`, [
    uid,
    JSON.stringify({ logoAssetId: ids.oldDraft }),
  ]);

  const res = await purgeUnusedUploads(90);
  assert.ok(res.logos >= 1 && res.templates >= 1);

  const left = async (table: string) =>
    new Set((await query<{ asset_id: string }>(`SELECT asset_id FROM ${table} WHERE user_id = $1`, [uid])).map((r) => r.asset_id));
  const logos = await left("logo_uploads");
  assert.ok(!logos.has(ids.oldFree), "eski foydalanilmagan logotip qoldi");
  assert.ok(logos.has(ids.oldUsed), "MUTATSIYA: generatsiya ishora qilgan logotip o'chdi");
  assert.ok(logos.has(ids.oldDraft), "MUTATSIYA: qoralama ishora qilgan logotip o'chdi");
  assert.ok(logos.has(ids.fresh), "MUTATSIYA: yangi logotip o'chdi");
  const tpls = await left("template_uploads");
  assert.ok(!tpls.has(ids.tplOld), "eski foydalanilmagan shablon qoldi");
  assert.ok(tpls.has(ids.tplDoc), "MUTATSIYA: hujjat (customTemplate) ishora qilgan shablon o'chdi");
});

test("purgeSourceCache: 60 kundan eski yozuvlar o'chadi, yangilari qoladi (EXT-08)", { skip }, async () => {
  const tag = randomBytes(6).toString("hex");
  await query(`INSERT INTO source_cache (key, payload, fetched_at) VALUES ($1, '{}'::jsonb, now() - interval '61 days'), ($2, '{}'::jsonb, now() - interval '5 days')`, [
    `test:${tag}:old`,
    `test:${tag}:new`,
  ]);
  const removed = await purgeSourceCache(60);
  assert.ok(removed >= 1);
  const keys = (await query<{ key: string }>(`SELECT key FROM source_cache WHERE key LIKE $1`, [`test:${tag}:%`])).map((r) => r.key);
  assert.deepEqual(keys, [`test:${tag}:new`]);
  await query(`DELETE FROM source_cache WHERE key LIKE $1`, [`test:${tag}:%`]);
});

test("UPLOAD_QUOTA: taklif qilingan sonlar", () => {
  assert.equal(UPLOAD_QUOTA.totalBytes, 200 * MB);
  assert.deepEqual({ ...UPLOAD_QUOTA.count }, { photo: 50, logo: 20, template: 20, source: 30 });
});

test("quotaMessage: har tur uchun ROST xabar — chegara va foydalanuvchi nima qila olishi (review R3)", () => {
  const all = (["photo", "logo", "template", "source", "generation"] as const).map((k) => [k, quotaMessage(k, "count")] as const);
  for (const [kind, msg] of all) {
    // Ulanmagan tozalash (`purgeUnusedUploads`) va'da qilinmaydi.
    assert.ok(!/foydalanilmagan fayllar 90 kundan/.test(msg), `${kind}: MUTATSIYA — mavjud bo'lmagan tozalash va'da qilindi`);
    assert.match(msg, new RegExp(`${kind === "generation" ? UPLOAD_QUOTA.perGeneration : UPLOAD_QUOTA.count[kind]} ta`), `${kind}: chegara aytilmadi`);
  }
  const m = Object.fromEntries(all);
  // Logotipni o'chirish yo'li yo'q — o'chirishni taklif qilmaymiz, qayta tanlashni aytamiz.
  assert.ok(!/o'chir/.test(m.logo), "logotip: o'chirish yo'li yo'q");
  assert.match(m.logo, /qayta tanla/);
  assert.match(m.template, /o'chir/);
  assert.match(m.source, /o'chir/);
  // Hujjatga yuklangan rasmlar hujjat umri davomida saqlanadi.
  assert.match(m.generation, /hujjat umri/);
  // Faqat haqiqatan ULANGAN tozalashlar aytiladi: manbalar 30, suratlar 90 kun.
  assert.match(m.source, /30 kun/);
  assert.match(m.photo, /90 kun/);

  const bytes = quotaMessage("logo", "bytes");
  assert.match(bytes, new RegExp(`${UPLOAD_QUOTA.totalBytes / MB} MB`));
  assert.match(bytes, /shablon/);
  assert.ok(!/90 kundan/.test(bytes));
});
