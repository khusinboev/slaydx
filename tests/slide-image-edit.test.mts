import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";
import type { DocOp } from "../lib/generation/slide-edit.ts";

/**
 * E5 — slayd rasm serveri (`lib/server/slide-image.ts` va uni chaqiradigan
 * `image` route'i).
 *
 * BAZASIZ: `pool().query`/`pool().connect()` (`tests/slide-doc-route.test.mts`
 * naqshi) ushlanadi. Route funksiyasining o'zi chaqirilmaydi — `cookies()`
 * Next so'rov konteksti ichida ishlaydi; route bu fayldagi AYNAN shu
 * funksiyani (`uploadSlideImage`) chaqiradi, ya'ni sinov haqiqiy kod
 * yo'lini sinaydi.
 *
 * AI bilan qayta chizish (`regenerateSlideImage`) va uning testlari
 * olib tashlandi (Muharrir 2 / WP4b).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const { ApiError } = await import("../lib/server/api.ts");
const { uploadSlideImage } = await import("../lib/server/slide-image.ts");
const { SLIDE_IMAGE_MAX_BYTES } = await import("../lib/generation/slide-limits.ts");
const { extractMeta } = await import("../lib/generation/meta.ts");
const { TOOL_BY_ID } = await import("../lib/tools.ts");

const GEN = "a1b2c3d4-0000-4000-8000-000000000002";
const USER = "u-42";

const meta = extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi", slideTemplate: "lecture" } as never);

/*
 * index 0 — rasm joyi bor (title); index 1 — rasm joyi bor (bullets);
 * index 2 — rasm joyi YO'Q — 422 yo'li uchun.
 *
 * Ilgari uchinchisi `stats` edi. AUDIT-9 E2 dan keyin `stats` rasm
 * TASMASINI ko'taradi (`photoSlot` null qaytarmaydi), ya'ni u 422 ni
 * boshqa sinamas edi. `quiz` — savol va to'rtta variant butun kenglikni
 * egallaydi, tasmaga o'rin yo'q.
 */
const slides: SlideModel[] = [
  { id: "s0", layout: "title", title: "Suv aylanishi", subtitle: "Kirish" },
  { id: "s1", layout: "bullets", title: "Bandlar", bullets: ["Bir.", "Ikki."] },
  {
    id: "s2",
    layout: "quiz",
    title: "Nazorat",
    quiz: [{ q: "Bug'lanish qayerda?", options: ["Okeanda", "Bulutda", "Daryoda", "Muzda"], answer: 0 }],
  },
];

function docOf(list: SlideModel[] = slides): AcademicDoc {
  return { meta, titlePage: true, toc: true, sections: [], slides: list, slideTemplate: "lecture" };
}

// ───────────────────────────────────────────── DB stub (bazasiz)

type Seen = { text: string; params: unknown[] };

type Rows = {
  forEdit?: Record<string, unknown> | null;
  detail?: Record<string, unknown> | null;
  updateDoc?: Record<string, unknown> | null;
  hasFile?: boolean;
  notOwner?: boolean;
  /** `doc_prev` (ASL deka) — `undefined`: qator yo'q; `null`: hech qachon tahrirlanmagan. */
  prev?: AcademicDoc | null;
};

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function mockDb(t: TestContext, rows: Rows): Seen[] {
  const seen: Seen[] = [];
  const run = async (text: string, params: unknown[] = []) => {
    seen.push({ text: norm(text), params });
    const q = norm(text);
    let out: unknown[] = [];
    if (/live_json_out/.test(q)) out = rows.detail ? [rows.detail] : [];
    else if (/^SELECT doc_json, doc_version/.test(q)) out = rows.forEdit ? [rows.forEdit] : [];
    else if (/UPDATE generations SET doc_json/.test(q)) out = rows.updateDoc ? [rows.updateDoc] : [];
    else if (/FROM generation_files f JOIN generations/.test(q)) out = rows.hasFile ? [{ "?column?": 1 }] : [];
    else if (/INSERT INTO generation_assets/.test(q)) out = []; // ON CONFLICT DO NOTHING
    // Egalik va kvota (C13, BEA-03) — `putGenerationUpload` yozishdan OLDIN so'raydi.
    else if (/^SELECT 1 FROM generations WHERE id = \$1 AND user_id = \$2/.test(q)) out = rows.notOwner ? [] : [{ "?column?": 1 }];
    else if (/^SELECT doc_prev, doc_version, status FROM generations/.test(q)) out = rows.prev === undefined ? [] : [{ doc_prev: rows.prev, doc_version: 3, status: "COMPLETED" }];
    else if (/WITH u AS/.test(q)) out = [{ total_bytes: "0", kind_count: 0, gen_count: 0 }];
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
    image_redraws: 2,
    edited_at: new Date(),
    live_seq: 0,
    html: "<html></html>",
    doc_json: docOf(),
    live_json_out: null,
    ...over,
  };
}

// ═══════════════════════════════════════════ uploadSlideImage

function pngBytes(extra = 16): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, Buffer.alloc(extra, 0x01)]);
}

function gifBytes(): Buffer {
  return Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3, 4]);
}

/** `File` `Buffer`ni to'g'ridan-to'g'ri qabul qilmaydi — haqiqiy `ArrayBuffer`ga kesib olamiz. */
function blobPart(b: Buffer): Uint8Array<ArrayBuffer> {
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  return new Uint8Array(ab);
}

