import "./helpers/next-request.mts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";
import { makeBlankPdf, makeDocx } from "./helpers/office-fixtures.ts";

/**
 * Free file converter (owner request 13): POST /api/convert + GET status. Real Postgres in a throwaway database
 * for the limits. CI has no LibreOffice and no pdftoppm, so every route path is also covered with stand-in
 * binaries (fake soffice / pdftoppm shell scripts); the real-conversion tests skip without the real binaries.
 *
 * Mutations (each turned a test red, then restored):
 *   M1. the magic-byte check removed from `convertFile` -> «magic bytes» tests;
 *   M2. `charge()` removed (no daily limit) -> «daily limit»;
 *   M3. `toPdf(... gate: convertGate())` replaced by the shared `sofficeGate()` -> «dedicated lane» + «busy lane».
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-convert-token";
process.env.WORKER_INLINE = "false";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("convert") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "Postgres kerak (DATABASE_URL)" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";
if (!hasDb) process.env.DATABASE_URL = "postgres://unused/unused";

const realSoffice = ["/usr/bin/soffice", "/usr/bin/libreoffice", "/usr/local/bin/soffice"].some((b) => existsSync(b));
const realPdftoppm = ["/usr/bin/pdftoppm", "/usr/local/bin/pdftoppm"].some((b) => existsSync(b));
const skipRealSoffice = skip || (realSoffice ? false : "LibreOffice yo'q");
const skipRealPdftoppm = skip || (realPdftoppm ? false : "pdftoppm yo'q");

/* ── stand-in binaries ── */
const png = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#3366cc" } }).png().toBuffer();
const fakeDir = mkdtempSync(join(tmpdir(), "convert-fake-"));
const fakePng = join(fakeDir, "page.png");
writeFileSync(fakePng, png);
const fakeSoffice = join(fakeDir, "soffice");
writeFileSync(
  fakeSoffice,
  '#!/bin/sh\nout=""; prev=""; src=""\nfor a in "$@"; do [ "$prev" = "--outdir" ] && out="$a"; prev="$a"; src="$a"; done\n' +
    'b=$(basename "$src"); printf "%%PDF-1.4\\n%%%%EOF\\n" > "$out/${b%.*}.pdf"\n',
);
const fakePdftoppm = join(fakeDir, "pdftoppm");
// args: -r DPI -l N -png SRC PREFIX -> PREFIX-1.png, PREFIX-2.png
writeFileSync(fakePdftoppm, `#!/bin/sh\nfor a in "$@"; do p="$a"; done\ncp ${fakePng} "$p-1.png"\ncp ${fakePng} "$p-2.png"\n`);
chmodSync(fakeSoffice, 0o755);
chmodSync(fakePdftoppm, 0o755);
function fakeBins() {
  process.env.SOFFICE_BIN = fakeSoffice;
  process.env.PDFTOPPM_BIN = fakePdftoppm;
}
function realBins() {
  delete process.env.SOFFICE_BIN;
  delete process.env.PDFTOPPM_BIN;
}
fakeBins();

const { query, queryOne, ensureMigrated } = await import("../lib/server/db.ts");
const settings = await import("../lib/server/settings.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const route = await import("../app/api/convert/route.ts");
const convert = await import("../lib/server/convert.ts");
const { sofficeGate } = await import("../lib/server/soffice-gate.ts");
if (!skip) await ensureMigrated();
after(async () => {
  await iso.drop();
});

let seq = 0;
async function user(telegramId: string | null = null): Promise<string> {
  const r = await queryOne<{ id: string }>(
    "INSERT INTO users (username, name, points, quota, balance, telegram_id) VALUES ($1, 'Convert Test', 0, 0, 0, $2) RETURNING id::text AS id",
    [`cv-${Date.now()}-${++seq}-${randomInt(0, 1e9)}`, telegramId],
  );
  return r!.id;
}
async function setSetting(key: string, value: unknown) {
  await query("INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, JSON.stringify(value)]);
  settings.invalidateSettingsCache();
}
async function clearSetting(key: string) {
  await query("DELETE FROM app_settings WHERE key = $1", [key]);
  settings.invalidateSettingsCache();
}
type Json = Record<string, unknown>;
async function post(uid: string | null, name: string, bytes: Uint8Array, target: string, qs = "") {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name));
  form.set("target", target);
  const headers: Record<string, string> = {};
  if (uid) headers.cookie = `${SESSION_COOKIE}=${(await createSession(uid)).token}`;
  const req = new Request(`http://localhost/api/convert${qs}`, { method: "POST", headers, body: form });
  const res = await inRequest(req, () => route.POST(req));
  return res;
}
const jsonOf = async (res: Response) => (await res.clone().json().catch(() => ({}))) as Json;
async function status(uid: string) {
  const req = new Request("http://localhost/api/convert", { headers: { cookie: `${SESSION_COOKIE}=${(await createSession(uid)).token}` } });
  return jsonOf(await inRequest(req, () => route.GET(req)));
}

