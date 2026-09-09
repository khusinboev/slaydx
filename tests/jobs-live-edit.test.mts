import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";
import type { AcademicDoc } from "../lib/generation/types.ts";

/**
 * F1a — poydevor, SERVER tomoni («Jonli generatsiya + ko'ruvchida
 * tahrirlash», `013_live_edit.sql`).
 *
 * BAZASIZ: `pool().query` ushlanadi (`tests/logo.test.mts:173-213`
 * naqshi) — bu yerda faqat SQL matni/predikatlar va sof funksiyalar
 * (`assetImageResolver`, `assetFromDataUrl`) sinaladi. Haqiqiy DB
 * integratsiyasi mavjud `tests/queue.test.mts`/`logo.test.mts` (DATABASE_URL
 * bo'lsa) qamrovida qoladi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const {
  setLive,
  heartbeat,
  getGeneration,
  claimJob,
  completeJob,
  failJob,
  reclaimStaleJobs,
  updateGenerationDoc,
  markFileVersion,
  reserveRedraw,
  releaseRedraw,
  getVersions,
  getGenerationForEdit,
  rowToSummary,
} = await import("../lib/server/jobs.ts");
const { assetImageResolver, assetFromDataUrl, ASSET_URL_RE, ownAssetUrlRe, putAssetBytes } = await import(
  "../lib/server/assets.ts"
);
const { renderPptx } = await import("../lib/generation/render-pptx.ts");

type Seen = { text: string; params: unknown[] };

/** `pool().query` ni ushlab, so'rov matni/parametrlarini yig'adi. */
function mockQuery(t: TestContext, rows: unknown[] = []): Seen[] {
  const seen: Seen[] = [];
  const p = pool();
  t.mock.method(p, "query", async (text: string, params: unknown[] = []) => {
    seen.push({ text, params });
    return { rows, rowCount: rows.length };
  });
  return seen;
}

