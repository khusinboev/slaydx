import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

/**
 * Tahrir javoblari hujjatni IKKI MARTA yubormaydi (SCALE-12 qolgan qismi).
 *
 * `PATCH …/doc`, rasm/surat yuklash, «Asl holat», AI qayta yozish va
 * sayqal javobidagi `generation` — `GET /api/generations/{id}` bilan bir
 * shakl. `doc` bor qatorda `html` (butun HTML nusxa, ~200–300 KB) klientga
 * kerak emas: ko'ruvchi `doc` dan chizadi (`ArtifactViewer`
 * `gen.doc ?? academicDocFromHtml(gen.html)`, `ResultView` `g.html ?? ""`).
 * Poll javobi buni allaqachon `lean` bilan qiladi — tahrir javoblari ham.
 *
 * Bazadagi `html` ustuni esa YOZILADI (ro'yxat/eksport uchun) — faqat
 * javobdan tushadi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "Postgres kerak (DATABASE_URL)";

const { query, queryOne, pool } = await import("../lib/server/db.ts");
const { toJsonb } = await import("../lib/server/jsonb.ts");
const { commitDocOps, restoreDoc } = await import("../lib/server/slide-commit.ts");
const { commitPolishedDoc } = await import("../lib/server/doc-polish.ts");
const { extractMeta } = await import("../lib/generation/meta.ts");
const { TOOL_BY_ID } = await import("../lib/tools.ts");

const users: string[] = [];

after(async () => {
  if (!hasDb) return;
  for (const id of users) await query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
  await pool().end();
});

async function newUser(): Promise<string> {
  const row = await queryOne<{ id: string }>(`INSERT INTO users (username) VALUES ($1) RETURNING id::text AS id`, [
    `w4e_l_${randomBytes(6).toString("hex")}`,
  ]);
  users.push(row!.id);
  return row!.id;
}

function slideDoc() {
  const meta = extractMeta(TOOL_BY_ID.slide, { topic: "Suv aylanishi", slideTemplate: "lecture" } as never);
  return {
    meta,
    titlePage: true,
    toc: true,
    sections: [],
    slideTemplate: "lecture",
    slides: [
      { id: "s0", layout: "title", title: "Suv aylanishi", subtitle: "Kirish" },
      { id: "s1", layout: "bullets", title: "Bandlar", bullets: ["Bir.", "Ikki."] },
    ],
  };
}

async function newGeneration(uid: string): Promise<string> {
  const gid = randomUUID();
  await query(
    `INSERT INTO generations (id, user_id, tool_id, topic, status, finished_at, doc_json, html, doc_version, file_version, file_name)
     VALUES ($1, $2, 'slide', 'Sinov', 'COMPLETED', now(), $3, '<p>eski</p>', 0, 0, 'deka.pptx')`,
    [gid, uid, toJsonb(slideDoc())],
  );
  return gid;
}

const titleOp = [{ op: "text", index: 1, src: { f: "title" }, value: "Yangi sarlavha" }];

test("commitDocOps / restoreDoc javobi: `doc` bor — `html` YUBORILMAYDI, bazada esa yoziladi (SCALE-12)", { skip }, async () => {
  const uid = await newUser();
  const gid = await newGeneration(uid);

  const gen = await commitDocOps(gid, uid, 0, titleOp as never);
  assert.ok(gen.doc, "doc javobda bo'lishi kerak");
  assert.equal(gen.docVersion, 1);
  assert.equal(gen.html, null, "MUTATSIYA: tahrir javobi hujjatni ikki marta yubordi (html)");
  const stored = await queryOne<{ html: string }>(`SELECT html FROM generations WHERE id = $1`, [gid]);
  assert.ok(stored!.html.length > 0 && stored!.html !== "<p>eski</p>", "bazadagi html yangilanishi kerak");

  const restored = await restoreDoc(gid, uid);
  assert.ok(restored.doc);
  assert.equal(restored.html, null);
});

test("commitPolishedDoc javobi (o'yin/plakat sayqali): `html` YUBORILMAYDI", { skip }, async () => {
  const uid = await newUser();
  const gid = await newGeneration(uid);
  const gen = await commitPolishedDoc(gid, uid, 0, slideDoc() as never, "<p>yangi</p>", null);
  assert.ok(gen.doc);
  assert.equal(gen.html, null, "MUTATSIYA: sayqal javobi hujjatni ikki marta yubordi (html)");
  const stored = await queryOne<{ html: string }>(`SELECT html FROM generations WHERE id = $1`, [gid]);
  assert.equal(stored!.html, "<p>yangi</p>");
});
