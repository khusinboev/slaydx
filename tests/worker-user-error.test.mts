import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";

/**
 * FOYDALANUVCHIGA XAVFSIZ XATO + ISH IZI (AUDIT prod-readiness C31:
 * BEA-09, EXT-12, OBS-08, OBS-05/06).
 *
 * Ilgari worker `e.message` ni TO'G'RIDAN-TO'G'RI `generations.error` ga
 * (ko'ruvchi uni aynan ko'rsatadi) va refund izohiga (`/api/users/me`)
 * yozardi: pg xatosi («invalid input syntax…»), provayder tanasi (Google:
 * «Consumer 'api_key:AIza…' has been suspended») foydalanuvchiga chiqardi.
 *
 * Endi:
 *   • kutubxona/pg/provayder xatosi → qisqa o'zbekcha umumiy matn;
 *     tafsilot FAQAT jurnalda (`jobId`, `attempt`, `stage?`, `provider?`,
 *     stack), kalit yashirilgan;
 *   • dvigatelning ATAYIN yozgan o'zbekcha xabari (sifat darvozasi va h.k.)
 *     o'zgarmaydi.
 *
 * Birinchi qism — sof tasniflash (bazasiz), ikkinchisi — haqiqiy navbat
 * (`enqueueGeneration` → `claimNext` → `runJob`) alohida Postgres bazada.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("wusererr") : { isolated: false, drop: async () => {} };
const skip = hasDb && iso.isolated ? false : "alohida Postgres baza yo'q";
if (!hasDb) process.env.DATABASE_URL = "postgres://unused/unused";

const { userMessage, UserFacingError, GENERIC_JOB_ERROR } = await import("../lib/server/user-error.ts");
const { TtsError } = await import("../lib/generation/tts/types.ts");
const { DeadlineError } = await import("../lib/generation/llm/chain.ts");

const GOOGLE_KEY = "AIzaSyTEST" + "k".repeat(29);
const PROVIDER_BODY = `{"error":{"code":403,"message":"Permission denied: Consumer 'api_key:${GOOGLE_KEY}' has been suspended.","status":"PERMISSION_DENIED"}}`;

// ───────────────────────────── sof tasniflash

test("userMessage: kutubxona/pg/tarmoq/provayder xatosi → umumiy o'zbekcha matn", () => {
  const pgLike = Object.assign(new Error('invalid input syntax for type json'), { code: "22P02", severity: "ERROR", routine: "report_invalid_token" });
  const net = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), { code: "ECONNREFUSED", syscall: "connect" });
  const cases: unknown[] = [
    pgLike,
    net,
    new TypeError("Cannot read properties of undefined (reading 'map')"),
    new Error("timeout exceeded when trying to connect"),
    new Error("canceling statement due to statement timeout"),
    new Error(`403 Forbidden: ${PROVIDER_BODY}`),
    new Error("Input buffer contains unsupported image format"),
    new Error(`Rasm yaratilmadi: https://generativelanguage.googleapis.com/v1/models?key=${GOOGLE_KEY}`),
    "raw string",
    null,
    { message: "obyekt" },
  ];
  for (const e of cases) {
    const m = userMessage(e);
    // MUTATSIYA: `userMessage` e.message ni qaytarsa — shu qator qizaradi.
    assert.equal(m, GENERIC_JOB_ERROR, `xom matn o'tib ketdi: ${String((e as Error)?.message ?? e)}`);
  }
});

test("userMessage: TTS va muddat xatolari — o'z qisqa o'zbekcha matni (xom tana yo'q)", () => {
  const tts = userMessage(new TtsError("gemini", `403 Forbidden: ${PROVIDER_BODY}`, { status: 403 }));
  assert.match(tts, /Ovoz/);
  assert.ok(!tts.includes("AIza") && !tts.includes("403"));
  const dl = userMessage(new DeadlineError("writer", 1200));
  assert.match(dl, /vaqt/i);
  assert.ok(!dl.includes("[llm"));
});

test("userMessage: dvigatelning ATAYIN yozgan o'zbekcha xabari o'zgarmaydi", () => {
  const keep = [
    "Fayl bo'sh chiqdi — qayta urinib ko'ring",
    "Tarjima qilinadigan matn topilmadi. Kredit qaytariladi.",
    "Ovoz provayderi sozlanmagan. Administrator bilan bog‘laning — to‘lov qaytarildi.",
    "Bosqich daqiqalari dars davomiyligiga mos kelmadi (40 daqiqa, kerak: 80 ± 5). Kredit qaytariladi — qayta urinib ko‘ring.",
    "PDF juda uzun: 400 sahifa (chegara 300). Hujjatni bo'lib yuboring.",
    "Ish vaqti tugadi",
    "Noma'lum vosita",
    "Navbat juda uzun edi — pul qaytarildi",
  ];
  for (const m of keep) assert.equal(userMessage(new Error(m)), m);
  assert.equal(userMessage(new UserFacingError("Maxsus xabar")), "Maxsus xabar");
  // Ichki dasturchi xabarlari (`planWork: …`, `[llm] …`) — foydalanuvchiga emas.
  assert.equal(userMessage(new Error("planWork: `doc.work` yo'q — eski hujjat umumiy yo'l bilan chiziladi")), GENERIC_JOB_ERROR);
  assert.equal(userMessage(new Error("[llm] grounding JSON rejimi bilan mos emas — ikki chaqiruv qiling")), GENERIC_JOB_ERROR);
});

// ───────────────────────────── haqiqiy navbat

type Row = Record<string, unknown>;
function capture(t: TestContext): Row[] {
  const rows: Row[] = [];
  const push = (...a: unknown[]) => {
    const s = a.map(String).join(" ");
    try {
      rows.push(JSON.parse(s));
    } catch {
      rows.push({ raw: s });
    }
  };
  t.mock.method(console, "log", push);
  t.mock.method(console, "warn", push);
  t.mock.method(console, "error", push);
  return rows;
}

test("worker: xom xato foydalanuvchiga chiqmaydi, tafsilot jurnalda (jobId, attempt, stage, provider)", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { enqueueGeneration, getGeneration, listGenerations } = await import("../lib/server/jobs.ts");
  const { recentTransactions } = await import("../lib/server/credits.ts");
  const worker = await import("../lib/server/worker.ts");
  await migrate();
  t.after(async () => {
    await pool().end();
    await iso.drop();
  });

  const mkUser = async () =>
    String(
      (
        await query<{ id: string }>(
          `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 50000) RETURNING id`,
          [`uerr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
        )
      )[0].id,
    );
  const clearQueue = () => query(`UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED','IN_PROGRESS')`);

  /** Bitta ishni navbatdan o'tkazadi; `build` stub xato tashlaydi. */
  const runWith = async (tt: TestContext, build: (onStage?: (ev: { progress: number; step: string }) => void) => Promise<never>) => {
    await clearQueue();
    const uid = await mkUser();
    const r = await enqueueGeneration({
      userId: uid,
      toolId: "translation",
      topic: "Sinov",
      price: 3000,
      format: "docx",
      values: { topic: "Sinov" },
      budgetMs: 60_000,
    });
    assert.ok(r.ok);
    const job = await worker.claimNext();
    assert.equal(job?.id, r.id);
    const rows = capture(tt);
    await worker.runJob(job!, { build: ((_tool: unknown, _values: unknown, opts: { onStage?: (ev: { progress: number; step: string }) => void }) => build(opts.onStage)) as never });
    const gen = await getGeneration(r.id, uid);
    const tx = await recentTransactions(uid);
    const list = await listGenerations(uid, { limit: 10, cursor: null });
    return { id: r.id, uid, gen: gen!, tx, rows, listed: list.items.find((g) => g.id === r.id)! };
  };

  await t.test("pg xatosi → o'zbekcha umumiy matn; xom matn faqat jurnalda", async (tt) => {
    const { id, gen, tx, rows, listed } = await runWith(tt, async (onStage) => {
      onStage?.({ progress: 40, step: "Tarjima qilinmoqda · 3/57" });
      await query("SELECT $1::int", ["x-not-a-number"]);
      throw new Error("yetib kelmasligi kerak");
    });
    assert.equal(gen.status, "FAILED");
    // MUTATSIYA: worker `e.message` ni saqlasa — shu ikki qator qizaradi.
    assert.equal(gen.error, GENERIC_JOB_ERROR);
    assert.equal(listed.error, GENERIC_JOB_ERROR);
    const refund = tx.find((x) => x.kind === "refund");
    assert.ok(refund, "pul qaytmadi");
    assert.ok(!/invalid input syntax/i.test(refund.note), `refund izohida xom pg matni: ${refund.note}`);

    const fail = rows.find((r) => r.level === "error" && r.jobId === id && (r.err as Row | undefined)?.message);
    assert.ok(fail, `jurnalda ish xatosi qatori yo'q: ${JSON.stringify(rows)}`);
    assert.match(String((fail.err as Row).message), /invalid input syntax/);
    assert.ok((fail.err as Row).stack, "stack yo'q");
    // OBS-08: urinish va bosqich — ish tarixini jurnaldan tiklash uchun.
    assert.equal(fail.attempt, 1);
    assert.equal(fail.stage, "Tarjima qilinmoqda · 3/57");
    // Pul qaytarish ham jurnalda, shu ish id si bilan.
    assert.ok(rows.some((r) => r.jobId === id && /qaytarildi/.test(String(r.msg))), "refund jurnali yo'q");
  });

  await t.test("provayder tanasidagi kalit — foydalanuvchiga ham, jurnalga ham chiqmaydi", async (tt) => {
    const { id, gen, tx, rows } = await runWith(tt, async () => {
      throw new TtsError("gemini", `403 Forbidden: ${PROVIDER_BODY}`, { status: 403 });
    });
    assert.ok(!String(gen.error).includes("AIza") && !String(gen.error).includes("Permission"), `xom: ${gen.error}`);
    assert.match(String(gen.error), /Ovoz/);
    const refund = tx.find((x) => x.kind === "refund")!;
    assert.ok(!refund.note.includes("AIza") && !refund.note.includes("403"));
    const all = JSON.stringify(rows);
    assert.ok(!all.includes(GOOGLE_KEY), "kalit jurnalga tushdi");
    const fail = rows.find((r) => r.level === "error" && r.jobId === id && r.err)!;
    assert.equal(fail.provider, "gemini");
    assert.match(String((fail.err as Row).message), /Permission denied/);
  });

  await t.test("dvigatelning o'zbekcha xabari foydalanuvchiga aynan boradi", async (tt) => {
    const msg = "Tarjima qilinadigan matn topilmadi. Kredit qaytariladi.";
    const { gen } = await runWith(tt, async () => {
      throw new Error(msg);
    });
    assert.equal(gen.error, msg);
  });

  await t.test("navbatga qo'yish izi: so'rov reqId si va ish id si bitta qatorda (OBS-02)", async (tt) => {
    const { withLogContext } = await import("../lib/server/log.ts");
    const uid = await mkUser();
    const rows = capture(tt);
    const r = await withLogContext({ reqId: "req-enqueue-1" }, () =>
      enqueueGeneration({ userId: uid, toolId: "essay", topic: "Sinov", price: 1000, format: "docx", values: { topic: "Sinov" }, budgetMs: 60_000 }),
    );
    assert.ok(r.ok);
    const line = rows.find((x) => x.jobId === r.id);
    // MUTATSIYA: `logEnqueue` chaqiruvi olib tashlansa — qizaradi.
    assert.ok(line, "enqueue jurnali yo'q");
    assert.equal(line.reqId, "req-enqueue-1");
    assert.equal(line.userId, uid);
    assert.equal(line.price, 1000);
    await query(`UPDATE generations SET status = 'REVOKED' WHERE id = $1`, [r.id]);
  });

  await t.test("eski qatordagi xom xato ham API javobida umumiy matnga aylanadi", async () => {
    const uid = await mkUser();
    const [{ id }] = await query<{ id: string }>(
      `INSERT INTO generations (id, user_id, tool_id, topic, price, format, values_json, status, error)
       VALUES (gen_random_uuid(), $1, 'essay', 'x', 0, 'docx', '{}'::jsonb, 'FAILED', $2) RETURNING id`,
      [uid, "connect ECONNREFUSED 10.0.0.5:5432"],
    );
    const gen = await getGeneration(id, uid);
    // MUTATSIYA: `rowToSummary` xom `error` ni qaytarsa — qizaradi.
    assert.equal(gen!.error, GENERIC_JOB_ERROR);
  });
});
