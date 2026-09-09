import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";

/**
 * E5 — slayd rasm serveri (`lib/server/slide-image.ts` va uni chaqiradigan
 * `image`/`image/regenerate` route'lari).
 *
 * BAZASIZ va TARMOQSIZ: `pool().query`/`pool().connect()` (`tests/slide-doc-route.test.mts`
 * naqshi) VA `globalThis.fetch` (`tests/slide-images.test.mts` naqshi)
 * ikkalasi ham ushlanadi. Route funksiyalarining o'zi chaqirilmaydi —
 * `cookies()` Next so'rov konteksti ichida ishlaydi; route'lar bu
 * fayldagi AYNAN shu funksiyalarni (`uploadSlideImage`,
 * `regenerateSlideImage`) chaqiradi, ya'ni sinov haqiqiy kod yo'lini
 * sinaydi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const { ApiError } = await import("../lib/server/api.ts");
const { uploadSlideImage, regenerateSlideImage } = await import("../lib/server/slide-image.ts");
const { IMAGE_REDRAW_LIMIT, SLIDE_IMAGE_MAX_BYTES } = await import("../lib/generation/slide-limits.ts");
const { seedFrom } = await import("../lib/generation/slide-images.ts");
const { extractMeta } = await import("../lib/generation/meta.ts");
const { TOOL_BY_ID } = await import("../lib/tools.ts");

const GEN = "a1b2c3d4-0000-4000-8000-000000000002";
const USER = "u-42";

const meta = extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi", slideTemplate: "lecture" } as never);

// index 0 — rasm joyi bor (title); index 1 — rasm joyi bor (bullets);
// index 2 — rasm joyi YO'Q (stats) — 422 yo'li uchun.
const slides: SlideModel[] = [
  { id: "s0", layout: "title", title: "Suv aylanishi", subtitle: "Kirish" },
  { id: "s1", layout: "bullets", title: "Bandlar", bullets: ["Bir.", "Ikki."] },
  { id: "s2", layout: "stats", title: "Statistika", stats: [{ value: "71%", label: "Yer yuzasi" }] },
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
  /** `null` — limit tugagan (`reserveRedraw` 0 qator). */
  reserve?: Record<string, unknown> | null;
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
    else if (/SET image_redraws = image_redraws \+ 1/.test(q)) out = rows.reserve ? [rows.reserve] : [];
    else if (/SET image_redraws = GREATEST/.test(q)) out = []; // releaseRedraw — natija tekshirilmaydi
    else if (/INSERT INTO generation_assets/.test(q)) out = []; // putAssetBytes — ON CONFLICT DO NOTHING
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

// ───────────────────────────────────────────── fetch stub (fal.ai)

/** `slide-images.ts` `sniffImageType`ning tekshiradigan haqiqiy 1x1 JPEG bayti. */
const JPEG_1PX =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as never;
}

function falEnv() {
  const saved = { fal: process.env.FAL_KEY, fetch: globalThis.fetch };
  process.env.FAL_KEY = "test-fal-key";
  return () => {
    globalThis.fetch = saved.fetch;
    if (saved.fal === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = saved.fal;
  };
}

/** Har chaqiruvda muvaffaqiyatli fal javobi — so'rov tanasini `seen`ga yozadi. */
function stubFalOk(seen: { body: Record<string, unknown> }[]) {
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    seen.push({ body: JSON.parse(String(init.body)) });
    return jsonRes(200, { images: [{ url: `data:image/jpeg;base64,${JPEG_1PX}` }] });
  }) as unknown as typeof fetch;
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

// ═══════════════════════════════════════════ regenerateSlideImage

test("regenerateSlideImage: indeks manfiy — 400, DB ga bormaydi", async (t) => {
  const seen = mockDb(t, { forEdit: editRow() });
  await expectApiError(regenerateSlideImage(GEN, USER, -1, 3), 400);
  assert.equal(seen.length, 0);
});

