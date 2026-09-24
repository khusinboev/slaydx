import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * W3-A review nitlari (W4-B):
 *
 * 1. YETIM QURILISHLAR CHEKLANGAN. Qattiq to'xtashdan keyin qurilish
 *    promise'i o'ldirilmaydi — u yetim bo'lib CPU/xotira/provayder pulini
 *    ishlatishda davom etadi, slot esa darhol qayta ishlatiladi. Tizimli
 *    osilishda (provayder javob bermaydi) yetimlar cheksiz yig'ilib, 2 GB
 *    konteynerni OOM ga olib borardi. Endi yetimlar sanaladi; soni
 *    `WORKER_CONCURRENCY` ga yetsa worker YANGI ish OLMAYDI (jurnalga
 *    yoziladi), yetim tugagach davom etadi.
 * 2. TOZALASH `live.stop()` DAN KEYIN. Ilgari xato/qattiq to'xtash yo'lida
 *    `failAndCleanup` (`deleteAssets`) `live.stop()` dan OLDIN ishlardi:
 *    navbatdagi jonli deka rasmi (`putAssets`) yoki yo'ldagi TTS
 *    `putAssetBytes` o'chirishdan KEYIN yozilib, FAILED ishda yetim aktiv
 *    qolardi. Endi avval reporter to'xtatiladi va yo'ldagi aktiv yozuvlari
 *    kutiladi, keyin FAILED + qaytarish + tozalash.
 *
 * Aktiv INSERT ni kechiktirish uchun boshqa sessiya xuddi shu
 * `(generation_id, asset_id)` ni COMMIT qilmay ushlab turadi (UNIQUE
 * tekshiruvi kutadi), keyin ROLLBACK qiladi — yozuv aniq kechikadi.
 *
 * MUTATSIYA: `claimNext` dagi yetimlar tekshiruvi olib tashlansa — «to'la
 * bo'lsa ish olinmaydi» qizaradi; `quiesce(...)` chaqiruvi olib tashlansa —
 * uchala «yetim aktiv qolmaydi» testi qizaradi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("orphan") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function quiet(t: TestContext) {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
}

