import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";
import type { DocOp } from "../lib/generation/slide-edit.ts";

/**
 * E4 — tahrir serverining yadrosi (`lib/server/slide-commit.ts` va uni
 * chaqiradigan `doc`/`rebuild`/`file` route'lari).
 *
 * BAZASIZ: `pool().query` va `pool().connect()` ushlanadi
 * (`tests/logo.test.mts:173` va `tests/jobs-live-edit.test.mts` naqshi),
 * so'rovlar SQL matni bo'yicha yo'naltiriladi. Shu bilan uchta narsa
 * sinaladi: (1) SQL predikatlari — egalik va `status` route darajasida
 * emas, bazada; (2) tartib — render tranzaksiyadan TASHQARIDA; (3) xato
 * bo'lganda bazaga hech narsa yozilmasligi.
 *
 * Route funksiyalarining o'zi (`PATCH`/`POST`/`GET`) chaqirilmaydi:
 * `requireUser` → `cookies()` faqat Next so'rov konteksti ichida
 * ishlaydi. Route'lar `slide-commit.ts` dagi AYNAN shu funksiyalarni
 * chaqiradi (`patchDocFromRequest`, `rebuildFile`, `ensureFreshFile`),
 * shuning uchun sinov haqiqiy kod yo'lini sinaydi — `uploadLogo` bilan
 * bir xil yondashuv.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const { ApiError } = await import("../lib/server/api.ts");
const {
  loadDocForEdit,
  commitDocOps,
  rebuildFile,
  ensureFreshFile,
  patchDocFromRequest,
  restoreDoc,
  DOC_PATCH_MAX_BYTES,
} = await import("../lib/server/slide-commit.ts");
const { extractMeta } = await import("../lib/generation/meta.ts");
const { TOOL_BY_ID } = await import("../lib/tools.ts");
const { fallbackSlides } = await import("../lib/generation/slide-write.ts");

const GEN = "a1b2c3d4-0000-4000-8000-000000000001";
const USER = "u-42";

const meta = extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi", slideTemplate: "lecture" } as never);

const slides: SlideModel[] = [
  { id: "s0", layout: "title", title: "Suv aylanishi", subtitle: "Kirish" },
  { id: "s1", layout: "bullets", title: "Bandlar", bullets: ["Bir.", "Ikki."] },
];

function docOf(list: SlideModel[] = slides): AcademicDoc {
  return { meta, titlePage: true, toc: true, sections: [], slides: list, slideTemplate: "lecture" };
}

// ───────────────────────────────────────────── DB stub (bazasiz)

type Seen = { text: string; params: unknown[] };

/** Qatorlar: har so'rov turi uchun nima qaytarilsin. `null` — 0 qator. */
type Rows = {
  forEdit?: Record<string, unknown> | null;
  versions?: Record<string, unknown> | null;
  detail?: Record<string, unknown> | null;
  updateDoc?: Record<string, unknown> | null;
  markFile?: Record<string, unknown> | null;
  hasFile?: boolean;
  /** `getGenerationForRestore` (`POST …/doc/restore`). */
  forRestore?: Record<string, unknown> | null;
  /** `restoreGenerationDoc` UPDATE natijasi. */
  restoreDoc?: Record<string, unknown> | null;
};

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * `pool().query` VA `pool().connect()` ni ushlaydi — `transaction()`
 * ham shu yerdan o'tadi, ya'ni BEGIN/COMMIT/ROLLBACK va tranzaksiya
 * ichidagi so'rovlar bitta ro'yxatda, TARTIBI bilan ko'rinadi.
 */
