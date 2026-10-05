import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Slide image screen copies (ops sprint D5, `docs/ops/PLAN.md`; O4 WP-F).
 *
 * Contract:
 *   1. the worker stores, next to each slide image, a copy ≤ 1024 px wide,
 *      JPEG q80 (`slideViewCopies` → `commitJobResult`, same transaction);
 *   2. the viewer asks for it with `?view=1` (`viewSrc`), the route serves the
 *      copy, or the original when there is none (old decks, uploads, logos);
 *   3. everything else — the route without the flag, `assetImageResolver`
 *      (PPTX rebuild), the stored file (downloads) — keeps the original bytes;
 *   4. ownership is the same SQL check as before.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("viewcopy") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const sharp = (await import("sharp")).default;
const { viewSrc, wantsViewCopy, VIEW_COPY_PARAM } = await import("../lib/asset-view.ts");
const assets = await import("../lib/server/assets.ts");
const { makeViewCopy, slideViewCopies, viewAssetId, assetFromDataUrl, assetUrl, VIEW_MAX_WIDTH } = assets;

const GID = "0f8fad5b-d9cb-469f-a165-70867728950e";

/** A photo-sized JPEG (~0.6–1 MB, like a provider image): gaussian noise compresses like a busy photo. */
async function photoJpeg(width = 1280, height = 960, seedColor = 90): Promise<Buffer> {
  const noisy = await sharp({
    create: { width, height, channels: 3, background: { r: seedColor, g: 140, b: 200 }, noise: { type: "gaussian", mean: 128, sigma: 20 } },
  })
    .png()
    .toBuffer();
  return sharp(noisy).jpeg({ quality: 95 }).toBuffer();
}

async function rgbaPng(alpha: number): Promise<Buffer> {
  const noisy = await sharp({
    create: { width: 900, height: 600, channels: 3, background: { r: 10, g: 200, b: 30 }, noise: { type: "gaussian", mean: 128, sigma: 30 } },
  })
    .png()
    .toBuffer();
  // RGBA: real transparency (alpha < 1) or a fully opaque alpha channel (alpha = 1).
  return sharp(noisy).ensureAlpha(alpha).png().toBuffer();
}

/** Byte equality without `assert` diffing megabyte buffers (a failing diff can exhaust the heavy.sh memory cap). */
const same = (a: Buffer | undefined, b: Buffer) => Boolean(a && a.equals(b));

const dataUrl = (bytes: Buffer, mime = "image/jpeg") => `data:${mime};base64,${bytes.toString("base64")}`;

function quiet(t: TestContext) {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "info", () => {});
}

// ───────────────────────────── viewer src choice (pure)

test("viewSrc: only an own asset path gets `?view=1`", () => {
  const own = `/api/generations/${GID}/assets/0123456789abcdef01234567`;
  // MUTATION: `viewSrc` returning `url` unchanged → the viewer would download the originals.
  assert.equal(viewSrc(own), `${own}?${VIEW_COPY_PARAM}=1`);
  for (const other of [
    "data:image/jpeg;base64,/9j/4AAQ",
    "blob:http://localhost/0f8fad5b",
    "https://example.com/a.jpg",
    `/api/generations/${GID}/thumb`,
    `${own}?view=1`,
    "/api/generations/gen1/assets/0123456789abcdef",
    `/api/generations/${GID}/assets/0123456789abcdef01234567/extra`,
    "/samples/tpl-atlas.jpg",
  ]) {
    assert.equal(viewSrc(other), other, other);
  }
  assert.equal(wantsViewCopy(new URL(`http://x${own}?view=1`)), true);
  assert.equal(wantsViewCopy(new URL(`http://x${own}`)), false);
  assert.equal(wantsViewCopy(new URL(`http://x${own}?view=0`)), false);
});

// ───────────────────────────── the copy itself (sharp)

test("makeViewCopy: real-sized photo → JPEG ≤ 1024 px wide, aspect kept, much smaller", async () => {
  const orig = await photoJpeg(1280, 960);
  assert.ok(orig.byteLength > 500_000, `test image should be photo-sized, got ${orig.byteLength}`);
  const copy = await makeViewCopy(orig, "image/jpeg");
  assert.ok(copy, "copy expected");
  assert.equal(copy![0], 0xff);
  assert.equal(copy![1], 0xd8, "JPEG");
  const meta = await sharp(copy!).metadata();
  // MUTATION: drop `.resize(...)` → width 1280.
  assert.equal(meta.width, VIEW_MAX_WIDTH);
  assert.equal(meta.height, 768);
  // MUTATION: quality 95 → copy not ≥ 20 % smaller → null.
  assert.ok(copy!.byteLength <= orig.byteLength * 0.6, `copy ${copy!.byteLength} vs ${orig.byteLength}`);
});

