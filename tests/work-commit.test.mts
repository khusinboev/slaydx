import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import type { AcademicDoc, DocMeta } from "../lib/generation/types.ts";

/**
 * TALABA ISHI tahrir SERVERI (AUDIT-19 WP-C) — `article-commit` naqshi.
 *
 * BAZASIZ: `pool().query`/`connect()` ushlanadi, so'rovlar SQL matni
 * bo'yicha yo'naltiriladi. Sinaladi:
 *   1) adapter reyestri — uchala vosita (`coursework`/`referat`/
 *      `mustaqil-ish`) `workAdapter` ni va O'Z op tilini oladi;
 *   2) `PATCH` yo'li — 409 (versiya), 422 (mazmun), eski hujjat (409
 *      `legacy`), yozilgan hujjatda matn va sinxron nusxalar;
 *   3) render — DOCX qayta yasaladi, sxema PNG aktivdan o'qiladi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const { ApiError } = await import("../lib/server/api.ts");
const { loadDocForEdit, commitDocOps } = await import("../lib/server/slide-commit.ts");
const { adapterFor, articleAdapter, resumeAdapter, slideAdapter, workAdapter, editableTools } = await import("../lib/server/edit-adapters.ts");
const { sampleWorkDoc } = await import("../lib/generation/work/samples.ts");

const GEN = "a1b2c3d4-0000-4000-8000-000000000019";
const USER = "u-19";
const ASSET = "fedcba9876543210";
const ASSET_URL = `/api/generations/${GEN}/assets/${ASSET}`;

/**
 * `commitDocOps` hujjat bilan birga HTML ko'rinishini ham qayta yasaydi
 * (`render-html.ts`), u esa titul maydonlarini `meta` dan o'qiydi —
 * shuning uchun bu yerdagi meta TO'LIQ (haqiqiy `extractMeta` ham
 * shularni beradi).
 */
const META = {
  topic: "Oliy ta’limda adaptiv o‘qitish tizimlarini joriy etish",
  workLabel: "Kurs ishi",
  language: "uz",
  toolId: "coursework",
  university: "Toshkent axborot texnologiyalari universiteti",
  faculty: "Dasturiy injiniring",
  department: "Axborot ta’lim texnologiyalari",
  subject: "Ta’limda axborot texnologiyalari",
  author: "Aliyev Ali Valiyevich",
  teacher: "Karimova Dilnoza Baxtiyorovna",
  city: "Toshkent",
  group: "301",
  course: "3",
  ministry: "oliy",
} as unknown as DocMeta;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function workDoc(): AcademicDoc {
  const d = JSON.parse(JSON.stringify(sampleWorkDoc(META))) as AcademicDoc;
  // Sxema PNG allaqachon aktivga chiqarilgan (worker `extractAssets`).
  d.work!.figures[0].url = ASSET_URL;
  d.work!.figures[0].assetId = ASSET;
  return d;
}

/** Eski kurs ishi: `doc.work` yo'q. */
function legacyDoc(): AcademicDoc {
  const d = JSON.parse(JSON.stringify(sampleWorkDoc(META))) as AcademicDoc;
  delete d.work;
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
    doc_json: workDoc(),
    doc_version: 3,
    file_version: 3,
    image_redraws: 0,
    tool_id: "coursework",
    file_name: "kurs-ishi.docx",
    topic: META.topic,
    status: "COMPLETED",
    ...over,
  };
}

function detailRow(over: Record<string, unknown> = {}) {
  return {
    id: GEN,
    user_id: USER,
    tool_id: "coursework",
    topic: META.topic,
    status: "COMPLETED",
    price: "24000",
    format: "docx",
    progress: 100,
    step: "Tayyor",
    file_name: "kurs-ishi.docx",
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
    doc_json: workDoc(),
    live_json_out: null,
    ...over,
  };
}

const textOp = [{ op: "text", path: "sections.0.blocks.0", value: "Tahrirlangan kirish jumlasi [lex:2]." }] as const;