/** A one-page PDF with real text, built by hand (pdf.js reads it; no binary needed). */
function textPdf(text: string): Uint8Array {
  const stream = `BT /F1 18 Tf 72 700 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/* ───────────────────────── access ───────────────────────── */

test("unauthenticated -> 401 (POST and GET)", { skip }, async () => {
  assert.equal((await post(null, "a.png", png, "jpg")).status, 401);
  const req = new Request("http://localhost/api/convert");
  assert.equal((await inRequest(req, () => route.GET(req))).status, 401);
});

test("cross-site POST is refused (CSRF/origin)", { skip }, async () => {
  const uid = await user();
  const form = new FormData();
  form.set("file", new File([new Uint8Array(png)], "a.png"));
  form.set("target", "jpg");
  const req = new Request("http://localhost/api/convert", {
    method: "POST",
    headers: { cookie: `${SESSION_COOKIE}=${(await createSession(uid)).token}`, origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    body: form,
  });
  assert.equal((await inRequest(req, () => route.POST(req))).status, 403);
});

/* ───────────────────────── validation ───────────────────────── */

test("magic bytes: a .docx renamed .png is rejected; a png renamed .docx/.pdf too; junk and Excel", { skip }, async () => {
  const uid = await user();
  const docx = await makeDocx();
  for (const [name, bytes] of [
    ["fake.png", docx],
    ["fake.docx", png],
    ["fake.pdf", png],
    ["fake.jpg", makeBlankPdf()],
    ["notes.pdf", Buffer.from("just text, no pdf here")],
  ] as const) {
    const res = await post(uid, name, bytes, name.endsWith(".png") || name.endsWith(".jpg") ? "pdf" : "png");
    assert.equal(res.status, 400, name);
    assert.equal((await jsonOf(res)).code, "mismatch", name);
  }
  const xlsx = await post(uid, "table.xlsx", docx, "pdf");
  assert.equal(xlsx.status, 400);
  assert.equal((await jsonOf(xlsx)).code, "unsupported", "Excel is not in v1");
  assert.equal((await status(uid)).used, 0, "rejected files cost nothing");
});

test("target matrix: invalid targets are 400 and cost nothing", { skip }, async () => {
  const uid = await user();
  const docx = await makeDocx();
  const cases: [string, Uint8Array, string][] = [
    ["a.docx", docx, "png"], // Word can only become PDF
    ["a.docx", docx, "docx"],
    ["a.pdf", makeBlankPdf(), "pdf"],
    ["a.pdf", makeBlankPdf(), "webp"],
    ["a.png", png, "png"], // already that format
    ["a.png", png, "docx"],
    ["a.png", png, "xlsx"], // unknown target
    ["a.png", png, ""],
  ];
  for (const [name, bytes, target] of cases) assert.equal((await post(uid, name, bytes, target)).status, 400, `${name} -> ${target}`);
  const form = new FormData();
  form.set("target", "pdf");
  const req = new Request("http://localhost/api/convert", { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${(await createSession(uid)).token}` }, body: form });
  assert.equal((await inRequest(req, () => route.POST(req))).status, 400, "no file");
  assert.equal((await status(uid)).used, 0);
});

test("size caps: images 15 MB, documents 20 MB", { skip }, async () => {
  const uid = await user();
  const bigImage = Buffer.concat([png, Buffer.alloc(16 * 1024 * 1024)]);
  const r1 = await post(uid, "big.png", bigImage, "jpg");
  assert.equal(r1.status, 413);
  const bigPdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(21 * 1024 * 1024)]);
  assert.equal((await post(uid, "big.pdf", bigPdf, "png")).status, 413);
  const okPdfSize = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(16 * 1024 * 1024)]);
  assert.notEqual((await post(uid, "mid.pdf", okPdfSize, "png")).status, 413, "a 16 MB PDF is under the document cap");
});

/* ───────────────────────── limits and switches ───────────────────────── */

