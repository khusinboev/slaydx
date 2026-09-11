import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";

/**
 * Maqola tahrir SERVERI (Maqola 2, AUDIT-17 WP7) — `resume-commit` naqshi.
 *
 * BAZASIZ: `pool().query`/`connect()` ushlanadi, so'rovlar SQL matni
 * bo'yicha yo'naltiriladi (`DATABASE_URL` shart emas — test har doim
 * yuradi). Sinaladi:
 *   1) adapter reyestri — `article` vositasi `articleAdapter` ni, o'z op
 *      tilini va DOCX rendererni oladi (slayd/rezyume yo'li buzilmaydi);
 *   2) `PATCH` yo'li — 409 (versiya), 422 (mazmun), 400 (begona op),
 *      `doc_prev` (birinchi tahrir), yozilgan hujjatda matn va sinxron
 *      nusxalar;
 *   3) `rebuildFile` — DOCX qayta yasaladi, sxema PNG aktivdan o'qilib
 *      `<w:drawing>` saqlanadi, eskiz aktivi o'sha tranzaksiyada o'chadi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const { ApiError } = await import("../lib/server/api.ts");
const { loadDocForEdit, commitDocOps, rebuildFile, ensureFreshFile, patchDocFromRequest } = await import("../lib/server/slide-commit.ts");
const { adapterFor, articleAdapter, resumeAdapter, slideAdapter } = await import("../lib/server/edit-adapters.ts");
const { THUMB_ASSET_ID } = await import("../lib/server/thumb.ts");
const { sampleArticleDoc } = await import("../lib/generation/article/samples.ts");

const GEN = "a1b2c3d4-0000-4000-8000-000000000007";
const USER = "u-42";
const ASSET = "0123456789abcdef";
const ASSET_URL = `/api/generations/${GEN}/assets/${ASSET}`;

const META = { topic: "Sun’iy intellektning oliy ta’limdagi o‘rni", author: "K", workLabel: "Maqola", language: "uz", toolId: "article" } as unknown as DocMeta;

/** 1×1 PNG — aktiv bayti. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function articleDoc(): AcademicDoc {
  const d = sampleArticleDoc(META);
  // Sxema PNG allaqachon aktivga chiqarilgan (worker `extractAssets`).
  d.article!.figures[0].url = ASSET_URL;
  d.article!.figures[0].assetId = ASSET;
  return d;
}

/** Eski maqola: `doc.article` yo'q, titul/mundarija bilan. */
function legacyDoc(): AcademicDoc {
  const d = sampleArticleDoc(META);
  delete d.article;
  d.titlePage = true;
  return d;
}

/* ───────────────────────────── DB stub (bazasiz) ───────────────────────────── */

type Seen = { text: string; params: unknown[] };
type Rows = {
  forEdit?: Record<string, unknown> | null;
  versions?: Record<string, unknown> | null;
  detail?: Record<string, unknown> | null;
  updateDoc?: Record<string, unknown> | null;
  markFile?: Record<string, unknown> | null;
  asset?: Record<string, unknown> | null;
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function mockDb(t: TestContext, rows: Rows): Seen[] {
  const seen: Seen[] = [];
  const run = async (text: string, params: unknown[] = []) => {
    seen.push({ text: norm(text), params });
    const q = norm(text);
    let out: unknown[] = [];
    if (/live_json_out/.test(q)) out = rows.detail ? [rows.detail] : [];
    else if (/^SELECT doc_json, doc_version/.test(q)) out = rows.forEdit ? [rows.forEdit] : [];
    else if (/^SELECT doc_version, file_version, tool_id/.test(q)) out = rows.versions ? [rows.versions] : [];
    else if (/UPDATE generations SET doc_json/.test(q)) out = rows.updateDoc ? [rows.updateDoc] : [];
    else if (/SET file_version = \$3/.test(q)) out = rows.markFile ? [rows.markFile] : [];
    else if (/^SELECT a\.bytes, a\.mime FROM generation_assets/.test(q)) out = rows.asset ? [rows.asset] : [];
    return { rows: out, rowCount: out.length };
  };
  const p = pool();
  t.mock.method(p, "query", run);
  t.mock.method(p, "connect", async () => ({ query: run, release() {} }));
  return seen;
}

const sqls = (seen: Seen[]) => seen.map((s) => s.text);
const found = (seen: Seen[], re: RegExp) => sqls(seen).filter((s) => re.test(s));

async function expectApiError(p: Promise<unknown>, status: number) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ApiError, `ApiError kutilgan edi, keldi: ${e}`);
    const err = e as InstanceType<typeof ApiError>;
    assert.equal(err.status, status, `status ${status} kutilgan, keldi ${err.status}: ${err.message}`);
    return err;
  }
  assert.fail(`xato tashlanishi kerak edi (status ${status})`);
}

