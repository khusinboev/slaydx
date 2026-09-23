import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AcademicDoc } from "../lib/generation/types.ts";

/**
 * OCHIQ O'YIN ROUTE LARI (AUDIT-22 R0) — `/api/o/[token]` va `…/submit`.
 *
 * Bu ikkisi LOGINSIZ (egasi qarori 8), ya'ni ular butun runtime ning
 * eng ochiq yuzasi. Shuning uchun testlar aynan XAVFSIZLIK
 * shartnomasini qulflaydi:
 *
 *   • noma'lum/muddati o'tgan token — 404 (sabab aytilmaydi);
 *   • javob ochiq ko'rinishda (`publicGameView`) — TO'G'RI JAVOB YO'Q;
 *   • `submit` — `checkOrigin` (CSRF) va o'yin+IP bo'yicha 120/daq, IP shipi 600/daq (429, C29);
 *   • BALL SERVERDA: klient yuborgan `score` e'tiborsiz;
 *   • ism bo'sh bo'lsa 400.
 *
 * Egasi route lari (`share`, `results`) sessiya talab qiladi va uni
 * testda qurib bo'lmaydi (`cookies()` faqat so'rov konteksti ichida) —
 * ular uchun sof funksiyalar (`resultsCsv`, `shareUrl`) va manba skani.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `submit` da `scoreAnswers` o'rniga `body.score` ishlatildi —
 *      «ball serverda» testi;
 *   2. `checkOrigin` chaqiruvi olib tashlandi — «begona origin 403»;
 *   3. `limit(...)` olib tashlandi — «429» testi;
 *   4. GET javobiga `session.doc` qo'shildi — «javob sizmaydi» testi;
 *   5. `resultsCsv` da CSV qochirish yo'qoldi — «formula injeksiyasi»;
 *   6. `share` route'dan `requireUser` olib tashlandi — manba skani.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
process.env.APP_URL = "http://localhost:3000";

const { pool } = await import("../lib/server/db.ts");

/* Migratsiyani BIR marta (bo'sh stub bilan) o'tkazamiz — keyingi
 * chaqiruvlar keshlangan va'dani oladi va testlar faqat O'Z SQL ini
 * ko'radi. */
{
  const p = pool() as unknown as { query: unknown; connect: unknown };
  const empty = async () => ({ rows: [], rowCount: 0 });
  const [q0, c0] = [p.query, p.connect];
  p.query = empty;
  p.connect = async () => ({ query: empty, release() {} });
  const { ensureMigrated } = await import("../lib/server/db.ts");
  await ensureMigrated();
  p.query = q0;
  p.connect = c0;
}

const { GET } = await import("../app/api/o/[token]/route.ts");
const { POST, SUBMIT_PER_MINUTE } = await import("../app/api/o/[token]/submit/route.ts");
const { GET: AUDIO, audioAssetIds } = await import("../app/api/o/[token]/audio/[assetId]/route.ts");
const { csvCell, resultsCsv } = await import("../app/api/generations/[id]/results/route.ts");
const { shareUrl } = await import("../app/api/generations/[id]/share/route.ts");
const { sampleGameDoc } = await import("../lib/generation/games/samples.ts");
const { publicItemId } = await import("../lib/game/public.ts");

const TOKEN = "aaaaaaaaaaaaaaaaaaaaaa";
const NOW = new Date("2026-09-17T10:00:00.000Z");

type Seen = { text: string; params: unknown[] };
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function sessionRow(doc: AcademicDoc, over: Record<string, unknown> = {}) {
  return {
    id: "11111111-0000-4000-8000-000000000001",
    generation_id: "a1b2c3d4-0000-4000-8000-000000000001",
    user_id: "42",
    token: TOKEN,
    kind: "sorting",
    settings_json: {},
    expires_at: null,
    created_at: NOW,
    doc_json: doc,
    topic: "Hayvonlar sinflari",
    status: "COMPLETED",
    ...over,
  };
}

