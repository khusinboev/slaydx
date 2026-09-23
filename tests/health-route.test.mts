import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * `/api/health` (TEST-08, C19 — INFRA-06/OBS-04/OBS-12): ilgari bu
 * route'ning hech qanday testi yo'q edi.
 *
 * Ikki narsa qulflanadi:
 * 1. **Ichki/ommaviy ajratish** — `CRON_SECRET` bo'lmasa (yoki noto'g'ri
 *    bo'lsa) javob FAQAT `{status}` — `problems`/`queue`/`warnings` kabi
 *    ichki holat hech qachon chiqmasin (ilgari bu ochiq edi).
 * 2. **Chuqur navbat SQL'i** (OBS-12) — `queued`/`running` soni, eng eski
 *    QUEUED yoshi va IN_PROGRESS'dagi eng yangi `locked_at` haqiqiy
 *    qatorlarni to'g'ri hisoblaydi.
 *
 * Haqiqiy Postgres kerak (tashlab yuboriladigan baza).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
process.env.CRON_SECRET = process.env.CRON_SECRET || "test-cron-secret-for-health-route";

const { pool, query, queryOne, migrate } = await import("../lib/server/db.ts");
const { GET } = await import("../app/api/health/route.ts");

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://x/api/health", { headers });
}

test(
  "/api/health: ichki bearer'siz javob FAQAT {status} — hech qanday ichki holat oshkor bo'lmaydi",
  { skip: hasDb ? false : "DATABASE_URL yo'q" },
  async () => {
    await migrate();
    const res = await GET(req());
    const body = await res.json();
    assert.ok([200, 503].includes(res.status));
    assert.deepEqual(Object.keys(body).sort(), ["status"], `ommaviy javobda faqat "status" bo'lishi kerak, keldi: ${JSON.stringify(body)}`);
  },
);

test(
  "/api/health: noto'g'ri Bearer token ham ommaviy (minimal) javob beradi",
  { skip: hasDb ? false : "DATABASE_URL yo'q" },
  async () => {
    const res = await GET(req({ authorization: "Bearer notrealcronsecret" }));
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ["status"]);
  },
);

test(
  "/api/health: to'g'ri CRON_SECRET bilan chuqur javob — navbat/muammolar/ogohlantirishlar bor",
  { skip: hasDb ? false : "DATABASE_URL yo'q" },
  async () => {
    const res = await GET(req({ authorization: `Bearer ${process.env.CRON_SECRET}` }));
    const body = await res.json();
    assert.equal(res.status, 200);
    for (const k of ["problems", "warnings", "queue", "features", "db", "version", "uptimeSec"]) {
      assert.ok(k in body, `chuqur javobda "${k}" yo'q`);
    }
    assert.ok(Array.isArray(body.problems));
    assert.ok(Array.isArray(body.warnings));
  },
);

test(
  "/api/health: navbat chuqur SQL'i (OBS-12) — queued/running/oldestQueuedAgeSec/newestLockedAt haqiqiy qatorlardan",
  { skip: hasDb ? false : "DATABASE_URL yo'q" },
  async (t: TestContext) => {
    await migrate();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await queryOne<{ id: string }>(`INSERT INTO users (username) VALUES ($1) RETURNING id::text AS id`, [`health_${stamp}`]);
    const uid = String(user!.id);
    const queuedId = randomUUID();
    const runningId = randomUUID();

    t.after(async () => {
      await query(`DELETE FROM generations WHERE id = ANY($1::uuid[])`, [[queuedId, runningId]]).catch(() => {});
      await query(`DELETE FROM users WHERE id = $1`, [uid]).catch(() => {});
    });

    // Eskirgan QUEUED qator — "eng eski navbat yoshi" shuni ko'rsatishi kerak.
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, format, values_json, status, created_at)
       VALUES ($1, $2, 'referat', 'Sinov', 'docx', '{}'::jsonb, 'QUEUED', now() - interval '5 minutes')`,
      [queuedId, uid],
    );
    // Yangi IN_PROGRESS qator (heartbeat'ga o'xshab `locked_at` yangi).
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, format, values_json, status, locked_by, locked_at)
       VALUES ($1, $2, 'referat', 'Sinov', 'docx', '{}'::jsonb, 'IN_PROGRESS', 'test-worker', now())`,
      [runningId, uid],
    );

    const res = await GET(req({ authorization: `Bearer ${process.env.CRON_SECRET}` }));
    const body = await res.json();

    assert.ok(body.queue, "queue null bo'lmasligi kerak (DB sog'lom)");
    assert.ok(body.queue.queued >= 1, `queued >= 1 kutilgan edi, keldi: ${body.queue.queued}`);
    assert.ok(body.queue.running >= 1, `running >= 1 kutilgan edi, keldi: ${body.queue.running}`);
    // Bizning QUEUED qatorimiz ~5 daqiqalik — eng eskisi shundan KAM bo'lolmaydi
    // (boshqa, undan ham eskiroq qatorlar bo'lsa faqat OSHISHI mumkin).
    assert.ok(body.queue.oldestQueuedAgeSec >= 200, `oldestQueuedAgeSec >= 200 kutilgan edi, keldi: ${body.queue.oldestQueuedAgeSec}`);
    assert.ok(body.queue.newestLockedAt, "newestLockedAt bo'lishi kerak");
    const lockedAgeSec = (Date.now() - new Date(body.queue.newestLockedAt).getTime()) / 1000;
    assert.ok(lockedAgeSec < 120, `newestLockedAt juda eski (${lockedAgeSec}s) — yangi heartbeat'ni ko'rsatishi kerak edi`);
  },
);

test.after(async () => {
  if (hasDb) await pool().end();
});