test("regenerateSlideImage: maketda rasm joyi yo'q — 422, reserveRedraw ChAQIRILMAYDI", async (t) => {
  const seen = mockDb(t, { forEdit: editRow({ doc_version: 3 }) });
  await expectApiError(regenerateSlideImage(GEN, USER, 2, 3), 422);
  /*
   * MUTATSIYA: agar tekshiruv tartibi almashtirilsa (avval limit band
   * qilinsa, keyin maket tekshirilsa), bu foydalanuvchining bepul
   * limitini BEHUDA yeb qo'yardi — hech qanday rasm chizib bo'lmaydigan
   * slaydda ham.
   */
  assert.equal(found(seen, /SET image_redraws = image_redraws \+ 1/).length, 0, "limit band qilinmasligi kerak");
});

test("regenerateSlideImage: reserveRedraw null — 409 {code:'redraw_limit'}, provayder CHAQIRILMAYDI", async (t) => {
  const restore = falEnv();
  const calls: unknown[] = [];
  globalThis.fetch = (async () => {
    calls.push(1);
    return jsonRes(200, { images: [{ url: `data:image/jpeg;base64,${JPEG_1PX}` }] });
  }) as unknown as typeof fetch;
  try {
    mockDb(t, { forEdit: editRow({ doc_version: 3, image_redraws: IMAGE_REDRAW_LIMIT }), reserve: null });
    const e = await expectApiError(regenerateSlideImage(GEN, USER, 1, 3), 409);
    assert.equal(e.extra.code, "redraw_limit");
    assert.equal(e.extra.imageRedraws, IMAGE_REDRAW_LIMIT);
    assert.equal(calls.length, 0, "limit tugagan bo'lsa pullik provayder chaqiruvi ketmasligi kerak");
  } finally {
    restore();
  }
});

test("regenerateSlideImage: provayder 'failed' — 502, releaseRedraw chaqiriladi, commitDocOps chaqirilmaydi", async (t) => {
  const restore = falEnv();
  globalThis.fetch = (async () => jsonRes(500, { error: "internal" })) as unknown as typeof fetch;
  try {
    const seen = mockDb(t, {
      forEdit: editRow({ doc_version: 3 }),
      reserve: { image_redraws: 2 },
    });
    const e = await expectApiError(regenerateSlideImage(GEN, USER, 1, 3), 502);
    assert.equal(e.extra.code, "failed");
    assert.equal(found(seen, /SET image_redraws = GREATEST/).length, 1, "band qilingan limit qaytarilishi kerak");
    assert.equal(found(seen, /UPDATE generations SET doc_json/).length, 0, "yiqilgan urinish yozilmasligi kerak");
    assert.equal(found(seen, /INSERT INTO generation_assets/).length, 0, "hech qanday aktiv saqlanmasligi kerak");
  } finally {
    restore();
  }
});

test("regenerateSlideImage: muvaffaqiyat — commitDocOps {op:'image', url} bilan, releaseRedraw ChAQIRILMAYDI", async (t) => {
  const restore = falEnv();
  const reqs: { body: Record<string, unknown> }[] = [];
  stubFalOk(reqs);
  try {
    const seen = mockDb(t, {
      forEdit: editRow({ doc_version: 3 }),
      reserve: { image_redraws: 2 },
      updateDoc: { doc_version: 4 },
      detail: detailRow(),
    });
    const gen = await regenerateSlideImage(GEN, USER, 1, 3);
    assert.equal(gen.docVersion, 4);

    assert.equal(found(seen, /SET image_redraws = GREATEST/).length, 0, "muvaffaqiyatda limit qaytarilmaydi");
    const upd = seen.find((s) => /UPDATE generations SET doc_json/.test(s.text))!;
    const nextDoc = JSON.parse(String(upd.params[2])) as AcademicDoc;
    assert.match(
      nextDoc.slides![1].image!.url,
      new RegExp(`^/api/generations/${GEN}/assets/[0-9a-f]+$`),
      "yozilgan URL shu generatsiyaning aktiviga ishora qilishi kerak",
    );
  } finally {
    restore();
  }
});

