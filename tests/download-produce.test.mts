import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Download producers (docs/mobile/PLAN.md §4.1–4.2): every registry format id
 * has a producer, each produces DIFFERENT bytes with the registry's type and
 * extension, the server offers exactly what `formatById` offers, ownership is
 * SQL, derived files are cached by {gen, sha(bytes), format}. LibreOffice and
 * pdftoppm are stubbed except in the gated real-conversion test.
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL ||= "postgres://unused/unused";

const { DOWNLOAD_FORMAT_IDS, downloadFormats, downloadSubject, formatById } = await import("../lib/downloads/formats.ts");
const { PRODUCERS, glossaryCsv, transcriptText, baseName, SLIDES_PNG_DPI } = await import("../lib/server/downloads/producers.ts");
const { PDF_TIMEOUT_MS } = await import("../lib/server/pdf.ts");

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test("registry ↔ producers: every registry id has exactly one producer and nothing else", () => {
  assert.deepEqual(Object.keys(PRODUCERS).sort(), [...DOWNLOAD_FORMAT_IDS].sort());
  for (const id of DOWNLOAD_FORMAT_IDS) {
    assert.equal(typeof PRODUCERS[id].produce, "function", id);
    assert.equal(typeof PRODUCERS[id].fileName, "function", id);
  }
});

test("soffice timeout and the link budget stay under nginx's proxy_read_timeout (no 504 HTML page)", async () => {
  const conf = readFileSync(new URL("../deploy/nginx/slaydx.conf.example", import.meta.url), "utf8");
  // The server-level default (the first one) applies to /api/generations/{id}/download.
  const nginxSec = Number(/proxy_read_timeout\s+(\d+)s;/.exec(conf)?.[1]);
  assert.equal(nginxSec, 60);
  assert.ok(PDF_TIMEOUT_MS <= 50_000, `PDF_TIMEOUT_MS=${PDF_TIMEOUT_MS}`);
  assert.ok(PDF_TIMEOUT_MS < nginxSec * 1000);
  // The token route never relies on a longer proxy window: its regeneration budget is under the default…
  const { LINK_BUDGET_MS } = await import("../lib/server/downloads/produce.ts");
  assert.ok(LINK_BUDGET_MS < 50_000, `LINK_BUDGET_MS=${LINK_BUDGET_MS}`);
  // …and /api/dl/ gets 120 s for streaming large files to slow phones (m1).
  const dlBlock = /location \/api\/dl\/ \{([^}]*)\}/.exec(conf)?.[1] ?? "";
  assert.match(dlBlock, /proxy_pass http:\/\/127\.0\.0\.1:3000;/);
  assert.match(dlBlock, /proxy_read_timeout 120s;/);
  assert.match(dlBlock, /proxy_cache off;/);
});

test("pure serializers: glossary CSV (BOM, CRLF, optional columns, formula escape) and transcript", () => {
  const csv = glossaryCsv([
    { term: "Fotosintez", def: "Yorug'lik energiyasi hisobiga organik modda hosil bo'lishi", example: "Barg", ru: "Фотосинтез", en: "Photosynthesis" },
    { term: "=HYPERLINK(1)", def: 'Qo\'shtirnoq "bor"' },
  ]);
  assert.ok(csv.startsWith("\uFEFF"), "BOM for Excel");
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[0], '"Atama","Ta’rif","Misol","Ruscha","Inglizcha"');
  assert.equal(lines[1], `"Fotosintez","Yorug'lik energiyasi hisobiga organik modda hosil bo'lishi","Barg","Фотосинтез","Photosynthesis"`);
  assert.equal(lines[2], `"'=HYPERLINK(1)","Qo'shtirnoq ""bor""","","",""`);
  assert.equal(glossaryCsv([{ term: "A", def: "B" }]).slice(1).split("\r\n")[0], '"Atama","Ta’rif"', "no empty columns");

  const doc = {
    meta: { topic: "Suv aylanishi" },
    sections: [],
    audio: { script: [{ speaker: "A", text: "Salom!" }, { speaker: "B", text: "Assalomu alaykum." }] },
  } as never;
  assert.equal(transcriptText(doc), "Suv aylanishi\n\nA: Salom!\n\nB: Assalomu alaykum.\n");
  const mono = { meta: { topic: "" }, sections: [], audio: { script: [{ speaker: "A", text: "Tabriklayman" }] } } as never;
  assert.equal(transcriptText(mono), "Tabriklayman\n", "single voice: no speaker labels");
  assert.equal(baseName("Fotosintez.pptx"), "Fotosintez");
  assert.equal(baseName(null), "fayl");
});