function uploadReq(
  file: File | null,
  baseVersion: string | null = "3",
  extraHeaders: Record<string, string> = {},
): Request {
  const fd = new FormData();
  if (file) fd.set("file", file);
  if (baseVersion !== null) fd.set("baseVersion", baseVersion);
  return new Request(`http://x/api/generations/${GEN}/slides/1/image`, {
    method: "POST",
    headers: extraHeaders,
    body: file ? fd : undefined,
  });
}

test("uploadSlideImage: indeks manfiy/butun son emas — 400, DB ga umuman bormaydi", async (t) => {
  const seen = mockDb(t, { forEdit: editRow() });
  await expectApiError(uploadSlideImage(uploadReq(null), GEN, USER, -1), 400);
  await expectApiError(uploadSlideImage(uploadReq(null), GEN, USER, 1.5), 400);
  assert.equal(seen.length, 0, "indeks shakli DB dan OLDIN tekshiriladi");
});

test("uploadSlideImage: content-length sarlavhasi chegaradan katta — tana o'qilmasdan 413", async (t) => {
  const seen = mockDb(t, { forEdit: editRow() });
  const req = uploadReq(null, "3", { "content-length": String(SLIDE_IMAGE_MAX_BYTES + 5 * 1024 * 1024) });
  await expectApiError(uploadSlideImage(req, GEN, USER, 1), 413);
  assert.equal(seen.length, 0);
});

test("uploadSlideImage: haqiqiy fayl hajmi chegaradan katta — 413 (content-length yolg'on bo'lsa ham)", async (t) => {
  mockDb(t, { forEdit: editRow() });
  const big = pngBytes(SLIDE_IMAGE_MAX_BYTES + 1024);
  const file = new File([blobPart(big)], "rasm.png", { type: "image/png" });
  const req = uploadReq(file);
  assert.equal(req.headers.get("content-length"), null);
  await expectApiError(uploadSlideImage(req, GEN, USER, 1), 413);
});

test("uploadSlideImage: PNG nomli/turli, lekin baytlari GIF — 415 (baytlardan, content-type dan emas)", async (t) => {
  mockDb(t, { forEdit: editRow() });
  /*
   * MUTATSIYA: agar `sniffImageType(bytes)` o'rniga `file.type` yoki
   * nomga ishonilsa, bu fayl 200 bilan o'tib ketardi — bayt darajasida
   * u GIF.
   */
  const file = new File([blobPart(gifBytes())], "rasm.png", { type: "image/png" });
  const req = uploadReq(file);
  await expectApiError(uploadSlideImage(req, GEN, USER, 1), 415);
});

test("uploadSlideImage: baseVersion yo'q/yaroqsiz — 400", async (t) => {
  mockDb(t, { forEdit: editRow() });
  const file = new File([blobPart(pngBytes())], "rasm.png", { type: "image/png" });
  await expectApiError(uploadSlideImage(uploadReq(file, null), GEN, USER, 1), 400);
  await expectApiError(uploadSlideImage(uploadReq(file, "abc"), GEN, USER, 1), 400);
  await expectApiError(uploadSlideImage(uploadReq(file, "-1"), GEN, USER, 1), 400);
});

test("uploadSlideImage: muvaffaqiyat — commitDocOps {op:'image', index, url} bilan chaqiriladi", async (t) => {
  const seen = mockDb(t, {
    forEdit: editRow({ doc_version: 3 }),
    updateDoc: { doc_version: 4 },
    detail: detailRow(),
    hasFile: true,
  });
  const file = new File([blobPart(pngBytes(32))], "rasm.png", { type: "image/png" });
  const req = uploadReq(file, "3");

  const gen = await uploadSlideImage(req, GEN, USER, 1);
  assert.equal(gen.docVersion, 4);

  const assetIns = found(seen, /INSERT INTO generation_assets/);
  assert.equal(assetIns.length, 1, "aktiv bitta marta yozilishi kerak");

  const upd = seen.find((s) => /UPDATE generations SET doc_json/.test(s.text))!;
  const nextDoc = JSON.parse(String(upd.params[2])) as AcademicDoc;
  assert.match(
    nextDoc.slides![1].image!.url,
    new RegExp(`^/api/generations/${GEN}/assets/[0-9a-f]+$`),
    "yozilgan URL shu generatsiyaning aktiviga ishora qilishi kerak",
  );
});

test("uploadSlideImage: begona hujjat — 404 va aktiv YOZILMAYDI (BEA-03: egalik yozishdan oldin)", async (t) => {
  // `getGenerationForEdit` `WHERE user_id` — begona hujjat qatori umuman kelmaydi.
  const seen = mockDb(t, { forEdit: null, notOwner: true });
  const file = new File([blobPart(pngBytes(32))], "rasm.png", { type: "image/png" });
  await expectApiError(uploadSlideImage(uploadReq(file, "3"), GEN, USER, 1), 404);
  assert.equal(found(seen, /INSERT INTO generation_assets/).length, 0, "MUTATSIYA: begona hujjatga bayt yozildi");
});

