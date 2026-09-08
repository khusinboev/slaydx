import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { identityLines } from "../lib/generation/slide-prompt/identity.ts";
import { extensionLines } from "../lib/generation/slide-prompt/extensions.ts";
import { SLIDE_TEMPLATE_BY_ID } from "../lib/generation/slide-templates.ts";

/**
 * WP-H: kimlik va kengaytma prompt qatorlari.
 *
 * Testlar: `identityLines` (muallif, lavozim, tashkilot)
 * va `extensionLines` (test, ma'ruzachi izohi).
 * Mutatsiya sinovi kod ichida emas — koordinator kodni ataylab buzib, aynan shu testlar yiqilishini tasdiqlaydi (loyiha standarti).
 */

const pro = TOOL_BY_ID["pro-slide"];
const lecture = SLIDE_TEMPLATE_BY_ID.lecture;
const meta = (v: FormValues) => extractMeta(pro, { topic: "Suv aylanishi", ...v });
const ctx = {}; // Empty context for tests

// ───────────────────────────────────────────── identityLines: muallif, lavozim, tashkilot

test("identity: hammasi bo'lsa, uchta qator + umumiy ko'rsatma", () => {
  const m = meta({ author: "Alisher Navoiy", position: "Professor", organization: "TTÜ" });
  const lines = identityLines(m, lecture, ctx);
  assert.equal(lines.length, 4);
  assert.ok(lines[0].includes("MUALLIF: Alisher Navoiy"));
  assert.ok(lines[1].includes("LAVOZIM: Professor"));
  assert.ok(lines[2].includes("TASHKILOT: TTÜ"));
  assert.ok(lines[3].includes("Titul slaydining subtitle maydoniga"));
});

test("identity: faqat muallif", () => {
  const m = meta({ author: "Muhammad Xorazmiy" });
  const lines = identityLines(m, lecture, ctx);
  assert.equal(lines.length, 2); // muallif + umumiy ko'rsatma
  assert.ok(lines[0].includes("MUALLIF"));
  assert.ok(!lines.find((l) => l.includes("LAVOZIM")));
  assert.ok(!lines.find((l) => l.includes("TASHKILOT")));
});

test("identity: faqat lavozim", () => {
  const m = meta({ position: "O'qituvchi" });
  const lines = identityLines(m, lecture, ctx);
  assert.equal(lines.length, 2); // lavozim + umumiy ko'rsatma
  assert.ok(lines[0].includes("LAVOZIM: O'qituvchi"));
  assert.ok(!lines.find((l) => l.includes("MUALLIF")));
});

test("identity: faqat tashkilot (organization)", () => {
  const m = meta({ organization: "Toshkent Davlat Universiteti" });
  const lines = identityLines(m, lecture, ctx);
  assert.equal(lines.length, 2); // tashkilot + umumiy ko'rsatma
  assert.ok(lines[0].includes("TASHKILOT: Toshkent Davlat Universiteti"));
  assert.ok(!lines.find((l) => l.includes("MUALLIF")));
});

test("identity: faqat university (tashkilot havola qiladi)", () => {
  const m = meta({ university: "Fergona Politexnika" });
  const lines = identityLines(m, lecture, ctx);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes("TASHKILOT: Fergona Politexnika"));
});

test("identity: organization ustun oladi university ga", () => {
  const m = meta({ organization: "TATU", university: "FPU" });
  const lines = identityLines(m, lecture, ctx);
  assert.ok(lines.find((l) => l.includes("TASHKILOT: TATU")));
  assert.ok(!lines.find((l) => l.includes("FPU")));
});

test("identity: hammasi bo'sh — qatorlar yo'q", () => {
  const m = meta({});
  const lines = identityLines(m, lecture, ctx);
  assert.equal(lines.length, 0);
});

test("identity: muallif + lavozim + university", () => {
  const m = meta({ author: "Ibn Sino", position: "Tabib", university: "Shayx Bayozid" });
  const lines = identityLines(m, lecture, ctx);
  assert.equal(lines.length, 4);
  assert.ok(lines.some((l) => l.includes("MUALLIF")));
  assert.ok(lines.some((l) => l.includes("LAVOZIM")));
  assert.ok(lines.some((l) => l.includes("TASHKILOT: Shayx Bayozid")));
});

// ───────────────────────────────────────────── extensionLines: test va izohi

test("extensions: quizCount > 0 — NAZORAT TESTI qatori", () => {
  const m = meta({ quizCount: 5 });
  const lines = extensionLines(m, lecture, ctx).filter(Boolean);
  assert.ok(lines.some((l) => l.includes("NAZORAT TESTI: 5 ta savol")));
  assert.ok(lines.some((l) => l.includes("quiz layoutda")));
  assert.ok(lines.some((l) => l.includes("answer indeksiga")));
});

test("extensions: quizCount: 0 — NAZORAT TESTI yo'q", () => {
  const m = meta({ quizCount: 0 });
  const lines = extensionLines(m, lecture, ctx).filter(Boolean);
  assert.ok(!lines.some((l) => l.includes("NAZORAT TESTI")));
});

test("extensions: quizCount: 3 — uchta savol", () => {
  const m = meta({ quizCount: 3 });
  const lines = extensionLines(m, lecture, ctx).filter(Boolean);
  assert.ok(lines.some((l) => l.includes("3 ta savol")));
});

test("extensions: speakerNotes: false + quizCount: 3 — Javoblar qatori", () => {
  const m = meta({ speakerNotes: false, quizCount: 3 });
  const lines = extensionLines(m, lecture, ctx).filter(Boolean);
  assert.ok(lines.some((l) => l.includes("NAZORAT TESTI: 3 ta savol")));
  assert.ok(lines.some((l) => l.includes("Javoblar")));
  assert.ok(lines.some((l) => l.includes("answers layout")));
});

test("extensions: speakerNotes: true + quizCount: 3 — Javoblar qatori yo'q", () => {
  const m = meta({ speakerNotes: true, quizCount: 3 });
  const lines = extensionLines(m, lecture, ctx).filter(Boolean);
  assert.ok(lines.some((l) => l.includes("NAZORAT TESTI: 3 ta savol")));
  assert.ok(!lines.some((l) => l.includes("answers layout")));
});

test("extensions: quizCount: 0 + speakerNotes: false — Javoblar qatori yo'q (test yo'q)", () => {
  const m = meta({ speakerNotes: false, quizCount: 0 });
  const lines = extensionLines(m, lecture, ctx).filter(Boolean);
  assert.ok(!lines.some((l) => l.includes("answers layout")));
});

test("extensions: extra qatori saqlanadi", () => {
  const m = meta({ extra: "Rang-barang rasm qo'shing" });
  const lines = extensionLines(m, lecture, ctx).filter(Boolean);
  assert.ok(lines.some((l) => l.includes("Qo‘shimcha talab: ")));
  assert.ok(lines.some((l) => l.includes("Rang-barang rasm")));
});

// ───────────────────────────────────────────── mutatsiya testlari
