import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

/**
 * Ko'ruvchidan rasm yuklash — aktiv va hujjat BITTA tranzaksiyada
 * (SECB-03 qolgan qismi; W2-C nit: rezyume surati juftligi bitta
 * tranzaksiyada).
 *
 * Ilgari `uploadSlideImage`/`uploadResumePhoto` avval `generation_assets`
 * ga yozar, keyin `commitDocOps` versiyani tekshirardi: eskirgan
 * `baseVersion` (409) yoki rasm joyi yo'q maket (422) bazada hech kim
 * ishora qilmaydigan «yetim» aktiv qoldirardi — va u hujjat umri
 * davomida `perGeneration` kvotasini yerdi. Rezyume surati esa kesilgan
 * va asl nusxani IKKI alohida kvota tranzaksiyasida yozardi: ikkinchisi
 * 413 olsa, birinchisi yetim qolardi.
 *
 * HAQIQIY Postgres (throwaway baza) bilan — «rad etildi → hech narsa
 * yozilmadi» bazaning o'zidan tekshiriladi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { ApiError } = await import("../lib/server/api.ts");
const { query, queryOne, pool } = await import("../lib/server/db.ts");
const { toJsonb } = await import("../lib/server/jsonb.ts");
const { uploadSlideImage } = await import("../lib/server/slide-image.ts");
const { uploadResumePhoto } = await import("../lib/server/resume-photo-commit.ts");
const { UPLOAD_QUOTA } = await import("../lib/server/upload-quota.ts");
const { extractMeta } = await import("../lib/generation/meta.ts");
const { docFromResume } = await import("../lib/generation/resume/model.ts");
const { sampleResume } = await import("../lib/generation/resume/samples.ts");
const { TOOL_BY_ID } = await import("../lib/tools.ts");

const users: string[] = [];

after(async () => {
  if (!hasDb) return;
  for (const id of users) await query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
  await pool().end();
});

async function newUser(): Promise<string> {
  const row = await queryOne<{ id: string }>(`INSERT INTO users (username) VALUES ($1) RETURNING id::text AS id`, [
    `w4e_${randomBytes(6).toString("hex")}`,
  ]);
  users.push(row!.id);
  return row!.id;
}

function slideDoc() {
  const meta = extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi", slideTemplate: "lecture" } as never);
  return {
    meta,
    titlePage: true,
    toc: true,
    sections: [],
    slideTemplate: "lecture",
    slides: [
      { id: "s0", layout: "title", title: "Suv aylanishi", subtitle: "Kirish" },
      { id: "s1", layout: "bullets", title: "Bandlar", bullets: ["Bir.", "Ikki."] },
      {
        id: "s2",
        layout: "quiz",
        title: "Nazorat",
        quiz: [{ q: "Bug'lanish qayerda?", options: ["Okeanda", "Bulutda", "Daryoda", "Muzda"], answer: 0 }],
      },
    ],
  };
}

function resumeDoc() {
  const meta = extractMeta(TOOL_BY_ID.resume, { topic: "Moliya tahlilchisi", fullName: "Karimova Dilnoza" } as never);
  return docFromResume(sampleResume("modern", undefined, false), meta);
}

async function newGeneration(uid: string, tool: "slide" | "resume", docVersion = 3): Promise<string> {
  const gid = randomUUID();
  const doc = tool === "slide" ? slideDoc() : resumeDoc();
  await query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status, finished_at, doc_json, doc_version, file_version, file_name)
     VALUES ($1, $2, $3, 'Sinov', 'COMPLETED', now() - interval '1 minute', $4, $5, $5, $6)`,
    [gid, uid, tool, toJsonb(doc), docVersion, tool === "slide" ? "deka.pptx" : "rezyume.docx"],
  );
  return gid;
}

async function assetCount(gid: string): Promise<number> {
  return Number((await queryOne<{ n: string }>(`SELECT count(*) AS n FROM generation_assets WHERE generation_id = $1`, [gid]))!.n);
}

async function docVersion(gid: string): Promise<number> {
  return (await queryOne<{ v: number }>(`SELECT doc_version AS v FROM generations WHERE id = $1`, [gid]))!.v;
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

function file(b: Buffer, name = "rasm.png"): File {
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  return new File([new Uint8Array(ab)], name, { type: "image/png" });
}

function slideReq(gid: string, index: number, baseVersion: number, bytes = png()): Request {
  const fd = new FormData();
  fd.set("file", file(bytes));
  fd.set("baseVersion", String(baseVersion));
  return new Request(`http://x/api/generations/${gid}/slides/${index}/image`, { method: "POST", body: fd });
}

function photoReq(gid: string, baseVersion: number, crop = png(), original: Buffer | null = png()): Request {
  const fd = new FormData();
  fd.set("file", file(crop));
  if (original) fd.set("original", file(original, "asl.png"));
  fd.set("baseVersion", String(baseVersion));
  fd.set("shape", "circle");
  return new Request(`http://x/api/generations/${gid}/photo`, { method: "POST", body: fd });
}

async function expectStatus(p: Promise<unknown>, status: number): Promise<void> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ApiError, `ApiError kutilgan edi: ${e}`);
    assert.equal((e as InstanceType<typeof ApiError>).status, status, (e as Error).message);
    return;
  }
  assert.fail(`${status} kutilgan edi — so'rov o'tib ketdi`);
}

test("slayd rasmi: eskirgan baseVersion (409) — aktiv YOZILMAYDI (SECB-03)", { skip }, async () => {
  const uid = await newUser();
  const gid = await newGeneration(uid, "slide", 3);
  await expectStatus(uploadSlideImage(slideReq(gid, 1, 2), gid, uid, 1), 409);
  assert.equal(await assetCount(gid), 0, "MUTATSIYA: 409 dan keyin yetim aktiv qoldi");
  assert.equal(await docVersion(gid), 3);
});

test("slayd rasmi: rasm joyi yo'q maket (422) — aktiv YOZILMAYDI", { skip }, async () => {
  const uid = await newUser();
  const gid = await newGeneration(uid, "slide", 3);
  await expectStatus(uploadSlideImage(slideReq(gid, 2, 3), gid, uid, 2), 422);
  assert.equal(await assetCount(gid), 0, "MUTATSIYA: 422 dan keyin yetim aktiv qoldi");
});

test("slayd rasmi: begona hujjat (404) — aktiv YOZILMAYDI", { skip }, async () => {
  const owner = await newUser();
  const stranger = await newUser();
  const gid = await newGeneration(owner, "slide", 3);
  await expectStatus(uploadSlideImage(slideReq(gid, 1, 3), gid, stranger, 1), 404);
  assert.equal(await assetCount(gid), 0);
});

test("slayd rasmi: muvaffaqiyat — aktiv + hujjat birga yoziladi, URL shu aktivga", { skip }, async () => {
  const uid = await newUser();
  const gid = await newGeneration(uid, "slide", 3);
  const gen = await uploadSlideImage(slideReq(gid, 1, 3), gid, uid, 1);
  assert.equal(gen.docVersion, 4);
  assert.equal(await assetCount(gid), 1);
  const row = await queryOne<{ url: string; asset_id: string }>(
    `SELECT g.doc_json->'slides'->1->'image'->>'url' AS url, a.asset_id
       FROM generations g JOIN generation_assets a ON a.generation_id = g.id WHERE g.id = $1`,
    [gid],
  );
  assert.equal(row!.url, `/api/generations/${gid}/assets/${row!.asset_id}`);
});

test("slayd rasmi: bir xil baseVersion bilan parallel 2 yuklama — bittasi o'tadi, yetim aktiv YO'Q", { skip }, async () => {
  const uid = await newUser();
  const gid = await newGeneration(uid, "slide", 3);
  const res = await Promise.allSettled([
    uploadSlideImage(slideReq(gid, 1, 3), gid, uid, 1),
    uploadSlideImage(slideReq(gid, 0, 3), gid, uid, 0),
  ]);
  const ok = res.filter((r) => r.status === "fulfilled").length;
  const conflicts = res.filter((r) => r.status === "rejected" && (r.reason as InstanceType<typeof ApiError>).status === 409).length;
  assert.equal(ok, 1);
  assert.equal(conflicts, 1);
  assert.equal(await assetCount(gid), 1, "yutqazgan so'rovning aktivi qolmasligi kerak");
});

test("rezyume surati: eskirgan baseVersion (409) — kesilgan ham, asl ham YOZILMAYDI", { skip }, async () => {
  const uid = await newUser();
  const gid = await newGeneration(uid, "resume", 3);
  await expectStatus(uploadResumePhoto(photoReq(gid, 1), gid, uid), 409);
  assert.equal(await assetCount(gid), 0, "MUTATSIYA: 409 dan keyin yetim surat qoldi");
});

test("rezyume surati: juftlik kvotaga sig'masa — IKKALASI ham yozilmaydi (bitta tranzaksiya, W2-C)", { skip }, async () => {
  const uid = await newUser();
  const gid = await newGeneration(uid, "resume", 3);
  const crop = png(20);
  const orig = png(20);
  // Kesilgan nusxa yolg'iz sig'adi, juftlik esa sig'maydi.
  const room = crop.byteLength + Math.floor(orig.byteLength / 2);
  await query(
    `INSERT INTO source_uploads (user_id, asset_id, name, kind, mime, size_bytes, bytes) VALUES ($1, $2, 'a.txt', 'txt', 'text/plain', $3, '\\x00')`,
    [uid, randomBytes(12).toString("hex"), UPLOAD_QUOTA.totalBytes - room],
  );
  await expectStatus(uploadResumePhoto(photoReq(gid, 3, crop, orig), gid, uid), 413);
  assert.equal(await assetCount(gid), 0, "MUTATSIYA: kesilgan nusxa yetim qoldi");
  assert.equal(await docVersion(gid), 3);
});

test("rezyume surati: muvaffaqiyat — ikkala aktiv va hujjat birga", { skip }, async () => {
  const uid = await newUser();
  const gid = await newGeneration(uid, "resume", 3);
  const gen = await uploadResumePhoto(photoReq(gid, 3), gid, uid);
  assert.equal(gen.docVersion, 4);
  assert.equal(await assetCount(gid), 2);
  const photo = await queryOne<{ asset_id: string; original: string }>(
    `SELECT doc_json->'resume'->'photo'->>'assetId' AS asset_id, doc_json->'resume'->'photo'->>'originalAssetId' AS original
       FROM generations WHERE id = $1`,
    [gid],
  );
  const ids = (await query<{ asset_id: string }>(`SELECT asset_id FROM generation_assets WHERE generation_id = $1`, [gid])).map(
    (r) => r.asset_id,
  );
  assert.ok(ids.includes(photo!.asset_id));
  assert.ok(ids.includes(photo!.original));
});