test("uploadSlideImage: tranzaksiya ichidagi egalik tekshiruvi ham turadi — 404, INSERT yo'q (SECB-03)", async (t) => {
  // Ikkinchi himoya chizig'i: `storeGenerationUploads` kvota qulfi ostida egalikni qayta so'raydi.
  const seen = mockDb(t, { forEdit: editRow({ doc_version: 3 }), updateDoc: { doc_version: 4 }, notOwner: true });
  const file = new File([blobPart(pngBytes(32))], "rasm.png", { type: "image/png" });
  await expectApiError(uploadSlideImage(uploadReq(file, "3"), GEN, USER, 1), 404);
  assert.equal(found(seen, /INSERT INTO generation_assets/).length, 0, "MUTATSIYA: begona hujjatga bayt yozildi");
  assert.ok(sqls(seen).includes("ROLLBACK"), "doc yozuvi ham qaytarilishi kerak");
});

test("uploadSlideImage: rasm joyi bo'lmagan maketga yuklash — 422 (applyDocOps orqali, ikkinchi marta yozilmaydi)", async (t) => {
  const seen = mockDb(t, { forEdit: editRow({ doc_version: 3 }) });
  const file = new File([blobPart(pngBytes())], "rasm.png", { type: "image/png" });
  const req = new Request(`http://x/api/generations/${GEN}/slides/2/image`, {
    method: "POST",
    body: (() => {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("baseVersion", "3");
      return fd;
    })(),
  });
  await expectApiError(uploadSlideImage(req, GEN, USER, 2), 422);
  assert.equal(found(seen, /UPDATE generations SET doc_json/).length, 0);
});

// ═══════════════════════════════════════════ AUDIT-25 P8: matn rasm bilan sig'maydi — 400

/*
 * Generatsiya matnni RASMSIZ qutigacha yozadi va bunday slaydga rasm qo'ymaydi
 * (`imageYieldField`). Ko'ruvchida rasm yuklansa kontent zonasi torayadi va matn
 * qutidan chiqardi — endi yuklash o'sha predikat bilan 400 oladi, aktiv va doc
 * yozilmaydi. Qisqa matnli slayd — odatdagidek qabul.
 */
const { imageYieldField } = await import("../lib/generation/slide-quality.ts");
const { buildSlideDeck } = await import("../lib/generation/slides.ts");
const { TEXT_TOO_LONG_FOR_IMAGE } = await import("../lib/server/slide-image.ts");

const P8_WORDS = "Suv aylanishi okean yuzasidan bug‘lanish bilan boshlanadi va bulutlarda kondensatsiyalanib yomg‘ir hamda qor shaklida yerga qaytadi".split(" ");
const p8Text = (n: number, from = 0) => {
  let out = "";
  for (let i = 0; ; i += 1) {
    const w = P8_WORDS[(from + i) % P8_WORDS.length];
    const next = out ? `${out} ${w}` : w;
    if (next.length > n) return out;
    out = next;
  }
};
const col = (len: number) => [0, 1, 2, 3].map((k) => p8Text(len, k * 2));
const longTwo: SlideModel = { id: "s3", layout: "twoCol", title: "Ikki jarayon", leftTitle: "Bug‘lanish", rightTitle: "Yog‘in", left: col(100), right: col(100) };
const shortTwo: SlideModel = { id: "s4", layout: "twoCol", title: "Ikki jarayon", leftTitle: "Bug‘lanish", rightTitle: "Yog‘in", left: col(30), right: col(30) };
const p8Doc = docOf([...slides, longTwo, shortTwo]);

function p8Req(index: number): Request {
  const fd = new FormData();
  fd.set("file", new File([blobPart(pngBytes(32))], "rasm.png", { type: "image/png" }));
  fd.set("baseVersion", "3");
  return new Request(`http://x/api/generations/${GEN}/slides/${index}/image`, { method: "POST", body: fd });
}

test("P8: matni rasmli qutiga sig'maydigan slaydga rasm yuklash — 400 «Matn rasm bilan sig‘maydi…», hech narsa yozilmaydi", async (t) => {
  const deck = buildSlideDeck(p8Doc);
  assert.equal(imageYieldField(longTwo, deck.bodyType, deck.visual), "colItem", "sinov asosi: uzun ustun rasm bilan sig'maydi");
  assert.equal(imageYieldField(shortTwo, deck.bodyType, deck.visual), null, "sinov asosi: qisqa ustun sig'adi");
  const seen = mockDb(t, { forEdit: editRow({ doc_json: p8Doc }) });
  const err = await expectApiError(uploadSlideImage(p8Req(3), GEN, USER, 3), 400);
  assert.equal(err.message, TEXT_TOO_LONG_FOR_IMAGE);
  assert.equal(err.message, "Matn rasm bilan sig‘maydi — avval matnni qisqartiring");
  assert.equal(found(seen, /INSERT INTO generation_assets/).length, 0, "rad etilgan rasm aktiv sifatida yozildi");
  assert.equal(found(seen, /UPDATE generations SET doc_json/).length, 0);
});

test("P8: qisqa matnli twoCol ga rasm yuklash — qabul qilinadi", async (t) => {
  const seen = mockDb(t, {
    forEdit: editRow({ doc_json: p8Doc }),
    updateDoc: { doc_version: 4 },
    detail: detailRow(),
    hasFile: true,
  });
  const gen = await uploadSlideImage(p8Req(4), GEN, USER, 4);
  assert.equal(gen.docVersion, 4);
  const upd = seen.find((s) => /UPDATE generations SET doc_json/.test(s.text))!;
  const nextDoc = JSON.parse(String(upd.params[2])) as AcademicDoc;
  assert.ok(nextDoc.slides![4].image, "qisqa slayd rasm olishi kerak");
  assert.deepEqual(nextDoc.slides![4].left, shortTwo.left);
});

