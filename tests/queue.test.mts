import test from "node:test";
import assert from "node:assert/strict";

/**
 * Navbat byudjeti — uchdan-uchiga (Sprint 12).
 *
 * Sof `budgetFor` testi `generation.test.mts` da. Bu yerda SIMLASH
 * tekshiriladi: byudjet navbatga qo'yishda hisoblanib, qatorga yozilib,
 * `claimJob` orqali worker ga yetib boradimi. Ilgari worker 14 xizmatga
 * bitta global `WORKER_JOB_TIMEOUT_MS` ishlatardi.
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

test("navbat byudjeti", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, migrate } = await import("../lib/server/db.ts");
  const { enqueueGeneration, claimJob } = await import("../lib/server/jobs.ts");
  const { budgetFor } = await import("../lib/generation/budget.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");

  await migrate();

  const suffix = `test-queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rows = await query<{ id: string }>(
    `INSERT INTO users (username, name, points, quota, balance)
     VALUES ($1, 'Test', 0, 0, 100000) RETURNING id`,
    [suffix],
  );
  const uid = String(rows[0].id);

  t.after(async () => {
    await query("DELETE FROM generations WHERE user_id = $1", [uid]);
    await query("DELETE FROM transactions WHERE user_id = $1", [uid]);
    await query("DELETE FROM users WHERE id = $1", [uid]);
    // Pool ATAYIN bu yerda yopilmaydi — fayldagi keyingi testlar ham shu
    // ulanishdan foydalanadi. Yopish faqat oxirgi testda.
  });

  const CAP = 900_000;
  const enqueue = async (toolId: "coursework" | "essay", values: Record<string, unknown>) => {
    const tool = TOOL_BY_ID[toolId];
    const res = await enqueueGeneration({
      userId: uid,
      toolId: tool.id,
      topic: `${toolId} sinov`,
      price: 100,
      format: tool.output,
      values: values as never,
      budgetMs: budgetFor(tool, values as never, CAP),
    });
    assert.equal(res.ok, true);
    return res.ok ? res.id : "";
  };

  await t.test("byudjet qatorga yoziladi va worker ga yetib boradi", async () => {
    // Katta ish avval navbatga tushadi — `claimJob` `created_at` bo'yicha oladi.
    const bigId = await enqueue("coursework", { topic: "Katta", pages: "40-45" });
    const smallId = await enqueue("essay", { topic: "Kichik", pages: "1" });

    const stored = await query<{ id: string; budget_ms: number }>(
      "SELECT id, budget_ms FROM generations WHERE user_id = $1 ORDER BY created_at",
      [uid],
    );
    const byId = Object.fromEntries(stored.map((r) => [r.id, Number(r.budget_ms)]));
    assert.ok(byId[bigId] >= 420_000, `katta ish byudjeti: ${byId[bigId]}`);
    assert.ok(byId[smallId] <= 120_000, `kichik ish byudjeti: ${byId[smallId]}`);

    // Worker aynan shu qiymatni oladi — global konstanta emas.
    const claimed = await claimJob("test-worker");
    assert.ok(claimed, "ish olinishi kerak");
    assert.equal(claimed!.id, bigId, "navbat tartibi: eng eskisi birinchi");
    assert.equal(claimed!.budgetMs, byId[bigId]);
  });

  await t.test("eski qator (budget_ms = 0) global qiymatga qaytadi", async () => {
    // `claimJob` navbatdagi ENG ESKI ishni oladi, shuning uchun oldingi
    // sinovdan qolgan qatorlar avval navbatdan chiqariladi — aks holda
    // bu sinov ular ustida ishlab qolardi.
    await query("UPDATE generations SET status = 'COMPLETED' WHERE user_id = $1 AND status = 'QUEUED'", [uid]);

    const id = await enqueue("essay", { topic: "Eski", pages: "2" });
    // Migratsiyadan oldin yaratilgan qatorni taqlid qilamiz.
    await query("UPDATE generations SET budget_ms = 0 WHERE id = $1", [id]);

    const claimed = await claimJob("test-worker-2");
    assert.ok(claimed);
    assert.equal(claimed!.id, id);
    assert.equal(claimed!.budgetMs, 0, "0 — worker global qiymatga qaytishi uchun belgi");
  });
});

/**
 * Worker qarorlari va navbat SQL i (adversarial mutatsiya supurgisi
 * ochgan teshiklar, 2026-09-05).
 *
 * Sprint 9–13 dan keyin o'tkazilgan supurgi shuni ko'rsatdiki, MANTIQ
 * sinalgan (`budgetFor`, `splitRatio`, `formatOf`), lekin SIMLASH
 * sinalmagan: worker byudjetni e'tiborsiz qoldirsa ham, `reclaimStaleJobs`
 * global muddatga qaytsa ham, `completeJob` formatni yangilamasa ham
 * birorta test yiqilmasdi.
 */