/** `session` — sessiya qatori (yoki `null`), `hits` — rate limit hisobi. */
function mockDb(t: TestContext, o: { session?: Record<string, unknown> | null; hits?: number; asset?: { bytes: Buffer; mime: string } } = {}): Seen[] {
  const seen: Seen[] = [];
  const run = async (text: string, params: unknown[] = []) => {
    const q = norm(text);
    seen.push({ text: q, params });
    let out: unknown[] = [];
    if (/INSERT INTO rate_limits/.test(q)) out = [{ hits: o.hits ?? 1 }];
    else if (/FROM game_sessions s/.test(q)) out = o.session === null ? [] : [o.session ?? sessionRow(sampleGameDoc("sorting"))];
    else if (/INSERT INTO game_results/.test(q)) out = [{ id: "r1", player_name: "Ali", score: 1, total: 12, seconds: 5, answers_json: {}, created_at: NOW }];
    else if (/FROM generation_assets a/.test(q)) out = o.asset === undefined ? [] : [o.asset];
    return { rows: out, rowCount: out.length };
  };
  const p = pool();
  t.mock.method(p, "query", run);
  t.mock.method(p, "connect", async () => ({ query: run, release() {} }));
  return seen;
}

const ctx = (token = TOKEN) => ({ params: Promise.resolve({ token }) });

const postReq = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000/api/o/${TOKEN}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

/* ══════════════════════════ GET /api/o/[token] ══════════════════════════ */

test("GET: mavjud havola — ochiq ko'rinish qaytadi, JAVOB YO'Q", async (t) => {
  const doc = sampleGameDoc("sorting");
  mockDb(t, { session: sessionRow(doc) });
  const res = await GET(new Request(`http://localhost:3000/api/o/${TOKEN}`), ctx());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { game: { kind: string; items: { text: string }[]; categories: unknown[] }; title: string };
  assert.equal(body.game.kind, "sorting");
  assert.equal(body.title, "Hayvonlar sinflari");
  assert.ok(body.game.items.length > 0);

  /*
   * MUTATSIYA: javobga `session.doc` yoki modelni qo'shish — toifa
   * elementlari bilan birga butun javob ochiq JSON da ketardi.
   */
  const json = JSON.stringify(body);
  for (const c of doc.game!.sorting!.categories) {
    assert.ok(!json.includes(`"items":["${c.items[0]}"`), "toifa elementlari ochiq");
  }
  assert.ok(!json.includes("doc_json") && !json.includes("sections"), "hujjatning o'zi qaytdi");
});

test("GET: noma'lum yoki muddati o'tgan token — 404 (sabab aytilmaydi)", async (t) => {
  mockDb(t, { session: null });
  const res = await GET(new Request(`http://localhost:3000/api/o/${TOKEN}`), ctx());
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "Topilmadi", "xato matni tokenning holatini oshkor qilyapti");
});

test("GET: yaroqsiz token shakli — 404 va bazaga so'rov KETMAYDI", async (t) => {
  const seen = mockDb(t, {});
  for (const bad of ["abc", "yot token", "a".repeat(200)]) {
    const res = await GET(new Request(`http://localhost:3000/api/o/${bad}`), ctx(bad));
    assert.equal(res.status, 404, `«${bad}»`);
  }
  assert.equal(seen.filter((s) => /game_sessions/.test(s.text)).length, 0, "yaroqsiz token bilan baza so'raldi");
});

test("GET: hujjat tayyor emas yoki o'yin emas — 404", async (t) => {
  mockDb(t, { session: sessionRow(sampleGameDoc("sorting"), { status: "FAILED" }) });
  assert.equal((await GET(new Request(`http://localhost:3000/api/o/${TOKEN}`), ctx())).status, 404);

  // Kind mos kelmasa (`publicGameView` → `null`) ham 404.
  mockDb(t, { session: sessionRow(sampleGameDoc("crossword"), { kind: "sorting" }) });
  assert.equal((await GET(new Request(`http://localhost:3000/api/o/${TOKEN}`), ctx())).status, 404);
});