// ═══════════════════════════════════════════ AUDIT-25 INT-03: yagona server nuqtasi (`commitDocOps`)

/*
 * Yuklashdagi tekshiruv rasm va matn uchrashadigan 4 yo'lning bittasini
 * yopardi. Qolgan uchtasi PATCH orqali keladi: rasmli slaydga matn yozish,
 * rasmni o'chirib matnni uzaytirib «Rasmni qaytarish» (`imageRestore`) va
 * oldingi yuklangan aktivni `image` op bilan qayta qo'yish. Endi tekshiruv
 * `commitDocOps` da (slayd adapterining `guard` i): op lar qo'llangandan
 * keyin RASMLI va «matn + rasm» holati OLDIN bo'lmagan har slayd
 * `imageYieldField` dan o'tadi; sig'masa — butun PATCH 400, hech narsa
 * yozilmaydi.
 */
const { commitDocOps, patchDocFromRequest } = await import("../lib/server/slide-commit.ts");

const IMG_A = `/api/generations/${GEN}/assets/${"a".repeat(32)}`;
const IMG_B = `/api/generations/${GEN}/assets/${"b".repeat(32)}`;
const IMG_OLD = `/api/generations/${GEN}/assets/${"c".repeat(32)}`;
const IMG_D = `/api/generations/${GEN}/assets/${"d".repeat(32)}`;

/*
 * 0 — qisqa twoCol, RASMLI (matn tahriri va almashtirish uchun);
 * 1 — uzun twoCol, RASMLI: ESKI deka — sig'maslik OLDINDAN bor, unga tegilmasa bloklamasin;
 * 2 — uzun twoCol, rasmi O'CHIRILGAN (`imageOrig` — boshqa hech qayerda yo'q URL) — `imageRestore` uchun;
 * 3 — qisqa twoCol, rasmsiz; 4 — uzun twoCol, rasmsiz (`image` op uchun).
 */
const int3Slides: SlideModel[] = [
  { ...shortTwo, id: "s0", image: { url: IMG_A } },
  { ...longTwo, id: "s1", image: { url: IMG_OLD } },
  { ...longTwo, id: "s2", imageOrig: { url: IMG_D } },
  { ...shortTwo, id: "s3" },
  { ...longTwo, id: "s4" },
];
const int3Doc = docOf(int3Slides);

function int3Db(t: TestContext) {
  return mockDb(t, {
    forEdit: editRow({ doc_json: int3Doc }),
    updateDoc: { doc_version: 4 },
    detail: detailRow(),
    hasFile: true,
  });
}

function savedDoc(seen: Seen[]): AcademicDoc {
  const upd = seen.find((s) => /UPDATE generations SET doc_json/.test(s.text));
  assert.ok(upd, "doc yozilishi kerak edi");
  return JSON.parse(String(upd.params[2])) as AcademicDoc;
}

async function expectTooLong(p: Promise<unknown>, seen: Seen[]) {
  const err = await expectApiError(p, 400);
  assert.equal(err.message, TEXT_TOO_LONG_FOR_IMAGE);
  assert.equal(err.extra.code, "text_too_long");
  assert.equal(found(seen, /UPDATE generations SET doc_json/).length, 0, "rad etilgan PATCH doc ni yozdi");
  assert.equal(found(seen, /INSERT INTO generation_assets/).length, 0, "rad etilgan PATCH aktiv yozdi");
  return err;
}

const LONG_ITEM = p8Text(100, 3);

test("INT-03 sinov asosi: 1-slayd rasm bilan sig'maydi (eski deka), 0-slayd sig'adi, uzun band 0-slaydni sig'dirmaydi", () => {
  const deck = buildSlideDeck(int3Doc);
  assert.equal(imageYieldField(int3Slides[0], deck.bodyType, deck.visual), null);
  assert.equal(imageYieldField(int3Slides[1], deck.bodyType, deck.visual), "colItem");
  const longer = { ...int3Slides[0], left: [LONG_ITEM, ...int3Slides[0].left!.slice(1)] };
  assert.equal(imageYieldField(longer, deck.bodyType, deck.visual), "colItem");
  assert.ok(LONG_ITEM.length <= 110, "tahrir chegarasidan (colItem 110) o'tadi — tekshiruvni FAQAT server guard qiladi");
});

test("INT-03 (1): rasmli slaydga rasmli qutidan uzun matn yozish (`text`) — 400, hech narsa yozilmaydi", async (t) => {
  const seen = int3Db(t);
  const err = await expectTooLong(commitDocOps(GEN, USER, 3, [{ op: "text", index: 0, src: { f: "left", i: 0 }, value: LONG_ITEM }]), seen);
  assert.equal(err.extra.index, 0);
});

test("INT-03 (1b): `list` op bilan ham xuddi shunday — 400", async (t) => {
  const seen = int3Db(t);
  await expectTooLong(commitDocOps(GEN, USER, 3, [{ op: "list", index: 0, field: "right", items: [LONG_ITEM, ...shortTwo.right!.slice(1)] }]), seen);
});

test("INT-03 (2): rasmli slaydga quti ichidagi matn — 200, yoziladi", async (t) => {
  const seen = int3Db(t);
  const value = p8Text(30, 5);
  const gen = await commitDocOps(GEN, USER, 3, [{ op: "text", index: 0, src: { f: "left", i: 0 }, value }]);
  assert.equal(gen.docVersion, 4);
  const doc = savedDoc(seen);
  assert.equal(doc.slides![0].left![0], value);
  assert.deepEqual(doc.slides![0].image, { url: IMG_A });
});