test("worker: yetimlar chegarasi va tozalash tartibi", { skip }, async (t) => {
  const pg = (await import("pg")).default;
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { env } = await import("../lib/server/env.ts");
  const worker = await import("../lib/server/worker.ts");
  const { assetFromDataUrl } = await import("../lib/server/assets.ts");
  await migrate();
  const hangs: Deferred<unknown>[] = [];
  t.after(async () => {
    for (const d of hangs) d.reject(new Error("sinov tugadi"));
    await sleep(200);
    await pool().end();
    await iso.drop();
  });

  const uid = String(
    (await query<{ id: string }>(`INSERT INTO users (username, name) VALUES ('orphan', 'T') RETURNING id`))[0].id,
  );
  const clearQueue = () => query(`UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED','IN_PROGRESS')`);
  const enqueue = async (toolId = "essay") => {
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, step, budget_ms, values_json) VALUES ($1, $2, $3, 'x', 'q', 60000, '{"topic":"x"}'::jsonb)`,
      [id, uid, toolId],
    );
    return id;
  };
  const status = async (id: string) => (await query<{ status: string }>(`SELECT status FROM generations WHERE id = $1`, [id]))[0].status;
  const assetCount = async (id: string) =>
    Number((await query<{ n: string }>(`SELECT count(*) AS n FROM generation_assets WHERE generation_id = $1`, [id]))[0].n);

  await t.test("yetimlar soni WORKER_CONCURRENCY ga yetsa yangi ish olinmaydi; yetim tugagach — olinadi", async (tt) => {
    quiet(tt);
    await clearQueue();
    Object.assign(env.worker, { concurrency: 2 });
    const builds = [deferred<unknown>(), deferred<unknown>()];
    hangs.push(...builds);
    for (const b of builds) {
      await enqueue();
      const job = await worker.claimNext();
      assert.ok(job, "ish olinmadi");
      await worker.runJob(job!, { build: () => b.promise as never, hardStopMs: 50 });
      assert.equal(await status(job!.id), "FAILED");
    }
    assert.equal(worker.orphanCount(), 2);

    const waiting = await enqueue();
    // MUTATSIYA: `claimNext` yetimlarni sanamasa — bu yerda ish olinardi.
    assert.equal(await worker.claimNext(), null, "yetimlar to'la — yangi ish olinmasligi kerak");
    assert.equal(await status(waiting), "QUEUED");

    builds[0].reject(new Error("yetim nihoyat yiqildi"));
    await sleep(50);
    assert.equal(worker.orphanCount(), 1);
    const next = await worker.claimNext();
    assert.equal(next?.id, waiting, "yetim tugagach ish olinishi kerak");
    await query(`UPDATE generations SET status = 'REVOKED' WHERE id = $1`, [waiting]);
    builds[1].resolve(undefined);
    await sleep(50);
    assert.equal(worker.orphanCount(), 0);
  });

  /** Boshqa sessiya shu aktivni COMMIT qilmay ushlaydi — bizning INSERT kutadi. */
  const blockAsset = async (genId: string, assetId: string) => {
    const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await other.connect();
    await other.query("BEGIN");
    await other.query(
      `INSERT INTO generation_assets (generation_id, asset_id, mime, size_bytes, bytes) VALUES ($1, $2, 'image/png', 1, '\\x00')`,
      [genId, assetId],
    );
    return {
      release: async () => {
        await other.query("ROLLBACK");
        await other.end();
      },
    };
  };
  const png = `data:image/png;base64,${Buffer.from("PNG-orphan-".repeat(8)).toString("base64")}`;
  const assetId = assetFromDataUrl(png)!.assetId;
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");
  const meta = extractMeta(TOOL_BY_ID["slide"], { topic: "Sinov" } as never);
  const plan = { type: "plan", slides: [{ id: "s0", layout: "bullets", title: "S" }], roles: ["r"], meta, theme: "atlas", template: "lecture" };

  const cases: Array<{
    name: string;
    toolId: string;
    hardStopMs: number;
    build: (opts: Record<string, (...a: never[]) => unknown>) => Promise<unknown>;
  }> = [
    {
      name: "xato yo'li: jonli deka rasmi o'chirishdan keyin yozilmaydi",
      toolId: "slide",
      hardStopMs: 30_000,
      build: async (opts) => {
        (opts.onProgress as (e: unknown) => void)(plan);
        (opts.onProgress as (e: unknown) => void)({ type: "image", index: 0, url: png });
        throw new Error("dvigatel yiqildi");
      },
    },
    {
      name: "qattiq to'xtash yo'li: jonli deka rasmi o'chirishdan keyin yozilmaydi",
      toolId: "slide",
      hardStopMs: 100,
      build: async (opts) => {
        (opts.onProgress as (e: unknown) => void)(plan);
        (opts.onProgress as (e: unknown) => void)({ type: "image", index: 0, url: png });
        const d = deferred<unknown>();
        hangs.push(d);
        return d.promise;
      },
    },
    {
      name: "xato yo'li: yo'ldagi TTS aktivi (putAsset) o'chirishdan keyin yozilmaydi",
      toolId: "essay",
      hardStopMs: 30_000,
      build: async (opts) => {
        void (opts.putAsset as (b: Uint8Array, m: string) => Promise<string>)(
          new Uint8Array(Buffer.from("PNG-orphan-".repeat(8))),
          "image/png",
        ).catch(() => undefined);
        await sleep(20);
        throw new Error("dvigatel yiqildi");
      },
    },
  ];

  for (const c of cases) {
    await t.test(c.name, async (tt) => {
      quiet(tt);
      await clearQueue();
      Object.assign(env.worker, { concurrency: 4 });
      const id = await enqueue(c.toolId);
      const job = await worker.claimNext();
      assert.equal(job?.id, id);
      const blocker = await blockAsset(id, assetId);
      const run = worker.runJob(job!, { build: ((_t: unknown, _v: unknown, opts: never) => c.build(opts)) as never, hardStopMs: c.hardStopMs });
      // Tuzatishsiz kodda shu oraliqda FAILED + `deleteAssets` o'tib bo'ladi; INSERT hali kutmoqda.
      await sleep(Math.min(c.hardStopMs, 1_000) + 500);
      const blockedAt = await status(id);
      await blocker.release();
      await run;
      await sleep(100);
      assert.equal(await status(id), "FAILED");
      tt.diagnostic(`aktiv INSERT kutayotganda holat: ${blockedAt}`);
      assert.equal(await assetCount(id), 0, "FAILED ishda yetim aktiv qoldi (tozalash yozuvdan oldin bo'lgan)");
    });
  }
});
