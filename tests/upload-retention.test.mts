import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

/**
 * Yuklamalar umri va kvota aniqligi (C41: BEA-19 server qismi; W2-C nitlari).
 *
 *   1) `purgeOldPhotos` — 90 kundan eski surat, agar forma qoralamasi yoki
 *      navbatdagi/ishlayotgan rezyume unga ishora qilsa, O'CHMAYDI:
 *      ilgari qoralama tiklanganda surat «singan» ko'rinar, pullik rezyume
 *      esa jimgina suratsiz chiqardi. TAYYOR rezyume esa suratni ushlab
 *      turmaydi (review R2): uning o'z nusxasi `generation_assets` da —
 *      aks holda kvota (50 qator, o'chirish yo'li yo'q) abadiy to'lardi.
 *   2) Bir xil faylni qayta yuklash (xesh bo'yicha bitta qator) `created_at`
 *      ni YANGILAYDI — 89-kuni qayta tanlangan surat/logotip ertasi kuni
 *      o'chib ketmasin (`purgeUnusedUploads` ulanishi uchun ham shart).
 *   3) Tizim yozadigan eskiz (`THUMB_ASSET_ID`) foydalanuvchi kvotasiga
 *      kirmaydi — u foydalanuvchi yuklamasi emas.
 *
 * HAQIQIY Postgres (throwaway baza).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, queryOne, pool } = await import("../lib/server/db.ts");
const { toJsonb } = await import("../lib/server/jsonb.ts");
const { UPLOAD_QUOTA, putGenerationUpload } = await import("../lib/server/upload-quota.ts");
const { putLogo } = await import("../lib/server/logo.ts");
const { putPhoto, purgeOldPhotos } = await import("../lib/server/photo.ts");
const { putTemplate } = await import("../lib/server/template-upload.ts");
const { putSource } = await import("../lib/server/source-upload.ts");
const { THUMB_ASSET_ID } = await import("../lib/server/thumb.ts");
const { assetImageResolver, extractAssets, getAsset, putAssets } = await import("../lib/server/assets.ts");
const { photoDataUrl } = await import("../lib/server/photo.ts");

const users: string[] = [];

after(async () => {
  if (!hasDb) return;
  for (const id of users) await query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
  await pool().end();
});

async function newUser(): Promise<string> {
  const row = await queryOne<{ id: string }>(`INSERT INTO users (username) VALUES ($1) RETURNING id::text AS id`, [
    `w4e_r_${randomBytes(6).toString("hex")}`,
  ]);
  users.push(row!.id);
  return row!.id;
}

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

const hex = () => randomBytes(12).toString("hex");

async function oldPhoto(uid: string, opts: { original?: string; ageDays?: number } = {}): Promise<string> {
  const id = hex();
  await query(
    `INSERT INTO photo_uploads (user_id, asset_id, mime, size_bytes, bytes, original_asset_id, created_at)
     VALUES ($1, $2, 'image/png', 10, '\\x00', $3, now() - ($4 || ' days')::interval)`,
    [uid, id, opts.original ?? null, String(opts.ageDays ?? 100)],
  );
  return id;
}

async function photoIds(uid: string): Promise<Set<string>> {
  return new Set((await query<{ asset_id: string }>(`SELECT asset_id FROM photo_uploads WHERE user_id = $1`, [uid])).map((r) => r.asset_id));
}

async function resumeGeneration(uid: string, status: string, values: Record<string, unknown>, doc: unknown = null): Promise<void> {
  await query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status, values_json, doc_json, finished_at)
     VALUES ($1, $2, 'resume', 'Rezyume', $3, $4, $5, CASE WHEN $3 IN ('COMPLETED','FAILED') THEN now() END)`,
    [randomUUID(), uid, status, toJsonb(values), doc == null ? null : toJsonb(doc)],
  );
}

/* ───────────────────────── 1) purgeOldPhotos ───────────────────────── */