test("INT-03 (3): rasm o'chirildi → matn uzaydi → «Rasmni qaytarish» (`imageRestore`) — 400", async (t) => {
  // 2-slayd: rasmi allaqachon o'chirilgan, matni uzun — qaytarish sig'maslikni tiklardi.
  const seen = int3Db(t);
  await expectTooLong(commitDocOps(GEN, USER, 3, [{ op: "imageRestore", index: 2 }]), seen);
});

test("INT-03 (3b): bitta PATCH ichida o'chirish + uzaytirish + qaytarish — 400", async (t) => {
  const seen = int3Db(t);
  await expectTooLong(
    commitDocOps(GEN, USER, 3, [
      { op: "image", index: 0, url: null },
      { op: "text", index: 0, src: { f: "left", i: 0 }, value: LONG_ITEM },
      { op: "imageRestore", index: 0 },
    ]),
    seen,
  );
});

test("INT-03 (3c): rasmni o'chirib matnni uzaytirish (rasmsiz qoladi) — 200", async (t) => {
  const seen = int3Db(t);
  await commitDocOps(GEN, USER, 3, [
    { op: "image", index: 0, url: null },
    { op: "text", index: 0, src: { f: "left", i: 0 }, value: LONG_ITEM },
  ]);
  const doc = savedDoc(seen);
  assert.equal(doc.slides![0].image, undefined);
  assert.equal(doc.slides![0].left![0], LONG_ITEM);
});

test("INT-03 (4): PATCH `image` op (oldingi aktiv) uzun matnli rasmsiz slaydga — 400; qisqa matnliga — 200", async (t) => {
  const seen = int3Db(t);
  const body = JSON.stringify({ baseVersion: 3, ops: [{ op: "image", index: 4, url: IMG_B }] });
  await expectTooLong(patchDocFromRequest(new Request(`http://x/api/generations/${GEN}/doc`, { method: "PATCH", body }), GEN, USER), seen);
  t.mock.restoreAll();
  const seen2 = int3Db(t);
  await commitDocOps(GEN, USER, 3, [{ op: "image", index: 3, url: IMG_B }]);
  assert.deepEqual(savedDoc(seen2).slides![3].image, { url: IMG_B });
});

test("INT-03 (4b): `set` op (undo yo'li) bilan rasmli slaydga uzun matn — 400", async (t) => {
  const seen = int3Db(t);
  await expectTooLong(commitDocOps(GEN, USER, 3, [{ op: "set", index: 3, slide: { ...longTwo, id: "s3", image: { url: IMG_B } } }]), seen);
});

test("INT-03 (5): tegilmagan sig'mas slayd (eski deka, 1-slayd) boshqa tahrirni bloklamaydi", async (t) => {
  const seen = int3Db(t);
  await commitDocOps(GEN, USER, 3, [
    { op: "text", index: 3, src: { f: "title" }, value: "Yangi sarlavha" },
    { op: "notes", index: 1, value: "Izoh" },
    { op: "footer", value: "Maktab" },
  ]);
  const doc = savedDoc(seen);
  assert.equal(doc.slides![3].title, "Yangi sarlavha");
  assert.deepEqual(doc.slides![1].image, { url: IMG_OLD }, "eski slayd rasmi joyida");
  assert.deepEqual(doc.slides![1].left, longTwo.left);
});

test("INT-03 (5b): eski sig'mas slaydning SARLAVHASI yoki uslubi (quti matni emas) — 200", async (t) => {
  const seen = int3Db(t);
  await commitDocOps(GEN, USER, 3, [
    { op: "text", index: 1, src: { f: "title" }, value: "Boshqa sarlavha" },
    { op: "style", index: 1, src: { f: "left", i: 0 }, size: 20 },
  ]);
  assert.equal(savedDoc(seen).slides![1].title, "Boshqa sarlavha");
});

test("INT-03 (5c): slaydlar tartibi o'zgarsa (reorder/delete/add) — tegilmagan eski slayd bloklamaydi", async (t) => {
  const seen = int3Db(t);
  await commitDocOps(GEN, USER, 3, [
    { op: "reorder", order: [1, 0, 2, 3, 4] },
    { op: "delete", index: 4 },
    { op: "add", after: 0 },
  ]);
  assert.deepEqual(savedDoc(seen).slides![0].image, { url: IMG_OLD });
});

test("INT-03 (5d): surilgan slayd ham kuzatiladi — reorder'dan keyin rasmli slaydga uzun matn 400", async (t) => {
  // reorder → 1-o'rinda endi asl 0-slayd (qisqa, rasmli); uni uzaytirish rad etiladi.
  const seen = int3Db(t);
  const err = await expectTooLong(
    commitDocOps(GEN, USER, 3, [
      { op: "reorder", order: [1, 0, 2, 3, 4] },
      { op: "add", after: -1 },
      { op: "text", index: 2, src: { f: "left", i: 0 }, value: LONG_ITEM },
    ]),
    seen,
  );
  assert.equal(err.extra.index, 2);
});

