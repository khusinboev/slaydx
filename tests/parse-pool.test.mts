import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { extractFromBuffer } from "../lib/extract-text.ts";
import { parsePptxTemplate, TemplateError } from "../lib/generation/pptx-template.ts";
import { createParsePool, ParsePoolError, resolveParseWorkerEntry } from "../lib/server/parse-pool.ts";
import { makeTextbookPdf, makeZip, templateEntries } from "./helpers/parse-fixtures.ts";

/**
 * CONC-09 (C06): foydalanuvchi faylini tahlil qilish web jarayonining
 * event loop'ida EMAS, alohida `worker_threads` workerida — devor soati
 * bo'yicha timeout (`terminate`), old-gen xotira chegarasi va kichik
 * navbat bilan.
 *
 * `pdf.js` ning «soxta worker»i faqat microtask orqali «bo'shatadi», ya'ni
 * bir xil thread ichidagi `Promise.race`/`destroy()` uni TO'XTATA OLMAYDI —
 * faqat `worker.terminate()`. Shu testlar aynan shuni isbotlaydi.
 */

const dir = await mkdtemp(join(tmpdir(), "slaydx-parse-pool-"));
const stuck = join(dir, "stuck.mjs");
await writeFile(stuck, 'import { parentPort } from "node:worker_threads";\nparentPort.once("message", () => { for (;;) {} });\n');
const hog = join(dir, "hog.mjs");
await writeFile(
  hog,
  'import { parentPort } from "node:worker_threads";\nparentPort.once("message", () => { const a = []; for (;;) a.push(new Array(1e5).fill(Math.random())); });\n',
);