function sql(s: Seen): string {
  return s.text.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// ROW_COLUMNS / rowToSummary
// ---------------------------------------------------------------------------

test("rowToSummary: live_json ROW_COLUMNS/xulosa maydonlarida YO'Q, yangi maydonlar bor", () => {
  const base = {
    id: "g1",
    user_id: "u1",
    tool_id: "slide",
    topic: "T",
    status: "COMPLETED" as const,
    price: "1000",
    format: "pptx",
    progress: 100,
    step: "Tayyor",
    file_name: "d.pptx",
    error: null,
    preview: null,
    delivered_json: null,
    created_at: new Date(),
    started_at: null,
    finished_at: new Date(),
    expires_at: null,
    doc_version: 3,
    file_version: 2,
    image_redraws: 1,
    edited_at: new Date("2026-01-01T00:00:00Z"),
    live_seq: 7,
  };
  const summary = rowToSummary(base);
  assert.equal(summary.docVersion, 3);
  assert.equal(summary.fileVersion, 2);
  assert.equal(summary.imageRedraws, 1);
  assert.equal(summary.editedAt, new Date("2026-01-01T00:00:00Z").toISOString());
  assert.equal(summary.liveSeq, 7);
  assert.ok(!("live_json" in summary), "live_json xulosaga chiqmasligi kerak");

  // Eski qator (013 dan oldingi, maydonlar yo'q) — xato bermaydi, 0/null.
  const old = rowToSummary({ ...base, doc_version: undefined, file_version: undefined, image_redraws: undefined, edited_at: undefined, live_seq: undefined } as never);
  assert.equal(old.docVersion, 0);
  assert.equal(old.fileVersion, 0);
  assert.equal(old.imageRedraws, 0);
  assert.equal(old.editedAt, null);
  assert.equal(old.liveSeq, 0);
});

// ---------------------------------------------------------------------------
// setLive / heartbeat
// ---------------------------------------------------------------------------

test("setLive: locked_by/status predikati, live_seq += 1, progress clamp, step slice", async (t) => {
  const seen = mockQuery(t, [{ live_seq: 5 }]);
  const out = await setLive("gen-1", "worker-1", { a: 1 }, 500, "x".repeat(500));
  assert.equal(out, 5);
  assert.equal(seen.length, 1);
  const q = sql(seen[0]);
  assert.match(q, /SET live_json = \$3, live_seq = live_seq \+ 1/);
  assert.match(q, /locked_at = now\(\)/);
  assert.match(q, /WHERE id = \$1 AND locked_by = \$2 AND status = 'IN_PROGRESS'/);
  assert.match(q, /RETURNING live_seq/);
  // MUTATSIYA: clamp/slice olib tashlansa bu ikkisi yiqiladi.
  assert.equal(seen[0].params[3], 99, "progress 0..99 ga siqilishi kerak");
  assert.equal((seen[0].params[4] as string).length, 200, "step 200 belgiga qirqilishi kerak");
});

test("setLive: qulf boshqada / status mos kelmasa — null, live_seq oshmaydi (qator yo'q)", async (t) => {
  mockQuery(t, []);
  const out = await setLive("gen-1", "worker-2", {}, 10, "x");
  assert.equal(out, null);
});

test("heartbeat: locked_at=now() bilan bir xil predikat, boshqa ustunga tegmaydi", async (t) => {
  const seen = mockQuery(t, []);
  await heartbeat("gen-1", "worker-1");
  assert.equal(seen.length, 1);
  const q = sql(seen[0]);
  assert.match(q, /SET\s+locked_at = now\(\)/);
  assert.match(q, /WHERE id = \$1 AND locked_by = \$2 AND status = 'IN_PROGRESS'/);
  assert.doesNotMatch(q, /live_json|progress|step/);
});

// ---------------------------------------------------------------------------
// claimJob / completeJob / failJob / reclaimStaleJobs — live_json = NULL
// ---------------------------------------------------------------------------

test("claimJob: live_json = NULL yoziladi (MUTATSIYA: olib tashlansa bu assert yiqiladi)", async (t) => {
  const seen = mockQuery(t, []);
  await claimJob("worker-1");
  assert.match(sql(seen[0]), /live_json = NULL/);
});

test("completeJob: live_json = NULL yoziladi", async (t) => {
  const seen = mockQuery(t, []);
  await completeJob("gen-1", "worker-1", { html: "<p/>", doc: null, fileName: "a.docx", preview: null });
  assert.match(sql(seen[0]), /live_json = NULL/);
});

test("failJob: live_json = NULL yoziladi", async (t) => {
  const seen = mockQuery(t, []);
  await failJob("gen-1", "worker-1", "xato");
  assert.match(sql(seen[0]), /live_json = NULL/);
});

test("reclaimStaleJobs: ikkala UPDATE (qayta navbat va yakuniy xato) live_json = NULL yozadi", async (t) => {
  const p = pool();
  const calls: string[] = [];
  t.mock.method(p, "connect", async () => ({
    query: async (text: string) => {
      calls.push(text);
      if (/BEGIN|COMMIT|ROLLBACK/.test(text)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  }));
  await reclaimStaleJobs();
  const updates = calls.filter((c) => /UPDATE generations/.test(c));
  assert.equal(updates.length, 2, "ikkita UPDATE bo'lishi kerak (qayta navbat + yakuniy xato)");
  for (const u of updates) {
    assert.match(u.replace(/\s+/g, " "), /live_json = NULL/, `har ikkala UPDATE live_json = NULL yozishi kerak: ${u}`);
  }
});

// ---------------------------------------------------------------------------
// getGeneration(since)
// ---------------------------------------------------------------------------

function genRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "gen-1",
    user_id: "u1",
    tool_id: "slide",
    topic: "T",
    status: "IN_PROGRESS",
    price: "1000",
    format: "pptx",
    progress: 40,
    step: "Matn yozilmoqda",
    file_name: "d.pptx",
    error: null,
    preview: null,
    delivered_json: null,
    created_at: new Date(),
    started_at: new Date(),
    finished_at: null,
    expires_at: null,
    doc_version: 0,
    file_version: 0,
    image_redraws: 0,
    edited_at: null,
    live_seq: 5,
    html: null,
    doc_json: null,
    live_json_out: { stage: "text" },
    ...overrides,
  };
}

test("getGeneration: since berilmasa va IN_PROGRESS bo'lsa — live bor, liveSeq har doim bor", async (t) => {
  mockQuery(t, [genRow()]);
  const g = await getGeneration("gen-1", "u1");
  assert.ok(g);
  assert.equal(g!.liveSeq, 5);
  assert.deepEqual(g!.live, { stage: "text" });
});

test("getGeneration: since >= live_seq (o'zgarmagan) — `live` kaliti UMUMAN YO'Q", async (t) => {
  // Baza SQL CASE sharti bajarilmagani uchun live_json_out NULL qaytaradi —
  // shuni simulyatsiya qilamiz.
  mockQuery(t, [genRow({ live_json_out: null })]);
  const g = await getGeneration("gen-1", "u1", { since: 5 });
  assert.ok(g);
  assert.equal(g!.liveSeq, 5);
  assert.ok(!("live" in g!), "o'zgarmagan bo'lsa live kaliti bo'lmasligi kerak (eski qiymat qaytmasin)");
});

test("getGeneration: since < live_seq — live yangilanadi", async (t) => {
  mockQuery(t, [genRow({ live_seq: 8, live_json_out: { stage: "images" } })]);
  const g = await getGeneration("gen-1", "u1", { since: 5 });
  assert.ok(g);
  assert.equal(g!.liveSeq, 8);
  assert.deepEqual(g!.live, { stage: "images" });
});

test("getGeneration: status COMPLETED bo'lsa — live kaliti yo'q (yakuniy holatda jonli deka ko'rsatilmaydi)", async (t) => {
  mockQuery(t, [genRow({ status: "COMPLETED", live_json_out: null })]);
  const g = await getGeneration("gen-1", "u1");
  assert.ok(g);
  assert.ok(!("live" in g!));
});

test("getGeneration: SQL matnida since CASE va egalik predikati bor", async (t) => {
  const seen = mockQuery(t, [genRow()]);
  await getGeneration("gen-1", "u1", { since: 3 });
  const q = sql(seen[0]);
  assert.match(q, /CASE WHEN status = 'IN_PROGRESS' AND \(\$3::int IS NULL OR live_seq > \$3\)/);
  assert.match(q, /THEN live_json END/);
  assert.match(q, /WHERE id = \$1 AND user_id = \$2/);
  assert.deepEqual(seen[0].params, ["gen-1", "u1", 3]);
});

// ---------------------------------------------------------------------------
// updateGenerationDoc / markFileVersion / reserveRedraw / releaseRedraw / getVersions / getGenerationForEdit
// ---------------------------------------------------------------------------

function fakeClient(rows: unknown[]) {
  const calls: Seen[] = [];
  return {
    calls,
    client: {
      query: async (text: string, params: unknown[] = []) => {
        calls.push({ text, params });
        return { rows, rowCount: rows.length };
      },
    } as unknown as import("pg").PoolClient,
  };
}

test("updateGenerationDoc: user_id, status='COMPLETED', doc_version=$expected predikatlari; doc_version+1 qaytadi", async () => {
  const { client, calls } = fakeClient([{ doc_version: 4 }]);
  const out = await updateGenerationDoc(client, "gen-1", "u1", 3, {
    doc: { meta: {} } as unknown as AcademicDoc,
    html: "<p/>",
    preview: null,
  });
  assert.equal(out, 4);
  const q = sql(calls[0]);
  assert.match(q, /doc_version = doc_version \+ 1/);
  assert.match(q, /edited_at = now\(\)/);
  assert.match(q, /WHERE id = \$1 AND user_id = \$2 AND status = 'COMPLETED' AND doc_version = \$6/);
  assert.deepEqual(calls[0].params.slice(0, 2), ["gen-1", "u1"]);
  assert.equal(calls[0].params[5], 3);
});

test("updateGenerationDoc: versiya mos kelmasa (qator yo'q) — null (409 chaqiruvchida)", async () => {
  const { client } = fakeClient([]);
  const out = await updateGenerationDoc(client, "gen-1", "u1", 3, {
    doc: { meta: {} } as unknown as AcademicDoc,
    html: "<p/>",
    preview: null,
  });
  assert.equal(out, null);
});

test("markFileVersion: file_version < $v predikati, egalik bor", async () => {
  const { client, calls } = fakeClient([{ file_version: 4 }]);
  const out = await markFileVersion(client, "gen-1", "u1", 4);
  assert.equal(out, 4);
  const q = sql(calls[0]);
  assert.match(q, /SET\s+file_version = \$3/);
  assert.match(q, /WHERE id = \$1 AND user_id = \$2 AND file_version < \$3/);
});

test("reserveRedraw: image_redraws < $limit va status='COMPLETED' BITTA predikatda (TOCTOU yo'q)", async (t) => {
  const seen = mockQuery(t, [{ image_redraws: 2 }]);
  const out = await reserveRedraw("gen-1", "u1", 5);
  assert.equal(out, 2);
  const q = sql(seen[0]);
  assert.match(q, /image_redraws = image_redraws \+ 1/);
  assert.match(q, /WHERE id = \$1 AND user_id = \$2 AND status = 'COMPLETED' AND image_redraws < \$3/);
});

test("reserveRedraw: limit tugagan bo'lsa — null", async (t) => {
  mockQuery(t, []);
  const out = await reserveRedraw("gen-1", "u1", 5);
  assert.equal(out, null);
});

test("releaseRedraw: GREATEST(image_redraws-1,0), egalik bilan", async (t) => {
  const seen = mockQuery(t, []);
  await releaseRedraw("gen-1", "u1");
  const q = sql(seen[0]);
  assert.match(q, /GREATEST\(image_redraws - 1, 0\)/);
  assert.match(q, /WHERE id = \$1 AND user_id = \$2/);
});

test("getVersions: egalik SQL da, kerakli maydonlarni qaytaradi", async (t) => {
  const seen = mockQuery(t, [
    { doc_version: 2, file_version: 1, tool_id: "slide", file_name: "d.pptx", status: "COMPLETED" },
  ]);
  const out = await getVersions("gen-1", "u1");
  assert.deepEqual(out, { docVersion: 2, fileVersion: 1, toolId: "slide", fileName: "d.pptx", status: "COMPLETED" });
  assert.match(sql(seen[0]), /WHERE id = \$1 AND user_id = \$2/);
});

test("getGenerationForEdit: FOR UPDATE ISHLATMAYDI (oddiy SELECT), egalik bor", async (t) => {
  const seen = mockQuery(t, [
    {
      doc_json: { meta: {} },
      doc_version: 1,
      file_version: 0,
      image_redraws: 0,
      tool_id: "slide",
      file_name: "d.pptx",
      topic: "T",
      status: "COMPLETED",
    },
  ]);
  const out = await getGenerationForEdit("gen-1", "u1");
  assert.equal(out?.docVersion, 1);
  const q = sql(seen[0]);
  assert.doesNotMatch(q, /FOR UPDATE/);
  assert.match(q, /WHERE id = \$1 AND user_id = \$2/);
});

// ---------------------------------------------------------------------------
// assets.ts: assetFromDataUrl / assetImageResolver
// ---------------------------------------------------------------------------

function pngBytes(extra = 16): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, Buffer.alloc(extra, 0x01)]);
}