/* ══════════════════════════ POST …/submit ══════════════════════════ */

test("submit: BALL SERVERDA — klient yuborgan `score` e'tiborsiz", async (t) => {
  const doc = sampleGameDoc("sorting");
  const cats = doc.game!.sorting!.categories;
  const seen = mockDb(t, { session: sessionRow(doc) });

  // O'yinchi BITTA toifani to'g'ri joylashtirdi, lekin «100» deb yozdi.
  const answers: Record<string, string> = {};
  for (const item of cats[0].items) answers[publicItemId(item)] = cats[0].id;

  const res = await POST(postReq({ name: "Ali", answers, seconds: 42, score: 100, total: 100 }), ctx());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { score: number; total: number; percent: number };
  const total = cats.reduce((n, c) => n + c.items.length, 0);
  assert.equal(body.total, total);
  assert.equal(body.score, cats[0].items.length, "MUTATSIYA: klient balli qabul qilindi");
  assert.ok(body.percent > 0 && body.percent < 100);

  // Bazaga SERVER hisoblagan ball yozildi.
  const insert = seen.find((s) => /INSERT INTO game_results/.test(s.text));
  assert.ok(insert, "natija yozilmadi");
  assert.equal(insert!.params[3], cats[0].items.length);
  assert.equal(insert!.params[4], total);
  assert.equal(insert!.params[6], 42, "soniya yozilmadi");
  // Javoblarning O'ZI emas, element bo'yicha to'g'ri/xato saqlanadi.
  const saved = JSON.parse(String(insert!.params[5])) as { results: Record<string, boolean> };
  assert.equal(Object.keys(saved.results).length, total);
  assert.ok(!JSON.stringify(saved).includes(cats[1].id), "javob matni jadvalga tushdi");
});

test("submit: ism bo'sh — 400, natija YOZILMAYDI", async (t) => {
  const seen = mockDb(t, {});
  const res = await POST(postReq({ name: "   ", answers: {} }), ctx());
  assert.equal(res.status, 400);
  assert.equal(seen.filter((s) => /INSERT INTO game_results/.test(s.text)).length, 0, "ismsiz natija yozildi");
});

test("submit: begona origin — 403 (CSRF)", async (t) => {
  const seen = mockDb(t, {});
  const res = await POST(postReq({ name: "Ali", answers: {} }, { origin: "https://evil.example" }), ctx());
  assert.equal(res.status, 403, "MUTATSIYA: `checkOrigin` chaqirilmayapti");
  assert.equal(seen.filter((s) => /INSERT INTO game_results/.test(s.text)).length, 0);
});

test("submit: o'yin+IP bo'yicha 120/daq (C29) — chegaradan keyin 429 va `Retry-After`", async (t) => {
  assert.equal(SUBMIT_PER_MINUTE, 120);
  const seen = mockDb(t, { hits: SUBMIT_PER_MINUTE + 1 });
  const res = await POST(postReq({ name: "Ali", answers: {} }), ctx());
  assert.equal(res.status, 429, "MUTATSIYA: rate limit yo'q");
  assert.ok(res.headers.get("Retry-After"), "Retry-After sarlavhasi yo'q");
  assert.equal(seen.filter((s) => /INSERT INTO game_results/.test(s.text)).length, 0, "chegaradan oshgan so'rov yozildi");
  // Rate limit bucket — IP bo'yicha.
  const bucket = String(seen.find((s) => /rate_limits/.test(s.text))!.params[0]);
  assert.match(bucket, /^o:submit:/);
});