/* ══════════════════════════════ adapter reyestri ══════════════════════════════ */

test("adapterFor: uchala talaba ishi vositasi `workAdapter` ga; maqola/slayd/rezyume o'zgarmagan", () => {
  for (const tool of ["coursework", "referat", "mustaqil-ish"]) {
    assert.equal(adapterFor(tool), workAdapter, `«${tool}» boshqa adapterga tushdi`);
  }
  assert.equal(adapterFor("article"), articleAdapter);
  assert.equal(adapterFor("slide"), slideAdapter);
  assert.equal(adapterFor("resume"), resumeAdapter);
  // Insho — o'z adapteri (WP-E1), talaba ishiniki EMAS.
  assert.equal(adapterFor("essay")?.id, "essay");
  assert.ok(!workAdapter.tools.has("essay"), "insho work adapteriga tushdi");
  assert.equal(workAdapter.id, "work");
  // Maqola adapteri talaba ishini OLMAYDI va aksincha.
  assert.ok(!articleAdapter.tools.has("coursework"));
  assert.ok(!workAdapter.tools.has("article"));
  for (const tool of ["coursework", "referat", "mustaqil-ish"]) assert.ok(editableTools().includes(tool));
});

test("workAdapter.hasModel: MODELLI hujjat — ha; eski (`doc.work` yo'q) — YO'Q (409 legacy)", () => {
  assert.equal(workAdapter.hasModel(workDoc()), true);
  assert.equal(workAdapter.hasModel(legacyDoc()), false, "eski kurs ishi tahrirga ochildi");
  assert.equal(workAdapter.hasModel({ sections: [] } as unknown as AcademicDoc), false);
  assert.equal(workAdapter.hasModel(null), false);
  const d = workDoc();
  assert.equal(workAdapter.prepare(d), d, "prepare nusxalamasligi kerak");
});

test("op TILI vositaga bog'liq — work adapteri slayd/rezyume/maqola opini qabul qilmaydi", () => {
  assert.equal(workAdapter.parse([{ op: "text", index: 0, src: { f: "title" }, value: "x" }]).ok, false, "slayd opi o'tdi");
  assert.equal(workAdapter.parse([{ op: "text", path: "identity.fullName", value: "x" }]).ok, false, "rezyume yo'li o'tdi");
  assert.equal(workAdapter.parse([{ op: "abstract", lang: "uz", text: "x" }]).ok, false, "maqolaning annotatsiya opi o'tdi");
  assert.equal(workAdapter.parse([{ op: "highlights", items: ["x"] }]).ok, false, "maqolaning «asosiy natijalar» opi o'tdi");
  assert.equal(workAdapter.parse([...textOp]).ok, true);
  assert.equal(resumeAdapter.parse([...textOp]).ok, false);
  assert.equal(slideAdapter.parse([...textOp]).ok, false);
});