test("purgeOldPhotos: qoralama yoki navbatdagi/ishlayotgan rezyume ishora qilgan surat QOLADI, qolgan eskisi (tayyor rezyumeniki ham) o'chadi (C41, R2)", { skip }, async () => {
  const uid = await newUser();
  const other = await newUser();

  const draftCrop = await oldPhoto(uid);
  const draftOriginal = await oldPhoto(uid);
  const viaCropOriginal = await oldPhoto(uid); // faqat kesilgan qatorning `original_asset_id` si orqali
  const draftCrop2 = await oldPhoto(uid, { original: viaCropOriginal });
  const completedValues = await oldPhoto(uid);
  const completedDocOriginal = await oldPhoto(uid);
  const queuedValues = await oldPhoto(uid);
  const runningValues = await oldPhoto(uid);
  const failedOnly = await oldPhoto(uid);
  const unreferenced = await oldPhoto(uid);
  const fresh = await oldPhoto(uid, { ageDays: 10 });
  const foreignRef = await oldPhoto(uid); // BOSHQA foydalanuvchi qoralamasida — himoya qilmaydi

  await query(`INSERT INTO form_drafts (user_id, tool_id, data) VALUES ($1, 'resume', $2)`, [
    uid,
    toJsonb({ photoAssetId: draftCrop.toUpperCase(), photoOriginalAssetId: draftOriginal }),
  ]);
  await query(`INSERT INTO form_drafts (user_id, tool_id, data) VALUES ($1, 'article', $2)`, [uid, toJsonb({ photoAssetId: draftCrop2 })]);
  await query(`INSERT INTO form_drafts (user_id, tool_id, data) VALUES ($1, 'resume', $2)`, [other, toJsonb({ photoAssetId: foreignRef })]);
  await resumeGeneration(uid, "COMPLETED", { photoAssetId: completedValues });
  await resumeGeneration(uid, "COMPLETED", {}, { resume: { photo: { url: "/x", assetId: "zz", originalAssetId: completedDocOriginal } } });
  await resumeGeneration(uid, "QUEUED", { photoAssetId: queuedValues });
  await resumeGeneration(uid, "IN_PROGRESS", { photoAssetId: runningValues });
  await resumeGeneration(uid, "FAILED", { photoAssetId: failedOnly });

  await purgeOldPhotos(90);
  const left = await photoIds(uid);

  for (const [name, id] of Object.entries({ draftCrop, draftOriginal, draftCrop2, viaCropOriginal, queuedValues, runningValues, fresh })) {
    assert.ok(left.has(id), `MUTATSIYA: ${name} o'chirildi, lekin unga ishora bor`);
  }
  for (const [name, id] of Object.entries({ completedValues, completedDocOriginal, failedOnly, unreferenced, foreignRef })) {
    assert.ok(!left.has(id), `MUTATSIYA: ${name} o'chishi kerak edi (kvota abadiy band bo'lardi)`);
  }
});