test("daily limit: 20 conversions pass, the 21st is refused; status counts down", { skip }, async () => {
  const uid = await user();
  assert.deepEqual(await status(uid), { enabled: true, limit: 20, used: 0, remaining: 20 });
  for (let i = 0; i < 20; i++) {
    const res = await post(uid, "a.png", png, "jpg");
    assert.equal(res.status, 200, `conversion ${i + 1}`);
  }
  const over = await post(uid, "a.png", png, "jpg");
  assert.equal(over.status, 429);
  assert.equal((await jsonOf(over)).code, "daily_limit");
  assert.deepEqual(await status(uid), { enabled: true, limit: 20, used: 20, remaining: 0 });
  const other = await user();
  assert.equal((await post(other, "a.png", png, "jpg")).status, 200, "the limit is per user");
});

test("a failed conversion is refunded", { skip }, async () => {
  const uid = await user();
  const broken = Buffer.concat([png.subarray(0, 40), Buffer.alloc(100)]); // valid signature, corrupt body
  const res = await post(uid, "broken.png", broken, "jpg");
  assert.equal(res.status, 422);
  assert.equal((await status(uid)).used, 0);
});

test("settings: limit 0 turns the feature off; the kill switch too; both restore", { skip }, async () => {
  const uid = await user();
  await setSetting("convert.daily_limit", 0);
  try {
    const res = await post(uid, "a.png", png, "jpg");
    assert.equal(res.status, 503);
    assert.equal((await jsonOf(res)).code, "disabled");
    assert.equal((await status(uid)).enabled, false);
  } finally {
    await clearSetting("convert.daily_limit");
  }
  await setSetting("convert.disabled", true);
  try {
    assert.equal((await post(uid, "a.png", png, "jpg")).status, 503);
  } finally {
    await clearSetting("convert.disabled");
  }
  assert.equal((await post(uid, "a.png", png, "jpg")).status, 200);
  await setSetting("convert.daily_limit", 2);
  try {
    assert.equal((await post(uid, "a.png", png, "jpg")).status, 200);
    assert.equal((await post(uid, "a.png", png, "jpg")).status, 429, "a lowered limit applies at once");
  } finally {
    await clearSetting("convert.daily_limit");
  }
});

/* ───────────────────────── the dedicated lane ───────────────────────── */

test("dedicated lane: its own Gate (concurrency 1, 5 waiters, 20 s), never the shared download gate", () => {
  assert.notEqual(convert.convertGate(), sofficeGate());
  assert.notEqual(convert.convertLightGate(), convert.convertGate());
  assert.deepEqual({ ...convert.CONVERT_LANE }, { max: 1, waitMs: 20_000, maxWaiters: 5, retryAfterSec: 20 });
  assert.equal(convert.convertGate(), convert.convertGate(), "one instance per process");
});

test("busy lane -> 503 with the Uzbek message and Retry-After; quota untouched; the shared gate unaffected", { skip }, async () => {
  const uid = await user();
  const gate = convert.convertGate();
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  const pending = [gate.run(() => hold)];
  for (let i = 0; i < 5; i++) pending.push(gate.run(() => hold)); // fills the 5 waiter places
  try {
    const res = await post(uid, "a.docx", await makeDocx(), "pdf");
    assert.equal(res.status, 503);
    assert.equal((await jsonOf(res)).error, "Hozir band, bir daqiqadan keyin urinib ko'ring");
    assert.ok(Number(res.headers.get("retry-after")) > 0);
    assert.equal(sofficeGate().stats().active, 0, "paid download gate is not used");
    assert.equal((await status(uid)).used, 0, "a busy refusal costs nothing");
    // sharp work has its own lane: images still convert while LibreOffice is busy.
    assert.equal((await post(uid, "a.png", png, "jpg")).status, 200);
  } finally {
    release();
    await Promise.allSettled(pending);
  }
});

/* ───────────────────────── conversions (stand-in binaries: run in CI) ───────────────────────── */

test("fake binaries: docx -> pdf, pdf -> png ZIP (2 pages), pdf -> jpg ZIP", { skip }, async () => {
  fakeBins();
  const uid = await user();
  const pdf = await post(uid, "Hisobot.docx", await makeDocx(), "pdf");
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(pdf.headers.get("content-disposition")!, /attachment; filename="Hisobot\.pdf"/);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");

  for (const t of ["png", "jpg"] as const) {
    const res = await post(uid, "kitob.pdf", makeBlankPdf(), t);
    assert.equal(res.status, 200, t);
    assert.equal(res.headers.get("content-type"), "application/zip");
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
    assert.deepEqual(Object.keys(zip.files).sort(), [`kitob-01.${t}`, `kitob-02.${t}`]);
    const first = await zip.file(`kitob-01.${t}`)!.async("nodebuffer");
    assert.equal((await sharp(first).metadata()).format, t === "png" ? "png" : "jpeg");
  }
});

