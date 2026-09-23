import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * C07 — bazali qismlar (vaqtinchalik Postgres):
 *   - `?format=pdf` foydalanuvchi bo'yicha limit (10 / 10 daqiqa) → 429 + Retry-After;
 *   - eskiz faqat TAYYOR (`COMPLETED`) generatsiya faylidan yasaladi (W1-C R3).
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test("C07 bazali", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { handler } = await import("../lib/server/api.ts");
  const { putGenerationFile } = await import("../lib/server/storage.ts");
  const { pdfResponse } = await import("../lib/server/pdf-serve.ts");
  const { PdfDiskCache } = await import("../lib/server/pdf-cache.ts");
  const { getOrBuildThumb } = await import("../lib/server/thumb.ts");

  await migrate();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rows = await query<{ id: string }>(
    `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 0) RETURNING id`,
    [`test-c07-${stamp}`],
  );
  const user = String(rows[0].id);
  const cacheDir = await mkdtemp(join(tmpdir(), "slaydx-c07-"));

  t.after(async () => {
    await query("DELETE FROM generations WHERE user_id = $1", [user]);
    await query("DELETE FROM rate_limits WHERE bucket LIKE $1", [`%:${user}`]);
    await query("DELETE FROM users WHERE id = $1", [user]);
    await rm(cacheDir, { recursive: true, force: true });
    await pool().end();
  });

  const mkGeneration = async (status: string): Promise<string> => {
    const id = randomUUID();
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, price, format, values_json, step, budget_ms, status, expires_at)
       VALUES ($1, $2, 'essay', 'Sinov', 100, 'docx', '{}'::jsonb, 'x', 90000, $3, now() + interval '1 day')`,
      [id, user, status],
    );
    await putGenerationFile(id, { bytes: new Uint8Array([1, 2, 3, 4]), mime: DOCX_MIME, fileName: "sinov.docx" });
    return id;
  };

  await t.test("?format=pdf: 11-chi o'girish 10 daqiqa ichida — 429 + Retry-After", async () => {
    const cache = new PdfDiskCache({ dir: cacheDir, maxBytes: 1024 * 1024, maxAgeMs: 60_000 });
    let converted = 0;
    const convert = async () => {
      converted += 1;
      return Buffer.from("%PDF-1.4 stub");
    };
    const gen = randomUUID();
    const route = handler("test/pdf", async (_req: Request, n: number) =>
      pdfResponse(
        // Har chaqiruvda boshqa bayt — kesh urilmaydi, har biri haqiqiy o'girish.
        { userId: user, generationId: gen, file: { bytes: Buffer.from([n, 7, 7]), fileName: "a.docx", mime: DOCX_MIME }, inline: false },
        { available: () => true, convert, cache },
      ),
    );
    const req = new Request("http://x/api/generations/x/file?format=pdf");
    for (let i = 1; i <= 10; i++) {
      const res = await route(req, i);
      assert.equal(res.status, 200, `${i}-chi so'rov o'tishi kerak`);
    }
    const res = await route(req, 11);
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get("retry-after")) > 0, "Retry-After sarlavhasi");
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /so'rov/);
    assert.equal(converted, 10, "limitdan oshgan so'rov soffice ga yetmaydi");
    // Keshdagi fayl limitdan tashqari ham beriladi (o'girish yo'q).
    const cached = await route(req, 3);
    assert.equal(cached.status, 200);
  });

  await t.test("eskiz: COMPLETED bo'lmagan generatsiyadan yasalmaydi", async () => {
    let built = 0;
    const deps = {
      available: () => true,
      build: async () => {
        built += 1;
        return Buffer.from([0xff, 0xd8, 0xff]);
      },
    };
    for (const status of ["IN_PROGRESS", "FAILED", "QUEUED"]) {
      const id = await mkGeneration(status);
      assert.equal(await getOrBuildThumb(id, user, deps), null, `${status} — eskiz yo'q`);
    }
    assert.equal(built, 0, "tayyor bo'lmagan fayl LibreOffice ga yuborilmaydi");
    const done = await mkGeneration("COMPLETED");
    assert.ok(await getOrBuildThumb(done, user, deps));
    assert.equal(built, 1);
  });
});