async function docx(text: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("word/document.xml", `<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "uint8array" });
}

/** `fn` davomida asosiy event loop'dagi eng uzun «qotish» (ms). */
async function loopGap<T>(fn: () => Promise<T>): Promise<{ gap: number; value?: T; error?: unknown }> {
  let last = performance.now();
  let gap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    gap = Math.max(gap, now - last);
    last = now;
  }, 5);
  let value: T | undefined;
  let error: unknown;
  try {
    value = await fn();
  } catch (e) {
    error = e;
  }
  clearInterval(timer);
  gap = Math.max(gap, performance.now() - last);
  return { gap, value, error };
}

const real = createParsePool({ entry: resolveParseWorkerEntry() });

test("worker entry: dev/test da TS manba tsx bilan topiladi", () => {
  const entry = resolveParseWorkerEntry();
  assert.ok(entry, "entry topilishi kerak");
  assert.match(entry!.file, /parse-worker\.ts$/);
});

test("haqiqiy worker: extract natijasi in-process bilan bayt-ba-bayt bir xil", async () => {
  const bytes = await docx("Salom &amp; dunyo");
  const viaWorker = await real.run({ kind: "extract", name: "x.docx", bytes });
  const local = await extractFromBuffer("x.docx", bytes.slice().buffer as ArrayBuffer);
  assert.deepEqual(viaWorker, local);
  assert.equal(viaWorker.text, "Salom & dunyo");
});

test("haqiqiy worker: manba hisoblagichi (source) va namuna profili", async () => {
  const counted = await real.run({ kind: "source", source: "txt", bytes: new TextEncoder().encode("Birinchi paragraf.\n\nIkkinchi paragraf.") });
  assert.deepEqual(counted, { chars: 36, text: "Birinchi paragraf.\nIkkinchi paragraf.", pages: undefined, segments: 2 });

  const tpl = await makeZip(templateEntries());
  assert.deepEqual(await real.run({ kind: "template", bytes: tpl }), await parsePptxTemplate(tpl));
});

test("haqiqiy worker: TemplateError va PDF sahifa chegarasi xato turlari saqlanadi", async () => {
  const notPptx = await makeZip([{ name: "a.txt", data: "x" }]);
  await assert.rejects(real.run({ kind: "template", bytes: notPptx }), (e: unknown) => e instanceof TemplateError && e.code === "not-pptx");
  const { makeBlankPagesPdf } = await import("./helpers/parse-fixtures.ts");
  const { MAX_PDF_PAGES } = await import("../lib/generation/translate/pdf.ts");
  await assert.rejects(real.run({ kind: "source", source: "pdf", bytes: makeBlankPagesPdf(MAX_PDF_PAGES + 1) }), { name: "PdfPageLimitError" });
});

test("haqiqiy worker: og'ir PDF tahlili asosiy event loop'ni to'smaydi", async () => {
  const bytes = makeTextbookPdf(120);
  const r = await loopGap(() => real.run({ kind: "source", source: "pdf", bytes }));
  assert.equal(r.error, undefined, String(r.error));
  const counted = r.value as { chars: number; pages?: number };
  assert.equal(counted.pages, 120);
  assert.ok(counted.chars > 100_000, `chars ${counted.chars}`);
  assert.ok(r.gap < 150, `asosiy thread ${r.gap.toFixed(0)} ms qotdi`);
});

test("timeout: tiqilib qolgan parser to'xtatiladi, chaqiruvchi toza 422 oladi, event loop bo'sh", async () => {
  const pool = createParsePool({ entry: { file: stuck, execArgv: [] }, timeoutMs: 400 });
  const t = performance.now();
  const { gap, error } = await loopGap(() => pool.run({ kind: "extract", name: "a.txt", bytes: new Uint8Array([120]) }));
  assert.ok(error instanceof ParsePoolError, String(error));
  assert.equal(error.code, "timeout");
  assert.equal(error.status, 422);
  assert.match(error.message, /juda uzoq/);
  const elapsed = performance.now() - t;
  assert.ok(elapsed < 3000, `timeout ${elapsed.toFixed(0)} ms dan keyin ishladi`);
  assert.ok(gap < 150, `asosiy thread ${gap.toFixed(0)} ms qotdi`);
  assert.equal(pool.stats().running, 0, "worker to'xtatilgan va slot bo'shagan");
});

test("navbat: bir vaqtda ko'pi bilan maxRunning worker, navbat to'lsa darrov 503", async () => {
  const pool = createParsePool({ entry: { file: stuck, execArgv: [] }, timeoutMs: 300, maxRunning: 1, maxQueue: 1 });
  const task = { kind: "extract", name: "a.txt", bytes: new Uint8Array([120]) } as const;
  const t = performance.now();
  const p1 = pool.run(task);
  const p2 = pool.run(task);
  const p3 = pool.run(task);
  assert.deepEqual(pool.stats(), { running: 1, queued: 1 });
  await assert.rejects(p3, (e: unknown) => e instanceof ParsePoolError && e.code === "busy" && e.status === 503);
  await assert.rejects(p1, { code: "timeout" });
  await assert.rejects(p2, { code: "timeout" });
  // Ikkinchisi faqat birinchisi bo'shagach boshlangan — ya'ni ≈ 2 × timeout.
  assert.ok(performance.now() - t >= 550, `navbat parallel ishladi: ${(performance.now() - t).toFixed(0)} ms`);
  assert.deepEqual(pool.stats(), { running: 0, queued: 0 });
});

test("xotira: worker old-gen chegarasidan oshsa — jarayon yiqilmaydi, toza 422", async () => {
  const pool = createParsePool({ entry: { file: hog, execArgv: [] }, timeoutMs: 20_000, maxOldMb: 32 });
  await assert.rejects(pool.run({ kind: "extract", name: "a.txt", bytes: new Uint8Array([120]) }), (e: unknown) => {
    assert.ok(e instanceof ParsePoolError);
    assert.equal(e.code, "failed");
    assert.equal(e.status, 422);
    return true;
  });
});

test("entry yo'q (null) — in-process zaxira bir xil natija beradi", async () => {
  const pool = createParsePool({ entry: null });
  const bytes = await docx("Zaxira yo'li");
  assert.deepEqual(await pool.run({ kind: "extract", name: "x.docx", bytes }), { text: "Zaxira yo'li" });
});

test("prod yo'li: esbuild to'plami (parse-worker.mjs) tsx siz, oddiy node worker'ida ishlaydi", async () => {
  const esbuild = await import("esbuild");
  const out = join(dir, "parse-worker.mjs");
  await esbuild.build({
    entryPoints: [join(process.cwd(), "lib/server/parse-worker.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: out,
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: "silent",
  });
  const entry = resolveParseWorkerEntry(dir, {});
  assert.deepEqual(entry, { file: out, execArgv: [] });
  const pool = createParsePool({ entry });
  assert.deepEqual(await pool.run({ kind: "extract", name: "x.docx", bytes: await docx("Prod to'plami") }), { text: "Prod to'plami" });
  const counted = await pool.run({ kind: "source", source: "pdf", bytes: makeTextbookPdf(3) });
  assert.equal(counted.pages, 3);
});