test("worker qarorlari", async (t) => {
  const { jobBudget, jobDeadlineMs, shortfallRatio } = await import("../lib/server/worker.ts");
  const { env } = await import("../lib/server/env.ts");

  await t.test("byudjet qatordan olinadi, 0 bo'lsa globalga qaytadi", () => {
    assert.equal(jobBudget({ budgetMs: 477_000 }), 477_000);
    assert.equal(jobBudget({ budgetMs: 99_000 }), 99_000);
    // Migratsiyadan oldingi qatorlar.
    assert.equal(jobBudget({ budgetMs: 0 }), env.worker.jobTimeoutMs);
    assert.equal(jobBudget({ budgetMs: -1 }), env.worker.jobTimeoutMs);
  });

  await t.test("generatsiya byudjeti qulf muddatidan qisqa", () => {
    /*
     * Ish `reclaimStaleJobs` uni o'lik deb hisoblashidan OLDIN tugab,
     * natijani yozishga ulgurishi kerak — aks holda tugagan ish qayta
     * navbatga tushardi.
     */
    assert.equal(jobDeadlineMs({ budgetMs: 477_000 }), 462_000);
    assert.ok(jobDeadlineMs({ budgetMs: 477_000 }) < 477_000);

    // Kichik ish ham ishlashga ulgursin — pastki chegara bor.
    assert.equal(jobDeadlineMs({ budgetMs: 20_000 }), 30_000);

    // Eski qator: global qiymatdan hisoblanadi, qattiq yozilgan emas.
    assert.equal(jobDeadlineMs({ budgetMs: 0 }), Math.max(30_000, env.worker.jobTimeoutMs - 15_000));
  });

  await t.test("kam yetkazilganda qaytariladigan ulush", () => {
    // To'liq yetkazildi — qaytarish yo'q.
    assert.equal(shortfallRatio(undefined), null);
    assert.equal(shortfallRatio({ got: 4, want: 4 }), null);
    assert.equal(shortfallRatio({ got: 5, want: 4 }), null, "ortiqcha ham qaytarishga sabab emas");

    // 4 tadan 3 tasi — chorak qaytadi.
    assert.equal(shortfallRatio({ got: 3, want: 4 }), 0.25);
    assert.equal(shortfallRatio({ got: 1, want: 4 }), 0.75);
    assert.equal(shortfallRatio({ got: 1, want: 2 }), 0.5);

    // Buzuq qiymat pul qaroriga aylanmasin.
    assert.equal(shortfallRatio({ got: 0, want: 0 }), null);
  });
});

