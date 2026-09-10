import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import type { AcademicDoc } from "../lib/generation/types.ts";

/**
 * Rezyume tahrir SERVERI (Rezyume 2, AUDIT-15 — B-2/B-5/B-6).
 *
 * BAZASIZ: `pool().query` va `pool().connect()` ushlanadi
 * (`tests/slide-doc-route.test.mts` naqshi), so'rovlar SQL matni bo'yicha
 * yo'naltiriladi. Shu bilan uch narsa sinaladi:
 *
 *   1) adapter reyestri — qaysi vosita qaysi op tilini va qaysi
 *      rendererni oladi (slayd yo'li BUZILMAGANI ham shu yerda);
 *   2) `PATCH` yo'li — versiya qulfi (409), `doc_prev` (birinchi tahrir),
 *      atomarlik;
 *   3) `rebuildFile` — DOCX qayta yasaladi va ESKIZ AKTIVI o'sha
 *      tranzaksiyada o'chadi (B-5, aks holda karta eskizi eskirib qoladi).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const { ApiError } = await import("../lib/server/api.ts");
const { loadDocForEdit, commitDocOps, rebuildFile, ensureFreshFile, patchDocFromRequest } = await import(
  "../lib/server/slide-commit.ts"
);
const { adapterFor, editableTools, preParseOps, resumeAdapter, slideAdapter } = await import(
  "../lib/server/edit-adapters.ts"
);
const { extractAssets } = await import("../lib/server/assets.ts");
const { THUMB_ASSET_ID } = await import("../lib/server/thumb.ts");
const { docFromResume, legacyResumeModel } = await import("../lib/generation/resume/model.ts");
const { sampleResume } = await import("../lib/generation/resume/samples.ts");
const { extractMeta } = await import("../lib/generation/meta.ts");
const { TOOL_BY_ID } = await import("../lib/tools.ts");

const GEN = "a1b2c3d4-0000-4000-8000-000000000001";
const USER = "u-42";

const meta = extractMeta(TOOL_BY_ID.resume, { topic: "Moliya tahlilchisi", fullName: "Karimova Dilnoza" } as never);

function resumeDoc(): AcademicDoc {
  return docFromResume(sampleResume("modern", undefined, false), meta);
}

/** Rezyume 2 dan OLDINGI hujjat: `doc.resume` yo'q, 4 bo'lim bor. */
function legacyDoc(): AcademicDoc {
  return {
    meta,
    titlePage: false,
    toc: false,
    sections: [
      { id: "summary", title: "Qisqacha", blocks: [{ kind: "p", text: "Tajribali mutaxassis." }, { kind: "p", text: "Toshkent · a@b.uz" }] },
      { id: "exp", title: "Tajriba", blocks: [{ kind: "h3", text: "2020–2024 — Tahlilchi" }, { kind: "li", text: "Natija." }] },
    ],
  } as unknown as AcademicDoc;
}

/* ───────────────────────────── DB stub (bazasiz) ───────────────────────────── */

type Seen = { text: string; params: unknown[] };
type Rows = {
  forEdit?: Record<string, unknown> | null;
  versions?: Record<string, unknown> | null;
  detail?: Record<string, unknown> | null;
  updateDoc?: Record<string, unknown> | null;
  markFile?: Record<string, unknown> | null;
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
    doc_json: resumeDoc(),
    doc_version: 3,
    file_version: 3,
    image_redraws: 0,
    tool_id: "resume",
    file_name: "rezyume.docx",
    topic: "Moliya tahlilchisi",
    status: "COMPLETED",
    ...over,
  };
}