test("submit: noma'lum token — 404; buzuq JSON — 400", async (t) => {
  mockDb(t, { session: null });
  assert.equal((await POST(postReq({ name: "Ali", answers: {} }), ctx())).status, 404);

  mockDb(t, {});
  const bad = new Request(`http://localhost:3000/api/o/${TOKEN}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{buzuq",
  });
  assert.equal((await POST(bad, ctx())).status, 400);
});

/* ══════════════════════════ egasi tomoni ══════════════════════════ */

test("natijalar CSV: BOM, sarlavha va formula injeksiyasidan himoya", () => {
  const rows = [
    { id: "r1", playerName: "Ali", score: 7, total: 10, seconds: 63, answers: {}, createdAt: "2026-09-17T10:00:00.000Z" },
    { id: "r2", playerName: "=HYPERLINK(\"http://evil\",\"bos\")", score: 3, total: 10, seconds: 20, answers: {}, createdAt: "2026-09-17T10:05:00.000Z" },
  ];
  const csv = resultsCsv(rows);
  assert.ok(csv.startsWith("﻿"), "BOM yo'q — Excel o'zbekcha ismni buzardi");
  assert.match(csv, /"Ism","Ball","Jami","Foiz","Soniya","Sana"/);
  assert.match(csv, /"Ali","7","10","70","63"/);
  /*
   * MUTATSIYA: qochirishni olib tashlash — `=HYPERLINK(...)` Excel da
   * FORMULA bo'lib ishga tushardi (CSV injection).
   */
  assert.ok(csv.includes(`"'=HYPERLINK`), "formula qochirilmadi");
  assert.equal(csvCell(`ikki "tirnoq"`), `"ikki ""tirnoq"""`);
  assert.equal(csvCell("qator\nuzilishi"), `"qator uzilishi"`);
  assert.equal(csvCell(null), `""`);
});

test("havola manzili: `APP_URL` birinchi, u bo'lmasa so'rov hostidan", () => {
  const req = new Request("http://192.168.1.5:3000/api/generations/x/share", { method: "POST" });
  assert.equal(shareUrl(req, TOKEN), `http://localhost:3000/o/${TOKEN}`, "APP_URL ishlatilmadi");
});

test("egasi route lari: `requireUser` + egalik, ochiq route larda esa YO'Q", () => {
  const share = readFileSync(new URL("../app/api/generations/[id]/share/route.ts", import.meta.url), "utf8");
  const results = readFileSync(new URL("../app/api/generations/[id]/results/route.ts", import.meta.url), "utf8");
  const open = readFileSync(new URL("../app/api/o/[token]/route.ts", import.meta.url), "utf8");
  const submit = readFileSync(new URL("../app/api/o/[token]/submit/route.ts", import.meta.url), "utf8");

  // MUTATSIYA: egasi route'idan `requireUser` ni olib tashlash.
  for (const [name, src] of [["share", share], ["results", results]] as const) {
    assert.match(src, /requireUser\(req\)/, `${name}: sessiya talab qilinmayapti`);
    assert.match(src, /user\.id/, `${name}: egalik user.id bilan tekshirilmayapti`);
  }
  // Ochiq route larda `requireUser` BO'LMASLIGI kerak (loginsiz o'yin).
  for (const [name, src] of [["o", open], ["submit", submit]] as const) {
    // Chaqiruvning O'ZI (izoh emas): ochiq o'yinda sessiya bo'lmaydi.
    assert.ok(!/requireUser\(/.test(src), `${name}: ochiq route sessiya talab qilyapti`);
    assert.match(src, /ensureMigrated\(\)/, `${name}: migratsiya kafolatlanmagan`);
  }
  assert.match(submit, /checkOrigin\(req\)/);
  assert.match(submit, /limit\(`o:submit:/);
  assert.match(submit, /scoreAnswers\(/, "ball serverda hisoblanmayapti");
  assert.ok(!/body\.score/.test(submit), "MUTATSIYA: klient balli o'qilyapti");
});

/* ───────────── ochiq tinglash audiosi — `/api/o/[token]/audio/[assetId]` (AUDIT-22 R) ───────────── */

const ASSET = "abcdef0123456789abcdef0123456789";
const actx = (token = TOKEN, assetId = ASSET) => ({ params: Promise.resolve({ token, assetId }) });
function listeningDoc(assetId: string | undefined = ASSET): AcademicDoc {
  const doc = structuredClone(sampleGameDoc("listening"));
  const items = doc.game?.listening?.items ?? [];
  assert.ok(items.length >= 2, "namunada kamida 2 topshiriq");
  if (assetId) items[0] = { ...items[0], audioAssetId: assetId };
  return doc;
}

test("audio: sessiya + ro'yxatdagi aktiv → 200 audio/mpeg, ochiq kesh, egalik SQL sessiya egasi bilan", async (t) => {
  const seen = mockDb(t, { session: sessionRow(listeningDoc(), { kind: "listening" }), asset: { bytes: Buffer.from([0xff, 0xfb, 1, 2]), mime: "audio/mpeg" } });
  const res = await AUDIO(new Request(`http://localhost:3000/api/o/${TOKEN}/audio/${ASSET}`), actx());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "audio/mpeg");
  assert.equal(res.headers.get("content-length"), "4");
  assert.match(res.headers.get("cache-control") ?? "", /public/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(Buffer.from(await res.arrayBuffer()).length, 4);
  const q = seen.find((s) => /FROM generation_assets a/.test(s.text));
  assert.ok(q, "aktiv SQL chaqirildi");
  assert.deepEqual(q.params, ["a1b2c3d4-0000-4000-8000-000000000001", ASSET, "42"], "egalik — sessiyadagi generatsiya + egasi id");
});

test("audio: ro'yxatda YO'Q aktiv — 404 va aktiv SQL umuman chaqirilmaydi (token boshqa aktivlarga kalit emas)", async (t) => {
  const seen = mockDb(t, { session: sessionRow(listeningDoc(), { kind: "listening" }), asset: { bytes: Buffer.from([1]), mime: "audio/mpeg" } });
  const other = "0000000000000000000000000000ffff";
  const res = await AUDIO(new Request(`http://localhost:3000/api/o/${TOKEN}/audio/${other}`), actx(TOKEN, other));
  assert.equal(res.status, 404);
  assert.ok(!seen.some((s) => /FROM generation_assets a/.test(s.text)), "aktiv SQL chaqirilmadi");
});

test("audio: tinglash bo'lmagan o'yin, noma'lum token, yaroqsiz id, tugallanmagan ish — hammasi 404", async (t) => {
  mockDb(t, { session: sessionRow(sampleGameDoc("sorting")), asset: { bytes: Buffer.from([1]), mime: "audio/mpeg" } });
  assert.equal((await AUDIO(new Request(`http://localhost:3000/api/o/${TOKEN}/audio/${ASSET}`), actx())).status, 404, "saralash o'yinida audio yo'q");
  mockDb(t, { session: null });
  assert.equal((await AUDIO(new Request(`http://localhost:3000/api/o/${TOKEN}/audio/${ASSET}`), actx())).status, 404, "token yo'q");
  mockDb(t, { session: sessionRow(listeningDoc(), { kind: "listening", status: "RUNNING" }), asset: { bytes: Buffer.from([1]), mime: "audio/mpeg" } });
  assert.equal((await AUDIO(new Request(`http://localhost:3000/api/o/${TOKEN}/audio/${ASSET}`), actx())).status, 404, "tugallanmagan");
  const bad = "../../etc";
  assert.equal((await AUDIO(new Request(`http://localhost:3000/api/o/${TOKEN}/audio/x`), actx(TOKEN, bad))).status, 404, "yaroqsiz aktiv id");
});

test("audio: MIME oq ro'yxatdan tashqarida bo'lsa `octet-stream` (sniff yo'q)", async (t) => {
  mockDb(t, { session: sessionRow(listeningDoc(), { kind: "listening" }), asset: { bytes: Buffer.from([1]), mime: "text/html" } });
  const res = await AUDIO(new Request(`http://localhost:3000/api/o/${TOKEN}/audio/${ASSET}`), actx());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/octet-stream");
});

test("audioAssetIds: faqat mavjud id lar, kichik harfda", () => {
  const ids = audioAssetIds({ kind: "listening", items: [{ audioAssetId: "ABC123ab" }, {}, { audioAssetId: "" }] });
  assert.deepEqual([...ids], ["abc123ab"]);
});