test("INT-03 (5e): `insert` (o'chirishni undo) — yangi kelgan rasmli slayd tekshiriladi", async (t) => {
  const seen = int3Db(t);
  await expectTooLong(commitDocOps(GEN, USER, 3, [{ op: "insert", index: 0, slide: { ...longTwo, id: "s9", image: { url: IMG_B } } }]), seen);
  t.mock.restoreAll();
  const seen2 = int3Db(t);
  await commitDocOps(GEN, USER, 3, [{ op: "insert", index: 0, slide: { ...shortTwo, id: "s9", image: { url: IMG_B } } }]);
  assert.deepEqual(savedDoc(seen2).slides![0].image, { url: IMG_B });
});

test("INT-03 (6): matni o'zgarmagan rasmli slaydda rasmni ALMASHTIRISH — qabul (yuklash ham, PATCH ham)", async (t) => {
  // 1-slayd: matni rasm bilan allaqachon sig'maydi (eski deka), lekin rasm BOR edi — almashtirish hech narsani yomonlashtirmaydi.
  const seen = int3Db(t);
  const gen = await uploadSlideImage(p8Req(1), GEN, USER, 1);
  assert.equal(gen.docVersion, 4);
  const doc = savedDoc(seen);
  assert.notEqual(doc.slides![1].image!.url, IMG_OLD, "yangi rasm qo'yildi");
  assert.deepEqual(doc.slides![1].imageOrig, { url: IMG_OLD }, "asl rasm «Rasmni qaytarish» uchun saqlandi");
  t.mock.restoreAll();
  const seen2 = int3Db(t);
  await uploadSlideImage(p8Req(0), GEN, USER, 0);
  assert.ok(savedDoc(seen2).slides![0].image);
  t.mock.restoreAll();
  const seen3 = int3Db(t);
  await commitDocOps(GEN, USER, 3, [{ op: "image", index: 1, url: IMG_B }]);
  assert.deepEqual(savedDoc(seen3).slides![1].image, { url: IMG_B });
});

test("INT-03 (6b): rasm almashtirilib BIR VAQTDA matn uzaysa — 400", async (t) => {
  const seen = int3Db(t);
  await expectTooLong(
    commitDocOps(GEN, USER, 3, [
      { op: "image", index: 0, url: IMG_B },
      { op: "text", index: 0, src: { f: "right", i: 1 }, value: LONG_ITEM },
    ]),
    seen,
  );
});

// ─── Monoton qoida (eski deka): qisqartirish hech qachon rad etilmaydi, uzaytirish — rad

const { imageTextOverflow } = await import("../lib/server/edit-adapters.ts");
const { imageOverflowChars, fitChars } = await import("../lib/generation/slide-quality.ts");

const oldItemSlide = (len: number): SlideModel => ({ ...shortTwo, id: "s1", left: [p8Text(len, 1), ...shortTwo.left!.slice(1)], image: { url: IMG_OLD } });
const oldDeckWith = (s: SlideModel) => docOf([int3Slides[0], s, ...int3Slides.slice(2)]);

test("INT-03 monoton (sof): eski dekadagi 200 belgilik twoCol bandi rasm yonida — 150 ga qisqartirish OK, 220 ga uzaytirish rad", async () => {
  const before = oldDeckWith(oldItemSlide(200));
  const deck = buildSlideDeck(before);
  const at = (len: number) => imageOverflowChars(oldItemSlide(len), deck.bodyType, deck.visual).colItem ?? 0;
  assert.ok(at(150) > 0 && at(150) < at(200) && at(220) > at(200), "sinov asosi: 150 hali sig'maydi, lekin kamroq; 220 ko'proq");
  assert.equal(await imageTextOverflow(before, oldDeckWith(oldItemSlide(150)), []), null, "qisqartirish (hali sig'masa ham) rad etildi");
  assert.equal(await imageTextOverflow(before, oldDeckWith(oldItemSlide(200)), []), null, "o'zgarmagan holat rad etildi");
  assert.deepEqual(await imageTextOverflow(before, oldDeckWith(oldItemSlide(220)), []), { index: 1, field: "colItem" });
});

test("INT-03 monoton: `imageYieldField` = `imageOverflowChars` ning birinchi kaliti (bitta o'lchov)", () => {
  const deck = buildSlideDeck(int3Doc);
  for (const s of [...int3Slides, oldItemSlide(200), oldItemSlide(10)]) {
    const keys = Object.keys(imageOverflowChars(s, deck.bodyType, deck.visual));
    assert.equal(imageYieldField(s, deck.bodyType, deck.visual), keys[0] ?? null);
  }
});

test("INT-03 monoton (commit): eski sig'mas bandni qisqartirish (hali sig'masa ham) — 200; uzaytirish — 400", async (t) => {
  // Tahrirchi ustun bandini 110 belgida qirqadi (`SLIDE_LIMITS.colItem`) — shuning uchun 100 belgilik asos.
  const deck = buildSlideDeck(int3Doc);
  const cap = fitChars("colItem", deck.bodyType, deck.visual, 4);
  const old = oldItemSlide(100);
  const L0 = old.left![0].length;
  const shorter = p8Text(Math.floor((cap + L0) / 2), 1);
  const longer = p8Text(110, 1);
  assert.ok(shorter.length > cap && shorter.length < L0 && longer.length > L0, `sinov asosi: cap ${cap} < ${shorter.length} < ${L0} < ${longer.length}`);
  const doc = oldDeckWith(old);
  const db = (tt: TestContext) => mockDb(tt, { forEdit: editRow({ doc_json: doc }), updateDoc: { doc_version: 4 }, detail: detailRow(), hasFile: true });

  const seen = db(t);
  await commitDocOps(GEN, USER, 3, [{ op: "text", index: 1, src: { f: "left", i: 0 }, value: shorter }]);
  const saved = savedDoc(seen).slides![1];
  assert.equal(saved.left![0], shorter);
  assert.equal(imageYieldField(saved, deck.bodyType, deck.visual), "colItem", "natija hali sig'maydi — shunga qaramay qabul");
  t.mock.restoreAll();
  const seen2 = db(t);
  await expectTooLong(commitDocOps(GEN, USER, 3, [{ op: "text", index: 1, src: { f: "left", i: 0 }, value: longer }]), seen2);
});

