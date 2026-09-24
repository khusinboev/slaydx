import test from "node:test";
import assert from "node:assert/strict";

/**
 * O'yin natijalari CSV — «Sana» Toshkent vaqtida (BEA-14).
 *
 * Server UTC da ishlaydi: ilgari o'qituvchi Excel da `2026-09-23T04:12:00.000Z`
 * ni (5 soat orqada, matn sifatida, saralanmaydigan) ko'rardi. Endi
 * `YYYY-MM-DD HH:mm` Toshkent vaqtida (UTC+5, yozgi vaqt yo'q) — Excel uni
 * sana-vaqt katagi deb taniydi. JSON ko'rinish (`createdAt`) o'zgarmaydi:
 * brauzer uni o'zi mahalliy vaqtga o'giradi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { csvRowLine, tashkentDateTime } = await import("../app/api/generations/[id]/results/route.ts");

const row = (createdAt: string) => ({ id: "r1", playerName: "Ali", score: 7, total: 10, seconds: 63, answers: {}, createdAt });

test("CSV «Sana»: UTC instant → Toshkent `YYYY-MM-DD HH:mm`", () => {
  assert.equal(tashkentDateTime("2026-09-23T04:12:00.000Z"), "2026-09-23 09:12");
  // Yil/kun almashinuvi — 31-dekabr 19:30 UTC Toshkentda allaqachon yangi yil.
  assert.equal(tashkentDateTime("2026-12-31T19:30:59.999Z"), "2027-01-01 00:30");
  assert.equal(tashkentDateTime("2026-03-01T18:59:00Z"), "2026-03-01 23:59");
  const line = csvRowLine(row("2026-09-23T04:12:00.000Z"));
  assert.match(line, /"2026-09-23 09:12"\r\n$/, "MUTATSIYA: CSV da hali UTC ISO satri");
  assert.ok(!line.includes("T04:12"), "UTC vaqti CSV ga tushmasin");
});

test("CSV «Sana»: yaroqsiz qiymat — o'zgarmasdan (eksport yiqilmaydi)", () => {
  assert.equal(tashkentDateTime("emas"), "emas");
  assert.equal(tashkentDateTime(""), "");
});