function detailRow(over: Record<string, unknown> = {}) {
  return {
    id: GEN,
    user_id: USER,
    tool_id: "resume",
    topic: "Moliya tahlilchisi",
    status: "COMPLETED",
    price: "3000",
    format: "docx",
    progress: 100,
    step: "Tayyor",
    file_name: "rezyume.docx",
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
    doc_json: resumeDoc(),
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

/* ══════════════════════════════ adapter reyestri ══════════════════════════════ */

test("adapterFor: vosita → adapter; tahrirlanmaydigan vosita — null", () => {
  assert.equal(adapterFor("slide"), slideAdapter);
  assert.equal(adapterFor("pro-slide"), slideAdapter);
  assert.equal(adapterFor("resume"), resumeAdapter);
  for (const t of ["referat", "essay", "translation", "glossary", ""]) {
    assert.equal(adapterFor(t), null, `«${t}» tahrirlanadigan bo'lib qoldi`);
  }
  assert.deepEqual(new Set(editableTools()), new Set(["slide", "pro-slide", "resume"]));
});

test("adapter `hasModel`: slayd — `doc.slides`, rezyume — model yoki eski bo'limlar", () => {
  assert.equal(slideAdapter.hasModel(resumeDoc()), false, "rezyume hujjati slayd adapteriga tushmasin");
  assert.equal(slideAdapter.hasModel({ slides: [] } as unknown as AcademicDoc), false);
  assert.equal(resumeAdapter.hasModel(resumeDoc()), true);
  assert.equal(resumeAdapter.hasModel(legacyDoc()), true, "eski rezyume ham tahrirlanadi (B-8)");
  assert.equal(resumeAdapter.hasModel({ sections: [] } as unknown as AcademicDoc), false);
  assert.equal(resumeAdapter.hasModel(null), false);
});

test("`prepare` eski hujjatni modelga ko'taradi, yangisiga TEGMAYDI", () => {
  const legacy = legacyDoc();
  const up = resumeAdapter.prepare(legacy);
  assert.ok(up.resume, "eski hujjatga model qo'shilmadi");
  assert.equal(up.resume?.identity.headline, legacyResumeModel(legacy).identity.headline);
  const fresh = resumeDoc();
  assert.equal(resumeAdapter.prepare(fresh), fresh, "yangi hujjat nusxalanmasligi kerak");
});

test("op TILI vositaga bog'liq — begona op qabul qilinmaydi", () => {
  const slideOp = [{ op: "text", index: 0, src: { f: "title" }, value: "x" }];
  const resumeOp = [{ op: "text", path: "identity.fullName", value: "x" }];
  assert.equal(resumeAdapter.parse(slideOp).ok, false, "rezyume adapteri slayd opini qabul qildi");
  assert.equal(slideAdapter.parse(resumeOp).ok, false, "slayd adapteri rezyume opini qabul qildi");
  assert.equal(resumeAdapter.parse(resumeOp).ok, true);
  assert.equal(slideAdapter.parse(slideOp).ok, true);
});

test("`preParseOps` — hujjat turidan mustaqil envelope darvozasi", () => {
  assert.equal(preParseOps([{ op: "text" }]).ok, true);
  assert.equal(preParseOps(null).ok, false);
  assert.equal(preParseOps([]).ok, false);
  const over = preParseOps(Array.from({ length: 51 }, () => ({ op: "text" })));
  assert.equal(over.ok, false);
  if (!over.ok) assert.match(over.error, /50/);
});

test("rezyume adapteri DOCX yasaydi (mime va haqiqiy ZIP)", async () => {
  const built = await resumeAdapter.render(
    { id: GEN, userId: USER, doc: resumeDoc(), fileName: "rezyume.docx", resolveImage: async () => null },
    {},
  );
  assert.equal(built.mime, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(built.fileName, "rezyume.docx");
  const zip = await JSZip.loadAsync(Buffer.from(built.bytes));
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /Karimova Dilnoza/);
});

/* ══════════════════════════════ extractAssets (B-2) ══════════════════════════════ */

const PNG_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("extractAssets rezyume suratini AKTIVGA chiqaradi (url va assetId)", () => {
  const m = sampleResume("modern", undefined, false);
  m.photo = { url: PNG_URL, shape: "circle", assetId: "" };
  const doc = docFromResume(m, meta);
  const out = extractAssets(GEN, doc, "<html></html>");

  assert.equal(out.assets.length, 1, "surat bayti aktivga chiqmadi");
  const photo = out.doc?.resume?.photo;
  assert.ok(photo, "surat modeldan yo'qolib qoldi");
  assert.match(photo!.url, new RegExp(`^/api/generations/${GEN}/assets/[0-9a-f]+$`));
  assert.equal(photo!.assetId, out.assets[0].assetId, "`assetId` URL bilan mos emas");
  assert.ok(!photo!.url.startsWith("data:"), "megabaytlik `data:` doc_json da qolib ketdi");
  assert.equal(photo!.shape, "circle", "boshqa maydonlar saqlanishi kerak");
});

test("aktiv URL i allaqachon qo'yilgan surat o'zgarmaydi", () => {
  const m = sampleResume("modern", undefined, false);
  const url = `/api/generations/${GEN}/assets/abc123`;
  m.photo = { url, shape: "circle", assetId: "abc123" };
  const out = extractAssets(GEN, docFromResume(m, meta), "");
  assert.equal(out.assets.length, 0);
  assert.equal(out.doc?.resume?.photo?.url, url);
});

test("suratsiz rezyume — aktiv yo'q, model o'zgarmaydi", () => {
  const doc = resumeDoc();
  const out = extractAssets(GEN, doc, "");
  assert.equal(out.assets.length, 0);
  assert.equal(out.doc?.resume?.photo, undefined);
});

/* ══════════════════════════════ PATCH yo'li ══════════════════════════════ */

const nameOp = [{ op: "text", path: "identity.fullName", value: "Yangi Ism" }] as const;

test("loadDocForEdit: rezyume hujjati adapter bilan qaytadi", async (t) => {
  mockDb(t, { forEdit: editRow() });
  const cur = await loadDocForEdit(GEN, USER);
  assert.equal(cur.adapter.id, "resume");
  assert.ok(cur.doc.resume);
});

test("loadDocForEdit: eski rezyume 409 EMAS — modelga ko'tarilib qaytadi (B-8)", async (t) => {
  mockDb(t, { forEdit: editRow({ doc_json: legacyDoc() }) });
  const cur = await loadDocForEdit(GEN, USER);
  assert.equal(cur.adapter.id, "resume");
  assert.ok(cur.doc.resume, "eski hujjat modelga ko'tarilmadi");
});

test("loadDocForEdit: tahrirlanmaydigan vosita — 409 {code:'legacy'}", async (t) => {
  mockDb(t, { forEdit: editRow({ tool_id: "referat" }) });
  const e = await expectApiError(loadDocForEdit(GEN, USER), 409);
  assert.equal(e.extra.code, "legacy");
});

test("commitDocOps: baseVersion mos kelmasa — 409 va UPDATE ketmaydi", async (t) => {
  const seen = mockDb(t, { forEdit: editRow({ doc_version: 5 }) });
  const e = await expectApiError(commitDocOps(GEN, USER, 3, nameOp as never), 409);
  assert.equal(e.extra.code, "version");
  assert.equal(found(seen, /UPDATE generations SET doc_json/).length, 0);
});

test("commitDocOps: yaroqsiz op — 422, bazaga hech narsa yozilmaydi", async (t) => {
  const seen = mockDb(t, { forEdit: editRow() });
  await expectApiError(commitDocOps(GEN, USER, 3, [{ op: "rowRemove", section: "experience", index: 99 }] as never), 422);
  assert.equal(found(seen, /UPDATE generations SET doc_json/).length, 0);
});

test("commitDocOps: BIRINCHI tahrir (doc_version=0) — `doc_prev` saqlanadi", async (t) => {
  const seen = mockDb(t, { forEdit: editRow({ doc_version: 0 }), updateDoc: { doc_version: 1 }, detail: detailRow() });
  await commitDocOps(GEN, USER, 0, nameOp as never);
  const upd = found(seen, /UPDATE generations SET doc_json/);
  assert.equal(upd.length, 1);
  assert.match(upd[0], /doc_prev = COALESCE\(doc_prev, doc_json\)/, "birinchi tahrirda `doc_prev` yozilmadi");
});

test("commitDocOps: keyingi tahrirlarda `doc_prev` TEGILMAYDI", async (t) => {
  const seen = mockDb(t, { forEdit: editRow({ doc_version: 3 }), updateDoc: { doc_version: 4 }, detail: detailRow() });
  await commitDocOps(GEN, USER, 3, nameOp as never);
  assert.ok(!found(seen, /UPDATE generations SET doc_json/)[0].includes("doc_prev ="));
});

test("commitDocOps: yozilgan hujjatda model ham, `sections` ham yangilangan", async (t) => {
  const seen = mockDb(t, { forEdit: editRow(), updateDoc: { doc_version: 4 }, detail: detailRow() });
  await commitDocOps(GEN, USER, 3, nameOp as never);
  const upd = seen.find((s) => /UPDATE generations SET doc_json/.test(s.text))!;
  // `updateGenerationDoc`: [id, userId, doc_json, html, preview, expectedVersion]
  const written = JSON.parse(upd.params[2] as string) as AcademicDoc;
  assert.equal(written.resume?.identity.fullName, "Yangi Ism");
  assert.equal(written.meta.author, "Yangi Ism", "`meta.author` sinxron emas");
});

test("patchDocFromRequest: rezyume tanasi rezyume adapteri bilan parse qilinadi", async (t) => {
  mockDb(t, { forEdit: editRow(), updateDoc: { doc_version: 4 }, detail: detailRow() });
  await patchDocFromRequest(patchReq({ baseVersion: 3, ops: nameOp }), GEN, USER);
});

test("patchDocFromRequest: SLAYD opi rezyume hujjatiga yuborilsa — 400", async (t) => {
  mockDb(t, { forEdit: editRow() });
  await expectApiError(
    patchDocFromRequest(patchReq({ baseVersion: 3, ops: [{ op: "layout", index: 0, layout: "bullets" }] }), GEN, USER),
    400,
  );
});

test("patchDocFromRequest: 50 tadan ortiq op — 400 va bazaga UMUMAN borilmaydi", async (t) => {
  const seen = mockDb(t, { forEdit: editRow() });
  const ops = Array.from({ length: 51 }, () => ({ op: "text", path: "summary", value: "x" }));
  const e = await expectApiError(patchDocFromRequest(patchReq({ baseVersion: 3, ops }), GEN, USER), 400);
  assert.match(e.message, /50/);
  assert.equal(seen.length, 0, "yaroqsiz tana bazaga bordi");
});

/* ══════════════════════════════ rebuildFile (B-5) ══════════════════════════════ */

test("rebuildFile: DOCX qayta yasaladi va ESKIZ AKTIVI o'sha tranzaksiyada o'chadi", async (t) => {
  const seen = mockDb(t, {
    forEdit: editRow({ doc_version: 4, file_version: 3 }),
    markFile: { file_version: 4 },
  });
  const out = await rebuildFile(GEN, USER);
  assert.equal(out.rebuilt, true);
  assert.equal(out.fileVersion, 4);

  const del = seen.find((s) => /DELETE FROM generation_assets WHERE generation_id = \$1 AND asset_id = \$2/.test(s.text));
  assert.ok(del, "eskiz aktivi o'chirilmadi — karta eskizi eskirib qoladi (B-5)");
  assert.deepEqual(del!.params, [GEN, THUMB_ASSET_ID]);

  // TARTIB: o'chirish fayl yozilgan tranzaksiyaning ICHIDA.
  const order = sqls(seen);
  const iLock = order.findIndex((s) => /pg_advisory_xact_lock/.test(s));
  const iDel = order.findIndex((s) => /DELETE FROM generation_assets WHERE generation_id = \$1 AND asset_id/.test(s));
  const iCommit = order.findIndex((s) => /^COMMIT$/.test(s));
  assert.ok(iLock >= 0 && iDel > iLock, "o'chirish tranzaksiyadan tashqarida");
  assert.ok(iCommit === -1 || iDel < iCommit, "o'chirish COMMIT dan keyin");

  // Yozilgan bayt HAQIQIY DOCX.
  const ins = seen.find((s) => /INSERT INTO generation_files/.test(s.text));
  assert.ok(ins, "fayl yozilmadi");
  const bytes = ins!.params[4] as Uint8Array;
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  assert.ok(zip.file("word/document.xml"), "DOCX emas");
  assert.equal(ins!.params[2], "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
});

test("rebuildFile: fayl yangi bo'lsa — render ham, o'chirish ham yo'q", async (t) => {
  const seen = mockDb(t, { forEdit: editRow({ doc_version: 4, file_version: 4 }) });
  const out = await rebuildFile(GEN, USER);
  assert.equal(out.rebuilt, false);
  assert.equal(found(seen, /DELETE FROM generation_assets/).length, 0);
  assert.equal(found(seen, /INSERT INTO generation_files/).length, 0);
});

test("rebuildFile: markFileVersion 0 qator — bayt ham, eskiz o'chirish ham yo'q", async (t) => {
  const seen = mockDb(t, {
    forEdit: editRow({ doc_version: 4, file_version: 3 }),
    markFile: null,
    versions: { doc_version: 4, file_version: 4, tool_id: "resume", file_name: "r.docx", status: "COMPLETED" },
  });
  const out = await rebuildFile(GEN, USER);
  assert.equal(out.rebuilt, false);
  assert.equal(found(seen, /INSERT INTO generation_files/).length, 0);
  assert.equal(found(seen, /DELETE FROM generation_assets/).length, 0);
});

test("ensureFreshFile: rezyume ham eskirgan faylni qayta yasaydi", async (t) => {
  const seen = mockDb(t, {
    versions: { doc_version: 4, file_version: 3, tool_id: "resume", file_name: "r.docx", status: "COMPLETED" },
    forEdit: editRow({ doc_version: 4, file_version: 3 }),
    markFile: { file_version: 4 },
  });
  await ensureFreshFile(GEN, USER);
  assert.equal(found(seen, /INSERT INTO generation_files/).length, 1);
});

test("ensureFreshFile: tahrirlanmaydigan vosita — qayta yasash YO'Q", async (t) => {
  const seen = mockDb(t, {
    versions: { doc_version: 4, file_version: 3, tool_id: "referat", file_name: "r.docx", status: "COMPLETED" },
  });
  await ensureFreshFile(GEN, USER);
  assert.equal(found(seen, /INSERT INTO generation_files/).length, 0);
});
