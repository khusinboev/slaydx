import test from "node:test";
import assert from "node:assert/strict";

/**
 * SECB-05 (C06): yuklash hajmi tanani O'QISH PAYTIDA cheklanadi.
 *
 * Ilgari chegara faqat `Content-Length` sarlavhasidan olinardi. Chunked
 * so'rovda (sarlavhasiz) `req.formData()` butun tanani xotiraga yutib,
 * keyingina `file.size` bilan «juda katta» derdi. Endi hisoblagich chegara
 * + bir bo'lakdan ortiq o'qimaydi.
 */
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { ApiError } = await import("../lib/server/api.ts");
const { uploadSource, SOURCE_MAX_BYTES } = await import("../lib/server/source-upload.ts");
const { uploadTemplate, TEMPLATE_MAX_BYTES } = await import("../lib/server/template-upload.ts");

const CHUNK = 1024 * 1024;
const BOUNDARY = "----slaydxtest";

/** Sarlavhasiz (chunked) multipart so'rov; `pulled()` — oqimdan qancha bayt olingani. */
function chunkedUpload(url: string, name: string, bytes: number): { req: Request; pulled: () => number } {
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${BOUNDARY}--\r\n`);
  let sent = 0;
  let left = bytes;
  let stage = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      let chunk: Uint8Array;
      if (stage === 0) {
        chunk = head;
        stage = 1;
      } else if (left > 0) {
        const n = Math.min(CHUNK, left);
        chunk = new Uint8Array(n).fill(0x61);
        left -= n;
      } else if (stage === 1) {
        chunk = tail;
        stage = 2;
      } else {
        controller.close();
        return;
      }
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const req = new Request(url, {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    body: stream,
    duplex: "half",
  } as RequestInit);
  return { req, pulled: () => sent };
}

async function expect413(p: Promise<unknown>): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ApiError, String(e));
    assert.equal(e.status, 413);
    return true;
  });
}

test("readUploadForm: chunked tana chegaradan oshsa — 413, ortig'i o'qilmaydi", async () => {
  const { readUploadForm } = await import("../lib/server/upload-body.ts");
  const { req, pulled } = chunkedUpload("http://x/a", "a.txt", 10 * CHUNK);
  await expect413(readUploadForm(req, 2 * CHUNK, "Fayl juda katta"));
  assert.ok(pulled() <= 3 * CHUNK + 1024, `o'qildi: ${pulled()}`);
});

test("readUploadForm: oddiy FormData so'rovi o'zgarishsiz o'qiladi", async () => {
  const { readUploadForm } = await import("../lib/server/upload-body.ts");
  const fd = new FormData();
  fd.set("file", new File([new TextEncoder().encode("salom")], "a.txt"));
  const form = await readUploadForm(new Request("http://x/a", { method: "POST", body: fd }), CHUNK, "katta");
  const file = form?.get("file");
  assert.ok(file instanceof File);
  assert.equal(file.name, "a.txt");
  assert.equal(await file.text(), "salom");
  // Chunked, lekin chegara ichida — ham ishlaydi.
  const small = chunkedUpload("http://x/a", "b.txt", 1000);
  const f2 = (await readUploadForm(small.req, CHUNK, "katta"))?.get("file");
  assert.ok(f2 instanceof File);
  assert.equal(f2.size, 1000);
});

test("uploadSource: Content-Length siz 25 MB — 413, tana to'liq yutilmaydi", async () => {
  const { req, pulled } = chunkedUpload("http://x/api/uploads/source", "a.txt", SOURCE_MAX_BYTES + 5 * CHUNK);
  await expect413(uploadSource(req, "1", { count: async () => ({ chars: 1, text: "x" }) }));
  assert.ok(pulled() <= SOURCE_MAX_BYTES + 64 * 1024 + CHUNK + 1024, `o'qildi: ${pulled()}`);
});

test("uploadSource (haqiqiy DEFAULT_COUNTER, worker thread): 301 sahifali PDF — 422 too-many-pages, saqlanmaydi", async () => {
  const { makeBlankPagesPdf } = await import("./helpers/parse-fixtures.ts");
  const { MAX_PDF_PAGES } = await import("../lib/generation/translate/pdf.ts");
  const fd = new FormData();
  fd.set("file", new File([makeBlankPagesPdf(MAX_PDF_PAGES + 1) as Uint8Array<ArrayBuffer>], "uzun.pdf"));
  const req = new Request("http://x/api/uploads/source", { method: "POST", body: fd });
  await assert.rejects(
    uploadSource(req, "1", { put: async () => { throw new Error("saqlanmasligi kerak"); } }),
    (e: unknown) => {
      assert.ok(e instanceof ApiError, String(e));
      assert.equal(e.status, 422);
      assert.equal(e.extra.code, "too-many-pages");
      assert.match(e.message, /PDF juda uzun/);
      return true;
    },
  );
});

test("uploadTemplate: Content-Length siz 25 MB — 413, tana to'liq yutilmaydi", async () => {
  const { req, pulled } = chunkedUpload("http://x/api/uploads/template", "a.pptx", TEMPLATE_MAX_BYTES + 5 * CHUNK);
  await expect413(uploadTemplate(req, "1", { put: async () => { throw new Error("chaqirilmasligi kerak"); }, rasterize: async () => ({}) }));
  assert.ok(pulled() <= TEMPLATE_MAX_BYTES + 64 * 1024 + CHUNK + 1024, `o'qildi: ${pulled()}`);
});
