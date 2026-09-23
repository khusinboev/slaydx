import test from "node:test";
import assert from "node:assert/strict";

/**
 * Chunked (sarlavhasiz) yuklama chegaradan oshsa — OQIM paytida 413 (SECB-05).
 *
 * Ilgari logotip, surat, slayd rasmi va rezyume surati faqat
 * `Content-Length` ga ishonardi: `Transfer-Encoding: chunked` so'rovda
 * sarlavha yo'q, tekshiruv o'tib ketar, `req.formData()` esa butun tanani
 * (nginx chegarasigacha) xotiraga yutardi. Endi `readUploadForm` baytlarni
 * sanab o'qiydi va chegaradan oshgan zahoti oqimni bekor qiladi.
 *
 * Har holatda: 413 va oqimdan chegara + bir-ikki bo'lakdan ORTIQ o'qilmaydi.
 * Baza kerak emas — hajm tekshiruvi egalik/kvotadan oldin.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { ApiError } = await import("../lib/server/api.ts");
const { uploadLogo, LOGO_MAX_BYTES } = await import("../lib/server/logo.ts");
const { uploadPhoto, PHOTO_MAX_BYTES } = await import("../lib/server/photo.ts");
const { uploadSlideImage } = await import("../lib/server/slide-image.ts");
const { uploadResumePhoto } = await import("../lib/server/resume-photo-commit.ts");
const { SLIDE_IMAGE_MAX_BYTES } = await import("../lib/generation/slide-limits.ts");

const CHUNK = 64 * 1024;
const TOTAL = 40 * 1024 * 1024;
const GEN = "a1b2c3d4-0000-4000-8000-000000000009";

/** Sarlavhasiz, cheksizga yaqin oqim — qancha bayt tortib olinganini sanaydi. */
function chunkedReq(): { req: Request; pulled: () => number } {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (sent >= TOTAL) return ctrl.close();
      sent += CHUNK;
      ctrl.enqueue(new Uint8Array(CHUNK).fill(0x41));
    },
  });
  const req = new Request("http://x/upload", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=----x" },
    body,
    duplex: "half",
  } as RequestInit);
  assert.equal(req.headers.get("content-length"), null, "sinov sharti: sarlavha yo'q");
  return { req, pulled: () => sent };
}

async function expect413(p: Promise<unknown>, pulled: () => number, cap: number): Promise<void> {
  try {
    await p;
    assert.fail("xato tashlanishi kerak edi");
  } catch (e) {
    assert.ok(e instanceof ApiError, `ApiError kutilgan edi: ${e}`);
    assert.equal((e as InstanceType<typeof ApiError>).status, 413, "MUTATSIYA: chunked tana chegarasiz o'qildi");
  }
  assert.ok(pulled() <= cap + 3 * CHUNK, `oqimdan ${pulled()} bayt o'qildi (chegara ${cap})`);
}

test("logo: chunked 40 MB — 413, oqim 2 MB atrofida to'xtaydi", async () => {
  const { req, pulled } = chunkedReq();
  await expect413(uploadLogo(req, "42"), pulled, LOGO_MAX_BYTES + 64 * 1024);
});

test("photo: chunked 40 MB — 413, oqim ~10 MB da to'xtaydi", async () => {
  const { req, pulled } = chunkedReq();
  await expect413(uploadPhoto(req, "42"), pulled, 2 * PHOTO_MAX_BYTES + 64 * 1024);
});

test("slide-image: chunked 40 MB — 413, oqim ~5 MB da to'xtaydi", async () => {
  const { req, pulled } = chunkedReq();
  await expect413(uploadSlideImage(req, GEN, "42", 1), pulled, SLIDE_IMAGE_MAX_BYTES + 64 * 1024);
});

test("resume photo: chunked 40 MB — 413, oqim ~10 MB da to'xtaydi", async () => {
  const { req, pulled } = chunkedReq();
  await expect413(uploadResumePhoto(req, GEN, "42"), pulled, 2 * SLIDE_IMAGE_MAX_BYTES + 64 * 1024);
});