test("regenerateSlideImage: seed HAR safar tasodifiy — seedFrom(topic) EMAS, ikki chaqiruv har xil beradi", async (t) => {
  const restore = falEnv();
  try {
    const reqs1: { body: Record<string, unknown> }[] = [];
    stubFalOk(reqs1);
    mockDb(t, {
      forEdit: editRow({ doc_version: 3 }),
      reserve: { image_redraws: 2 },
      updateDoc: { doc_version: 4 },
      detail: detailRow(),
    });
    await regenerateSlideImage(GEN, USER, 1, 3);

    const reqs2: { body: Record<string, unknown> }[] = [];
    stubFalOk(reqs2);
    mockDb(t, {
      forEdit: editRow({ doc_version: 3 }),
      reserve: { image_redraws: 2 },
      updateDoc: { doc_version: 4 },
      detail: detailRow(),
    });
    await regenerateSlideImage(GEN, USER, 1, 3);

    const seed1 = reqs1[0].body.seed;
    const seed2 = reqs2[0].body.seed;
    assert.equal(typeof seed1, "number");
    /*
     * MUTATSIYA: agar `regenerateSlideImage` `seedFrom(topic)` ishlatsa
     * (deka bilan bir xil), ikkala chaqiruv AYNAN bir xil seed berardi —
     * bu assertion buni ushlaydi. Ehtimollik bilan tasodifiy ikkita
     * qiymat tenglashib qolishi 1/1_000_000 — amalda ahamiyatsiz.
     */
    assert.notEqual(seed1, seed2, "har chaqiruv o'z tasodifiy seed'ini olishi kerak");
    assert.notEqual(seed1, seedFrom("Suv aylanishi"), "deka seed'i ISHLATILMASLIGI kerak");
  } finally {
    restore();
  }
});

test("regenerateSlideImage: hint promptga yetadi va imageHint sifatida ATOMIK yoziladi", async (t) => {
  const restore = falEnv();
  const reqs: { body: Record<string, unknown> }[] = [];
  stubFalOk(reqs);
  try {
    const seen = mockDb(t, {
      forEdit: editRow({ doc_version: 3 }),
      reserve: { image_redraws: 2 },
      updateDoc: { doc_version: 4 },
      detail: detailRow(),
    });
    await regenerateSlideImage(GEN, USER, 1, 3, "qishloq maktabidagi sinf xonasi");

    assert.match(
      String(reqs[0].body.prompt),
      /qishloq maktabidagi sinf xonasi/,
      "berilgan ko'rsatma promptga tushishi kerak",
    );

    const writes = found(seen, /^UPDATE generations SET doc_json/);
    assert.equal(writes.length, 1, "imageHint va rasm BITTA yozuvda (atomik) — reserveRedraw'dan ALOHIDA UPDATE");
    const upd = seen.find((s) => /UPDATE generations SET doc_json/.test(s.text))!;
    const nextDoc = JSON.parse(String(upd.params[2])) as AcademicDoc;
    assert.equal(
      nextDoc.slides![1].imageHint,
      "qishloq maktabidagi sinf xonasi",
      "hint slaydga saqlanishi kerak — keyingi safar ko'rinsin",
    );
  } finally {
    restore();
  }
});

test("regenerateSlideImage: baseVersion eskirgan — 409 {code:'version'}, providerdan KEYIN ham limit qaytariladi", async (t) => {
  const restore = falEnv();
  stubFalOk([]);
  try {
    const seen = mockDb(t, {
      forEdit: editRow({ doc_version: 7 }),
      reserve: { image_redraws: 2 },
    });
    const e = await expectApiError(regenerateSlideImage(GEN, USER, 1, 3), 409);
    assert.equal(e.extra.code, "version");
    /*
     * `commitDocOps` o'zi ICHKARIDA yana bir marta `loadDocForEdit`
     * chaqiradi va u yerda versiya solishtiriladi — provayder
     * muvaffaqiyatli chizgan bo'lsa ham, versiya keksargan bo'lsa
     * yozuv 409 bilan yiqiladi. Bu holatda ham limit ATAYLAB
     * qaytarilishi kerak: foydalanuvchi bepul chizishni band qilib,
     * hech narsaga erishmadi.
     */
    assert.equal(found(seen, /SET image_redraws = GREATEST/).length, 1);
  } finally {
    restore();
  }
});