function editRow(over: Record<string, unknown> = {}) {
  return {
    doc_json: articleDoc(),
    doc_version: 3,
    file_version: 3,
    image_redraws: 0,
    tool_id: "article",
    file_name: "maqola.docx",
    topic: META.topic,
    status: "COMPLETED",
    ...over,
  };
}

function detailRow(over: Record<string, unknown> = {}) {
  return {
    id: GEN,
    user_id: USER,
    tool_id: "article",
    topic: META.topic,
    status: "COMPLETED",
    price: "8000",
    format: "docx",
    progress: 100,
    step: "Tayyor",
    file_name: "maqola.docx",
    error: null,
    preview: null,
    delivered_json: null,
    created_at: new Date(),
    started_at: new Date(),
    finished_at: new Date(),
    expires_at: null,
    doc_version: 4,
    file_version: 3,
    image_redraws: 0,
    edited_at: new Date(),
    live_seq: 0,
    html: "<html></html>",
    doc_json: articleDoc(),
    live_json_out: null,
    ...over,
  };
}

const patchReq = (body: unknown) =>
  new Request("http://localhost/api/generations/x/doc", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const textOp = [{ op: "text", path: "sections.0.blocks.0", value: "Tahrirlangan kirish jumlasi [W4385]." }] as const;

/* ══════════════════════════════ adapter reyestri ══════════════════════════════ */

test("adapterFor: `article` → articleAdapter; slayd/rezyume yo'li o'zgarmagan", () => {
  assert.equal(adapterFor("article"), articleAdapter);
  assert.equal(adapterFor("slide"), slideAdapter);
  assert.equal(adapterFor("resume"), resumeAdapter);
  assert.equal(adapterFor("referat"), null, "referat tahrirlanadigan bo'lib qoldi");
  assert.equal(articleAdapter.id, "article");
});

test("articleAdapter.hasModel: bo'limli hujjat — ha (eski maqola ham), bo'sh — yo'q", () => {
  assert.equal(articleAdapter.hasModel(articleDoc()), true);
  assert.equal(articleAdapter.hasModel(legacyDoc()), true, "eski maqola ham tahrirlanadi (matn oplari)");
  assert.equal(articleAdapter.hasModel({ sections: [] } as unknown as AcademicDoc), false);
  assert.equal(articleAdapter.hasModel(null), false);
  assert.equal(slideAdapter.hasModel(articleDoc()), false, "maqola slayd adapteriga tushmasin");
  const d = articleDoc();
  assert.equal(articleAdapter.prepare(d), d, "prepare nusxalamasligi kerak");
});

test("op TILI vositaga bog'liq — maqola adapteri slayd/rezyume opini qabul qilmaydi", () => {
  const slideOp = [{ op: "text", index: 0, src: { f: "title" }, value: "x" }];
  const resumeOp = [{ op: "text", path: "identity.fullName", value: "x" }];
  assert.equal(articleAdapter.parse(slideOp).ok, false);
  assert.equal(articleAdapter.parse(resumeOp).ok, false, "rezyume yo'li maqola regexidan o'tdi");
  assert.equal(articleAdapter.parse([...textOp]).ok, true);
  assert.equal(resumeAdapter.parse([...textOp]).ok, false, "rezyume adapteri maqola opini qabul qildi");
  assert.equal(slideAdapter.parse([...textOp]).ok, false);
});

test("articleAdapter DOCX yasaydi: sxema PNG `resolveImage` (aktiv) orqali — `<w:drawing>` bor", async () => {
  const doc = articleDoc();
  const asked: string[] = [];
  const built = await articleAdapter.render(
    {
      id: GEN,
      userId: USER,
      doc,
      fileName: "maqola.docx",
      resolveImage: async (url) => {
        asked.push(url);
        return url === ASSET_URL ? { data: `image/png;base64,${PNG.toString("base64")}`, type: "png" } : null;
      },
    },
    {},
  );
  assert.equal(built.mime, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(built.fileName, "maqola.docx");
  assert.deepEqual(asked, [ASSET_URL], "rasm aktiv URL i bilan so'ralmadi");
  const zip = await JSZip.loadAsync(Buffer.from(built.bytes));
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /<w:drawing>/, "sxema DOCX ga kirmadi");
  assert.match(xml, /1-rasm\./);
  assert.ok(!/Mundarija|MUNDARIJA/.test(xml), "maqolada mundarija bo'lmasligi kerak");
});

/* ══════════════════════════════ PATCH yo'li ══════════════════════════════ */

test("loadDocForEdit: maqola adapter bilan qaytadi; eski maqola ham 409 EMAS", async (t) => {
  mockDb(t, { forEdit: editRow() });
  const cur = await loadDocForEdit(GEN, USER);
  assert.equal(cur.adapter.id, "article");
  assert.ok(cur.doc.article);
  t.mock.reset();
  mockDb(t, { forEdit: editRow({ doc_json: legacyDoc() }) });
  const old = await loadDocForEdit(GEN, USER);
  assert.equal(old.adapter.id, "article");
});

test("commitDocOps: baseVersion mos kelmasa — 409 va UPDATE ketmaydi", async (t) => {
  const seen = mockDb(t, { forEdit: editRow({ doc_version: 5 }) });
  const e = await expectApiError(commitDocOps(GEN, USER, 3, textOp as never), 409);
  assert.equal(e.extra.code, "version");
  assert.equal(found(seen, /UPDATE generations SET doc_json/).length, 0);
});

test("commitDocOps: yaroqsiz op — 422 (`at` bilan), bazaga hech narsa yozilmaydi", async (t) => {
  const seen = mockDb(t, { forEdit: editRow() });
  const e = await expectApiError(commitDocOps(GEN, USER, 3, [{ op: "text", path: "sections.0.blocks.0", value: "ok" }, { op: "heading", sectionId: "yo'q", title: "x" }] as never), 422);
  assert.equal(e.extra.at, 1);
  assert.equal(found(seen, /UPDATE generations SET doc_json/).length, 0);
});

test("commitDocOps: eski maqolada model opi — 422", async (t) => {
  mockDb(t, { forEdit: editRow({ doc_json: legacyDoc() }) });
  const e = await expectApiError(commitDocOps(GEN, USER, 3, [{ op: "refRemove", refId: "W4385" }] as never), 422);
  assert.match(e.message, /Eski maqola/);
});

test("commitDocOps: BIRINCHI tahrir (doc_version=0) — `doc_prev` saqlanadi, keyingisida tegilmaydi", async (t) => {
  const seen = mockDb(t, { forEdit: editRow({ doc_version: 0 }), updateDoc: { doc_version: 1 }, detail: detailRow() });
  await commitDocOps(GEN, USER, 0, textOp as never);
  const upd = found(seen, /UPDATE generations SET doc_json/);
  assert.equal(upd.length, 1);
  assert.match(upd[0], /doc_prev = COALESCE\(doc_prev, doc_json\)/, "birinchi tahrirda `doc_prev` yozilmadi");

  t.mock.reset();
  const seen2 = mockDb(t, { forEdit: editRow({ doc_version: 3 }), updateDoc: { doc_version: 4 }, detail: detailRow() });
  await commitDocOps(GEN, USER, 3, textOp as never);
  assert.ok(!found(seen2, /UPDATE generations SET doc_json/)[0].includes("doc_prev ="));
});

test("commitDocOps: yozilgan hujjatda matn, sinxron sarlavha va qayta hisoblangan `cited`; hisobot TEGILMAYDI", async (t) => {
  const row = editRow();
  (row.doc_json as AcademicDoc).article!.review = { score: 83, checks: [], judgeNotes: [], verifiedShare: 1, recentShare: 1, builtAt: "2026-09-12T00:00:00.000Z" };
  const seen = mockDb(t, { forEdit: row, updateDoc: { doc_version: 4 }, detail: detailRow() });
  await commitDocOps(
    GEN,
    USER,
    3,
    [
      { op: "text", path: "sections.1.blocks.0", value: "Adabiyotlar tahlili manbasiz." },
      { op: "caption", target: "figure", id: "f1", value: "Yangi sxema sarlavhasi" },
    ] as never,
  );
  const upd = seen.find((s) => /UPDATE generations SET doc_json/.test(s.text))!;
  // `updateGenerationDoc`: [id, userId, doc_json, html, preview, expectedVersion]
  const written = JSON.parse(upd.params[2] as string) as AcademicDoc;
  assert.equal(written.sections[1].blocks[0].text, "Adabiyotlar tahlili manbasiz.");
  const fig = written.sections[1].blocks[1];
  assert.equal(fig.kind === "figure" ? fig.text : "", "Yangi sxema sarlavhasi");
  assert.equal(written.article!.figures[0].caption, "Yangi sxema sarlavhasi", "model sarlavhasi sinxron emas");
  assert.equal(written.article!.figures[0].url, ASSET_URL, "rasm aktivi yo'qoldi");
  assert.equal(written.article!.references.find((r) => r.id === "u1")!.cited, false, "u1 endi iqtibos qilinmagan");
  assert.equal(written.article!.review!.score, 83, "hisobot o'chib ketdi — qayta hisob serverda (rewrite) bo'ladi");
  assert.equal(typeof upd.params[3], "string", "html yozilmadi");
});

test("patchDocFromRequest: maqola tanasi maqola adapteri bilan; SLAYD opi — 400", async (t) => {
  mockDb(t, { forEdit: editRow(), updateDoc: { doc_version: 4 }, detail: detailRow() });
  await patchDocFromRequest(patchReq({ baseVersion: 3, ops: textOp }), GEN, USER);
  t.mock.reset();
  mockDb(t, { forEdit: editRow() });
  await expectApiError(patchDocFromRequest(patchReq({ baseVersion: 3, ops: [{ op: "layout", index: 0, layout: "bullets" }] }), GEN, USER), 400);
  t.mock.reset();
  mockDb(t, { forEdit: editRow() });
  // `review` opi klientdan o'tmaydi — ball soxtalashtirib bo'lmaydi.
  await expectApiError(patchDocFromRequest(patchReq({ baseVersion: 3, ops: [{ op: "review", review: { score: 100 } }] }), GEN, USER), 400);
});

/* ══════════════════════════════ rebuildFile ══════════════════════════════ */

test("rebuildFile: DOCX qayta yasaladi (sxema aktivdan, `<w:drawing>`), eskiz aktivi o'sha tranzaksiyada o'chadi", async (t) => {
  const seen = mockDb(t, {
    forEdit: editRow({ doc_version: 4, file_version: 3 }),
    markFile: { file_version: 4 },
    asset: { bytes: PNG, mime: "image/png" },
  });
  const out = await rebuildFile(GEN, USER);
  assert.equal(out.rebuilt, true);
  assert.equal(out.fileVersion, 4);

  const get = seen.find((s) => /^SELECT a\.bytes, a\.mime FROM generation_assets/.test(s.text));
  assert.ok(get, "sxema aktivi o'qilmadi");
  assert.deepEqual(get!.params, [GEN, ASSET, USER], "egalik SQL da emas");

  const del = seen.find((s) => /DELETE FROM generation_assets WHERE generation_id = \$1 AND asset_id = \$2/.test(s.text));
  assert.ok(del, "eskiz aktivi o'chirilmadi — karta eskizi eskirib qoladi");
  assert.deepEqual(del!.params, [GEN, THUMB_ASSET_ID]);
  const order = sqls(seen);
  const iLock = order.findIndex((s) => /pg_advisory_xact_lock/.test(s));
  const iDel = order.findIndex((s) => /DELETE FROM generation_assets WHERE generation_id = \$1 AND asset_id/.test(s));
  assert.ok(iLock >= 0 && iDel > iLock, "o'chirish tranzaksiyadan tashqarida");

  const ins = seen.find((s) => /INSERT INTO generation_files/.test(s.text));
  assert.ok(ins, "fayl yozilmadi");
  assert.equal(ins!.params[2], "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const zip = await JSZip.loadAsync(Buffer.from(ins!.params[4] as Uint8Array));
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /<w:drawing>/, "qayta yasalgan DOCX da sxema yo'q");
});

test("rebuildFile: fayl yangi bo'lsa — render ham, o'chirish ham yo'q", async (t) => {
  const seen = mockDb(t, { forEdit: editRow({ doc_version: 4, file_version: 4 }) });
  const out = await rebuildFile(GEN, USER);
  assert.equal(out.rebuilt, false);
  assert.equal(found(seen, /INSERT INTO generation_files/).length, 0);
});

test("ensureFreshFile: maqola ham eskirgan faylni qayta yasaydi", async (t) => {
  const seen = mockDb(t, {
    versions: { doc_version: 4, file_version: 3, tool_id: "article", file_name: "m.docx", status: "COMPLETED" },
    forEdit: editRow({ doc_version: 4, file_version: 3 }),
    markFile: { file_version: 4 },
  });
  await ensureFreshFile(GEN, USER);
  assert.equal(found(seen, /INSERT INTO generation_files/).length, 1);
});