test("assetFromDataUrl: to'g'ri data: URL — assetId/mime/bytes, extractAssets bilan bir xil SHA-256", () => {
  const bytes = pngBytes();
  const url = `data:image/png;base64,${bytes.toString("base64")}`;
  const found = assetFromDataUrl(url);
  assert.ok(found);
  assert.equal(found!.mime, "image/png");
  assert.equal(found!.bytes.equals(bytes), true);
  assert.match(found!.assetId, /^[0-9a-f]{24}$/);
});

test("assetFromDataUrl: data: bo'lmagan yoki bo'sh baytli URL — null", () => {
  assert.equal(assetFromDataUrl("https://example.uz/a.png"), null);
  assert.equal(assetFromDataUrl("data:image/png;base64,"), null);
});

test("ASSET_URL_RE / ownAssetUrlRe: faqat o'z generatsiyasi ID'siga mos", () => {
  assert.match("/api/generations/gen-1/assets/abc123", ASSET_URL_RE);
  const re = ownAssetUrlRe("gen-1");
  assert.match("/api/generations/gen-1/assets/abc123", re);
  assert.doesNotMatch("/api/generations/gen-2/assets/abc123", re);
});

test("assetImageResolver: o'z URL — getAsset chaqiriladi, natija qaytadi", async (t) => {
  const bytes = pngBytes();
  const seen: Seen[] = [];
  const p = pool();
  t.mock.method(p, "query", async (text: string, params: unknown[] = []) => {
    seen.push({ text, params });
    return { rows: [{ bytes, mime: "image/png" }], rowCount: 1 };
  });

  const resolve = assetImageResolver("gen-1", "u1");
  const out = await resolve("/api/generations/gen-1/assets/abcdef123456");
  assert.ok(out);
  assert.equal(out!.type, "png");
  assert.equal(out!.data, `image/png;base64,${bytes.toString("base64")}`);
  assert.equal(seen.length, 1, "getAsset aynan chaqirilishi kerak");
  assert.match(sql(seen[0]), /WHERE a\.generation_id = \$1 AND a\.asset_id = \$2 AND g\.user_id = \$3/);
  assert.deepEqual(seen[0].params, ["gen-1", "abcdef123456", "u1"]);
});