test("INT-03 undo: eski sig'mas rasmli slaydni o'chirish + undo (`insert` asl `id` bilan) bir PATCH da — 200", async (t) => {
  const seen = int3Db(t);
  await commitDocOps(GEN, USER, 3, [
    { op: "delete", index: 1 },
    { op: "insert", index: 1, slide: int3Slides[1] },
  ]);
  const doc = savedDoc(seen);
  assert.deepEqual(doc.slides![1].image, { url: IMG_OLD });
  assert.deepEqual(doc.slides![1].left, longTwo.left);
});

test("INT-03 undo: begona `id`, shu URL, lekin UZUNROQ matnli rasmli slayd — hali ham 400", async (t) => {
  const seen = int3Db(t);
  const longer = { ...int3Slides[1], id: "s77", left: [p8Text(110, 1), ...longTwo.left!.slice(1)] };
  await expectTooLong(commitDocOps(GEN, USER, 3, [{ op: "insert", index: 1, slide: longer }]), seen);
});

// ─── ASL deka asos sifatida (P12 sharhi 1): eski deka o'z AI rasmini hech qachon yo'qotmaydi — IKKI PATCH

const { inverseOps } = await import("../lib/generation/slide-edit.ts");

/**
 * Ikki PATCH ketma-ketligi: 1-PATCH `int3Doc` ustida (asl deka — `doc_prev` hali yo'q),
 * 2-PATCH saqlangan natija ustida, `doc_prev` = `int3Doc` (1-PATCH birinchi tahrir edi).
 * `second` — 1-PATCH dan oldingi va keyingi doc'ni olib, 2-PATCH op larini qaytaradi.
 */
async function twoPatches(t: TestContext, first: DocOp[], second: (base: AcademicDoc, saved: AcademicDoc) => DocOp[], prev: AcademicDoc | null = int3Doc) {
  const seen1 = int3Db(t);
  await commitDocOps(GEN, USER, 3, first);
  const saved = savedDoc(seen1);
  t.mock.restoreAll();
  const seen2 = mockDb(t, { forEdit: editRow({ doc_json: saved, doc_version: 4 }), updateDoc: { doc_version: 5 }, detail: detailRow(), hasFile: true, prev });
  return { seen2, run: () => commitDocOps(GEN, USER, 4, second(int3Doc, saved)) };
}

test("INT-03 asl deka (a): eski sig'mas slayddan rasmni o'chirish → Ctrl+Z (alohida PATCH) — 200", async (t) => {
  const first: DocOp[] = [{ op: "image", index: 1, url: null }];
  const { seen2, run } = await twoPatches(t, first, (base) => inverseOps(base, first, { genId: GEN }));
  await run();
  assert.deepEqual(savedDoc(seen2).slides![1].image, { url: IMG_OLD });
  assert.equal(found(seen2, /^SELECT doc_prev/).length, 1, "asl deka dangasa o'qildi");
});

test("INT-03 asl deka (b): o'chirilgan AI rasmini «Rasmni qaytarish» (`imageRestore`, alohida PATCH) — 200", async (t) => {
  const { seen2, run } = await twoPatches(t, [{ op: "image", index: 1, url: null }], () => [{ op: "imageRestore", index: 1 }]);
  await run();
  assert.deepEqual(savedDoc(seen2).slides![1].image, { url: IMG_OLD });
});

test("INT-03 asl deka (c): eski sig'mas rasmli slaydni o'chirish → Ctrl+Z ALOHIDA PATCH da — 200", async (t) => {
  const first: DocOp[] = [{ op: "delete", index: 1 }];
  const { seen2, run } = await twoPatches(t, first, (base) => inverseOps(base, first, { genId: GEN }));
  await run();
  const doc = savedDoc(seen2);
  assert.deepEqual(doc.slides![1].image, { url: IMG_OLD });
  assert.deepEqual(doc.slides![1].left, longTwo.left);
});

test("INT-03 asl deka (d): qisqartirish → Ctrl+Z (asl uzun matnga qaytish, alohida PATCH) — 200", async (t) => {
  // Ikkala ustun ham qisqaradi — Ctrl+Z `before` ga nisbatan ortiqchani KO'PAYTIRADI, faqat asl deka qutqaradi.
  const first: DocOp[] = [
    { op: "list", index: 1, field: "left", items: shortTwo.left! },
    { op: "list", index: 1, field: "right", items: shortTwo.right! },
  ];
  const { seen2, run } = await twoPatches(t, first, (base) => inverseOps(base, first, { genId: GEN }));
  await run();
  assert.deepEqual(savedDoc(seen2).slides![1].left, longTwo.left);
});

