import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * «Emoji bilan bepul hujjat + to'liq qaytarish» (AUDIT prod-readiness C03: BEB-01, BEA-02) — BAZA BILAN.
 *
 * Zanjir: worker faylni `putGenerationFile` bilan SAQLAYDI, keyin
 * `completeJob` `doc_json` (JSONB) ni yozadi. Hujjat ichida yolg'iz
 * surrogat (`"…".slice(0, 80)` emoji juftligini yorgan) yoki `\u0000`
 * bo'lsa Postgres UPDATE ni rad etadi → catch → `failJob` + to'liq
 * `refund`, lekin saqlangan fayl QOLARDI va `getGenerationFile` holatni
 * so'ramagani uchun FAILED ishning fayli yuklab olinardi.
 *
 * Himoya uch qatlamda sinaladi:
 *   (a) JSONB/TEXT yozuvchilar (`completeJob`, `updateGenerationDoc`,
 *       `setLive`, `enqueueGeneration`, `putDraft`, `addResult`) buzuq
 *       matnni tozalab YOZADI — 500 yo'q, ish yiqilmaydi;
 *   (b) `getGenerationFile` faqat COMPLETED ishning faylini beradi;
 *   (c) worker xato yo'lida (`failAndCleanup`) saqlangan fayl/aktivlar o'chadi.
 *
 * Faqat vaqtinchalik test bazasi: `DATABASE_URL=postgres://slaydx:audit@127.0.0.1:55439/slaydx`.
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const EMOJI = "😀";
const HIGH = "\ud83d";
/** Emoji aynan 80-kod birligida yoriladi — `meta.ts` `position` naqshi. */
const SPLIT = ("A".repeat(79) + EMOJI).slice(0, 80);

