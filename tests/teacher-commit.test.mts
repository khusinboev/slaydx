import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import type { AcademicDoc } from "../lib/generation/types.ts";

/**
 * O'QITUVCHI HUJJATI tahrir SERVERI (AUDIT-20 WP-D) — `work-commit` naqshi.
 *
 * BAZASIZ: `pool().query`/`connect()` ushlanadi, so'rovlar SQL matni
 * bo'yicha yo'naltiriladi. Sinaladi:
 *   1) adapter reyestri — BESHALA vosita `teacherAdapter` ni va O'Z op
 *      tilini oladi;
 *   2) `PATCH` yo'li — 409 (versiya), 422 (mazmun), eski hujjat (409
 *      `legacy`), yozilgan hujjatda matn VA model izchilligi;
 *   3) render — DOCX qayta yasaladi, OMR PNG i aktivdan o'qiladi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const { ApiError } = await import("../lib/server/api.ts");
const { loadDocForEdit, commitDocOps } = await import("../lib/server/slide-commit.ts");
const { adapterFor, articleAdapter, slideAdapter, teacherAdapter, workAdapter, editableTools } = await import("../lib/server/edit-adapters.ts");
const { sampleTeacherDoc } = await import("../lib/generation/teacher/samples.ts");
const { TEACHER_TOOL_LIST } = await import("../lib/generation/teacher/types.ts");

const GEN = "a1b2c3d4-0000-4000-8000-000000000020";
const USER = "u-20";
const ASSET = "0123456789abcdef";
const ASSET_URL = `/api/generations/${GEN}/assets/${ASSET}`;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const clone = (d: AcademicDoc): AcademicDoc => JSON.parse(JSON.stringify(d)) as AcademicDoc;

function lessonDoc(): AcademicDoc {
  return clone(sampleTeacherDoc("lesson"));
}

/** OMR PNG i aktivga chiqarilgan test hujjati (worker `extractAssets`). */
function testDoc(): AcademicDoc {
  const d = clone(sampleTeacherDoc("test"));
  d.teacher!.figures = [
    { id: "omr", kind: "scheme", caption: "Javoblar varag‘i", spec: { kind: "omr", ...d.teacher!.test!.omr! }, url: ASSET_URL, assetId: ASSET, w: 1200, h: 1600 },
  ];
  const omr = d.sections.find((s) => s.id === "omr");
  if (omr) omr.blocks = [{ kind: "figure", text: "Javoblar varag‘i", figureId: "omr" }];
  return d;
}

/** Eski o'qituvchi hujjati: `doc.teacher` yo'q. */
function legacyDoc(): AcademicDoc {
  const d = lessonDoc();
  delete d.teacher;
  return d;
}

/* ───────────────────────────── DB stub (bazasiz) ───────────────────────────── */

type Seen = { text: string; params: unknown[] };
type Rows = { forEdit?: Record<string, unknown> | null; detail?: Record<string, unknown> | null; updateDoc?: Record<string, unknown> | null };

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function mockDb(t: TestContext, rows: Rows): Seen[] {
  const seen: Seen[] = [];
  const run = async (text: string, params: unknown[] = []) => {
    seen.push({ text: norm(text), params });
    const q = norm(text);
    let out: unknown[] = [];
    if (/live_json_out/.test(q)) out = rows.detail ? [rows.detail] : [];
    else if (/^SELECT doc_json, doc_version/.test(q)) out = rows.forEdit ? [rows.forEdit] : [];
    else if (/UPDATE generations SET doc_json/.test(q)) out = rows.updateDoc ? [rows.updateDoc] : [];
    return { rows: out, rowCount: out.length };
  };
  const p = pool();
  t.mock.method(p, "query", run);
  t.mock.method(p, "connect", async () => ({ query: run, release() {} }));
  return seen;
}

const found = (seen: Seen[], re: RegExp) => seen.map((s) => s.text).filter((s) => re.test(s));

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
    doc_json: lessonDoc(),
    doc_version: 3,
    file_version: 3,
    image_redraws: 0,
    tool_id: "lesson-plan",
    file_name: "dars-ishlanmasi.docx",
    topic: "Fotosintez va uning bosqichlari",
    status: "COMPLETED",
    ...over,
  };
}

function detailRow(over: Record<string, unknown> = {}) {
  return {
    id: GEN,
    user_id: USER,
    tool_id: "lesson-plan",
    topic: "Fotosintez va uning bosqichlari",
    status: "COMPLETED",
    price: "6000",
    format: "docx",
    progress: 100,
    step: "Tayyor",
    file_name: "dars-ishlanmasi.docx",
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
    doc_json: lessonDoc(),
    live_json_out: null,
    ...over,
  };
}

/** Uy vazifasi paragrafi — nasr bo'limi, model bilan sinxron. */
const HOMEWORK = "sections.3.blocks.0";

/* ══════════════════════════════ adapter reyestri ══════════════════════════════ */