function mockDb(t: TestContext, rows: Rows): Seen[] {
  const seen: Seen[] = [];
  const run = async (text: string, params: unknown[] = []) => {
    seen.push({ text: norm(text), params });
    const q = norm(text);
    let out: unknown[] = [];
    if (/live_json_out/.test(q)) out = rows.detail ? [rows.detail] : [];
    else if (/^SELECT doc_prev, doc_version, status/.test(q)) out = rows.forRestore ? [rows.forRestore] : [];
    else if (/^SELECT doc_json, doc_version/.test(q)) out = rows.forEdit ? [rows.forEdit] : [];
    else if (/^SELECT doc_version, file_version, tool_id/.test(q)) out = rows.versions ? [rows.versions] : [];
    else if (/SET doc_json = doc_prev/.test(q)) out = rows.restoreDoc ? [rows.restoreDoc] : [];
    else if (/UPDATE generations SET doc_json/.test(q)) out = rows.updateDoc ? [rows.updateDoc] : [];
    else if (/SET file_version = \$3/.test(q)) out = rows.markFile ? [rows.markFile] : [];
    else if (/FROM generation_files f JOIN generations/.test(q)) out = rows.hasFile ? [{ "?column?": 1 }] : [];
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

/** `getGenerationForEdit` qaytaradigan qator. */
function editRow(over: Record<string, unknown> = {}) {
  return {
    doc_json: docOf(),
    doc_version: 3,
    file_version: 3,
    image_redraws: 1,
    tool_id: "slide",
    file_name: "deka.pptx",
    topic: "Suv aylanishi",
    status: "COMPLETED",
    ...over,
  };
}

/** `getGeneration` (to'liq detal) qaytaradigan qator — `ROW_COLUMNS` + html/doc. */
function detailRow(over: Record<string, unknown> = {}) {
  return {
    id: GEN,
    user_id: USER,
    tool_id: "slide",
    topic: "Suv aylanishi",
    status: "COMPLETED",
    price: "2000",
    format: "pptx",
    progress: 100,
    step: "Tayyor",
    file_name: "deka.pptx",
    error: null,
    preview: null,
    delivered_json: null,
    created_at: new Date(),
    started_at: new Date(),
    finished_at: new Date(),
    expires_at: null,
    doc_version: 4,
    file_version: 3,
    image_redraws: 1,
    edited_at: new Date(),
    live_seq: 0,
    html: "<html></html>",
    doc_json: docOf(),
    live_json_out: null,
    ...over,
  };
}

/** `getGenerationForRestore` qaytaradigan qator. */
function restoreRow(over: Record<string, unknown> = {}) {
  return {
    doc_prev: docOf(),
    doc_version: 4,
    status: "COMPLETED",
    ...over,
  };
}

const textOp: DocOp[] = [{ op: "text", index: 1, src: { f: "title" }, value: "Yangi sarlavha" }];

// ═══════════════════════════════════════════ loadDocForEdit

test("loadDocForEdit: qator yo'q (yoki begona egа) — 404, egalik SQL predikatida", async (t) => {
  const seen = mockDb(t, { forEdit: null });
  await expectApiError(loadDocForEdit(GEN, USER), 404);
  assert.equal(seen.length, 1);
  /*
   * MUTATSIYA: `getGenerationForEdit` dan `AND user_id = $2` olib
   * tashlansa shu assertion qizaradi — ya'ni begona hujjatni tahrirga
   * ochib yuborish CI da ushlanadi (`CLAUDE.md`: «route darajasidagi
   * tekshiruv YETARLI EMAS»).
   */
  assert.match(seen[0].text, /WHERE id = \$1 AND user_id = \$2/);
  assert.deepEqual(seen[0].params, [GEN, USER]);
});

test("loadDocForEdit: hali tayyor emas — 409 {code:'status'}", async (t) => {
  mockDb(t, { forEdit: editRow({ status: "IN_PROGRESS", doc_json: null }) });
  const e = await expectApiError(loadDocForEdit(GEN, USER), 409);
  assert.equal(e.extra.code, "status");
  assert.equal(e.extra.status, "IN_PROGRESS");
});

test("loadDocForEdit: slayd bo'lmagan vosita — 409 {code:'legacy'}", async (t) => {
  mockDb(t, { forEdit: editRow({ tool_id: "kurs-ishi" }) });
  const e = await expectApiError(loadDocForEdit(GEN, USER), 409);
  assert.equal(e.extra.code, "legacy");
});

test("loadDocForEdit: eski deka (doc.slides yo'q) — 409 {code:'legacy'}", async (t) => {
  mockDb(t, { forEdit: editRow({ doc_json: { ...docOf(), slides: undefined } }) });
  const e = await expectApiError(loadDocForEdit(GEN, USER), 409);
  assert.equal(e.extra.code, "legacy");

  // Bo'sh massiv ham eski deka bilan bir xil — `applyDocOps` unga tegmaydi.
  mockDb(t, { forEdit: editRow({ doc_json: { ...docOf(), slides: [] } }) });
  const e2 = await expectApiError(loadDocForEdit(GEN, USER), 409);
  assert.equal(e2.extra.code, "legacy");
});

test("loadDocForEdit: pro-slide ham tahrirlanadi", async (t) => {
  mockDb(t, { forEdit: editRow({ tool_id: "pro-slide" }) });
  const cur = await loadDocForEdit(GEN, USER);
  assert.equal(cur.toolId, "pro-slide");
  assert.equal(cur.docVersion, 3);
  assert.equal(cur.imageRedraws, 1);
});

// ═══════════════════════════════════════════ commitDocOps

test("commitDocOps: baseVersion mos kelmasa — 409 {code:'version'} va UPDATE umuman ketmaydi", async (t) => {
  const seen = mockDb(t, { forEdit: editRow({ doc_version: 7 }) });
  const e = await expectApiError(commitDocOps(GEN, USER, 3, textOp), 409);
  assert.equal(e.extra.code, "version");
  assert.equal(e.extra.docVersion, 7);
  assert.equal(found(seen, /UPDATE generations/).length, 0, "yozish urinishi bo'lmasligi kerak");
  /*
   * E4 dan qolgan band: `commitDocOps` ICHIDAGI `loadDocForEdit`
   * chaqirig'i ham egalik SQLidan o'tishi qulflanadi — bu yerda
   * alohida test emas, xuddi shu `commitDocOps` yo'lida. MUTATSIYA:
   * `getGenerationForEdit` dan `AND user_id = $2` olib tashlansa (yoki
   * boshqa userning hujjatini ko'rsatib yuborsa), shu assertion
   * qizaradi.
   */
  assert.match(seen[0].text, /WHERE id = \$1 AND user_id = \$2/, "commitDocOps ichidagi o'qish ham egalik SQL da");
  assert.deepEqual(seen[0].params, [GEN, USER]);
});

test("commitDocOps: UPDATE 0 qator qaytarsa — 409 {code:'version', docVersion} (optimistik qulf)", async (t) => {
  /*
   * Bu ASOSIY yarim-poyga testi: `loadDocForEdit` 3 ni ko'rdi, lekin
   * yozish paytida boshqa tab allaqachon 4 ga oshirib yuborgan.
   * `updateGenerationDoc` 0 qator qaytaradi.
   *
   * MUTATSIYA: `updateGenerationDoc` dan `AND doc_version = $6` olib
   * tashlansa haqiqiy bazada bu holat 200 bo'lib ketardi — shu yerda
   * SQL matni ham tekshiriladi.
   */
  const seen = mockDb(t, {
    forEdit: editRow({ doc_version: 3 }),
    updateDoc: null,
  });
  const e = await expectApiError(commitDocOps(GEN, USER, 3, textOp), 409);
  assert.equal(e.extra.code, "version");
  // 409 dan keyin eng yangi versiya qayta o'qiladi (mockda yana 3).
  assert.equal(e.extra.docVersion, 3);

  const upd = found(seen, /UPDATE generations SET doc_json/);
  assert.equal(upd.length, 1);
  assert.match(upd[0], /AND user_id = \$2/, "egalik SQL da");
  assert.match(upd[0], /AND status = 'COMPLETED'/, "faqat tayyor hujjat tahrirlanadi");
  assert.match(upd[0], /AND doc_version = \$6/, "optimistik qulf SQL da");
  assert.match(upd[0], /doc_version = doc_version \+ 1/);

  // Yozish TRANZAKSIYADA bo'lishi kerak: BEGIN … UPDATE … ROLLBACK/COMMIT.
  const idx = sqls(seen).indexOf(upd[0]);
  assert.equal(sqls(seen)[idx - 1], "BEGIN");
});

test("commitDocOps: xato operatsiya — 422 {error, at}, bazaga hech narsa yozilmaydi", async (t) => {
  const seen = mockDb(t, { forEdit: editRow({ doc_version: 3 }) });
  const bad: DocOp[] = [
    { op: "text", index: 1, src: { f: "title" }, value: "Ok" },
    { op: "delete", index: 99 }, // chegaradan tashqarida
  ];
  const e = await expectApiError(commitDocOps(GEN, USER, 3, bad), 422);
  assert.equal(e.extra.at, 1, "«at» — nechanchi operatsiyada yiqilgani");
  assert.equal(found(seen, /UPDATE generations/).length, 0, "PATCH atomar — qisman yozuv yo'q");
  assert.equal(found(seen, /^BEGIN$/).length, 0, "tranzaksiya ham ochilmaydi");
});

test("commitDocOps: muvaffaqiyat — doc/html/preview bitta UPDATE da, javob GenerationDetail shaklida", async (t) => {
  const seen = mockDb(t, {
    forEdit: editRow({ doc_version: 3 }),
    updateDoc: { doc_version: 4 },
    detail: detailRow(),
    hasFile: true,
  });

  const gen = await commitDocOps(GEN, USER, 3, textOp);

  // Javob `GET /api/generations/{id}` bilan bir xil shaklda.
  assert.equal(gen.docVersion, 4);
  assert.equal(gen.fileVersion, 3);
  assert.equal(gen.imageRedraws, 1);
  assert.equal(gen.hasFile, true);
  assert.equal(gen.id, GEN);
  assert.ok(gen.doc?.slides?.length);

  const upd = seen.find((s) => /UPDATE generations SET doc_json/.test(s.text));
  assert.ok(upd);
  // $3 doc, $4 html, $5 preview, $6 kutilgan versiya.
  const nextDoc = JSON.parse(String(upd.params[2])) as AcademicDoc;
  assert.equal(nextDoc.slides?.[1].title, "Yangi sarlavha", "op qo'llangan doc yoziladi");
  assert.ok(String(upd.params[3]).length > 0, "html shu yerda qayta render qilinadi");
  assert.equal(upd.params[5], 3);
  // `renumberSlides` — `applyDocOps` oxirida; sections ham yangilanadi.
  assert.ok((nextDoc.sections ?? []).some((s) => s.title === "Yangi sarlavha"));
});

test("commitDocOps: html doc bilan BITTA tranzaksiyada yoziladi (alohida UPDATE yo'q)", async (t) => {
  const seen = mockDb(t, {
    forEdit: editRow({ doc_version: 3 }),
    updateDoc: { doc_version: 4 },
    detail: detailRow(),
  });
  await commitDocOps(GEN, USER, 3, textOp);
  const writes = found(seen, /^UPDATE generations SET/);
  assert.equal(writes.length, 1, "bitta yozuv — doc, html va preview birga");
  assert.match(writes[0], /SET doc_json = \$3, html = \$4, preview = \$5/);
});

test("commitDocOps: BIRINCHI tahrir (doc_version=0) — keepPrev, doc_prev = COALESCE(doc_prev, doc_json)", async (t) => {
  /*
   * `014_doc_prev.sql` — «Asl holatga qaytarish» faqat ILK tahrirda
   * (`doc_version = 0`) asl dekani `doc_prev`ga saqlab qoladi.
   *
   * MUTATSIYA: `commitDocOps`dagi `{ keepPrev: cur.docVersion === 0 }`
   * shartini olib tashlasak (yoki doim `true` bersak), 2-tahrirdagi test
   * ham SQL da `COALESCE` ni ko'rardi — quyidagi ikkinchi assertion
   * (docVersion=3 holati) buni ushlaydi.
   */
  const seen = mockDb(t, {
    forEdit: editRow({ doc_version: 0 }),
    updateDoc: { doc_version: 1 },
    detail: detailRow(),
  });
  await commitDocOps(GEN, USER, 0, textOp);
  const upd = seen.find((s) => /UPDATE generations SET/.test(s.text))!;
  assert.match(upd.text, /doc_prev = COALESCE\(doc_prev, doc_json\)/);
});

test("commitDocOps: KEYINGI tahrirlarda (doc_version>0) — doc_prev TEGILMAYDI", async (t) => {
  const seen = mockDb(t, {
    forEdit: editRow({ doc_version: 3 }),
    updateDoc: { doc_version: 4 },
    detail: detailRow(),
  });
  await commitDocOps(GEN, USER, 3, textOp);
  const upd = seen.find((s) => /UPDATE generations SET/.test(s.text))!;
  assert.doesNotMatch(upd.text, /doc_prev/, "COALESCE faqat ILK tahrirda qo'shiladi");
});

// ═══════════════════════════════════════════ restoreDoc (POST …/doc/restore)

test("restoreDoc: qator yo'q (yoki begona egа) — 404", async (t) => {
  const seen = mockDb(t, { forRestore: null });
  await expectApiError(restoreDoc(GEN, USER), 404);
  assert.equal(seen.length, 1);
  assert.match(seen[0].text, /WHERE id = \$1 AND user_id = \$2/);
  assert.deepEqual(seen[0].params, [GEN, USER]);
});

test("restoreDoc: hali tayyor emas — 409 {code:'status'}", async (t) => {
  mockDb(t, { forRestore: restoreRow({ status: "IN_PROGRESS" }) });
  const e = await expectApiError(restoreDoc(GEN, USER), 409);
  assert.equal(e.extra.code, "status");
  assert.equal(e.extra.status, "IN_PROGRESS");
});

test("restoreDoc: doc_prev NULL (hech qachon tahrirlanmagan) — 409 {code:'no_prev'}, UPDATE ketmaydi", async (t) => {
  const seen = mockDb(t, { forRestore: restoreRow({ doc_prev: null }) });
  const e = await expectApiError(restoreDoc(GEN, USER), 409);
  assert.equal(e.extra.code, "no_prev");
  /*
   * MUTATSIYA: `restoreDoc`dagi `if (!pre.docPrev) throw ...` tekshiruvi
   * olib tashlansa, kod baribir tranzaksiyaga kirib SQL yuborardi (SQL
   * predikati `doc_prev IS NOT NULL` uni 0 qatorga aylantirib, boshqa
   * xato xabari — "qaytadan urinib ko'ring" — chiqardi). Bu assertion
   * xato TURINI (aynan shu tekshiruv ishlaganini) ushlaydi.
   */
  assert.equal(found(seen, /^BEGIN$/).length, 0, "doc_prev yo'qligi darhol rad etiladi — tranzaksiya ochilmaydi");
});

test("restoreDoc: muvaffaqiyat — doc_json = doc_prev, egalik va predikatlar SQL da", async (t) => {
  // `doc_prev` ATAYLAB o'ziga xos bo'lim sarlavhasi bilan — pastdagi
  // assertion render aynan SHU dokdan (joriy `doc_json` emas)
  // qurilganini isbotlaydi. `renderHtml` faqat `doc.sections`ni chizadi
  // (bu testdagi `docOf` ni har doim `sections: []` bilan qurgani uchun
  // shu yerda qo'lda to'ldiriladi — haqiqiy yo'lda `applyDocOps`
  // `sectionsOf` bilan avtomatik yig'adi).
  const prevDoc: AcademicDoc = {
    ...docOf([{ id: "s0", layout: "bullets", title: "ASL SARLAVHA — tahrirdan oldingi", bullets: ["B."] }]),
    sections: [{ id: "s0", title: "ASL SARLAVHA — tahrirdan oldingi", blocks: [{ kind: "li", text: "B." }] }],
  };
  const seen = mockDb(t, {
    forRestore: restoreRow({ doc_prev: prevDoc }),
    restoreDoc: { doc_version: 5 },
    detail: detailRow({ doc_version: 5, has_prev: true }),
    hasFile: true,
  });

  const gen = await restoreDoc(GEN, USER);

  // Javob `GET /api/generations/{id}` bilan bir xil shaklda (`commitDocOps` naqshi).
  assert.equal(gen.docVersion, 5);
  assert.equal(gen.id, GEN);
  assert.ok(gen.doc?.slides?.length);

  const upd = seen.find((s) => /SET doc_json = doc_prev/.test(s.text));
  assert.ok(upd, "restoreGenerationDoc UPDATE yuborilishi kerak");
  assert.match(upd!.text, /AND user_id = \$2/, "egalik SQL da");
  assert.match(upd!.text, /AND status = 'COMPLETED'/, "faqat tayyor hujjat qaytariladi");
  assert.match(upd!.text, /AND doc_prev IS NOT NULL/, "bo'sh restore SQL darajasida ham rad etiladi");
  /*
   * MUTATSIYA: `restoreDoc` `renderHtml(pre.docPrev)` o'rniga joriy
   * (tahrirlangan) dokdan render qilsa, bu qator "ASL SARLAVHA" ni
   * TOPMAS edi — chunki `pre.docPrev` render kirishi sifatida faqat shu
   * yo'l bilan ishlatiladi ($3 — html, restoreGenerationDoc chaqiruvida).
   */
  assert.ok(String(upd!.params[2]).includes("ASL SARLAVHA"), "html doc_prev'dan qurilishi kerak");

  // Yozish TRANZAKSIYADA (BEGIN … UPDATE … COMMIT).
  const idx = sqls(seen).indexOf(upd!.text);
  assert.equal(sqls(seen)[idx - 1], "BEGIN");
});

test("restoreDoc: UPDATE 0 qator qaytarsa (poyga — shu oraliqda status/doc_prev o'zgargan) — 409 {code:'no_prev'}", async (t) => {
  /*
   * MUTATSIYA: `restoreGenerationDoc`dan `AND doc_prev IS NOT NULL` yoki
   * `AND status = 'COMPLETED'` olib tashlansa, haqiqiy bazada bu poyga
   * holati jimgina 200 bo'lib ketardi. Shu yerda `restoreDoc == null`
   * bo'lgan holat (SQL 0 qator qaytargan) alohida tekshiriladi.
   */
  mockDb(t, { forRestore: restoreRow(), restoreDoc: null });
  const e = await expectApiError(restoreDoc(GEN, USER), 409);
  assert.equal(e.extra.code, "no_prev");
});

// ═══════════════════════════════════════════ hasPrev (rowToSummary → GenerationSummary)

test("commitDocOps javobi: hasPrev — `has_prev` SQL ustunidan to'g'ridan-to'g'ri o'qiladi", async (t) => {
  mockDb(t, {
    forEdit: editRow({ doc_version: 3 }),
    updateDoc: { doc_version: 4 },
    detail: detailRow({ has_prev: true }),
  });
  const gen = await commitDocOps(GEN, USER, 3, textOp);
  assert.equal(gen.hasPrev, true);

  mockDb(t, {
    forEdit: editRow({ doc_version: 3 }),
    updateDoc: { doc_version: 4 },
    detail: detailRow({ has_prev: false }),
  });
  const gen2 = await commitDocOps(GEN, USER, 3, textOp);
  /*
   * MUTATSIYA: `rowToSummary`dagi `hasPrev: r.has_prev ?? false` o'rniga
   * doim `true` (yoki doim `false`) qaytarilsa, shu ikki qarama-qarshi
   * holat (true/false) orasidagi farq yo'qolib, ikkala assertiondan
   * biri qizaradi.
   */
  assert.equal(gen2.hasPrev, false);
});

// ═══════════════════════════════════════════ parseDocOps / tana

function patchReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://x/api/generations/${GEN}/doc`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

test("patchDocFromRequest: 50 tadan ortiq operatsiya — 400 (parseDocOps darvozasi)", async (t) => {
  const seen = mockDb(t, { forEdit: editRow() });
  const ops = Array.from({ length: 51 }, () => ({ op: "text", index: 1, src: { f: "title" }, value: "x" }));
  const e = await expectApiError(patchDocFromRequest(patchReq({ baseVersion: 3, ops }), GEN, USER), 400);
  assert.match(e.message, /50/);
  // MUTATSIYA: 400 emas, 422 kelsa — parse darvozasi chetlab o'tilgan.
  assert.equal(seen.length, 0, "yaroqsiz tana bazaga umuman bormasligi kerak");

  // 50 tasi o'tadi — chegara aynan shu yerda (off-by-one qulfi).
  const ok = Array.from({ length: 50 }, () => ({ op: "text", index: 1, src: { f: "title" }, value: "x" }));
  mockDb(t, { forEdit: editRow({ doc_version: 3 }), updateDoc: { doc_version: 4 }, detail: detailRow() });
  await patchDocFromRequest(patchReq({ baseVersion: 3, ops: ok }), GEN, USER);
});

test("patchDocFromRequest: baseVersion yo'q/yaroqsiz — 400", async (t) => {
  mockDb(t, { forEdit: editRow() });
  await expectApiError(patchDocFromRequest(patchReq({ ops: textOp }), GEN, USER), 400);
  await expectApiError(patchDocFromRequest(patchReq({ baseVersion: "3", ops: textOp }), GEN, USER), 400);
  await expectApiError(patchDocFromRequest(patchReq({ baseVersion: -1, ops: textOp }), GEN, USER), 400);
  await expectApiError(patchDocFromRequest(patchReq({ baseVersion: 1.5, ops: textOp }), GEN, USER), 400);
});

test("patchDocFromRequest: tana 300 KB dan katta — 413 (o'qilmasdan)", async (t) => {
  /*
   * MUTATSIYA: chegara ATAYLAB o'zining eksport qilingan konstantasidan
   * emas, ABSOLYUT sondan (`300 * 1024`) hisoblanadi. Agar shu tekshiruv
   * `DOC_PATCH_MAX_BYTES + 1` bilan yozilsa, kimdir konstantani
   * (masalan 300 KB dan 3 MB ga) o'zgartirib qo'ysa ham test baribir
   * "yashil" qolardi — chunki ikkalasi ham BIR XIL o'zgargan
   * konstantadan olinadi. Absolyut son bilan konstantaning o'zi ham
   * (quyidagi tenglik bilan), chegara ham mustaqil tasdiqlanadi.
   */
  assert.equal(DOC_PATCH_MAX_BYTES, 300 * 1024, "hujjatlashtirilgan chegara — API jadvali shu songa tayanadi");

  const seen = mockDb(t, { forEdit: editRow() });
  const req = patchReq({ baseVersion: 3, ops: textOp }, {
    "content-length": String(300 * 1024 + 1),
  });
  await expectApiError(patchDocFromRequest(req, GEN, USER), 413);
  assert.equal(seen.length, 0);

  // Chegaraning o'zi (300 KB, ortig'i emas) — o'qilishi kerak (413 emas).
  mockDb(t, { forEdit: editRow({ doc_version: 3 }), updateDoc: { doc_version: 4 }, detail: detailRow() });
  const okReq = patchReq({ baseVersion: 3, ops: textOp }, { "content-length": String(300 * 1024) });
  await patchDocFromRequest(okReq, GEN, USER);
});

test("patchDocFromRequest: ops massiv emas — 400, tana obyekt emas — 400", async (t) => {
  mockDb(t, { forEdit: editRow() });
  await expectApiError(patchDocFromRequest(patchReq({ baseVersion: 3, ops: {} }), GEN, USER), 400);
  await expectApiError(patchDocFromRequest(patchReq([1, 2]), GEN, USER), 400);
});

// ═══════════════════════════════════════════ rebuildFile

/** Renderni ATAYIN sanaydigan/yiqitadigan seam. */
function fakeRender(fail = false) {
  const calls: { fileName: string }[] = [];
  const render = (async (doc: AcademicDoc, fileName: string) => {
    calls.push({ fileName });
    if (fail) throw new Error("pptx yiqildi");
    return {
      html: "",
      bytes: new Uint8Array([1, 2, 3, 4]),
      fileName,
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      doc,
    };
  }) as typeof import("../lib/generation/render-pptx.ts")["renderPptx"];
  return { render, calls };
}

test("rebuildFile: file_version >= doc_version — renderPptx CHAQIRILMAYDI (no-op)", async (t) => {
  const seen = mockDb(t, { forEdit: editRow({ doc_version: 5, file_version: 5 }) });
  const r = fakeRender();
  const out = await rebuildFile(GEN, USER, { render: r.render });
  assert.deepEqual(out, { fileVersion: 5, docVersion: 5, rebuilt: false });
  /*
   * MUTATSIYA: shartni `>` ga o'zgartirsak (yoki umuman olib tashlasak),
   * klientning har debounce chaqirig'i qimmat PPTX renderini ishga
   * tushirardi — `calls.length` shuni ushlaydi.
   */
  assert.equal(r.calls.length, 0);
  assert.equal(found(seen, /^BEGIN$/).length, 0, "yozish tranzaksiyasi ham ochilmaydi");

  // file_version doc_version dan KATTA bo'lsa ham (nazariy) — no-op.
  mockDb(t, { forEdit: editRow({ doc_version: 4, file_version: 9 }) });
  assert.equal((await rebuildFile(GEN, USER, { render: r.render })).rebuilt, false);
  assert.equal(r.calls.length, 0);
});

test("rebuildFile: render yiqilsa — markFileVersion ham, putGenerationFile ham chaqirilmaydi", async (t) => {
  const seen = mockDb(t, {
    forEdit: editRow({ doc_version: 6, file_version: 3 }),
    markFile: { file_version: 6 },
  });
  const r = fakeRender(true);
  await assert.rejects(rebuildFile(GEN, USER, { render: r.render }), /pptx yiqildi/);
  assert.equal(r.calls.length, 1);
  /*
   * Eng muhim kafolat: eskirgan, lekin BUTUN fayl joyida qoladi.
   * MUTATSIYA: renderni tranzaksiya ichiga ko'chirib, xatoni yutib
   * yuborsak (`catch {}`), `file_version` render qilinmagan holda
   * oshib ketardi va `GET …/file` eskirgan faylni «yangi» deb bergan
   * bo'lardi — shu ikki assertion aynan shuni ushlaydi.
   */
  assert.equal(found(seen, /SET file_version/).length, 0);
  assert.equal(found(seen, /INSERT INTO generation_files/).length, 0);
  assert.equal(found(seen, /^BEGIN$/).length, 0);
});

test("rebuildFile: TARTIB — render tranzaksiyadan TASHQARIDA, so'ng lock → markFileVersion → INSERT", async (t) => {
  const seen = mockDb(t, {
    forEdit: editRow({ doc_version: 6, file_version: 3 }),
    markFile: { file_version: 6 },
  });
  const calls: string[] = [];
  const render = (async (doc: AcademicDoc, fileName: string) => {
    calls.push(`render:${sqls(seen).length}`); // render paytida nechta so'rov bo'lgan
    return {
      html: "",
      bytes: new Uint8Array(8),
      fileName,
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      doc,
    };
  }) as typeof import("../lib/generation/render-pptx.ts")["renderPptx"];

  const out = await rebuildFile(GEN, USER, { render });
  assert.deepEqual(out, { fileVersion: 6, docVersion: 6, rebuilt: true });

  const order = sqls(seen);
  const iBegin = order.indexOf("BEGIN");
  const iLock = order.findIndex((s) => /pg_advisory_xact_lock\(hashtext\(\$1\)\)/.test(s));
  const iMark = order.findIndex((s) => /SET file_version/.test(s));
  const iPut = order.findIndex((s) => /INSERT INTO generation_files/.test(s));
  const iCommit = order.indexOf("COMMIT");

  /*
   * MUTATSIYA: renderni `transaction(...)` ichiga ko'chirsak, render
   * paytidagi so'rovlar soni BEGIN ni ham qamrab olardi — `calls[0]`
   * "render:1" (faqat `getGenerationForEdit`) bo'lishi shart.
   */
  assert.equal(calls[0], "render:1", "render tranzaksiya ochilishidan OLDIN tugashi kerak");
  assert.ok(iBegin > -1 && iLock > iBegin, "advisory lock tranzaksiya ICHIDA (xact lock)");
  assert.ok(iMark > iLock, "lock markFileVersion dan oldin — parallel rebuild ketma-ket bo'ladi");
  assert.ok(iPut > iMark, "bayt faqat versiya band qilingandan keyin yoziladi");
  assert.ok(iCommit > iPut);

  const mark = seen.find((s) => /SET file_version/.test(s.text))!;
  assert.match(mark.text, /AND user_id = \$2/, "egalik SQL da");
  assert.match(mark.text, /AND file_version < \$3/, "eski render yangisini orqaga surmasin");
  assert.deepEqual(mark.params, [GEN, USER, 6]);
});

test("rebuildFile: markFileVersion 0 qator (boshqa rebuild o'zib ketgan) — bayt YOZILMAYDI", async (t) => {
  const seen = mockDb(t, {
    forEdit: editRow({ doc_version: 6, file_version: 3 }),
    markFile: null,
    versions: { doc_version: 8, file_version: 8, tool_id: "slide", file_name: "d.pptx", status: "COMPLETED" },
  });
  const r = fakeRender();
  const out = await rebuildFile(GEN, USER, { render: r.render });
  assert.equal(out.rebuilt, false);
  assert.equal(out.fileVersion, 8, "haqiqiy versiya qayta o'qiladi");
  assert.equal(found(seen, /INSERT INTO generation_files/).length, 0);
});

// ═══════════════════════════════════════════ ensureFreshFile (GET …/file)

test("ensureFreshFile: file_version < doc_version — rebuild chaqiriladi", async (t) => {
  const seen = mockDb(t, {
    versions: { doc_version: 6, file_version: 3, tool_id: "slide", file_name: "d.pptx", status: "COMPLETED" },
    forEdit: editRow({ doc_version: 6, file_version: 3 }),
    markFile: { file_version: 6 },
  });
  const r = fakeRender();
  await ensureFreshFile(GEN, USER, { render: r.render });
  /*
   * MUTATSIYA: `file/route.ts` dan `ensureFreshFile` chaqirig'ini olib
   * tashlasak yoki shartni teskari qilsak, foydalanuvchi ekrandagidan
   * FARQ QILADIGAN eski PPTX ni yuklab olardi («ko'rdim = oldim»
   * buzilishi) — bu assertion shuni ushlaydi.
   */
  assert.equal(r.calls.length, 1);
  assert.equal(found(seen, /INSERT INTO generation_files/).length, 1);

  const ver = seen[0];
  assert.match(ver.text, /WHERE id = \$1 AND user_id = \$2/, "versiya so'rovida ham egalik");
});

test("ensureFreshFile: fayl yangi / slayd emas / tayyor emas / topilmadi — rebuild YO'Q", async (t) => {
  const r = fakeRender();

  mockDb(t, {
    versions: { doc_version: 6, file_version: 6, tool_id: "slide", file_name: "d.pptx", status: "COMPLETED" },
  });
  await ensureFreshFile(GEN, USER, { render: r.render });

  mockDb(t, {
    versions: { doc_version: 6, file_version: 0, tool_id: "kurs-ishi", file_name: "d.docx", status: "COMPLETED" },
  });
  await ensureFreshFile(GEN, USER, { render: r.render });

  mockDb(t, {
    versions: { doc_version: 6, file_version: 0, tool_id: "slide", file_name: "d.pptx", status: "IN_PROGRESS" },
  });
  await ensureFreshFile(GEN, USER, { render: r.render });

  mockDb(t, { versions: null });
  await ensureFreshFile(GEN, USER, { render: r.render });

  assert.equal(r.calls.length, 0, "to'rt holatda ham qimmat render bo'lmasligi kerak");
});

// ═══════════════════════════════════════════ Haqiqiy pptxgenjs (stubsiz)

/**
 * `npm run build` bu sprintda ishlatilmaydi (dev server band), shuning
 * uchun «`pptxgenjs` route yo'lida haqiqatan ishlaydimi» degan savol
 * shu test bilan yopiladi: STUBSIZ `rebuildFile` (standart
 * `renderPptx`) chaqiriladi va bazaga yozilgan bayt tekshiriladi.
 */
test("rebuildFile: stubsiz — haqiqiy renderPptx PPTX yozadi (>10 KB)", async (t) => {
  const deck = fallbackSlides(meta);
  assert.ok(deck.length >= 4);
  const seen = mockDb(t, {
    forEdit: editRow({ doc_json: docOf(deck), doc_version: 2, file_version: 1 }),
    markFile: { file_version: 2 },
  });

  const out = await rebuildFile(GEN, USER);
  assert.deepEqual(out, { fileVersion: 2, docVersion: 2, rebuilt: true });

  const put = seen.find((s) => /INSERT INTO generation_files/.test(s.text));
  assert.ok(put, "bayt yozilishi kerak");
  assert.equal(put.params[0], GEN);
  assert.equal(put.params[1], "deka.pptx");
  assert.equal(
    put.params[2],
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );
  const bytes = put.params[4] as Buffer;
  assert.ok(Buffer.isBuffer(bytes));
  assert.ok(bytes.byteLength > 10 * 1024, `PPTX juda kichik: ${bytes.byteLength} bayt`);
  assert.equal(put.params[3], bytes.byteLength);
  // ZIP sarlavhasi — haqiqiy OOXML paketi.
  assert.equal(bytes.subarray(0, 2).toString("latin1"), "PK");
});
