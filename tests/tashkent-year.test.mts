import test, { mock } from "node:test";
import assert from "node:assert/strict";

/**
 * TITUL YILI — Toshkent vaqti (UTC+5) bo'yicha.
 *
 * Server UTC da ishlaydi (Docker). 31-dekabr 19:00–24:00 UTC da
 * Toshkentda yangi yil boshlangan: o'sha paytda yaratilgan hujjat
 * titulida (DOCX `title-model.ts`, veb `render-html.ts`, `extractMeta`
 * muzlatadigan `meta.year`) YANGI yil turishi kerak. Jarayon vaqt
 * mintaqasi ataylab UTC ga qo'yiladi — ishlab chiquvchi noutbuki
 * Toshkentda bo'lsa ham test serverdagi holatni sinaydi.
 */
process.env.TZ = "UTC";

const { TOOL_BY_ID } = await import("../lib/tools.ts");
const { extractMeta } = await import("../lib/generation/meta.ts");
const { titleModel } = await import("../lib/generation/title-model.ts");
const { renderHtml } = await import("../lib/generation/render-html.ts");
const { tashkentYear } = await import("../lib/generation/tashkent-year.ts");
type FormValues = import("../lib/types.ts").FormValues;
type AcademicDoc = import("../lib/generation/types.ts").AcademicDoc;

const at = (iso: string) => mock.timers.enable({ apis: ["Date"], now: new Date(iso) });

test("tashkentYear: 31-dekabr 19:00 UTC dan boshlab yangi yil; undan oldin eski", () => {
  assert.equal(tashkentYear(new Date("2026-12-31T18:59:59Z")), 2026);
  assert.equal(tashkentYear(new Date("2026-12-31T19:00:00Z")), 2027);
  assert.equal(tashkentYear(new Date("2026-12-31T23:30:00Z")), 2027);
  assert.equal(tashkentYear(Date.parse("2027-06-01T00:00:00Z")), 2027);
});

test("extractMeta: 31-dekabr 20:00 UTC (Toshkentda 1-yanvar 01:00) — meta.year yangi yil", () => {
  at("2026-12-31T20:00:00Z");
  try {
    const meta = extractMeta(TOOL_BY_ID.referat, { topic: "Suv aylanishi" } as FormValues);
    assert.equal(meta.year, 2027);
  } finally {
    mock.timers.reset();
  }
  at("2026-12-31T18:00:00Z");
  try {
    assert.equal(extractMeta(TOOL_BY_ID.referat, { topic: "Suv aylanishi" } as FormValues).year, 2026);
  } finally {
    mock.timers.reset();
  }
});

test("titul (DOCX modeli va veb HTML): `meta.year` siz eski hujjat ham Toshkent yilini oladi", () => {
  const meta = extractMeta(TOOL_BY_ID.referat, { topic: "Suv aylanishi" } as FormValues);
  const doc: AcademicDoc = { meta: { ...meta, year: undefined as unknown as number }, titlePage: true, toc: false, sections: [] };
  at("2026-12-31T21:00:00Z");
  try {
    assert.match(titleModel(doc).cityYear, /2027/);
    assert.match(renderHtml(doc), /2027/);
    assert.ok(!/2026/.test(renderHtml(doc)), "eski yil chiqmasligi kerak");
  } finally {
    mock.timers.reset();
  }
});

test("veb titul `meta.year` ni o'qiydi (fayl bilan bir xil — «ko'rdim = oldim»)", () => {
  const meta = extractMeta(TOOL_BY_ID.referat, { topic: "Suv aylanishi" } as FormValues);
  const doc: AcademicDoc = { meta: { ...meta, year: 2024 }, titlePage: true, toc: false, sections: [] };
  assert.match(titleModel(doc).cityYear, /2024/);
  assert.match(renderHtml(doc), /2024/);
});