test("workAdapter DOCX yasaydi: sxema PNG `resolveImage` (aktiv) orqali — `<w:drawing>` va MUNDARIJA bor", async () => {
  const asked: string[] = [];
  const built = await workAdapter.render(
    {
      id: GEN,
      userId: USER,
      doc: workDoc(),
      fileName: "kurs-ishi.docx",
      resolveImage: async (url) => {
        asked.push(url);
        return url === ASSET_URL ? { data: `image/png;base64,${PNG.toString("base64")}`, type: "png" } : null;
      },
    },
    {},
  );
  assert.equal(built.mime, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(built.fileName, "kurs-ishi.docx");
  assert.deepEqual(asked, [ASSET_URL], "rasm aktiv URL i bilan so'ralmadi");
  const zip = await JSZip.loadAsync(Buffer.from(built.bytes));
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.match(xml, /<w:drawing>/, "sxema DOCX ga kirmadi");
  assert.match(xml, /2\.1-rasm\./);
  assert.match(xml, /MUNDARIJA/, "talaba ishida mundarija bo'lishi SHART");
  assert.match(xml, /1-BOB\./);
});

/* ══════════════════════════════ PATCH yo'li ══════════════════════════════ */

test("loadDocForEdit: kurs ishi `work` adapteri bilan qaytadi", async (t) => {
  mockDb(t, { forEdit: editRow() });
  const cur = await loadDocForEdit(GEN, USER);
  assert.equal(cur.adapter.id, "work");
  assert.ok(cur.doc.work);
});

test("loadDocForEdit: ESKI hujjat — 409 `legacy` (model yo'q)", async (t) => {
  mockDb(t, { forEdit: editRow({ doc_json: legacyDoc() }) });
  const e = await expectApiError(loadDocForEdit(GEN, USER), 409);
  assert.equal(e.extra.code, "legacy");
});

test("commitDocOps: baseVersion mos kelmasa — 409 va UPDATE ketmaydi", async (t) => {
  const seen = mockDb(t, { forEdit: editRow({ doc_version: 5 }) });
  const e = await expectApiError(commitDocOps(GEN, USER, 3, textOp as never), 409);
  assert.equal(e.extra.code, "version");
  assert.equal(found(seen, /UPDATE generations SET doc_json/).length, 0);
});

test("commitDocOps: yaroqsiz op — 422 (`at` bilan), bazaga hech narsa yozilmaydi", async (t) => {
  const seen = mockDb(t, { forEdit: editRow() });
  const e = await expectApiError(
    commitDocOps(GEN, USER, 3, [{ op: "text", path: "sections.0.blocks.0", value: "ok" }, { op: "heading", sectionId: "yo-q", title: "x" }] as never),
    422,
  );
  assert.equal(e.extra.at, 1);
  assert.equal(found(seen, /UPDATE generations SET doc_json/).length, 0);
});

test("commitDocOps: yozilgan hujjatda matn, sinxron BOB DARAXTI va qayta hisoblangan `cited`; hisobot TEGILMAYDI", async (t) => {
  const row = editRow();
  (row.doc_json as AcademicDoc).work!.review = { score: 81, checks: [], judgeNotes: [], builtAt: "2026-09-16T00:00:00.000Z" } as never;
  const seen = mockDb(t, { forEdit: row, updateDoc: { doc_version: 4 }, detail: detailRow() });
  await commitDocOps(
    GEN,
    USER,
    3,
    [
      { op: "heading", sectionId: "ch1", title: "Nazariy asoslar" },
      { op: "caption", target: "figure", id: "f1", value: "Tizimning blok-sxemasi" },
      /*
       * `u6` faqat shu blokda (`ch1.1` — bo'limlar tartibida 2-indeks)
       * iqtibos qilingan; matn o'zgarsa u ro'yxatdan TUSHADI.
       */
      { op: "text", path: "sections.2.blocks.1", value: "Tasniflash mezoni sifatida moslashuv darajasi olinadi." },
    ] as never,
  );
  const upd = seen.find((s) => /UPDATE generations SET doc_json/.test(s.text))!;
  const written = JSON.parse(upd.params[2] as string) as AcademicDoc;
  assert.equal(written.sections.find((s) => s.id === "ch1")!.title, "Nazariy asoslar");
  assert.equal(written.work!.chapters.find((c) => c.id === "ch1")!.title, "Nazariy asoslar", "bob daraxti eskirib qoldi");
  assert.equal(written.work!.figures[0].caption, "Tizimning blok-sxemasi", "model sarlavhasi sinxron emas");
  assert.equal(written.work!.figures[0].url, ASSET_URL, "rasm aktivi yo'qoldi");
  assert.equal(written.work!.references.find((r) => r.id === "u6")!.cited, false, "u6 endi iqtibos qilinmagan");
  assert.equal(written.work!.review!.score, 81, "hisobot o'chib ketdi — qayta hisob serverda bo'ladi");
});