test("JSONB/TEXT yozuvlari yolg'iz surrogat va NUL bilan", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, queryOne, migrate, pool, transaction } = await import("../lib/server/db.ts");
  const jobs = await import("../lib/server/jobs.ts");
  const { putGenerationFile, getGenerationFile } = await import("../lib/server/storage.ts");
  const { putAssets } = await import("../lib/server/assets.ts");
  const { putDraft } = await import("../lib/server/form-draft.ts");
  const { addResult } = await import("../lib/server/game-sessions.ts");

  await migrate();

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const u = await queryOne<{ id: string }>(
    `INSERT INTO users (username, name, points, quota, balance)
     VALUES ($1, 'Test', 0, 0, 100000) RETURNING id::text AS id`,
    [`test-jsonb-${stamp}`],
  );
  const uid = String(u!.id);
  const WORKER = `w-jsonb-${stamp}`;

  t.after(async () => {
    await query("DELETE FROM generations WHERE user_id = $1", [uid]).catch(() => {});
    await query("DELETE FROM form_drafts WHERE user_id = $1", [uid]).catch(() => {});
    await query("DELETE FROM transactions WHERE user_id = $1", [uid]).catch(() => {});
    await query("DELETE FROM users WHERE id = $1", [uid]).catch(() => {});
    await pool().end();
  });

  /** `claimJob`dan keyingi holat: IN_PROGRESS, qulf bizda. */
  const mkRunning = async (): Promise<string> => {
    const id = randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, price, format, values_json, step, budget_ms, status, locked_by, locked_at)
       VALUES ($1, $2, 'resume', 'Sinov', 3000, 'docx', '{}'::jsonb, 'Boshlandi', 90000, 'IN_PROGRESS', $3, now())`,
      [id, uid, WORKER],
    );
    return id;
  };

  const FILE = {
    bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileName: "sinov.docx",
  };

  await t.test("(a) completeJob: doc/preview/html ichida yolg'iz surrogat va NUL — ish COMPLETED bo'ladi", async () => {
    const id = await mkRunning();
    const doc = {
      title: "Sinov",
      meta: { position: SPLIT, extra: "a\u0000b" },
      sections: [{ title: `bo'lim${HIGH}`, paragraphs: ["x\u0000y", `\ude00z`] }],
    } as unknown as Parameters<typeof jobs.completeJob>[2]["doc"];
    // BUGUN: 22P02 invalid input syntax for type json → throw.
    const won = await jobs.completeJob(id, WORKER, {
      html: "<p>a\u0000b</p>",
      doc,
      fileName: "sinov\u0000.docx",
      preview: { lines: [SPLIT, "n\u0000ul"] },
      delivered: { got: 1, want: 1, unit: `ta${HIGH}` } as never,
    });
    assert.equal(won, true);
    const row = await queryOne<{ status: string; doc_json: { meta: { position: string; extra: string } }; html: string; file_name: string; preview: { lines: string[] } }>(
      "SELECT status, doc_json, html, file_name, preview FROM generations WHERE id = $1",
      [id],
    );
    assert.equal(row!.status, "COMPLETED");
    assert.equal(row!.doc_json.meta.position, "A".repeat(79) + "\ufffd");
    assert.equal(row!.doc_json.meta.extra, "ab");
    assert.equal(row!.html, "<p>ab</p>");
    assert.equal(row!.file_name, "sinov.docx");
    assert.deepEqual(row!.preview.lines, ["A".repeat(79) + "\ufffd", "nul"]);
  });

  await t.test("(a) updateGenerationDoc / setLive / setCost / failJob — buzuq matn bilan ham yoziladi", async () => {
    const id = await mkRunning();
    // setLive: jonli deka (LLM matni) ichida NUL/surrogat.
    const seq = await jobs.setLive(id, WORKER, { slides: [{ title: `s${HIGH}`, body: "a\u0000" }] }, 40, `qadam\u0000${HIGH}`);
    assert.equal(typeof seq, "number", "setLive yozilishi kerak edi");
    await jobs.setProgress(id, WORKER, 50, `bosqich\u0000`);
    assert.equal(await jobs.setCost(id, WORKER, { provider: `p\u0000`, model: SPLIT } as never), true);
    assert.equal(
      await jobs.completeJob(id, WORKER, { html: "<p>ok</p>", doc: { title: "ok" } as never, fileName: "ok.docx", preview: null }),
      true,
    );
    // Ko'ruvchi tahriri (PATCH …/doc) — `clipTo` yorgan emoji + NUL.
    const v = await transaction((client) =>
      jobs.updateGenerationDoc(client, id, uid, 0, {
        doc: { title: SPLIT, body: "x\u0000" } as never,
        html: "<p>t\u0000</p>",
        preview: { lines: [SPLIT] },
      }),
    );
    assert.equal(v, 1);

    const failing = await mkRunning();
    assert.equal(await jobs.failJob(failing, WORKER, `pg xato\u0000 ${HIGH}`), true);
  });

  await t.test("(b) enqueueGeneration: `values`/`topic` ichida \\u0000 — 500 emas, tozalanib navbatga tushadi", async () => {
    const res = await jobs.enqueueGeneration({
      userId: uid,
      toolId: "essay",
      topic: `Mavzu\u0000 ${HIGH}`,
      price: 100,
      format: "docx",
      values: { topic: `Mavzu\u0000`, extra: SPLIT },
      budgetMs: 90_000,
    });
    assert.equal(res.ok, true);
    const id = (res as { id: string }).id;
    const row = await queryOne<{ topic: string; values_json: Record<string, string> }>(
      "SELECT topic, values_json FROM generations WHERE id = $1",
      [id],
    );
    assert.equal(row!.values_json.topic, "Mavzu");
    assert.equal(row!.values_json.extra, "A".repeat(79) + "\ufffd");
    assert.equal(row!.topic.includes("\u0000"), false);
  });

  await t.test("(a) putDraft / addResult — qoralama va o'yin natijasi buzuq matn bilan ham yoziladi", async () => {
    await putDraft(uid, "essay", { topic: SPLIT, extra: `x${HIGH}` });

    const gid = await mkRunning();
    const sid = randomUUID();
    await query(
      `INSERT INTO game_sessions (id, generation_id, user_id, token, kind, settings_json)
       VALUES ($1, $2, $3, $4, 'quiz', '{}'::jsonb)`,
      [sid, gid, uid, `tok-${stamp}`],
    );
    const r = await addResult({
      sessionId: sid,
      playerName: `Ali\u0000${HIGH}`,
      score: 1,
      total: 2,
      seconds: 3,
      answers: { q1: `javob\u0000`, [`k${HIGH}`]: SPLIT },
    });
    assert.ok(r.id);
    assert.equal(r.playerName.includes("\u0000"), false);
  });

  await t.test("(b2) getGenerationFile: FAILED ishning saqlangan fayli BERILMAYDI, COMPLETED niki beriladi", async () => {
    const failed = await mkRunning();
    await putGenerationFile(failed, FILE);
    assert.equal(await jobs.failJob(failed, WORKER, "xato"), true);
    // MUTATSIYA: storage.ts dagi `g.status = 'COMPLETED'` olib tashlansa — qizaradi.
    assert.equal(await getGenerationFile(failed, uid), null, "FAILED + qaytarilgan ishning fayli yuklab olinmasligi kerak");

    const done = await mkRunning();
    await putGenerationFile(done, FILE);
    assert.equal(await jobs.completeJob(done, WORKER, { html: "", doc: null, fileName: "sinov.docx", preview: null }), true);
    const f = await getGenerationFile(done, uid);
    assert.ok(f, "COMPLETED ishning fayli beriladi");
    assert.equal(f.bytes.byteLength, 8);
  });

  await t.test("(c) worker xato yo'li: fayl/aktivlar saqlangandan keyin yiqilsa — FAILED, pul qaytadi, fayl va aktivlar O'CHADI", async () => {
    const { failAndCleanup } = await import("../lib/server/worker.ts");
    assert.equal(typeof failAndCleanup, "function", "worker.ts `failAndCleanup` ni eksport qilishi kerak");
    const id = await mkRunning();
    await putGenerationFile(id, FILE);
    await putAssets(id, [{ assetId: "b".repeat(24), mime: "image/png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }]);
    await query(
      `INSERT INTO transactions (user_id, kind, points_delta, quota_delta, balance_delta, reference, note)
       VALUES ($1, 'charge', 0, 0, -3000, $2, 'resume: Sinov')`,
      [uid, id],
    );

    // Xabar ichida NUL ham bor — `refund` izohi (TEXT) uni rad etmasin.
    await failAndCleanup({ id, userId: uid }, WORKER, "completeJob yiqildi\u0000");

    const row = await queryOne<{ status: string }>("SELECT status FROM generations WHERE id = $1", [id]);
    assert.equal(row!.status, "FAILED");
    const files = await query("SELECT 1 FROM generation_files WHERE generation_id = $1", [id]);
    // MUTATSIYA: failAndCleanup dan fayl o'chirish olib tashlansa — qizaradi.
    assert.equal(files.length, 0, "FAILED ishning fayli bazada qolmasligi kerak");
    const assets = await query("SELECT 1 FROM generation_assets WHERE generation_id = $1", [id]);
    assert.equal(assets.length, 0, "FAILED ishning aktivlari bazada qolmasligi kerak");
    const refunds = await query("SELECT 1 FROM transactions WHERE kind = 'refund' AND reference = $1", [id]);
    assert.equal(refunds.length, 1, "to'liq qaytarish yozilishi kerak");
  });

  await t.test("(c) worker xato yo'li: qulf BOSHQADA bo'lsa — hech narsa o'chirilmaydi, pul qaytmaydi", async () => {
    const { failAndCleanup } = await import("../lib/server/worker.ts");
    const id = await mkRunning();
    await putGenerationFile(id, FILE);
    await failAndCleanup({ id, userId: uid }, "boshqa-worker", "eski worker");
    const row = await queryOne<{ status: string }>("SELECT status FROM generations WHERE id = $1", [id]);
    assert.equal(row!.status, "IN_PROGRESS");
    const files = await query("SELECT 1 FROM generation_files WHERE generation_id = $1", [id]);
    assert.equal(files.length, 1, "qulf egasining fayliga tegilmasligi kerak");
    const refunds = await query("SELECT 1 FROM transactions WHERE kind = 'refund' AND reference = $1", [id]);
    assert.equal(refunds.length, 0);
  });

  /** Fayl + aktiv + `charge` yozuvi bor ish — tozalash/qaytarish sinovlari uchun. */
  const withArtifacts = async (id: string, chargeDelta = -3000) => {
    await putGenerationFile(id, FILE);
    await putAssets(id, [{ assetId: "c".repeat(24), mime: "image/png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }]);
    await query(
      `INSERT INTO transactions (user_id, kind, points_delta, quota_delta, balance_delta, reference, note)
       VALUES ($1, 'charge', 0, 0, $3, $2, 'resume: Sinov')`,
      [uid, id, chargeDelta],
    );
  };
  const leftovers = async (id: string) => ({
    files: (await query("SELECT 1 FROM generation_files WHERE generation_id = $1", [id])).length,
    assets: (await query("SELECT 1 FROM generation_assets WHERE generation_id = $1", [id])).length,
  });

  await t.test("(c, R2) failAndCleanup: refund YIQILSA ham fayl/aktivlar o'chadi (xato yuqoriga chiqadi)", async () => {
    const { failAndCleanup } = await import("../lib/server/worker.ts");
    const id = await mkRunning();
    // Haqiqiy baza xatosi: «charge» yozuvi +1e12 — qaytarish balansni manfiy
    // qilardi va `users.balance >= 0` CHECK uni rad etadi → `refund` throw.
    await withArtifacts(id, 1_000_000_000_000);
    await assert.rejects(failAndCleanup({ id, userId: uid }, WORKER, "xato"), /check constraint/);
    const row = await queryOne<{ status: string }>("SELECT status FROM generations WHERE id = $1", [id]);
    assert.equal(row!.status, "FAILED");
    // MUTATSIYA: o'chirishlar `finally` dan refund'dan keyingi oddiy qatorga qaytarilsa — qizaradi.
    assert.deepEqual(await leftovers(id), { files: 0, assets: 0 }, "refund xatosi tozalashni o'tkazib yubormasligi kerak");
  });

  await t.test("(c, R1) housekeeping: reclaimStaleJobs FAILED qilgan ish — pul qaytadi, fayl/aktivlar O'CHADI", async () => {
    const { housekeeping } = await import("../lib/server/worker.ts");
    const id = randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, price, format, values_json, step, budget_ms, status,
                                locked_by, locked_at, attempts)
       VALUES ($1, $2, 'resume', 'Sinov', 3000, 'docx', '{}'::jsonb, 'Boshlandi', 1000, 'IN_PROGRESS',
               'o-lgan-worker', now() - interval '1 hour', 2)`,
      [id, uid],
    );
    await withArtifacts(id);
    await housekeeping();
    const row = await queryOne<{ status: string }>("SELECT status FROM generations WHERE id = $1", [id]);
    assert.equal(row!.status, "FAILED", "shart: ikkinchi urinishdagi osilgan ish FAILED bo'lishi kerak");
    const refunds = await query("SELECT 1 FROM transactions WHERE kind = 'refund' AND reference = $1", [id]);
    assert.equal(refunds.length, 1);
    // MUTATSIYA: housekeeping'dagi tozalash olib tashlansa — qizaradi.
    assert.deepEqual(await leftovers(id), { files: 0, assets: 0 }, "vaqti tugab FAILED bo'lgan ishning fayli qolmasligi kerak");
  });
});