test("makeViewCopy: a narrower image is not enlarged", async () => {
  const orig = await photoJpeg(800, 600);
  const copy = await makeViewCopy(orig, "image/jpeg");
  assert.ok(copy);
  // MUTATION: `withoutEnlargement: false` → 1024.
  assert.equal((await sharp(copy!).metadata()).width, 800);
});

test("makeViewCopy: real transparency → null (original kept); opaque RGBA PNG → JPEG copy", async () => {
  // MUTATION: drop the `isOpaque` check → transparent PNG gets a flattened JPEG.
  assert.ok((await makeViewCopy(await rgbaPng(0.5), "image/png")) === null, "transparent PNG must keep its original");
  const opaque = await makeViewCopy(await rgbaPng(1), "image/png");
  assert.ok(opaque, "opaque PNG gets a copy");
  assert.equal((await sharp(opaque!).metadata()).format, "jpeg");
});

test("makeViewCopy: no saving → null; non-image mime → null; broken bytes throw", async () => {
  const small = await sharp(await photoJpeg(640, 480)).jpeg({ quality: 40 }).toBuffer();
  // MUTATION: drop the `VIEW_MAX_RATIO` check → a copy BIGGER than the original is stored.
  assert.ok((await makeViewCopy(small, "image/jpeg")) === null, "no saving → original");
  assert.ok((await makeViewCopy(await photoJpeg(), "audio/mpeg")) === null, "non-image mime");
  await assert.rejects(makeViewCopy(Buffer.from("not an image at all"), "image/jpeg"));
});

test("makeViewCopy: a Display-P3 photo keeps its colour profile (review m3)", async () => {
  const noisy = await sharp({
    create: { width: 1280, height: 960, channels: 3, background: { r: 40, g: 200, b: 60 }, noise: { type: "gaussian", mean: 128, sigma: 20 } },
  })
    .png()
    .toBuffer();
  const p3 = await sharp(noisy).withIccProfile("p3").jpeg({ quality: 95 }).toBuffer();
  const copy = await makeViewCopy(p3, "image/jpeg");
  assert.ok(copy);
  // MUTATION: drop `.keepIccProfile()` → no profile, P3 pixels read as sRGB (dull colours).
  assert.ok((await sharp(copy!).metadata()).icc, "ICC profile kept");
  // An untagged (sRGB) photo gets no profile bytes added.
  assert.ok(!(await sharp((await makeViewCopy(await photoJpeg(), "image/jpeg"))!).metadata()).icc);
});

test("viewCopyBudget (review M1): never reaches the hard stop; too little time → 0 (skip)", () => {
  const { viewCopyBudget, VIEW_BUDGET_MS, VIEW_STOP_MARGIN_MS, VIEW_MIN_BUDGET_MS } = assets;
  assert.equal(viewCopyBudget(Number.POSITIVE_INFINITY), VIEW_BUDGET_MS);
  assert.equal(viewCopyBudget(60_000), VIEW_BUDGET_MS);
  assert.equal(viewCopyBudget(VIEW_STOP_MARGIN_MS + 5_000), 5_000);
  assert.equal(viewCopyBudget(VIEW_STOP_MARGIN_MS + VIEW_MIN_BUDGET_MS - 1), 0);
  assert.equal(viewCopyBudget(800), 0);
  assert.equal(viewCopyBudget(-5_000), 0);
});

// ───────────────────────────── which assets get copies (worker step, pure)

