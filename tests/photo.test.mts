import test from "node:test";
import assert from "node:assert/strict";

/**
 * Rezyume surati (Rezyume 2, 6-band) — SERVER yarmi.
 *
 * `uploadPhoto` autentifikatsiyadan ajratilgan (`logo.test.mts` dagi
 * izoh): route AYNAN shu funksiyani chaqiradi, shuning uchun bu yerdagi
 * sinov haqiqiy kod yo'lini sinaydi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { ApiError } = await import("../lib/server/api.ts");
const { uploadPhoto, PHOTO_MAX_BYTES, PHOTO_CROP_MAX_SIDE } = await import("../lib/server/photo.ts");

function blobPart(b: Buffer): Uint8Array<ArrayBuffer> {
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  return new Uint8Array(ab);
}

/** Haqiqiy o'lchamli PNG sarlavhasi — `imageDims` IHDR dan o'qiydi. */
function png(w: number, h: number, extra = 32): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4);
  ihdr.writeUInt32BE(w, 8);
  ihdr.writeUInt32BE(h, 12);
  return Buffer.concat([sig, ihdr, Buffer.alloc(extra, 1)]);
}
function gif(): Buffer {
  return Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3, 4]);
}

function req(fields: Record<string, File | string | null>, headers: Record<string, string> = {}): Request {
  const fd = new FormData();
  let any = false;
  for (const [k, v] of Object.entries(fields)) {
    if (v === null) continue;
    fd.set(k, v as string | Blob);
    any = true;
  }
  return new Request("http://x/api/uploads/photo", { method: "POST", headers, body: any ? fd : undefined });
}

async function expectApiError(p: Promise<unknown>, status: number) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ApiError, `ApiError kutilgan edi: ${e}`);
    assert.equal((e as InstanceType<typeof ApiError>).status, status);
    return;
  }
  assert.fail(`xato kutilgan edi (${status})`);
}

test("content-length juda katta — tana o'qilmasdan 413", async () => {
  // MUTATSIYA: sarlavha tekshiruvi olib tashlansa, `formData()` bosqichiga
  // o'tib 400 («Fayl yuborilmadi») qaytardi.
  await expectApiError(uploadPhoto(req({}, { "content-length": String(4 * PHOTO_MAX_BYTES) }), "1"), 413);
});

test("fayl 5 MB dan katta — 413", async () => {
  const file = new File([blobPart(png(600, 600, PHOTO_MAX_BYTES))], "p.png", { type: "image/png" });
  await expectApiError(uploadPhoto(req({ file }), "1"), 413);
});

test("PNG nomi bilan kelgan GIF — 415 (bayt bo'yicha sniff)", async () => {
  const file = new File([blobPart(gif())], "photo.png", { type: "image/png" });
  await expectApiError(uploadPhoto(req({ file }), "1"), 415);
});

test("kesilgan nusxa 1200 pikseldan katta — 422", async () => {
  // Klient 600×600 yuboradi; kattasi kelsa bu kesilmagan asl demakdir.
  const file = new File([blobPart(png(PHOTO_CROP_MAX_SIDE + 1, 600))], "p.png", { type: "image/png" });
  await expectApiError(uploadPhoto(req({ file }), "1"), 422);
});

test("fayl yuborilmagan — 400", async () => {
  await expectApiError(uploadPhoto(req({ crop: "{}" }), "1"), 400);
});