test("INT-03 asl deka: `doc_prev` null (hech qachon tahrirlanmagan) — `before` asl; baribir rad/qabul to'g'ri", async (t) => {
  // Birinchi tahrirning o'zida `imageRestore` yo'q, shuning uchun bu yerda 2-slaydning noyob URL i — 400.
  const seen = mockDb(t, { forEdit: editRow({ doc_json: int3Doc }), prev: null });
  await expectTooLong(commitDocOps(GEN, USER, 3, [{ op: "imageRestore", index: 2 }]), seen);
});

test("INT-03 asl deka: oqim 2 — rasmni o'chirib matnni UZAYTIRISH, keyin qaytarish (alohida PATCH) — hali ham 400", async (t) => {
  const { seen2, run } = await twoPatches(
    t,
    [
      { op: "image", index: 1, url: null },
      { op: "text", index: 1, src: { f: "left", i: 0 }, value: p8Text(110, 1) },
    ],
    () => [{ op: "imageRestore", index: 1 }],
  );
  await expectTooLong(run(), seen2);
});

test("INT-03 asl deka: tez yo'llar o'tsa `doc_prev` UMUMAN o'qilmaydi", async (t) => {
  const seen = int3Db(t);
  await commitDocOps(GEN, USER, 3, [{ op: "text", index: 0, src: { f: "title" }, value: "Yangi" }]);
  assert.equal(found(seen, /^SELECT doc_prev/).length, 0);
});

// ─── Maket o'zgarishi (P12 sharhi 3) va yagona jadval (P12 sharhi 4)

const { IMAGE_YIELD_TABLE, imageYieldText, imageOverflowRatio } = await import("../lib/generation/slide-quality.ts");

test("INT-03 nisbat: maket o'zgarib ortiqcha KAMAYSA (yangi maydon) — qabul; ko'paysa — rad", async () => {
  const deck = buildSlideDeck(int3Doc);
  const oldSlide = int3Slides[1];
  const worst = Math.max(...Object.values(imageOverflowRatio(oldSlide, deck.bodyType, deck.visual)));
  const cap = fitChars("bullets", deck.bodyType, deck.visual, 3);
  assert.ok(cap < fitChars("bullets", deck.bodyType, deck.visual, 3, { images: "none" }), "sinov asosi: bullets rasm bilan torayadi");
  const bulletsOf = (ratio: number): SlideModel => ({ id: "s1", layout: "bullets", title: oldSlide.title, bullets: [p8Text(Math.ceil(cap * ratio), 1), "Ikki.", "Uch."], image: { url: IMG_OLD } });
  const lower = (1 + worst) / 2;
  const r = (s: SlideModel) => imageOverflowRatio(s, deck.bodyType, deck.visual).bullets ?? 0;
  assert.ok(r(bulletsOf(lower)) > 1 && r(bulletsOf(lower)) < worst, `sinov asosi: 1 < ${r(bulletsOf(lower))} < ${worst}`);
  const layoutOp: DocOp[] = [{ op: "layout", index: 1, layout: "bullets" }];
  const after = (s: SlideModel) => docOf([int3Slides[0], s, ...int3Slides.slice(2)]);
  assert.equal(await imageTextOverflow(int3Doc, after(bulletsOf(lower)), layoutOp), null, "ortiqcha kamaydi — qabul");
  const higher = bulletsOf(worst * 1.3);
  assert.ok(r(higher) > worst, "sinov asosi: ortiqcha ko'paydi");
  assert.deepEqual(await imageTextOverflow(int3Doc, after(higher), layoutOp), { index: 1, field: "bullets" });
});

test("INT-03 jadval: `imageYieldText` kalitlari = o'lchov o'qiydigan maydonlar (bitta jadval)", () => {
  const keys = Object.fromEntries(Object.entries(IMAGE_YIELD_TABLE).map(([k, v]) => [k, [...v!.keys]]));
  assert.deepEqual(keys, {
    bullets: ["bullets"],
    twoCol: ["left", "right"],
    compare: ["left", "right"],
    process: ["steps"],
    stats: ["stats"],
    table: ["table"],
    quote: ["quote"],
    section: ["subtitle"],
    closing: ["subtitle"],
  });
  const deck = buildSlideDeck(int3Doc);
  const base = int3Slides[1];
  // Ro'yxatda YO'Q maydonlar: kalit ham, o'lchov ham o'zgarmaydi.
  const noise: SlideModel = { ...base, title: "Boshqa", leftTitle: "X".repeat(60), rightTitle: "Y".repeat(60), quoteBy: "Z", notes: "n", subtitle: "S".repeat(200) };
  assert.equal(imageYieldText(noise), imageYieldText(base));
  assert.deepEqual(imageOverflowChars(noise, deck.bodyType, deck.visual), imageOverflowChars(base, deck.bodyType, deck.visual));
  // Ro'yxatdagi har kalit: o'zgarsa `imageYieldText` ham o'zgaradi.
  for (const k of IMAGE_YIELD_TABLE.twoCol!.keys) assert.notEqual(imageYieldText({ ...base, [k]: ["boshqa"] }), imageYieldText(base), k);
});

test("INT-03: yuklash uzun matnli RASMSIZ slaydga — hali ham 400 (yagona nuqta orqali)", async (t) => {
  const seen = int3Db(t);
  await expectTooLong(uploadSlideImage(p8Req(4), GEN, USER, 4), seen);
});