test("slideViewCopies: one copy per distinct slide image; logos, figures and broken images skipped", async (t) => {
  quiet(t);
  const a = await photoJpeg(1280, 960, 40);
  const b = await photoJpeg(1280, 960, 200);
  const logo = await photoJpeg(1100, 300, 10);
  const broken = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03, 0x04]);
  const doc = {
    meta: {},
    sections: [],
    slides: [
      { id: "s1", layout: "title", title: "A", image: { url: dataUrl(a) } },
      { id: "s2", layout: "bullets", title: "B", image: { url: dataUrl(b) } },
      { id: "s3", layout: "bullets", title: "C", image: { url: dataUrl(a) } },
      { id: "s4", layout: "bullets", title: "D", image: { url: dataUrl(broken) } },
      { id: "s5", layout: "bullets", title: "E" },
    ],
    slideLogo: { url: dataUrl(logo) },
  } as never;
  const extracted = assets.extractAssets(GID, doc, "");
  assert.equal(extracted.assets.length, 4, "a, b, broken, logo");
  const copies = await slideViewCopies(GID, extracted.doc, extracted.assets);
  const idA = assetFromDataUrl(dataUrl(a))!.assetId;
  const idB = assetFromDataUrl(dataUrl(b))!.assetId;
  // MUTATION: iterate `assets` instead of `doc.slides` → the logo also gets a copy (3 ids).
  assert.deepEqual(copies.map((c) => c.assetId).sort(), [viewAssetId(idA), viewAssetId(idB)].sort());
  for (const c of copies) assert.equal(c.mime, "image/jpeg");
  assert.equal(viewAssetId(idA).length, 26, "26 hex — never a 24-hex content id or thumbnail id");
  assert.match(viewAssetId(idA), /^[0-9a-f]{8,64}$/, "fits the route's asset id pattern");
  // The model keeps the ORIGINAL url (PPTX rebuild reads it).
  assert.equal(extracted.doc!.slides![0].image!.url, assetUrl(GID, idA));
  // Budget exhausted → no copies, no throw.
  assert.equal((await slideViewCopies(GID, extracted.doc, extracted.assets, 0)).length, 0);
  // A url of another generation is not ours.
  const foreign = { ...extracted.doc!, slides: [{ id: "x", layout: "title", title: "X", image: { url: assetUrl(crypto.randomUUID(), idA) } }] } as never;
  assert.equal((await slideViewCopies(GID, foreign, extracted.assets)).length, 0);
});

// ───────────────────────────── DB: route, resolver, worker

