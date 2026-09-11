import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { AcademicDoc } from "../lib/generation/types.ts";
import type { ArticleModel, Figure } from "../lib/generation/article/types.ts";

/**
 * `extractAssets` — maqola sxemalari (Maqola 2 / AUDIT-17, WP4).
 *
 * `Figure.url` generatsiyada `data:image/png;base64,…` (`figures/png.ts`,
 * WP3) — bu yerda faqat `extractAssets` sof mantig'i sinaladi: URL
 * aktivga almashadi, `assetId` to'ladi, bir xil bayt bitta aktivga
 * tushadi. Oxirgi test (DB) `assetImageResolver` shu URL dan bayt
 * qaytarishini tasdiqlaydi — DOCX qayta render (tahrirdan keyin) uchun
 * MUHIM yo'l.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { extractAssets, assetUrl, putAssets, assetImageResolver } = await import("../lib/server/assets.ts");

/** 8 baytlik PNG sarlavha + to'ldiruvchi (`sniffImageType` shuni tekshiradi). */
function pngDataUrl(byte = 0x01): string {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const body = Buffer.concat([sig, Buffer.alloc(16, byte)]);
  return `data:image/png;base64,${body.toString("base64")}`;
}

function figure(id: string, url?: string): Figure {
  return { id, kind: "scheme", caption: `Sxema ${id}`, spec: { kind: "process", steps: ["a", "b"] }, url, w: 100, h: 100 };
}

function articleModel(figures: Figure[]): ArticleModel {
  return { v: 1, type: "imrad_oak", profile: "oak", cite: "gost", authors: [], keywords: {}, references: [], figures, language: "uz" };
}

function docWith(figures: Figure[]): AcademicDoc {
  return { meta: {}, sections: [], article: articleModel(figures) } as unknown as AcademicDoc;
}

test("extractAssets: figure data: → aktiv, url almashadi, assetId to'ladi", () => {
  const doc = docWith([figure("f1", pngDataUrl())]);
  const { doc: next, assets } = extractAssets("gen1", doc, "");
  assert.equal(assets.length, 1);
  assert.equal(assets[0].mime, "image/png");
  const fig = next?.article?.figures[0];
  assert.equal(fig?.url, assetUrl("gen1", assets[0].assetId));
  assert.equal(fig?.assetId, assets[0].assetId);
});

test("extractAssets: url yo'q figure (fallback ro'yxatga tushgan) o'zgarishsiz qoladi", () => {
  const doc = docWith([figure("f1", undefined)]);
  const { doc: next, assets } = extractAssets("gen1", doc, "");
  assert.equal(assets.length, 0);
  assert.equal(next?.article?.figures[0].url, undefined);
  assert.equal(next?.article?.figures[0].assetId, undefined);
});

test("extractAssets: article yo'q hujjatda article maydoni o'zgarishsiz (regressiya)", () => {
  const doc = { meta: {}, sections: [] } as unknown as AcademicDoc;
  const { doc: next, assets } = extractAssets("gen1", doc, "");
  assert.equal(next?.article, undefined);
  assert.equal(assets.length, 0);
});

test("extractAssets: bir xil rasm ikki sxemada — bitta aktiv (SHA-256)", () => {
  const url = pngDataUrl(7);
  const doc = docWith([figure("f1", url), figure("f2", url)]);
  const { doc: next, assets } = extractAssets("gen1", doc, "");
  assert.equal(assets.length, 1, "bir xil bayt — bitta aktiv");
  assert.equal(next?.article?.figures[0].assetId, next?.article?.figures[1].assetId);
});

test("extractAssets: ikki xil rasm — ikkita aktiv, har figure O'Z assetId sini oladi", () => {
  const doc = docWith([figure("f1", pngDataUrl(1)), figure("f2", pngDataUrl(2))]);
  const { doc: next, assets } = extractAssets("gen1", doc, "");
  assert.equal(assets.length, 2);
  assert.notEqual(next?.article?.figures[0].assetId, next?.article?.figures[1].assetId);
});

test(
  "assetImageResolver: aktivga aylangan figure baytni qaytaradi (DOCX qayta render yo'li)",
  { skip: hasDb ? false : "DATABASE_URL yo'q" },
  async (t: TestContext) => {
    const { query, queryOne, pool, migrate } = await import("../lib/server/db.ts");
    await migrate();
    const { randomUUID } = await import("node:crypto");

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await queryOne<{ id: string }>(
      `INSERT INTO users (username) VALUES ($1) RETURNING id::text AS id`,
      [`assets_article_${stamp}`],
    );
    const uid = String(user!.id);
    const gid = randomUUID();

    t.after(async () => {
      await query(`DELETE FROM generation_assets WHERE generation_id = $1`, [gid]).catch(() => {});
      await query(`DELETE FROM generations WHERE id = $1`, [gid]).catch(() => {});
      await query(`DELETE FROM users WHERE id = $1`, [uid]).catch(() => {});
      await pool().end();
    });

    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, price, format, values_json, step, budget_ms, status)
       VALUES ($1, $2, 'article', 'Sinov', 4000, 'docx', '{}'::jsonb, 'Tayyor', 90000, 'COMPLETED')`,
      [gid, uid],
    );

    const doc = docWith([figure("f1", pngDataUrl(9))]);
    const { doc: next, assets } = extractAssets(gid, doc, "");
    await putAssets(gid, assets);

    const resolve = assetImageResolver(gid, uid);
    const url = next!.article!.figures[0].url!;
    const bytes = await resolve(url);
    assert.ok(bytes, "resolver bayt qaytarishi kerak");
    assert.equal(bytes?.type, "png");

    // Egalik: begona foydalanuvchi shu URL orqali bayt ololmaydi.
    const stranger = await queryOne<{ id: string }>(
      `INSERT INTO users (username) VALUES ($1) RETURNING id::text AS id`,
      [`assets_article_stranger_${stamp}`],
    );
    const strangerId = String(stranger!.id);
    t.after(async () => {
      await query(`DELETE FROM users WHERE id = $1`, [strangerId]).catch(() => {});
    });
    const strangerResolve = assetImageResolver(gid, strangerId);
    assert.equal(await strangerResolve(url), null, "begona foydalanuvchi o'qiy olmasligi kerak");
  },
);