test("adapterFor: BESHALA o'qituvchi vositasi `teacherAdapter` ga; boshqalari o'zgarmagan", () => {
  for (const tool of TEACHER_TOOL_LIST) {
    assert.equal(adapterFor(tool), teacherAdapter, `«${tool}» boshqa adapterga tushdi`);
  }
  assert.equal(teacherAdapter.id, "teacher");
  assert.equal(adapterFor("article"), articleAdapter);
  assert.equal(adapterFor("slide"), slideAdapter);
  assert.equal(adapterFor("coursework"), workAdapter);
  // Begona vosita o'qituvchi adapteriga tushmaydi va aksincha.
  assert.ok(!teacherAdapter.tools.has("article"));
  assert.ok(!teacherAdapter.tools.has("coursework"));
  assert.ok(!workAdapter.tools.has("lesson-plan"));
  for (const tool of TEACHER_TOOL_LIST) assert.ok(editableTools().includes(tool), `«${tool}» tahrirlanadigan vositalar ro'yxatida yo'q`);
  // Reyestr YAGONA manba: beshta vosita kutiladi (yangi qo'shilsa shu yerda ko'rinadi).
  assert.equal(TEACHER_TOOL_LIST.length, 5, `vositalar soni: ${TEACHER_TOOL_LIST.join(", ")}`);
});

test("teacherAdapter.hasModel: MODELLI hujjat — ha; eski (`doc.teacher` yo'q) — YO'Q (409 legacy)", () => {
  assert.equal(teacherAdapter.hasModel(lessonDoc()), true);
  assert.equal(teacherAdapter.hasModel(legacyDoc()), false, "eski o'qituvchi hujjati tahrirga ochildi");
  assert.equal(teacherAdapter.hasModel({ sections: [] } as unknown as AcademicDoc), false);
  assert.equal(teacherAdapter.hasModel(null), false);
  const d = lessonDoc();
  assert.equal(teacherAdapter.prepare(d), d, "prepare nusxalamasligi kerak");
});

test("op TILI vositaga bog'liq — o'qituvchi adapteri begona op tilini qabul qilmaydi", () => {
  assert.equal(teacherAdapter.parse([{ op: "text", index: 0, src: { f: "title" }, value: "x" }]).ok, false, "slayd opi o'tdi");
  assert.equal(teacherAdapter.parse([{ op: "abstract", lang: "uz", text: "x" }]).ok, false, "maqolaning annotatsiya opi o'tdi");
  assert.equal(teacherAdapter.parse([{ op: "refRemove", refId: "W1" }]).ok, false, "talaba ishining manba opi o'tdi");
  // O'z tili — o'tadi (nasr yo'li ham, model yo'li ham).
  assert.equal(teacherAdapter.parse([{ op: "text", path: HOMEWORK, value: "x" }]).ok, true);
  assert.equal(teacherAdapter.parse([{ op: "text", path: "teacher.lesson.homework", value: "x" }]).ok, true);
  // Va teskarisi: o'qituvchi model yo'lini boshqa adapterlar olmaydi.
  assert.equal(workAdapter.parse([{ op: "text", path: "teacher.lesson.homework", value: "x" }]).ok, false);
  assert.equal(slideAdapter.parse([{ op: "text", path: HOMEWORK, value: "x" }]).ok, false);
});

test("teacherAdapter DOCX yasaydi: OMR PNG i `resolveImage` (aktiv) orqali — `<w:drawing>` bor", async () => {
  const asked: string[] = [];
  const built = await teacherAdapter.render(
    {
      id: GEN,
      userId: USER,
      doc: testDoc(),
      fileName: "test.docx",
      resolveImage: async (url) => {
        asked.push(url);
        return url === ASSET_URL ? { data: `image/png;base64,${PNG.toString("base64")}`, type: "png" } : null;
      },
    },
    {},
  );
  assert.equal(built.mime, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(built.fileName, "test.docx");
  assert.deepEqual(asked, [ASSET_URL], "OMR rasmi aktiv URL i bilan so'ralmadi");
  const zip = await JSZip.loadAsync(Buffer.from(built.bytes));
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /<w:drawing>/, "OMR blankasi DOCX ga kirmadi");
  assert.match(xml, /TEST TOPSHIRIG/, "rasmiy shapka yo'q");
  // O'qituvchi hujjatida MUNDARIJA bo'lmaydi (qaror 12 — rasmiy shakl).
  assert.ok(!/MUNDARIJA/.test(xml), "o'qituvchi hujjatida mundarija chizildi");
});

/* ══════════════════════════════ PATCH yo'li ══════════════════════════════ */

test("loadDocForEdit: dars ishlanmasi `teacher` adapteri bilan qaytadi", async (t) => {
  mockDb(t, { forEdit: editRow() });
  const cur = await loadDocForEdit(GEN, USER);
  assert.equal(cur.adapter.id, "teacher");
  assert.ok(cur.doc.teacher);
});