test("navbat SQL i", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { enqueueGeneration, claimJob, completeJob, reclaimStaleJobs } = await import("../lib/server/jobs.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");

  await migrate();
  const suffix = `test-sql-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rows = await query<{ id: string }>(
    `INSERT INTO users (username, name, points, quota, balance)
     VALUES ($1, 'Test', 0, 0, 100000) RETURNING id`,
    [suffix],
  );
  const uid = String(rows[0].id);
  t.after(async () => {
    await query("DELETE FROM generations WHERE user_id = $1", [uid]);
    await query("DELETE FROM transactions WHERE user_id = $1", [uid]);
    await query("DELETE FROM users WHERE id = $1", [uid]);
    await pool().end();
  });

  const add = async (budgetMs: number) => {
    const res = await enqueueGeneration({
      userId: uid,
      toolId: "essay",
      topic: "sinov",
      price: 10,
      format: TOOL_BY_ID.essay.output,
      values: {} as never,
      budgetMs,
    });
    assert.equal(res.ok, true);
    return res.ok ? res.id : "";
  };

  await t.test("uzun byudjetli sog'lom ish o'lik deb belgilanmaydi", async () => {
    // Ikkita ish: biri qisqa byudjetli, biri uzun. Ikkalasi ham 2 daqiqa
    // oldin qulflangan.
    const shortJob = await add(60_000);
    const longJob = await add(600_000);
    await query(
      `UPDATE generations SET status = 'IN_PROGRESS', attempts = 2,
              locked_by = 'w', locked_at = now() - interval '2 minutes'
        WHERE id = ANY($1::uuid[])`,
      [[shortJob, longJob]],
    );

    const dead = await reclaimStaleJobs();
    /*
     * Qisqa byudjetli ish (60 s + 30 s zaxira) 2 daqiqada muddatini
     * o'tkazgan; uzun byudjetli (600 s) esa hali sog'lom ishlayapti.
     * Ilgari ikkalasi ham global 300 s bilan solishtirilar va uzun ish
     * ham navbatga qaytarilishi mumkin edi.
     */
    assert.ok(dead.includes(shortJob), "muddati o'tgan ish yakunlanishi kerak");
    assert.ok(!dead.includes(longJob), "sog'lom uzun ish tegilmasligi kerak");

    const still = await query<{ status: string }>("SELECT status FROM generations WHERE id = $1", [longJob]);
    assert.equal(still[0].status, "IN_PROGRESS");
  });

  await t.test("completeJob format yorlig'ini haqiqiy faylga moslaydi", async () => {
    await query("UPDATE generations SET status = 'COMPLETED' WHERE user_id = $1 AND status = 'QUEUED'", [uid]);
    const id = await add(99_000);

    const claimed = await claimJob("w2");
    assert.ok(claimed && claimed.id === id);

    // Navbatga qo'yishda yorliq `tool.output` — insho uchun `docx`.
    const before = await query<{ format: string }>("SELECT format FROM generations WHERE id = $1", [id]);
    assert.equal(before[0].format, "docx");

    // Haqiqiy fayl ZIP bo'lib chiqsa yorliq ham shunga o'tadi — foydalanuvchi
    // «DOCX» tugmasini bosib `.zip` olmasin.
    const won = await completeJob(id, "w2", { html: "", doc: null, fileName: "natija-3ta.zip", preview: null });
    assert.equal(won, true);
    const after = await query<{ format: string }>("SELECT format FROM generations WHERE id = $1", [id]);
    assert.equal(after[0].format, "zip");
  });
});

test("rowToSummary: delivered_json -> delivered (Sprint 5, AUDIT-6 C7)", async () => {
  const { rowToSummary } = await import("../lib/server/jobs.ts");

  /*
   * Ilgari `file.delivered` faqat qisman qaytarish tranzaksiyasining
   * izohida qolardi — bazada umuman saqlanmasdi. `ResultView` uni
   * ko'rsatishi uchun avval `rowToSummary` uni qatordan xulosaga
   * to'g'ri o'tkazishi kerak.
   */
  const base = {
    id: "g1",
    user_id: "u1",
    tool_id: "image",
    topic: "Rasm",
    status: "COMPLETED" as const,
    price: "6000",
    format: "zip",
    progress: 100,
    step: "Tayyor",
    file_name: "rasm.zip",
    error: null,
    preview: null,
    created_at: new Date("2026-01-01T00:00:00Z"),
    started_at: null,
    finished_at: new Date("2026-01-01T00:01:00Z"),
    expires_at: null,
  };

  const withDelivered = rowToSummary({ ...base, delivered_json: { got: 3, want: 4 } });
  assert.deepEqual(withDelivered.delivered, { got: 3, want: 4 });

  const withoutDelivered = rowToSummary({ ...base, delivered_json: null });
  assert.equal(withoutDelivered.delivered, undefined, "to'liq yetkazilganda maydon yo'q bo'lishi kerak");
});