test("tayyor rezyume surati `photo_uploads` ga bog'liq EMAS — qator o'chgandan keyin ham aktivdan beriladi (R2)", { skip }, async () => {
  const uid = await newUser();
  const bytes = png(64);
  const photoId = await putPhoto(uid, bytes, "image/png");

  // Worker yo'li: `photoDataUrl` → `data:` URL → `extractAssets` (`swapPhoto`) → `generation_assets`.
  const photo = await photoDataUrl(uid, photoId);
  assert.ok(photo);
  const gid = randomUUID();
  const doc = { meta: {}, sections: [], resume: { photo: { url: photo.url, shape: "circle", assetId: photoId } } };
  const extracted = extractAssets(gid, doc as never, "");
  const stored = (extracted.doc as unknown as { resume: { photo: { url: string; assetId: string } } }).resume.photo;
  assert.equal(stored.url, `/api/generations/${gid}/assets/${stored.assetId}`, "tayyor hujjat suratni o'z aktividan o'qiydi");
  await query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status, values_json, doc_json, finished_at)
     VALUES ($1, $2, 'resume', 'Rezyume', 'COMPLETED', $3, $4, now())`,
    [gid, uid, toJsonb({ photoAssetId: photoId }), toJsonb(extracted.doc)],
  );
  await putAssets(gid, extracted.assets);

  await query(`UPDATE photo_uploads SET created_at = now() - interval '100 days' WHERE user_id = $1`, [uid]);
  await purgeOldPhotos(90);
  assert.equal((await photoIds(uid)).size, 0, "tayyor rezyume surat qatorini ushlab turmasligi kerak");

  // Ko'ruvchi (`/api/generations/{id}/assets/{aid}` → `getAsset`) va DOCX qayta render (`assetImageResolver`).
  const asset = await getAsset(gid, stored.assetId, uid);
  assert.ok(asset && Buffer.compare(asset.bytes, bytes) === 0, "surat baytlari aktivda qolishi kerak");
  const img = await assetImageResolver(gid, uid)(stored.url);
  assert.ok(img && img.type === "png");
});

/* ───────────────────────── 2) created_at yangilanadi ───────────────────────── */

async function ageRow(table: string, uid: string, assetId: string): Promise<void> {
  await query(`UPDATE ${table} SET created_at = now() - interval '100 days' WHERE user_id = $1 AND asset_id = $2`, [uid, assetId]);
}

async function ageDays(table: string, uid: string, assetId: string): Promise<number> {
  const row = await queryOne<{ d: number }>(
    `SELECT extract(epoch FROM now() - created_at) / 86400 AS d FROM ${table} WHERE user_id = $1 AND asset_id = $2`,
    [uid, assetId],
  );
  return Number(row!.d);
}

test("qayta yuklash: logo, surat, shablon, manba — bir xil bayt `created_at` ni yangilaydi (W2-C, BEA-19)", { skip }, async () => {
  const uid = await newUser();

  const logoBytes = png();
  const { assetId: logoId } = await putLogo(uid, logoBytes, "image/png");
  await ageRow("logo_uploads", uid, logoId);
  await putLogo(uid, logoBytes, "image/png");
  assert.ok((await ageDays("logo_uploads", uid, logoId)) < 1, "MUTATSIYA: logo qayta yuklanganda eski sana qoldi");

  const photoBytes = png();
  const photoId = await putPhoto(uid, photoBytes, "image/png");
  await ageRow("photo_uploads", uid, photoId);
  await putPhoto(uid, photoBytes, "image/png");
  assert.ok((await ageDays("photo_uploads", uid, photoId)) < 1, "MUTATSIYA: surat qayta yuklanganda eski sana qoldi");

  const pptx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), randomBytes(64)]);
  const { assetId: tplId } = await putTemplate(uid, pptx, "n.pptx", {} as never, {} as never);
  await ageRow("template_uploads", uid, tplId);
  await putTemplate(uid, pptx, "n.pptx", {} as never, {} as never);
  assert.ok((await ageDays("template_uploads", uid, tplId)) < 1, "MUTATSIYA: shablon qayta yuklanganda eski sana qoldi");

  const txt = Buffer.from(`Salom ${hex()}`);
  const row = { name: "a.txt", kind: "txt" as const, mime: "text/plain", chars: 12, text: "Salom" };
  const { assetId: srcId } = await putSource(uid, txt, row);
  await ageRow("source_uploads", uid, srcId);
  await putSource(uid, txt, row);
  assert.ok((await ageDays("source_uploads", uid, srcId)) < 1, "MUTATSIYA: manba qayta yuklanganda eski sana qoldi");
});

/* ───────────────────────── 3) eskiz kvotaga kirmaydi ───────────────────────── */

async function completedGeneration(uid: string): Promise<string> {
  const gid = randomUUID();
  await query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status, finished_at) VALUES ($1, $2, 'slide', 'Sinov', 'COMPLETED', now() - interval '1 minute')`,
    [gid, uid],
  );
  return gid;
}

async function putAssetRow(gid: string, assetId: string, sizeBytes: number): Promise<void> {
  await query(
    `INSERT INTO generation_assets (generation_id, asset_id, mime, size_bytes, bytes, expires_at) VALUES ($1, $2, 'image/png', $3, '\\x00', NULL)`,
    [gid, assetId, sizeBytes],
  );
}

test("kvota: tizim eskizi (THUMB_ASSET_ID) umumiy hajmga ham, hujjat soniga ham kirmaydi (W2-C)", { skip }, async () => {
  const uid = await newUser();
  const gid = await completedGeneration(uid);
  // Eskiz hujjat tugagandan KEYIN yoziladi (`thumb.ts`) — ilgari «foydalanuvchi yuklamasi» deb sanalardi.
  await putAssetRow(gid, THUMB_ASSET_ID, UPLOAD_QUOTA.totalBytes);
  await putLogo(uid, png(), "image/png"); // MUTATSIYA: eskiz sanalsa — 413

  for (let i = 0; i < UPLOAD_QUOTA.perGeneration - 1; i++) await putAssetRow(gid, hex(), 10);
  await putGenerationUpload(gid, uid, "image/png", png()); // 59 + eskiz + 1 — eskiz sanalsa 413
});