test("loadDocForEdit: ESKI hujjat — 409 `legacy` (model yo'q)", async (t) => {
  mockDb(t, { forEdit: editRow({ doc_json: legacyDoc() }) });
  const e = await expectApiError(loadDocForEdit(GEN, USER), 409);
  assert.equal(e.extra.code, "legacy");
});

test("commitDocOps: baseVersion mos kelmasa — 409 va UPDATE ketmaydi", async (t) => {
  const seen = mockDb(t, { forEdit: editRow({ doc_version: 5 }) });
  const e = await expectApiError(commitDocOps(GEN, USER, 3, [{ op: "text", path: HOMEWORK, value: "x" }] as never), 409);
  assert.equal(e.extra.code, "version");
  assert.equal(found(seen, /UPDATE generations SET doc_json/).length, 0);
});

test("commitDocOps: yaroqsiz op — 422 (`at` bilan), bazaga hech narsa yozilmaydi", async (t) => {
  const seen = mockDb(t, { forEdit: editRow() });
  const e = await expectApiError(
    commitDocOps(GEN, USER, 3, [{ op: "text", path: HOMEWORK, value: "ok" }, { op: "heading", sectionId: "yo-q", title: "x" }] as never),
    422,
  );
  assert.equal(e.extra.at, 1);
  assert.equal(found(seen, /UPDATE generations SET doc_json/).length, 0);
});

test("commitDocOps: yozilgan hujjatda matn VA model izchil; hisobot TEGILMAYDI", async (t) => {
  const row = editRow();
  (row.doc_json as AcademicDoc).teacher!.review = { score: 79, checks: [], judgeNotes: [], builtAt: "2026-09-16T00:00:00.000Z" } as never;
  const seen = mockDb(t, { forEdit: row, updateDoc: { doc_version: 4 }, detail: detailRow() });
  await commitDocOps(
    GEN,
    USER,
    3,
    [
      { op: "heading", sectionId: "goal", title: "Dars maqsadlari" },
      { op: "text", path: HOMEWORK, value: "Sxema chizib, 5 ta savolga javob yozing." },
      { op: "text", path: "teacher.school.subject", value: "Kimyo" },
    ] as never,
  );
  const upd = seen.find((s) => /UPDATE generations SET doc_json/.test(s.text))!;
  const written = JSON.parse(upd.params[2] as string) as AcademicDoc;
  assert.equal(written.sections.find((s) => s.id === "goal")!.title, "Dars maqsadlari");
  assert.equal(written.sections[3].blocks[0].text, "Sxema chizib, 5 ta savolga javob yozing.");
  // NASR → MODEL: hisobot/prompt shu maydondan o'qiydi.
  assert.equal(written.teacher!.lesson!.homework, "Sxema chizib, 5 ta savolga javob yozing.", "model eski uy vazifasida qoldi");
  assert.equal(written.teacher!.school.subject, "Kimyo");
  // SHAPKA → PASPORT: takror qatori ham yangi fan bilan (dublikat chiqmaydi).
  assert.match(written.sections[0].blocks[0].text, /Fan: Kimyo/, "pasport takrori eski fan bilan qoldi");
  assert.equal(written.teacher!.review!.score, 79, "hisobot o'chib ketdi — qayta hisob serverda bo'ladi");
});

test("commitDocOps: `docVersion` oshadi va javob `GenerationDetail` shaklida", async (t) => {
  const seen = mockDb(t, { forEdit: editRow(), updateDoc: { doc_version: 4 }, detail: detailRow({ doc_version: 4 }) });
  const gen = await commitDocOps(GEN, USER, 3, [{ op: "text", path: HOMEWORK, value: "Yangi vazifa." }] as never);
  assert.equal(gen.docVersion, 4, "versiya oshmadi");
  assert.equal(gen.id, GEN);
  assert.equal(gen.type, "lesson-plan");
  // Yozuv BITTA (`html`/`preview` hujjat bilan bir tranzaksiyada).
  assert.equal(found(seen, /UPDATE generations SET doc_json/).length, 1);
});

test("commitDocOps: `review` opi — hisobot yoziladi (server yo'li)", async (t) => {
  const seen = mockDb(t, { forEdit: editRow(), updateDoc: { doc_version: 4 }, detail: detailRow() });
  const review = { score: 88, checks: [], judgeNotes: [], builtAt: "2026-09-16T00:00:00.000Z" };
  await commitDocOps(GEN, USER, 3, [{ op: "review", review }] as never);
  const upd = seen.find((s) => /UPDATE generations SET doc_json/.test(s.text))!;
  const written = JSON.parse(upd.params[2] as string) as AcademicDoc;
  assert.equal(written.teacher!.review!.score, 88);
  // Lekin KLIENTDAN bunday op o'tmaydi — darvoza `parse` da.
  assert.equal(teacherAdapter.parse([{ op: "review", review }]).ok, false, "klient hisobotni o'zi yozib yubordi");
});
