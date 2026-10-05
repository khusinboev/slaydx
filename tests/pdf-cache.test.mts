import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * C07: o'girilgan PDF keshi (disk, LRU, hajm chegarasi). `?format=pdf`
 * javobi endi `produceDownload` orqali (`download-routes.test.mts`). Konvertor soxta — LibreOffice ishlatilmaydi, baza ham yo'q
 * (per-user 429 — `pdf-limits-db.test.mts`).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { PdfDiskCache, getOrConvertPdf, pdfCacheKey } = await import("../lib/server/pdf-cache.ts");
const { SofficeBusyError } = await import("../lib/server/soffice-gate.ts");

const GEN = "a1b2c3d4-0000-4000-8000-0000000000c7";

async function freshCache(t: TestContext, maxBytes = 1024 * 1024, maxAgeMs = 60_000) {
  const dir = await mkdtemp(join(tmpdir(), "slaydx-pdfc-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, cache: new PdfDiskCache({ dir, maxBytes, maxAgeMs }) };
}

function countingConverter(delayMs = 0) {
  const calls: string[] = [];
  // Haqiqiy `toPdf` kabi: `beforeRun` — slot olingandan KEYIN chaqiriladi.
  const convert = async (bytes: Uint8Array, name: string, beforeRun?: () => Promise<void>) => {
    await beforeRun?.();
    calls.push(name);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return Buffer.from(`%PDF-1.4 ${Buffer.from(bytes).toString("hex")}`);
  };
  return { calls, convert };
}

test("kesh kaliti: generatsiya id + fayl mazmuni hashi", () => {
  const a = pdfCacheKey(GEN, new Uint8Array([1, 2, 3]));
  assert.equal(a, pdfCacheKey(GEN, new Uint8Array([1, 2, 3])));
  assert.notEqual(a, pdfCacheKey(GEN, new Uint8Array([1, 2, 4])), "fayl o'zgarsa — yangi kalit");
  assert.notEqual(a, pdfCacheKey("b1b2c3d4-0000-4000-8000-0000000000c7", new Uint8Array([1, 2, 3])));
  assert.match(a, /^[0-9a-f-]+$/, "fayl nomiga xavfsiz");
});

test("kesh: ikkinchi so'rov o'girishni chaqirmaydi (keshdan)", async (t) => {
  const { cache } = await freshCache(t);
  const { calls, convert } = countingConverter();
  const bytes = new Uint8Array([9, 8, 7]);
  const first = await getOrConvertPdf({ generationId: GEN, bytes, fileName: "a.docx", convert, cache });
  const second = await getOrConvertPdf({ generationId: GEN, bytes, fileName: "a.docx", convert, cache });
  assert.equal(calls.length, 1, "soffice faqat bir marta");
  assert.ok(first && second && first.equals(second));

  // Yangi jarayon (bo'sh xotira indeksi) ham diskdagi faylni topadi.
  const reopened = new PdfDiskCache({ dir: (cache as unknown as { opts: { dir: string } }).opts.dir, maxBytes: 1024 * 1024, maxAgeMs: 60_000 });
  const third = await getOrConvertPdf({ generationId: GEN, bytes, fileName: "a.docx", convert, cache: reopened });
  assert.equal(calls.length, 1);
  assert.ok(third?.equals(first!));

  // Fayl o'zgardi (tahrir) — qayta o'giriladi.
  await getOrConvertPdf({ generationId: GEN, bytes: new Uint8Array([9, 8, 6]), fileName: "a.docx", convert, cache });
  assert.equal(calls.length, 2);
});

test("kesh: bir xil faylga parallel so'rovlar — bitta o'girish (single-flight), limit bir marta", async (t) => {
  const { cache } = await freshCache(t);
  const { calls, convert } = countingConverter(80);
  let charged = 0;
  const beforeConvert = async () => {
    charged += 1;
  };
  const bytes = new Uint8Array([5, 5, 5]);
  const outs = await Promise.all(
    Array.from({ length: 5 }, () => getOrConvertPdf({ generationId: GEN, bytes, fileName: "a.docx", convert, cache, beforeConvert })),
  );
  assert.equal(calls.length, 1);
  assert.equal(charged, 1, "limit faqat haqiqiy o'girish uchun");
  assert.ok(outs.every((o) => o?.equals(outs[0]!)));
  // Keshdan berilganda limit sarflanmaydi.
  await getOrConvertPdf({ generationId: GEN, bytes, fileName: "a.docx", convert, cache, beforeConvert });
  assert.equal(charged, 1);
});

test("kesh: LRU — hajm chegarasidan oshsa eng eski o'chadi; yozuv atomar (.tmp qolmaydi)", async (t) => {
  const { dir, cache } = await freshCache(t, 3000);
  const pdf = (n: number) => Buffer.alloc(1000, n);
  await cache.put("k1", pdf(1));
  await cache.put("k2", pdf(2));
  await cache.put("k3", pdf(3));
  assert.ok(await cache.get("k1"), "k1 ishlatildi — endi eng yangi");
  await cache.put("k4", pdf(4));
  assert.equal(await cache.get("k2"), null, "eng kam ishlatilgan (k2) chiqarildi");
  assert.ok(await cache.get("k1"));
  assert.ok(await cache.get("k3"));
  assert.ok(await cache.get("k4"));
  const files = await readdir(dir);
  assert.equal(files.filter((f) => f.endsWith(".tmp")).length, 0);
  assert.equal(files.filter((f) => f.endsWith(".pdf")).length, 3);
  assert.ok(cache.totalBytes() <= 3000);

  // Chegaradan katta bitta PDF keshlanmaydi (boshqalarni haydab chiqarmaydi).
  await cache.put("big", Buffer.alloc(2500, 9));
  assert.equal(await cache.get("big"), null);
  assert.ok(await cache.get("k4"));
});

test("kesh: muddati o'tgan yozuv va yarim yozilgan .tmp tashlanadi", async (t) => {
  const { dir } = await freshCache(t);
  await writeFile(join(dir, "yarim.123.tmp"), "x");
  const cache = new PdfDiskCache({ dir, maxBytes: 1024 * 1024, maxAgeMs: 50 });
  await cache.put("old", Buffer.from("%PDF old"));
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(await cache.get("old"), null, "24 soatlik muddat (bu yerda 50 ms)");
  const files = await readdir(dir);
  assert.deepEqual(files.filter((f) => f.endsWith(".tmp")), []);
});

test("kesh: hamma slot band — SofficeBusyError chaqiruvchiga o'tadi, limit SARFLANMAYDI (R2), hech narsa keshlanmaydi", async (t) => {
  const { cache } = await freshCache(t);
  // Haqiqiy `toPdf` kabi: slot olinmadi → `beforeRun` hech qachon chaqirilmaydi.
  const convert = async () => {
    throw new SofficeBusyError(15);
  };
  let charged = 0;
  const bytes = new Uint8Array([2, 2, 2]);
  await assert.rejects(
    getOrConvertPdf({ generationId: GEN, bytes, fileName: "a.docx", convert, cache, beforeConvert: async () => void (charged += 1) }),
    (e: unknown) => e instanceof SofficeBusyError && e.retryAfterSec === 15,
  );
  assert.equal(charged, 0, "503 (Retry-After) ga amal qilgan foydalanuvchi kvotasi yonmasligi kerak");
  assert.equal(await cache.get(pdfCacheKey(GEN, bytes)), null);
});

