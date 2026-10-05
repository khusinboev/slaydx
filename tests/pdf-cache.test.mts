import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/**
 * C07: o'girilgan PDF keshi (disk, LRU, hajm chegarasi). `?format=pdf`
 * javobi endi `produceDownload` orqali (`download-routes.test.mts`). Konvertor soxta — LibreOffice ishlatilmaydi, baza ham yo'q
 * (per-user 429 — `pdf-limits-db.test.mts`).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { PdfDiskCache, getOrConvertPdf, pdfCacheKey, derivedCacheDir, privateCacheDir } = await import("../lib/server/pdf-cache.ts");
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

/* ─────────────── m5: directory and file hardening ─────────────── */

const mode = async (p: string) => (await stat(p)).mode & 0o777;

test("m5: a directory we create is 0700; a pre-existing one we own is tightened to 0700; entries are 0600", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "slaydx-m5-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const created = join(root, "new", "cache");
  const a = new PdfDiskCache({ dir: created, maxBytes: 1 << 20, maxAgeMs: 60_000 });
  await a.put("k1", Buffer.from("%PDF a"));
  assert.equal(await a.activeDir(), created);
  assert.equal(await mode(created), 0o700);
  const loose = join(root, "loose");
  await mkdir(loose);
  await chmod(loose, 0o777);
  const b = new PdfDiskCache({ dir: loose, maxBytes: 1 << 20, maxAgeMs: 60_000 });
  await b.put("k1", Buffer.from("%PDF b"));
  assert.equal(await b.activeDir(), loose);
  assert.equal(await mode(loose), 0o700, "a Dockerfile-made 0755/0777 mount point is tightened");
  assert.equal(await mode(join(loose, "k1.pdf")), 0o600);
});

test("m5: unusable configured dir (a file, a symlink) or none → a private mkdtemp dir, never a fixed /tmp path", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "slaydx-m5-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const asFile = join(root, "file");
  await writeFile(asFile, "x");
  const realDir = join(root, "real");
  await mkdir(realDir, { mode: 0o700 });
  const link = join(root, "link");
  await symlink(realDir, link);
  const priv = await privateCacheDir();
  assert.notEqual(priv, join(tmpdir(), "slaydx-pdf-cache"));
  assert.match(basename(priv), /^slaydx-derived-[A-Za-z0-9]{6}$/, "mkdtemp: random, unguessable suffix");
  assert.equal(await mode(priv), 0o700);
  for (const [i, dir] of [asFile, link, null].entries()) {
    const c = new PdfDiskCache({ dir, maxBytes: 1 << 20, maxAgeMs: 60_000 });
    const key = `fb-${i}`;
    await c.put(key, Buffer.from("%PDF fb"));
    assert.equal(await c.activeDir(), priv, `${dir} → private dir`);
    assert.ok((await c.get(key))?.equals(Buffer.from("%PDF fb")), "the cache still works");
  }
  assert.deepEqual(await readdir(realDir), [], "nothing was written through the symlinked dir");
  // DERIVED_CACHE_DIR unset → the private dir, not /tmp/slaydx-pdf-cache.
  const prev = process.env.DERIVED_CACHE_DIR;
  delete process.env.DERIVED_CACHE_DIR;
  try {
    assert.equal(derivedCacheDir(), null);
  } finally {
    if (prev !== undefined) process.env.DERIVED_CACHE_DIR = prev;
  }
});

test("m5: a symlink planted under an entry name is never indexed or read (O_NOFOLLOW / lstat)", async (t) => {
  const { dir, cache } = await freshCache(t);
  const secretDir = await mkdtemp(join(tmpdir(), "slaydx-m5-secret-"));
  t.after(() => rm(secretDir, { recursive: true, force: true }));
  const secret = join(secretDir, "secret.txt");
  await writeFile(secret, "MAXFIY");
  // Planted before the first access: init's lstat skips it.
  await symlink(secret, join(dir, "planted.pdf"));
  assert.equal(await cache.size("planted"), null, "not indexed");
  assert.equal(await cache.get("planted"), null);
  // Swapped in after indexing: the O_NOFOLLOW open refuses it and the entry is dropped.
  await cache.put("swap", Buffer.from("%PDF real"));
  await rm(join(dir, "swap.pdf"));
  await symlink(secret, join(dir, "swap.pdf"));
  assert.equal(await cache.get("swap"), null);
  assert.equal(await cache.size("swap"), null, "dropped from the index");
});

/* ─────────────── m1: entries behind a live download link ─────────────── */

test("m1: touch pins an entry — LRU skips it while pinned; only the hard ceiling evicts it", async (t) => {
  const { dir } = await freshCache(t);
  const cache = new PdfDiskCache({ dir, maxBytes: 3000, maxAgeMs: 60_000, pinMs: 60_000, hardMaxBytes: 5000 });
  await cache.put("old", Buffer.alloc(1000, 1));
  assert.equal(await cache.touch("old"), 1000, "touch returns the size");
  assert.equal(await cache.touch("missing"), null);
  await cache.put("b", Buffer.alloc(1000, 2));
  await cache.put("c", Buffer.alloc(1000, 3));
  // "old" is the LRU candidate by insertion, but get() of b and c makes it the least recently used anyway.
  await cache.get("b");
  await cache.get("c");
  await cache.put("d", Buffer.alloc(1000, 4));
  assert.ok(await cache.size("old"), "pinned: survives LRU pressure");
  assert.equal(await cache.size("b"), null, "the unpinned LRU entry went instead");
  // Past the hard ceiling even pinned entries go (oldest first).
  for (const k of ["p1", "p2", "p3", "p4", "p5"]) {
    await cache.put(k, Buffer.alloc(1000, 5));
    await cache.touch(k);
  }
  assert.ok(cache.totalBytes() <= 5000);
  assert.equal(await cache.size("old"), null, "the oldest pinned entry was evicted above the ceiling");
  assert.equal(await cache.size("p5"), 1000, "the entry just written is never its own eviction victim");
});

test("m1: touch refreshes the age (the 24 h limit counts from the last minted link) and an expired pin is evictable", async (t) => {
  const { dir } = await freshCache(t);
  const cache = new PdfDiskCache({ dir, maxBytes: 2000, maxAgeMs: 60_000, pinMs: 30, hardMaxBytes: 10_000 });
  await cache.put("aged", Buffer.alloc(1000, 1));
  const past = (Date.now() - 50_000) / 1000;
  await utimes(join(dir, "aged.pdf"), past, past);
  const reopened = new PdfDiskCache({ dir, maxBytes: 2000, maxAgeMs: 60_000, pinMs: 30, hardMaxBytes: 10_000 });
  assert.equal(await reopened.touch("aged"), 1000);
  assert.ok(Date.now() - (await stat(join(dir, "aged.pdf"))).mtimeMs < 5_000, "mtime refreshed on disk");
  await new Promise((r) => setTimeout(r, 50)); // the 30 ms pin expires
  await reopened.put("x", Buffer.alloc(1000, 2));
  await reopened.put("y", Buffer.alloc(1000, 3));
  assert.equal(await reopened.size("aged"), null, "an expired pin is a normal LRU entry again");
});

