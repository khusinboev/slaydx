import "./helpers/next-request.mts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import JSZip from "jszip";
import sharp from "sharp";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";
import { makeBlankPdf } from "./helpers/office-fixtures.ts";

/**
 * POST /api/convert with `mode=alifbo` (script converter, owner request 6): DOCX / PPTX / TXT, same login, daily limit,
 * size caps and «Botga yuborish» delivery as the other converter modes. Real Postgres in a throwaway database; no
 * LibreOffice involved.
 *
 * Mutations (restored): `charge()` skipped in `convertAlifbo` -> «shares the daily limit»; refund removed in its catch ->
 * «a failed file is refunded»; the `detected === null` TXT guard removed -> «magic bytes».
 */

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
process.env.APP_URL = "https://slaydx.test";
process.env.TELEGRAM_BOT_TOKEN = "123456:FAKE-alifbo-token";
process.env.WORKER_INLINE = "false";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("alifbo") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "Postgres kerak (DATABASE_URL)" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";
if (!hasDb) process.env.DATABASE_URL = "postgres://unused/unused";

const { query, queryOne, ensureMigrated } = await import("../lib/server/db.ts");
const settings = await import("../lib/server/settings.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const route = await import("../app/api/convert/route.ts");
if (!skip) await ensureMigrated();
after(async () => {
  await iso.drop();
});

const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#3366cc" } }).png().toBuffer();

let seq = 0;
async function user(telegramId: string | null = null): Promise<string> {
  const r = await queryOne<{ id: string }>(
    "INSERT INTO users (username, name, points, quota, balance, telegram_id) VALUES ($1, 'Alifbo Test', 0, 0, 0, $2) RETURNING id::text AS id",
    [`al-${Date.now()}-${++seq}-${randomInt(0, 1e9)}`, telegramId],
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
const jsonOf = async (res: Response) => (await res.clone().json().catch(() => ({}))) as Json;
async function status(uid: string) {
  const req = new Request("http://localhost/api/convert", { headers: { cookie: `${SESSION_COOKIE}=${(await createSession(uid)).token}` } });
  return jsonOf(await inRequest(req, () => route.GET(req)));
}

const WNS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
async function cyrDocx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="${WNS}"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Ўзбекистон шаҳри</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}
async function cyrPptx(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", "<p:presentation/>");
  zip.file("ppt/slides/slide1.xml", '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>Чорсу бозори</a:t></a:r></a:p></p:sld>');
  return zip.generateAsync({ type: "uint8array" });
}
async function post(uid: string | null, name: string, bytes: Uint8Array, fields: Record<string, string>, qs = "") {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name));
  form.set("mode", "alifbo");
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const headers: Record<string, string> = {};
  if (uid) headers.cookie = `${SESSION_COOKIE}=${(await createSession(uid)).token}`;
  const req = new Request(`http://localhost/api/convert${qs}`, { method: "POST", headers, body: form });
  return inRequest(req, () => route.POST(req));
}
/** The other (file-format) mode, to prove the quota is shared. */
async function postFormat(uid: string, name: string, bytes: Uint8Array, target: string) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name));
  form.set("target", target);
  const req = new Request("http://localhost/api/convert", { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${(await createSession(uid)).token}` }, body: form });
  return inRequest(req, () => route.POST(req));
}
const CYR_LAT = { from: "cyr", to: "lat" };
const enc = (s: string) => new TextEncoder().encode(s);

test("alifbo: DOCX / PPTX / TXT are converted and returned with the script in the file name", { skip }, async () => {
  const uid = await user();
  const docx = await post(uid, "Hisobot.docx", await cyrDocx(), CYR_LAT);
  assert.equal(docx.status, 200);
  assert.match(docx.headers.get("content-disposition")!, /Hisobot-lotin\.docx/);
  assert.match(docx.headers.get("content-type")!, /wordprocessingml/);
  const dz = await JSZip.loadAsync(new Uint8Array(await docx.arrayBuffer()));
  assert.match(await dz.file("word/document.xml")!.async("string"), /<w:rPr><w:b\/><\/w:rPr><w:t>Oʻzbekiston shahri<\/w:t>/);

  const pptx = await post(uid, "Taqdimot.pptx", await cyrPptx(), { from: "cyr", to: "new" });
  assert.equal(pptx.status, 200);
  assert.match(pptx.headers.get("content-disposition")!, /Taqdimot-yangi-lotin\.pptx/);
  const pz = await JSZip.loadAsync(new Uint8Array(await pptx.arrayBuffer()));
  assert.match(await pz.file("ppt/slides/slide1.xml")!.async("string"), /<a:t>Çorsu bozori<\/a:t>/);

  const txt = await post(uid, "matn.txt", enc("Тошкент шаҳри"), { from: "cyr", to: "new" });
  assert.equal(txt.status, 200);
  assert.match(txt.headers.get("content-type")!, /^text\/plain/);
  assert.match(txt.headers.get("content-disposition")!, /matn-yangi-lotin\.txt/);
  assert.equal(await txt.text(), "Toşkent şahri");

  const back = await post(uid, "matn.txt", enc("Toşkent şahri"), { from: "new", to: "cyr" });
  assert.equal(await back.text(), "Тошкент шаҳри");
  assert.match(back.headers.get("content-disposition")!, /matn-kirill\.txt/);
  assert.equal((await status(uid)).used, 4, "one quota unit per file");
});

test("alifbo: login required; bad / equal scripts and unsupported files are 400 and cost nothing", { skip }, async () => {
  assert.equal((await post(null, "a.txt", enc("салом"), CYR_LAT)).status, 401);
  const uid = await user();
  const noFrom = await post(uid, "a.txt", enc("салом"), { to: "lat" });
  assert.equal(noFrom.status, 400);
  assert.equal((await jsonOf(noFrom)).code, "bad_script");
  assert.equal((await jsonOf(await post(uid, "a.txt", enc("салом"), { from: "cyr", to: "klingon" }))).code, "bad_script");
  const same = await post(uid, "a.txt", enc("салом"), { from: "lat", to: "lat" });
  assert.equal(same.status, 400);
  assert.equal((await jsonOf(same)).code, "same_script");
  const pdf = await post(uid, "a.pdf", makeBlankPdf(), CYR_LAT);
  assert.equal(pdf.status, 400);
  assert.equal((await jsonOf(pdf)).code, "unsupported");
  assert.equal((await post(uid, "a.txt", new Uint8Array(0), CYR_LAT)).status, 400);
  assert.equal((await status(uid)).used, 0);
});

test("alifbo magic bytes: a txt renamed .docx, a png renamed .txt, a docx renamed .pptx are mismatches", { skip }, async () => {
  const uid = await user();
  for (const [name, bytes] of [
    ["a.docx", enc("oddiy matn")],
    ["a.txt", png],
    ["a.pptx", await cyrDocx()],
    ["a.docx", await cyrPptx()],
    ["a.txt", await cyrDocx()],
  ] as [string, Uint8Array][]) {
    const res = await post(uid, name, bytes, CYR_LAT);
    assert.equal(res.status, 400, name);
    assert.equal((await jsonOf(res)).code, "mismatch", name);
  }
  assert.equal((await status(uid)).used, 0);
});

test("alifbo shares the daily limit with the other converter modes", { skip }, async () => {
  const uid = await user();
  await setSetting("convert.daily_limit", 2);
  try {
    assert.equal((await post(uid, "a.txt", enc("салом"), CYR_LAT)).status, 200);
    assert.equal((await postFormat(uid, "a.png", png, "jpg")).status, 200);
    const over = await post(uid, "a.txt", enc("салом"), CYR_LAT);
    assert.equal(over.status, 429);
    assert.equal((await jsonOf(over)).code, "daily_limit");
    assert.deepEqual(await status(uid), { enabled: true, limit: 2, used: 2, remaining: 0 });
  } finally {
    await clearSetting("convert.daily_limit");
  }
});

test("alifbo: the kill switch and limit 0 apply", { skip }, async () => {
  const uid = await user();
  await setSetting("convert.disabled", true);
  try {
    const res = await post(uid, "a.txt", enc("салом"), CYR_LAT);
    assert.equal(res.status, 503);
    assert.equal((await jsonOf(res)).code, "disabled");
  } finally {
    await clearSetting("convert.disabled");
  }
  await setSetting("convert.daily_limit", 0);
  try {
    assert.equal((await post(uid, "a.txt", enc("салом"), CYR_LAT)).status, 503);
  } finally {
    await clearSetting("convert.daily_limit");
  }
});

test("alifbo: a failed file is refunded (invalid UTF-8 text) and a cut-off docx is refused before charging", { skip }, async () => {
  const uid = await user();
  const bad = await post(uid, "a.txt", new Uint8Array([0xff, 0xfe, 0xfd, 0x80]), CYR_LAT);
  assert.equal(bad.status, 400);
  assert.equal((await jsonOf(bad)).code, "mismatch");
  assert.equal((await status(uid)).used, 0, "the quota unit was given back");
  const cut = (await cyrDocx()).slice(0, 60);
  assert.equal((await post(uid, "a.docx", cut, CYR_LAT)).status, 400);
  assert.equal((await status(uid)).used, 0);
});

test("alifbo size caps: 20 MB for Word / PowerPoint, 5 MB for plain text", { skip }, async () => {
  const uid = await user();
  const big = await post(uid, "a.txt", new Uint8Array(5 * 1024 * 1024 + 1).fill(97), CYR_LAT);
  assert.equal(big.status, 413);
  assert.equal((await jsonOf(big)).code, "too_large");
  assert.equal((await status(uid)).used, 0);
  const ok = await post(uid, "a.txt", new Uint8Array(1024 * 1024).fill(97), CYR_LAT);
  assert.equal(ok.status, 200);
});

test("alifbo: deliver=bot sends the converted file to the user's chat", { skip }, async () => {
  const realFetch = globalThis.fetch;
  const calls: { method: string; form: FormData }[] = [];
  globalThis.fetch = (async (url: string | URL, init?: { body?: unknown }) => {
    const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(String(url));
    if (!m) return realFetch(url as never, init as never);
    calls.push({ method: m[1]!, form: init!.body as FormData });
    return new Response(JSON.stringify({ ok: true, result: { document: { file_id: "F1", file_unique_id: "U1" } } }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const uid = await user("777000222");
    const res = await post(uid, "matn.txt", enc("Тошкент"), CYR_LAT, "?deliver=bot");
    assert.equal(res.status, 200);
    assert.deepEqual(await jsonOf(res), { ok: true, delivered: "bot", fileName: "matn-lotin.txt" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.form.get("chat_id"), "777000222");
    const doc = calls[0]!.form.get("document") as File;
    assert.equal(doc.name, "matn-lotin.txt");
    assert.equal(await doc.text(), "Toshkent");
    assert.match(String(calls[0]!.form.get("caption")), /Alifbo o'giruvchi/);
    const web = await user();
    assert.equal((await post(web, "matn.txt", enc("салом"), CYR_LAT, "?deliver=bot")).status, 409);
    assert.equal((await status(web)).used, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