test("deliver=bot sends the converted file to the user's chat instead of returning it", { skip }, async () => {
  const realFetch = globalThis.fetch;
  const calls: { method: string; form: FormData }[] = [];
  globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
    const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(String(url));
    if (!m) return realFetch(url as never, init as never);
    calls.push({ method: m[1]!, form: init!.body as FormData });
    return new Response(JSON.stringify({ ok: true, result: { document: { file_id: "F1", file_unique_id: "U1" } } }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const uid = await user("777000111");
    const res = await post(uid, "a.png", png, "jpg", "?deliver=bot");
    assert.equal(res.status, 200);
    assert.deepEqual(await jsonOf(res), { ok: true, delivered: "bot", fileName: "a.jpg" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.method, "sendDocument");
    assert.equal(calls[0]!.form.get("chat_id"), "777000111");
    assert.equal((calls[0]!.form.get("document") as File).name, "a.jpg");
    // no Telegram account -> 409, nothing converted or charged
    const web = await user();
    const no = await post(web, "a.png", png, "jpg", "?deliver=bot");
    assert.equal(no.status, 409);
    assert.equal((await status(web)).used, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

/* ───────────────────────── conversions that need no external binary ───────────────────────── */

test("image <-> image and image -> PDF (sharp + the self-written PDF writer)", { skip }, async () => {
  const uid = await user();
  const jpg = Buffer.from(await (await post(uid, "x.png", png, "jpg")).arrayBuffer());
  assert.equal((await sharp(jpg).metadata()).format, "jpeg");
  const webp = Buffer.from(await (await post(uid, "x.jpg", jpg, "webp")).arrayBuffer());
  assert.equal((await sharp(webp).metadata()).format, "webp");
  const back = Buffer.from(await (await post(uid, "x.webp", webp, "png")).arrayBuffer());
  assert.equal((await sharp(back).metadata()).format, "png");
  const res = await post(uid, "x.jpg", jpg, "pdf");
  assert.equal(res.status, 200);
  const pdf = Buffer.from(await res.arrayBuffer());
  assert.equal(pdf.subarray(0, 8).toString(), "%PDF-1.4");
  assert.equal((pdf.toString("latin1").match(/\/Type \/Page /g) ?? []).length, 1);
  assert.ok(pdf.includes(Buffer.from([0xff, 0xd8, 0xff])), "a JPEG is embedded");
});

test("PDF -> Word (DOCX) reuses the translator's PDF reader; a scanned PDF says so", { skip }, async () => {
  const uid = await user();
  const res = await post(uid, "m.pdf", textPdf("Salom dunyo test"), "docx");
  assert.equal(res.status, 200);
  const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
  assert.match(await zip.file("word/document.xml")!.async("string"), /Salom dunyo test/);
  const blank = await post(uid, "scan.pdf", makeBlankPdf(), "docx");
  assert.equal(blank.status, 422);
  assert.equal((await jsonOf(blank)).code, "no_text");
  assert.equal((await status(uid)).used, 1, "the scanned PDF was refunded");
});

/* ───────────────────────── real binaries (skipped in CI) ───────────────────────── */

test("real LibreOffice: docx -> pdf", { skip: skipRealSoffice }, async () => {
  realBins();
  try {
    const uid = await user();
    const res = await post(uid, "real.docx", await makeDocx(), "pdf");
    assert.equal(res.status, 200);
    const pdf = Buffer.from(await res.arrayBuffer());
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.length > 1000, "a real PDF, not the stand-in");
  } finally {
    fakeBins();
  }
});

test("real pdftoppm: pdf -> png (single page = plain file)", { skip: skipRealPdftoppm }, async () => {
  realBins();
  try {
    const uid = await user();
    const res = await post(uid, "one.pdf", makeBlankPdf(), "png");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).format, "png");
  } finally {
    fakeBins();
  }
});

test("real: jpg -> pdf -> png round trip (LibreOffice not needed)", { skip: skipRealPdftoppm }, async () => {
  realBins();
  try {
    const uid = await user();
    const jpg = await sharp(png).jpeg().toBuffer();
    const pdf = Buffer.from(await (await post(uid, "p.jpg", jpg, "pdf")).arrayBuffer());
    const page = await post(uid, "p.pdf", pdf, "png");
    assert.equal(page.status, 200);
    const meta = await sharp(Buffer.from(await page.arrayBuffer())).metadata();
    assert.ok((meta.width ?? 0) > 100);
  } finally {
    fakeBins();
  }
});