test("assetImageResolver: begona generatsiya ID / https: URL — null, getAsset UMUMAN chaqirilmaydi (MUTATSIYA)", async (t) => {
  const seen: Seen[] = [];
  const p = pool();
  t.mock.method(p, "query", async (text: string, params: unknown[] = []) => {
    seen.push({ text, params });
    return { rows: [], rowCount: 0 };
  });

  const resolve = assetImageResolver("gen-1", "u1");
  assert.equal(await resolve("/api/generations/gen-2/assets/abcdef123456"), null);
  assert.equal(await resolve("https://evil.example/x.png"), null);
  assert.equal(await resolve("data:image/png;base64,AAAA"), null);
  assert.equal(seen.length, 0, "begona/nomos URL uchun getAsset SO'ROV YUBORMASLIGI kerak (SSRF/IDOR himoyasi)");
});

test("assetImageResolver: aktiv topilmasa (getAsset null) — null", async (t) => {
  mockQuery(t, []);
  const resolve = assetImageResolver("gen-1", "u1");
  assert.equal(await resolve("/api/generations/gen-1/assets/abcdef123456"), null);
});

test("putAssetBytes: assetIdFor bilan bir xil SHA-256, INSERT yuboradi", async (t) => {
  const seen = mockQuery(t, []);
  const bytes = pngBytes(32);
  const found = assetFromDataUrl(`data:image/png;base64,${bytes.toString("base64")}`)!;
  const assetId = await putAssetBytes("gen-1", "image/png", bytes);
  assert.equal(assetId, found.assetId, "putAssetBytes va assetFromDataUrl bir xil assetId hisoblashi kerak");
  assert.equal(seen.length, 1);
  assert.match(sql(seen[0]), /INSERT INTO generation_assets/);
});