test("route + resolver + worker (Postgres)", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const assetRoute = await import("../app/api/generations/[id]/assets/[assetId]/route.ts");
  const worker = await import("../lib/server/worker.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  const mkUser = async (name: string) =>
    String((await query<{ id: string }>(`INSERT INTO users (username, name) VALUES ($1, 'Test') RETURNING id`, [`${name}-${Date.now()}`]))[0].id);
  const uid = await mkUser("viewcopy");
  const stranger = await mkUser("viewcopy-stranger");
  const cookieOf = async (u: string) => `${SESSION_COOKIE}=${(await createSession(u)).token}`;
  const ownerCookie = await cookieOf(uid);
  const strangerCookie = await cookieOf(stranger);
  const mkGen = async (status: string) => {
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, step, budget_ms, values_json, status)
       VALUES ($1, $2, 'pro-slide', 'Sinov', 'q', 60000, '{"topic":"Sinov"}'::jsonb, $3)`,
      [id, uid, status],
    );
    return id;
  };
  const call = async (gid: string, assetId: string, cookie: string, view: boolean) => {
    const url = `http://localhost/api/generations/${gid}/assets/${assetId}${view ? "?view=1" : ""}`;
    const req = new Request(url, { headers: { cookie } });
    return inRequest(req, () => assetRoute.GET(req, { params: Promise.resolve({ id: gid, assetId }) }));
  };

  const orig = await photoJpeg(1280, 960, 120);
  const copy = (await makeViewCopy(orig, "image/jpeg"))!;
  const { assetId } = assetFromDataUrl(dataUrl(orig))!;
  const done = await mkGen("COMPLETED");
  await assets.putAssets(done, [
    { assetId, mime: "image/jpeg", bytes: orig },
    { assetId: viewAssetId(assetId), mime: "image/jpeg", bytes: copy },
  ]);

  await t.test("`?view=1` → the copy, long cache", async () => {
    const res = await call(done, assetId, ownerCookie, true);
    assert.equal(res.status, 200);
    const body = Buffer.from(await res.arrayBuffer());
    // MUTATION: route ignoring the flag (always `getAsset`) → the original bytes.
    assert.ok(body.equals(copy), `copy bytes expected, got ${body.byteLength} B (copy ${copy.byteLength} B, original ${orig.byteLength} B)`);
    assert.equal(res.headers.get("x-asset-variant"), "view");
    assert.equal(res.headers.get("content-type"), "image/jpeg");
    assert.equal(res.headers.get("content-length"), String(copy.byteLength));
    assert.equal(res.headers.get("cache-control"), "private, max-age=86400, immutable");
  });

  await t.test("no flag → the original, byte for byte (downloads, image tools, direct links)", async () => {
    const res = await call(done, assetId, ownerCookie, false);
    assert.equal(res.status, 200);
    assert.ok(same(Buffer.from(await res.arrayBuffer()), orig), "original bytes expected");
    assert.equal(res.headers.get("x-asset-variant"), null);
    assert.equal(res.headers.get("cache-control"), "private, max-age=86400, immutable");
  });

  await t.test("assetImageResolver (PPTX rebuild) reads the original even when a copy exists", async () => {
    const resolved = await assets.assetImageResolver(done, uid)(assetUrl(done, assetId));
    assert.ok(resolved);
    // MUTATION: resolver switched to `getViewAsset` → the 1024 px copy lands in the PPTX.
    assert.ok(resolved!.data === `image/jpeg;base64,${orig.toString("base64")}`, `original expected, got ${resolved!.data.length} chars`);
  });

  await t.test("old deck (no copy) → `?view=1` falls back to the original, cached long", async () => {
    const old = await mkGen("COMPLETED");
    await assets.putAssets(old, [{ assetId, mime: "image/jpeg", bytes: orig }]);
    const res = await call(old, assetId, ownerCookie, true);
    assert.equal(res.status, 200);
    assert.ok(same(Buffer.from(await res.arrayBuffer()), orig), "original bytes expected");
    assert.equal(res.headers.get("x-asset-variant"), "original");
    assert.equal(res.headers.get("cache-control"), "private, max-age=86400, immutable");
  });

  await t.test("deck still building (live view) → original with a SHORT cache", async () => {
    const live = await mkGen("IN_PROGRESS");
    await assets.putAssets(live, [{ assetId, mime: "image/jpeg", bytes: orig }]);
    const res = await call(live, assetId, ownerCookie, true);
    assert.equal(res.status, 200);
    // MUTATION: drop the `pending` branch → the original is pinned for a day under `?view=1`.
    assert.equal(res.headers.get("cache-control"), "private, max-age=60");
  });

  await t.test("ownership: a stranger gets 404 with and without the flag, and for the copy id", async () => {
    for (const [id, view] of [
      [assetId, true],
      [assetId, false],
      [viewAssetId(assetId), false],
    ] as const) {
      const res = await call(done, id, strangerCookie, view);
      // MUTATION: drop `AND g.user_id = $3` in `getViewAsset` → 200 for `?view=1`.
      assert.equal(res.status, 404, `${id} view=${view}`);
      assert.equal(res.headers.get("cache-control"), "private, no-store");
    }
    const anon = new Request(`http://localhost/api/generations/${done}/assets/${assetId}?view=1`);
    const res = await inRequest(anon, () => assetRoute.GET(anon, { params: Promise.resolve({ id: done, assetId }) }));
    assert.equal(res.status, 401);
  });

  await t.test("worker: a finished pro deck stores originals + copies in one commit; model and file keep originals", async (tt) => {
    quiet(tt);
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, step, budget_ms, values_json)
       VALUES ($1, $2, 'pro-slide', 'Sinov', 'q', 60000, '{"topic":"Sinov"}'::jsonb)`,
      [id, uid],
    );
    const job = await worker.claimNext();
    assert.equal(job?.id, id);
    const imgs = [await photoJpeg(1280, 960, 30), await photoJpeg(1024, 1024, 170)];
    const pptx = Buffer.from("PPTX-with-original-images");
    const build = async () => ({
      html: "",
      bytes: new Uint8Array(pptx),
      fileName: "deck.pptx",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      doc: {
        meta: {},
        sections: [],
        slides: [
          { id: "s1", layout: "title", title: "A", image: { url: dataUrl(imgs[0]) } },
          { id: "s2", layout: "bullets", title: "B", image: { url: dataUrl(imgs[1]) } },
        ],
      },
    });
    await worker.runJob(job!, { build: build as never, hardStopMs: 60_000 });

    const gen = (await query<{ status: string; doc_json: { slides: { image: { url: string } }[] } }>(`SELECT status, doc_json FROM generations WHERE id = $1`, [id]))[0];
    assert.equal(gen.status, "COMPLETED");
    const rows = await query<{ asset_id: string; mime: string; bytes: Buffer }>(
      `SELECT asset_id, mime, bytes FROM generation_assets WHERE generation_id = $1 ORDER BY asset_id`,
      [id],
    );
    const byId = new Map(rows.map((r) => [r.asset_id, r]));
    for (const [i, img] of imgs.entries()) {
      const aid = assetFromDataUrl(dataUrl(img))!.assetId;
      assert.ok(same(byId.get(aid)?.bytes, img), `original ${i} stored untouched`);
      const c = byId.get(viewAssetId(aid));
      // MUTATION: worker passing only `extracted.assets` → no copy rows.
      assert.ok(c, `copy ${i} stored`);
      assert.equal(c!.mime, "image/jpeg");
      assert.ok(c!.bytes.byteLength < img.byteLength * 0.8);
      assert.ok((await sharp(c!.bytes).metadata()).width! <= VIEW_MAX_WIDTH);
      // doc_json keeps the ORIGINAL asset url (no `?view`, no copy id).
      assert.equal(gen.doc_json.slides[i].image.url, assetUrl(id, aid));
    }
    assert.equal(rows.length, 4);
    const file = (await query<{ bytes: Buffer }>(`SELECT bytes FROM generation_files WHERE generation_id = $1`, [id]))[0];
    assert.ok(same(file.bytes, pptx), "the stored file (downloads) is the build output, untouched");
  });

  await t.test("worker near the hard stop (review M1): the deck is COMMITTED without copies, not failed", async (tt) => {
    quiet(tt);
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, step, budget_ms, values_json)
       VALUES ($1, $2, 'pro-slide', 'Sinov', 'q', 60000, '{"topic":"Sinov"}'::jsonb)`,
      [id, uid],
    );
    const job = await worker.claimNext();
    assert.equal(job?.id, id);
    // 8 photo-sized images ≈ 2 s of copying; the build returns 800 ms before the hard stop.
    const imgs: Buffer[] = [];
    for (let i = 0; i < 8; i++) imgs.push(await photoJpeg(1280, 960, 20 + i * 25));
    const pptx = Buffer.from("PPTX-late-deck");
    const build = async () => {
      await new Promise((r) => setTimeout(r, 400));
      return {
        html: "",
        bytes: new Uint8Array(pptx),
        fileName: "deck.pptx",
        mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        doc: {
          meta: {},
          sections: [],
          slides: imgs.map((img, i) => ({ id: `s${i}`, layout: "bullets", title: `S${i}`, image: { url: dataUrl(img) } })),
        },
      };
    };
    await worker.runJob(job!, { build: build as never, hardStopMs: 1_200 });

    const gen = (await query<{ status: string; error: string | null }>(`SELECT status, error FROM generations WHERE id = $1`, [id]))[0];
    // MUTATION: uncapped budget (`viewCopyBudget(Infinity)`) → FAILED «Ish vaqti tugadi», refunded, deck lost.
    assert.equal(gen.status, "COMPLETED", `status ${gen.status} (${gen.error})`);
    const file = (await query<{ bytes: Buffer }>(`SELECT bytes FROM generation_files WHERE generation_id = $1`, [id]))[0];
    assert.ok(file && same(file.bytes, pptx), "result file committed");
    const counts = (
      await query<{ originals: string; copies: string }>(
        `SELECT count(*) FILTER (WHERE length(asset_id) = 24) AS originals, count(*) FILTER (WHERE length(asset_id) = 26) AS copies
           FROM generation_assets WHERE generation_id = $1`,
        [id],
      )
    )[0];
    assert.equal(Number(counts.originals), imgs.length, "originals committed");
    assert.equal(Number(counts.copies), 0, "copies skipped — the viewer falls back to originals");
  });

  await t.test("`?view=1` never aliases: a 22-hex id + d1 does not reach a 24-hex content asset (review n1)", async () => {
    const gen = await mkGen("COMPLETED");
    const contentId = "0123456789abcdef012345d1";
    await assets.putAssets(gen, [{ assetId: contentId, mime: "image/jpeg", bytes: orig }]);
    const short = contentId.slice(0, 22);
    // MUTATION: `viewId = viewAssetId(assetId)` for every id → 200 with the content asset.
    const res = await call(gen, short, ownerCookie, true);
    assert.equal(res.status, 404);
    // The content id itself still serves normally with the flag (no copy → original).
    const ok = await call(gen, contentId, ownerCookie, true);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("x-asset-variant"), "original");
  });
});
