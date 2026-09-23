import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * WORKER IJARASI (AUDIT prod-readiness W3-A: C14, C15 worker tomoni, C26).
 *
 * 1. C15 (BEB-02, FILE-05, SCALE-11) — qattiq to'xtash: `deadline + grace`
 *    o'tsa ish FAILED + pul AYNAN bir marta qaytadi, slot bo'shaydi
 *    (`runJob` qurilish tugashini kutmay qaytadi), kech kelgan natija
 *    tashlanadi (fayl yozilmaydi, holat FAILED qoladi).
 * 2. C26 (CONC-06) — to'siq tokeni HAR CLAIM uchun: bir process o'z ishini
 *    qayta olsa ham eski (qulfi yo'qolgan) yurish yangi yurishning faylini
 *    bosib yoza olmaydi va o'chira olmaydi.
 * 3. C14 (INFRA-02, CONC-03, DB-05) — SIGTERM: yangi ish olinmaydi,
 *    grace ichida tugaganlar odatdagidek COMPLETED, qolganlari DARHOL
 *    QUEUED ga qaytadi (urinish sanalmaydi, qulf bo'sh, `run_after <= now()`)
 *    va boshqa worker uni shu zahoti oladi.
 *
 * Postgres talab qilinadi (alohida baza — `claimNext` global navbatni o'qiydi).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("wlease") : { isolated: false, drop: async () => {} };
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

/** Har yurish o'z baytlari va o'z aktivi (data: URL) bilan — kimniki qolganini ajratish uchun. */
function fileFor(tag: string) {
  const png = Buffer.from(`PNG-${tag}-`.repeat(12)).toString("base64");
  return {
    html: `<p>${tag}</p><img src="data:image/png;base64,${png}">`,
    bytes: new Uint8Array(Buffer.from(`FILE-${tag}`)),
    fileName: `natija-${tag}.docx`,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: { title: tag } as never,
  };
}

function quiet(t: TestContext) {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "log", () => {});
}

test("worker ijarasi: qattiq to'xtash, har-claim to'siq, SIGTERM", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { enqueueGeneration, claimJob, reclaimStaleJobs } = await import("../lib/server/jobs.ts");
  const worker = await import("../lib/server/worker.ts");
  await migrate();

  const pending: Deferred<unknown>[] = [];
  t.after(async () => {
    // Osilib qolgan stub qurilishlar yopiladi — yetim yurishlar `finally`ga yetsin.
    for (const d of pending) d.reject(new Error("sinov tugadi"));
    await new Promise((r) => setTimeout(r, 200));
    await pool().end();
    await iso.drop();
  });
  const hang = <T,>() => {
    const d = deferred<T>();
    pending.push(d as Deferred<unknown>);
    return d;
  };

  const mkUser = async (name: string, balance = 100_000) =>
    String(
      (
        await query<{ id: string }>(
          `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, $2) RETURNING id`,
          [`${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, balance],
        )
      )[0].id,
    );
  const enqueue = async (uid: string) => {
    const r = await enqueueGeneration({
      userId: uid,
      toolId: "essay",
      topic: "Sinov",
      price: 3000,
      format: "docx",
      values: { topic: "Sinov" },
      budgetMs: 60_000,
    });
    assert.ok(r.ok);
    return r.id;
  };
  const row = async (id: string) =>
    (
      await query<{ status: string; locked_by: string | null; attempts: number; run_after_ok: boolean; error: string | null; file_name: string }>(
        `SELECT status, locked_by, attempts, run_after <= now() AS run_after_ok, error, file_name FROM generations WHERE id = $1`,
        [id],
      )
    )[0];
  const fileOf = async (id: string) =>
    (await query<{ bytes: Buffer }>(`SELECT bytes FROM generation_files WHERE generation_id = $1`, [id]))[0]?.bytes.toString() ?? null;
  const assetCount = async (id: string) =>
    Number((await query<{ n: string }>(`SELECT count(*) AS n FROM generation_assets WHERE generation_id = $1`, [id]))[0].n);
  const refunds = async (id: string) =>
    Number((await query<{ n: string }>(`SELECT count(*) AS n FROM transactions WHERE kind = 'refund' AND reference = $1`, [id]))[0].n);
  const balance = async (uid: string) => Number((await query<{ balance: string }>(`SELECT balance FROM users WHERE id = $1`, [uid]))[0].balance);
  /** Navbatni bo'shatadi: boshqa sinov qatorlari keyingi `claimNext`ga tushmasin. */
  const clearQueue = () => query(`UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED','IN_PROGRESS')`);

  await t.test("C15: muddat o'tdi → FAILED + bir marta qaytarish, slot bo'shaydi, kech natija tashlanadi", async (tt) => {
    quiet(tt);
    await clearQueue();
    const uid = await mkUser("deadline");
    const id = await enqueue(uid);
    const job = await worker.claimNext();
    assert.equal(job?.id, id);
    const late = hang<ReturnType<typeof fileFor>>();

    const started = Date.now();
    const run = worker.runJob(job!, { build: () => late.promise as never, hardStopMs: 300 });
    const outcome = await Promise.race([run.then(() => "settled"), new Promise((r) => setTimeout(() => r("hung"), 3000))]);
    // MUTATSIYA: `Promise.race` (qattiq to'xtash) olib tashlansa — `runJob` qurilishni kutadi, slot band qoladi.
    assert.equal(outcome, "settled", "runJob muddat o'tgach qaytmadi — slot band qoldi");
    assert.ok(Date.now() - started < 2500);

    const r = await row(id);
    assert.equal(r.status, "FAILED");
    assert.match(String(r.error), /vaqt/i);
    assert.equal(await refunds(id), 1, "pul aynan bir marta qaytishi kerak");
    const afterRefund = await balance(uid);
    assert.equal(afterRefund, 100_000);

    // Kech natija: qurilish endi tugaydi — fayl yozilmaydi, holat va pul o'zgarmaydi.
    late.resolve(fileFor("kech"));
    await new Promise((r2) => setTimeout(r2, 300));
    assert.equal((await row(id)).status, "FAILED", "kech natija FAILED ishni COMPLETED qildi");
    assert.equal(await fileOf(id), null, "kech natija fayli yozildi");
    assert.equal(await assetCount(id), 0, "kech natija aktivlari yozildi");
    assert.equal(await refunds(id), 1);
    assert.equal(await balance(uid), afterRefund);
  });

  await t.test("C15: muddatdan oldin tugagan ish odatdagidek COMPLETED (qattiq to'xtash aralashmaydi)", async (tt) => {
    quiet(tt);
    await clearQueue();
    const uid = await mkUser("ontime");
    const id = await enqueue(uid);
    const job = await worker.claimNext();
    await worker.runJob(job!, { build: async () => fileFor("vaqtida") as never, hardStopMs: 2000 });
    assert.equal((await row(id)).status, "COMPLETED");
    assert.equal(await fileOf(id), "FILE-vaqtida");
    assert.equal(await refunds(id), 0);
  });

  await t.test("C26: o'z ishini qayta olgan process — eski yurish yangi yurish faylini bosib yozmaydi/o'chirmaydi", async (tt) => {
    quiet(tt);
    await clearQueue();
    const uid = await mkUser("aba");
    const id = await enqueue(uid);

    // 1-yurish qulfni oladi va qurilishda «osilib» qoladi.
    const job1 = await worker.claimNext();
    assert.equal(job1?.id, id);
    const stale = hang<ReturnType<typeof fileFor>>();
    const run1 = worker.runJob(job1!, { build: () => stale.promise as never, hardStopMs: 60_000 });

    // Heartbeat to'xtagan deb faraz qilamiz: housekeeping ishni qayta navbatga qo'yadi…
    await query(`UPDATE generations SET locked_at = now() - interval '1 hour' WHERE id = $1`, [id]);
    await reclaimStaleJobs();
    await query(`UPDATE generations SET run_after = now() WHERE id = $1`, [id]);
    // …va XUDDI SHU process uni qayta oladi (ABA).
    const job2 = await worker.claimNext();
    assert.equal(job2?.id, id);
    const live = hang<ReturnType<typeof fileFor>>();
    const run2 = worker.runJob(job2!, { build: () => live.promise as never, hardStopMs: 60_000 });

    // Eski yurish BIRINCHI tugaydi — u endi ega emas.
    stale.resolve(fileFor("eski"));
    await run1;
    // MUTATSIYA: per-claim token o'rniga process id → eski yurish COMPLETED qiladi va fayl yozadi.
    assert.equal((await row(id)).status, "IN_PROGRESS", "eski yurish jonli claim ustidan ishni yakunladi");
    assert.equal(await fileOf(id), null, "eski yurish faylni yozdi");
    assert.equal(await assetCount(id), 0, "eski yurish aktiv yozdi");

    live.resolve(fileFor("yangi"));
    await run2;
    assert.equal((await row(id)).status, "COMPLETED");
    assert.equal(await fileOf(id), "FILE-yangi");
    assert.equal(await assetCount(id), 1);

    // Yana bir eski yurish (3-chi, yo'qolgan claim) — endi COMPLETED ishga kech keladi.
    const job3Stale = { ...job1! };
    await worker.runJob(job3Stale, { build: async () => fileFor("juda-eski") as never, hardStopMs: 60_000 });
    assert.equal((await row(id)).status, "COMPLETED");
    // MUTATSIYA: `!won` tarmog'idagi `deleteGenerationFile/deleteAssets` qaytsa — fayl/aktiv o'chadi.
    assert.equal(await fileOf(id), "FILE-yangi", "eski yurish tayyor faylni bosib yozdi yoki o'chirdi");
    assert.equal(await assetCount(id), 1, "eski yurish tayyor aktivlarni o'chirdi");
    assert.equal(await refunds(id), 0);
  });

  await t.test("C14: SIGTERM — grace ichida tugagan COMPLETED, qolgani darhol QUEUED (urinish sanalmaydi)", async (tt) => {
    quiet(tt);
    await clearQueue();
    const fastUser = await mkUser("sig-fast");
    const slowUser = await mkUser("sig-slow");
    const fastId = await enqueue(fastUser);
    const slowId = await enqueue(slowUser);
    const attemptsBefore = (await row(slowId)).attempts;

    const a = await worker.claimNext();
    const b = await worker.claimNext();
    const jobs = [a!, b!];
    const fast = jobs.find((j) => j.id === fastId)!;
    const slow = jobs.find((j) => j.id === slowId)!;
    assert.ok(fast && slow);
    const slowBuild = hang<ReturnType<typeof fileFor>>();
    const runFast = worker.runJob(fast, {
      build: () => new Promise((r) => setTimeout(() => r(fileFor("tez") as never), 150)),
      hardStopMs: 60_000,
    });
    const runSlow = worker.runJob(slow, { build: () => slowBuild.promise as never, hardStopMs: 60_000 });

    const t0 = Date.now();
    const released = await worker.shutdownWorker({ graceMs: 600 });
    assert.ok(Date.now() - t0 < 2000, "shutdown grace davridan uzoq kutdi");
    await runFast;

    assert.equal((await row(fastId)).status, "COMPLETED", "grace ichida tugagan ish yakunlanmadi");
    // MUTATSIYA: release olib tashlansa — qator IN_PROGRESS qoladi (eski 2 s + exit xatti-harakati).
    assert.deepEqual(released, [slowId]);
    const r = await row(slowId);
    assert.equal(r.status, "QUEUED");
    assert.equal(r.locked_by, null);
    assert.equal(r.attempts, attemptsBefore, "deploy urinish sifatida sanaldi");
    assert.equal(r.run_after_ok, true, "qaytarilgan ish darhol olinmaydi");
    assert.equal(await refunds(slowId), 0);

    // Boshqa worker darhol oladi.
    const other = await claimJob("boshqa-worker:1");
    assert.equal(other?.id, slowId);

    // O'layotgan processning yetim yurishi endi tugasa ham — begona claimga tegmaydi.
    slowBuild.resolve(fileFor("yetim"));
    await Promise.race([runSlow, new Promise((res) => setTimeout(res, 500))]);
    const after = await row(slowId);
    assert.equal(after.status, "IN_PROGRESS");
    assert.equal(after.locked_by, "boshqa-worker:1");
    assert.equal(await fileOf(slowId), null, "yetim yurish yangi egasining ishiga fayl yozdi");

    // To'xtagan worker yangi ish olmaydi.
    const uid = await mkUser("sig-after");
    await enqueue(uid);
    assert.equal(await worker.claimNext(), null, "to'xtatilgan worker yangi ish oldi");
  });
});