// ---------------------------------------------------------------------------
// render-pptx.ts: opts.resolveImage
// ---------------------------------------------------------------------------

const slideTool = TOOL_BY_ID.slide;
const meta = () => extractMeta(slideTool, { topic: "Sinov mavzu" });

test("renderPptx: opts.resolveImage berilsa — u ishlatiladi (stub, tarmoqqa chiqilmaydi)", async () => {
  const slides: SlideModel[] = [
    { id: "s1", layout: "bullets", title: "Slayd 1" },
    {
      id: "s2",
      layout: "bullets",
      title: "Slayd 2",
      image: { url: "/api/generations/gen-1/assets/abcdef123456" },
    },
  ];
  const doc: AcademicDoc = {
    meta: meta(),
    titlePage: false,
    toc: false,
    sections: [],
    slides,
  };

  let calls = 0;
  const bytes = pngBytes();
  const resolveImage = async (url: string) => {
    calls += 1;
    assert.equal(url, "/api/generations/gen-1/assets/abcdef123456");
    return { data: `image/png;base64,${bytes.toString("base64")}`, type: "png" as const };
  };

  const file = await renderPptx(doc, "sinov.pptx", { resolveImage });
  assert.ok(file.bytes.byteLength > 0, "PPTX bayt yaratilishi kerak");
  assert.equal(calls, 1, "resolveImage aynan rasm slaydi uchun chaqirilishi kerak");
});

test("renderPptx: resolveImage `null` qaytarsa — fetchImageBytes zaxirasiga o'tadi (data: URL bilan)", async () => {
  const bytes = pngBytes();
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
  const slides: SlideModel[] = [
    { id: "s1", layout: "bullets", title: "Slayd 1", image: { url: dataUrl } },
  ];
  const doc: AcademicDoc = {
    meta: meta(),
    titlePage: false,
    toc: false,
    sections: [],
    slides,
  };

  const file = await renderPptx(doc, "sinov.pptx", { resolveImage: async () => null });
  assert.ok(file.bytes.byteLength > 0);
});