test("producers (Postgres)", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { putGenerationFile } = await import("../lib/server/storage.ts");
  const { createGameSession, addResult } = await import("../lib/server/game-sessions.ts");
  const { DerivedDiskCache } = await import("../lib/server/pdf-cache.ts");
  const { produceWith, produceDownload, peekWith, prepareDownload } = await import("../lib/server/downloads/produce.ts");
  const { isDownloadError } = await import("../lib/server/downloads/errors.ts");
  const sharp = (await import("sharp")).default;
  const JSZip = (await import("jszip")).default;

  // The exact public signature package B imports (compile-time check).
  const signature: (
    genId: string,
    userId: string,
    format: import("../lib/downloads/formats.ts").DownloadFormatId,
    opts?: { signal?: AbortSignal },
  ) => Promise<{ bytes: Buffer; fileName: string; mime: string; fileVersion: number }> = produceDownload;
  assert.equal(typeof signature, "function");

  await migrate();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const mkUser = async (tag: string) =>
    String(
      (
        await query<{ id: string }>(`INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 0) RETURNING id`, [
          `test-dl-${tag}-${stamp}`,
        ])
      )[0].id,
    );
  const user = await mkUser("a");
  const other = await mkUser("b");
  const cacheDir = await mkdtemp(join(tmpdir(), "slaydx-dlp-"));
  t.after(async () => {
    await query("DELETE FROM generations WHERE user_id IN ($1, $2)", [user, other]);
    await query("DELETE FROM users WHERE id IN ($1, $2)", [user, other]);
    await rm(cacheDir, { recursive: true, force: true });
    await pool().end();
  });

  const png = await sharp({ create: { width: 64, height: 40, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 0.5 } } }).png().toBuffer();
  const pagePng = (n: number) =>
    sharp({ create: { width: 20, height: 10, channels: 3, background: { r: n * 40, g: 0, b: 0 } } })
      .png()
      .toBuffer();

  type Counters = { convert: number; raster: number; jpeg: number };
  const stubDeps = (counters: Counters, cache = new DerivedDiskCache({ dir: cacheDir, maxBytes: 64 << 20, maxAgeMs: 60_000 })) => ({
    pdfAvailable: () => true,
    rasterAvailable: () => true,
    cache,
    ensureFresh: async () => {},
    pdfLimit: async () => {},
    rasterLimit: async () => {},
    convertPdf: async (bytes: Uint8Array, _name: string, beforeRun?: () => Promise<void>) => {
      await beforeRun?.();
      counters.convert += 1;
      return Buffer.from(`%PDF-1.4 stub ${Buffer.from(bytes).toString("hex").slice(0, 32)}`);
    },
    rasterize: async (pdf: Buffer, dpi: number) => {
      counters.raster += 1;
      assert.equal(dpi, SLIDES_PNG_DPI);
      assert.ok(pdf.subarray(0, 5).toString() === "%PDF-");
      return Promise.all([1, 2, 3].map(pagePng));
    },
  });

  const mkGen = async (opts: {
    owner?: string;
    tool: string;
    format: string;
    mime: string;
    fileName: string;
    bytes: Uint8Array;
    doc?: unknown;
    status?: string;
  }): Promise<string> => {
    const id = randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, price, format, values_json, doc_json, step, budget_ms, status, expires_at)
       VALUES ($1, $2, $3, 'Sinov', 100, $4, '{}'::jsonb, $5::jsonb, 'x', 90000, $6, now() + interval '1 day')`,
      [id, opts.owner ?? user, opts.tool, opts.format, opts.doc === undefined ? null : JSON.stringify(opts.doc), opts.status ?? "COMPLETED"],
    );
    await putGenerationFile(id, { bytes: opts.bytes, mime: opts.mime, fileName: opts.fileName });
    return id;
  };

  const meta = { topic: "Fotosintez", toolId: "x", language: "uz" };
  const fixtures = {
    slide: await mkGen({ tool: "slide", format: "pptx", mime: PPTX, fileName: "Fotosintez ʻjarayoni.pptx", bytes: Buffer.from("pptx-bytes-1") }),
    essay: await mkGen({ tool: "essay", format: "docx", mime: DOCX, fileName: "Insho.docx", bytes: Buffer.from("docx-bytes-1") }),
    glossary: await mkGen({
      tool: "glossary",
      format: "docx",
      mime: DOCX,
      fileName: "Lugat.docx",
      bytes: Buffer.from("docx-bytes-glossary"),
      doc: { meta: { ...meta, toolId: "glossary" }, sections: [], teacher: { v: 1, kind: "glossary", glossary: { terms: [{ term: "Xlorofill", def: "Yashil pigment" }], order: "source" } } },
    }),
    image: await mkGen({ tool: "image", format: "png", mime: "image/png", fileName: "Rasm.png", bytes: png }),
    podcast: await mkGen({
      tool: "podcast",
      format: "mp3",
      mime: "audio/mpeg",
      fileName: "Podkast.mp3",
      bytes: Buffer.from("ID3-mp3-bytes"),
      doc: { meta: { ...meta, toolId: "podcast" }, sections: [], audio: { v: 1, kind: "podcast", type: "t", language: "uz", script: [{ speaker: "A", text: "Bugun fotosintez haqida gaplashamiz." }] } },
    }),
    sorting: await mkGen({ tool: "sorting", format: "docx", mime: DOCX, fileName: "Saralash.docx", bytes: Buffer.from("docx-bytes-sorting") }),
  };
  const session = await createGameSession(fixtures.sorting, user, "sorting");
  assert.ok(session);
  await addResult({ sessionId: session!.id, playerName: "Zulfiya", score: 7, total: 10, seconds: 42, answers: {} });

  await t.test("every registry id is offered by some fixture and produced: different bytes, registry mime, right extension", async () => {
    const counters = { convert: 0, raster: 0, jpeg: 0 };
    const deps = stubDeps(counters);
    const covered = new Set<string>();
    for (const [name, id] of Object.entries(fixtures)) {
      const row = await query<{ tool_id: string; format: string; doc_json: never }>(`SELECT tool_id, format, doc_json FROM generations WHERE id = $1`, [id]);
      const subject = downloadSubject(
        { type: row[0].tool_id, format: row[0].format, doc: row[0].doc_json },
        { hasResults: name === "sorting" },
      );
      const offered = downloadFormats(subject, { pdf: true });
      const outs: Buffer[] = [];
      for (const f of offered) {
        const out = await produceWith(id, user, f.id, { ensureFresh: true }, deps);
        covered.add(f.id);
        const expectedMime = f.id === "native" ? (await query<{ mime: string }>(`SELECT mime FROM generation_files WHERE generation_id = $1`, [id]))[0].mime : f.mime;
        assert.equal(out.mime, expectedMime, `${name}/${f.id} mime`);
        assert.ok(out.fileName.endsWith(`.${f.ext}`), `${name}/${f.id}: ${out.fileName} ends with .${f.ext}`);
        assert.ok(out.bytes.byteLength > 0);
        assert.equal(out.fileVersion, 0);
        for (const prev of outs) assert.ok(!prev.equals(out.bytes), `${name}/${f.id} differs from the other formats`);
        outs.push(out.bytes);
      }
    }
    assert.deepEqual([...covered].sort(), [...DOWNLOAD_FORMAT_IDS].sort(), "every registry id was produced by a fixture");
  });

  await t.test("content of each derived format", async () => {
    const counters = { convert: 0, raster: 0, jpeg: 0 };
    const deps = stubDeps(counters);
    const native = await produceWith(fixtures.slide, user, "native", { ensureFresh: false }, deps);
    assert.equal(native.bytes.toString(), "pptx-bytes-1");
    assert.equal(native.fileName, "Fotosintez ʻjarayoni.pptx");

    const pdf = await produceWith(fixtures.slide, user, "pdf", { ensureFresh: false }, deps);
    assert.equal(pdf.bytes.subarray(0, 5).toString(), "%PDF-");
    assert.equal(pdf.fileName, "Fotosintez ʻjarayoni.pdf");

    const zip = await produceWith(fixtures.slide, user, "slides-png", { ensureFresh: false }, deps);
    const z = await JSZip.loadAsync(zip.bytes);
    assert.deepEqual(Object.keys(z.files), ["slayd-01.png", "slayd-02.png", "slayd-03.png"]);
    const first = await z.file("slayd-02.png")!.async("nodebuffer");
    assert.ok(first.equals(await pagePng(2)), "pages kept in order");
    assert.equal(zip.fileName, "Fotosintez ʻjarayoni-slaydlar.zip");

    const jpg = await produceWith(fixtures.image, user, "jpg", { ensureFresh: false }, deps);
    assert.deepEqual([...jpg.bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], "JPEG magic");
    const m = await sharp(jpg.bytes).metadata();
    assert.equal(m.format, "jpeg");
    assert.equal(m.width, 64);
    assert.equal(m.height, 40);
    // Transparent PNG pixels are flattened onto white, not black.
    const { data } = await sharp(jpg.bytes).raw().toBuffer({ resolveWithObject: true });
    assert.ok(data[0] > 200 && data[1] > 100, `flattened on white (got ${data[0]},${data[1]},${data[2]})`);

    const txt = await produceWith(fixtures.podcast, user, "transcript-txt", { ensureFresh: false }, deps);
    assert.equal(txt.bytes.toString("utf8"), "Fotosintez\n\nBugun fotosintez haqida gaplashamiz.\n");
    assert.equal(txt.fileName, "Podkast-matn.txt");

    const gcsv = await produceWith(fixtures.glossary, user, "glossary-csv", { ensureFresh: false }, deps);
    assert.equal(gcsv.bytes.toString("utf8"), '\uFEFF"Atama","Ta’rif"\r\n"Xlorofill","Yashil pigment"\r\n');

    const rcsv = await produceWith(fixtures.sorting, user, "results-csv", { ensureFresh: false }, deps);
    const rtext = rcsv.bytes.toString("utf8");
    assert.ok(rtext.startsWith('\uFEFF"Ism","Ball","Jami","Foiz","Soniya","Sana"\r\n'), rtext.slice(0, 60));
    assert.match(rtext, /"Zulfiya","7","10","70","42","\d{4}-\d\d-\d\d \d\d:\d\d"\r\n$/);
  });

  await t.test("derived cache: second request converts nothing; new bytes → new conversion; peek never converts", async () => {
    const counters = { convert: 0, raster: 0, jpeg: 0 };
    const cache = new DerivedDiskCache({ dir: await mkdtemp(join(tmpdir(), "slaydx-dlp2-")), maxBytes: 64 << 20, maxAgeMs: 60_000 });
    const deps = stubDeps(counters, cache);
    const id = await mkGen({ tool: "slide", format: "pptx", mime: PPTX, fileName: "K.pptx", bytes: Buffer.from("cache-v1") });

    const peek0 = await peekWith(id, user, "pdf", { ensureFresh: false }, deps);
    assert.equal(peek0.size, null, "not converted yet");
    assert.equal(counters.convert, 0, "peek does not convert");

    const a = await produceWith(id, user, "pdf", { ensureFresh: false }, deps);
    const b = await produceWith(id, user, "pdf", { ensureFresh: false }, deps);
    assert.equal(counters.convert, 1);
    assert.ok(a.bytes.equals(b.bytes));
    assert.equal((await peekWith(id, user, "pdf", { ensureFresh: false }, deps)).size, a.bytes.byteLength);

    // slides-png reuses the cached PDF (no second soffice) and is cached itself.
    await produceWith(id, user, "slides-png", { ensureFresh: false }, deps);
    await produceWith(id, user, "slides-png", { ensureFresh: false }, deps);
    assert.equal(counters.convert, 1);
    assert.equal(counters.raster, 1);

    // Same generation, new bytes (rebuild after an edit): never the old PDF.
    await putGenerationFile(id, { bytes: Buffer.from("cache-v2"), mime: PPTX, fileName: "K.pptx" });
    const c = await produceWith(id, user, "pdf", { ensureFresh: false }, deps);
    assert.equal(counters.convert, 2);
    assert.ok(!c.bytes.equals(a.bytes));
  });

  await t.test("validation: unknown/unsupported/unavailable formats, ownership, not ready", async () => {
    const deps = stubDeps({ convert: 0, raster: 0, jpeg: 0 });
    const code = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (e) {
        assert.ok(isDownloadError(e), String(e));
        return `${e.code}:${e.status}`;
      }
      return "ok";
    };
    assert.equal(await code(produceWith(fixtures.slide, user, "exe", { ensureFresh: false }, deps)), "unknown_format:400");
    assert.equal(await code(produceWith(fixtures.essay, user, "slides-png", { ensureFresh: false }, deps)), "unsupported:400");
    assert.equal(await code(produceWith(fixtures.slide, user, "jpg", { ensureFresh: false }, deps)), "unsupported:400");
    assert.equal(await code(produceWith(fixtures.image, user, "pdf", { ensureFresh: false }, deps)), "unsupported:400");
    assert.equal(await code(produceWith(fixtures.essay, user, "glossary-csv", { ensureFresh: false }, deps)), "unsupported:400");
    assert.equal(await code(produceWith(fixtures.essay, user, "transcript-txt", { ensureFresh: false }, deps)), "unsupported:400");
    // Sorting without any result: no results CSV.
    const empty = await mkGen({ tool: "sorting", format: "docx", mime: DOCX, fileName: "S.docx", bytes: Buffer.from("s") });
    assert.equal(await code(produceWith(empty, user, "results-csv", { ensureFresh: false }, deps)), "unsupported:400");
    // Results of the sorting game belong to its owner only.
    assert.equal(await code(produceWith(fixtures.sorting, other, "results-csv", { ensureFresh: false }, deps)), "not_found:404");

    // LibreOffice / pdftoppm missing → 503, not "unsupported".
    assert.equal(await code(produceWith(fixtures.slide, user, "pdf", { ensureFresh: false }, { ...deps, pdfAvailable: () => false })), "unavailable:503");
    assert.equal(await code(produceWith(fixtures.slide, user, "slides-png", { ensureFresh: false }, { ...deps, rasterAvailable: () => false })), "unavailable:503");
    const unavailable = await produceWith(fixtures.slide, user, "pdf", { ensureFresh: false }, { ...deps, pdfAvailable: () => false }).catch((e: unknown) => e);
    assert.ok(isDownloadError(unavailable) && unavailable.retryAfterSec === 30, "every 503 carries Retry-After");

    // Ownership in SQL: another user's id, a random id, a malformed id.
    assert.equal(await code(produceWith(fixtures.slide, other, "native", { ensureFresh: false }, deps)), "not_found:404");
    assert.equal(await code(produceWith(randomUUID(), user, "native", { ensureFresh: false }, deps)), "not_found:404");
    assert.equal(await code(produceWith("../etc/passwd", user, "native", { ensureFresh: false }, deps)), "not_found:404");

    const queued = await mkGen({ tool: "slide", format: "pptx", mime: PPTX, fileName: "Q.pptx", bytes: Buffer.from("q"), status: "IN_PROGRESS" });
    assert.equal(await code(produceWith(queued, user, "native", { ensureFresh: false }, deps)), "not_ready:409");

    // Converter failure and a busy LibreOffice gate.
    const failing = { ...deps, convertPdf: async () => null, cache: new DerivedDiskCache({ dir: await mkdtemp(join(tmpdir(), "slaydx-dlp3-")), maxBytes: 1 << 20, maxAgeMs: 60_000 }) };
    assert.equal(await code(produceWith(fixtures.essay, user, "pdf", { ensureFresh: false }, failing)), "failed:502");
    const { SofficeBusyError } = await import("../lib/server/soffice-gate.ts");
    const busy = {
      ...failing,
      convertPdf: async () => {
        throw new SofficeBusyError(15);
      },
    };
    const err = await produceWith(fixtures.essay, user, "pdf", { ensureFresh: false }, busy).catch((e: unknown) => e);
    assert.ok(isDownloadError(err));
    assert.equal(err.code, "busy");
    assert.equal(err.status, 503);
    assert.equal(err.retryAfterSec, 15);
  });

  await t.test("token mode: exact file_version and a current file, else stale (410)", async () => {
    const deps = stubDeps({ convert: 0, raster: 0, jpeg: 0 });
    const id = await mkGen({ tool: "slide", format: "pptx", mime: PPTX, fileName: "V.pptx", bytes: Buffer.from("v") });
    assert.equal((await produceWith(id, user, "native", { ensureFresh: false, expectVersion: 0 }, deps)).fileVersion, 0);
    const err1 = await produceWith(id, user, "native", { ensureFresh: false, expectVersion: 1 }, deps).catch((e: unknown) => e);
    assert.ok(isDownloadError(err1) && err1.code === "stale" && err1.status === 410);
    // Edited in the viewer, not rebuilt yet: the stored file no longer matches what the user sees.
    await query(`UPDATE generations SET doc_version = 1 WHERE id = $1`, [id]);
    const err2 = await peekWith(id, user, "native", { ensureFresh: false, expectVersion: 0 }, deps).catch((e: unknown) => e);
    assert.ok(isDownloadError(err2) && err2.code === "stale", String(err2));
    // A non-editable tool (no adapter) with doc_version ahead is NOT stale — nothing could rebuild it.
    const img = await mkGen({ tool: "image", format: "png", mime: "image/png", fileName: "R.png", bytes: png });
    await query(`UPDATE generations SET doc_version = 2 WHERE id = $1`, [img]);
    assert.equal((await produceWith(img, user, "native", { ensureFresh: false, expectVersion: 0 }, deps)).fileVersion, 0);
  });

  await t.test("ensureFresh is called before producing (stale files are rebuilt, never served)", async () => {
    const calls: string[] = [];
    const deps = { ...stubDeps({ convert: 0, raster: 0, jpeg: 0 }), ensureFresh: async (g: string, u: string) => void calls.push(`${g}:${u}`) };
    await produceWith(fixtures.slide, user, "native", { ensureFresh: true }, deps);
    assert.deepEqual(calls, [`${fixtures.slide}:${user}`]);
    await produceWith(fixtures.slide, user, "native", { ensureFresh: false }, deps);
    assert.equal(calls.length, 1);
  });

  await t.test("abort signal stops waiting", async () => {
    const ac = new AbortController();
    ac.abort();
    const deps = stubDeps({ convert: 0, raster: 0, jpeg: 0 });
    await assert.rejects(produceWith(fixtures.slide, user, "native", { ensureFresh: false }, deps, ac.signal));
  });

  await t.test("prepare: stored and instant formats are ready at once; size matches the produced bytes", async () => {
    const deps = { ...stubDeps({ convert: 0, raster: 0, jpeg: 0 }), prepareBudgetMs: 50 };
    const r = await prepareDownload(fixtures.slide, user, "native", deps);
    assert.deepEqual(r, { state: "ready", fileName: "Fotosintez ʻjarayoni.pptx", size: Buffer.from("pptx-bytes-1").byteLength, mime: PPTX, fileVersion: 0 });
    const g = await prepareDownload(fixtures.glossary, user, "glossary-csv", deps);
    assert.equal(g.state, "ready");
    assert.equal(g.state === "ready" && g.size, Buffer.byteLength('\uFEFF"Atama","Ta’rif"\r\n"Xlorofill","Yashil pigment"\r\n'));
  });

  await t.test("prepare: `ready` for a derived file always means it is in the cache now (no stale job memo)", async () => {
    const counters = { convert: 0, raster: 0, jpeg: 0 };
    const mkCache = async () => new DerivedDiskCache({ dir: await mkdtemp(join(tmpdir(), "slaydx-dlp-memo-")), maxBytes: 64 << 20, maxAgeMs: 60_000 });
    const id = await mkGen({ tool: "slide", format: "pptx", mime: PPTX, fileName: "M.pptx", bytes: Buffer.from("memo") });
    const first = await prepareDownload(id, user, "pdf", { ...stubDeps(counters, await mkCache()), prepareBudgetMs: 2_000 });
    assert.equal(first.state, "ready");
    assert.equal(counters.convert, 1);
    // The cache lost the file (eviction, new container without the volume): convert again.
    const cache2 = await mkCache();
    const second = await prepareDownload(id, user, "pdf", { ...stubDeps(counters, cache2), prepareBudgetMs: 2_000 });
    assert.equal(second.state, "ready");
    assert.equal(counters.convert, 2);
    const { derivedCacheKey } = await import("../lib/server/pdf-cache.ts");
    assert.ok((await cache2.size(derivedCacheKey(id, Buffer.from("memo")), "pdf")) !== null);
  });

  const soffice = ["/usr/bin/soffice", "/usr/bin/libreoffice", "/usr/local/bin/soffice"].some((p) => existsSync(p));
  const pdftoppm = ["/usr/bin/pdftoppm", "/usr/local/bin/pdftoppm"].some((p) => existsSync(p));
  await t.test(
    "real LibreOffice + pdftoppm: PPTX → PDF → one 150 dpi PNG per slide",
    { skip: soffice && pdftoppm ? false : "LibreOffice/pdftoppm yo'q" },
    async (tt: TestContext) => {
      const { makePptx } = await import("./helpers/office-fixtures.ts");
      const pptx = await makePptx();
      const slides = Object.keys((await JSZip.loadAsync(pptx)).files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length;
      const id = await mkGen({ tool: "slide", format: "pptx", mime: PPTX, fileName: "Real.pptx", bytes: pptx });
      const dir = await mkdtemp(join(tmpdir(), "slaydx-dlp-real-"));
      tt.after(() => rm(dir, { recursive: true, force: true }));
      const deps = {
        cache: new DerivedDiskCache({ dir, maxBytes: 256 << 20, maxAgeMs: 60_000 }),
        ensureFresh: async () => {},
        pdfLimit: async () => {},
        rasterLimit: async () => {},
      };
      const pdf = await produceWith(id, user, "pdf", { ensureFresh: false }, deps);
      assert.equal(pdf.bytes.subarray(0, 5).toString(), "%PDF-");
      const zip = await produceWith(id, user, "slides-png", { ensureFresh: false }, deps);
      const z = await JSZip.loadAsync(zip.bytes);
      const names = Object.keys(z.files);
      assert.equal(names.length, slides, `${names.length} PNG for ${slides} slides`);
      const m = await sharp(await z.file(names[0])!.async("nodebuffer")).metadata();
      assert.equal(m.format, "png");
      // 13.333 in wide slide at 150 dpi.
      assert.ok(Math.abs((m.width ?? 0) - 2000) <= 2, `width ${m.width}`);
    },
  );
});

test("registry sanity used by the fixtures: formatById mirrors downloadFormats", () => {
  const s = { type: "slide", format: "pptx" };
  assert.equal(formatById(s, { pdf: true }, "slides-png")?.mime, "application/zip");
  assert.equal(formatById(s, { pdf: false }, "slides-png"), null);
});
