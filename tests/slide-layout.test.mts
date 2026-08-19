import test from "node:test";
import assert from "node:assert/strict";
import { planSlide, type SlideLayer } from "../lib/generation/slide-layout.ts";
import { getSlideTheme } from "../lib/generation/slide-themes.ts";
import { coerceLayout } from "../lib/generation/slide-write.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";

/**
 * Slayd chizmasi — Slide Law ning kod darajasidagi ifodasi.
 *
 * Bu yerdagi tekshiruvlar aynan Sprint 1 da tuzatilgan nuqsonlarni
 * qulflaydi: matn qutidan chiqib ketmasin, jarayon oqim bo'lib ko'rinsin,
 * raqamlar diagrammaga aylansin, model kontenti yo'qolmasin.
 */

const theme = getSlideTheme("atlas");
const plan = (s: SlideModel) => planSlide(s, theme, "classic", 1, 10);
const texts = (ls: SlideLayer[]) => ls.filter((l): l is Extract<SlideLayer, { t: "text" }> => l.t === "text");
const rects = (ls: SlideLayer[]) => ls.filter((l) => l.t === "rect");

// ------------------------------------------------------------ sig'dirish

test("Slide Law hajmidagi bandlar to'liq 18 pt da qoladi", () => {
  // 4 ta band × 120 belgi — `MAX_BULLETS` va `MAX_BULLET_CHARS` chegarasi.
  // Aynan shu hajm proyektor uchun mo'ljallangan va kichraytirilmasligi kerak.
  const size = texts(
    plan({
      id: "a",
      layout: "bullets",
      title: "Sarlavha",
      bullets: Array.from({ length: 4 }, () => "a".repeat(120)),
    }).layers,
  ).find((t) => t.lines)?.size;
  assert.equal(size, 18);
});

test("chegaradan oshgan matn kichrayadi, lekin 15 pt dan pastga tushmaydi", () => {
  const sizeOf = (chars: number) =>
    texts(
      plan({
        id: "b",
        layout: "bullets",
        title: "Sarlavha",
        bullets: Array.from({ length: 4 }, () => "a".repeat(chars)),
      }).layers,
    ).find((t) => t.lines)?.size ?? 0;

  const heavy = sizeOf(300);
  const extreme = sizeOf(900);
  assert.ok(heavy < 18, `og'ir matn kichrayishi kerak: ${heavy}`);
  assert.ok(heavy > 15, `o'rtacha og'irlikda pol urilmasin: ${heavy}`);
  assert.equal(extreme, 15, "haddan tashqari matnda pol 15 pt");
});

test("hech bir qatlam slayd chegarasidan chiqmaydi", () => {
  const samples: SlideModel[] = [
    { id: "1", layout: "title", title: "Uzun sarlavha ".repeat(4), kicker: "Fan", subtitle: "Izoh" },
    { id: "2", layout: "agenda", title: "Reja", bullets: ["a", "b", "c", "d", "e"] },
    { id: "3", layout: "compare", title: "Qiyos", leftTitle: "A", left: ["x", "y"], rightTitle: "B", right: ["z"] },
    { id: "4", layout: "quote", title: "Iqtibos", quote: "Uzun iqtibos matni ".repeat(6) },
    { id: "5", layout: "process", title: "Oqim", steps: [1, 2, 3, 4, 5].map((n) => ({ n: `${n}`, title: `B${n}`, text: "Izoh" })) },
  ];
  for (const s of samples) {
    for (const l of plan(s).layers) {
      assert.ok(l.box.x >= -0.01 && l.box.y >= -0.01, `${s.layout}: manfiy koordinata`);
      assert.ok(l.box.x + l.box.w <= 13.34, `${s.layout}: kenglikdan chiqdi`);
      assert.ok(l.box.y + l.box.h <= 7.51, `${s.layout}: balandlikdan chiqdi`);
    }
  }
});

// -------------------------------------------------------------- process

test("5 bosqich ikki qatorga bo'linadi va o'qlar qo'yiladi", () => {
  const p = plan({
    id: "p",
    layout: "process",
    title: "Bosqichlar",
    steps: [1, 2, 3, 4, 5].map((n) => ({ n: String(n), title: `Bosqich ${n}`, text: "Izoh" })),
  });
  const cardYs = new Set(rects(p.layers).map((l) => Number(l.box.y.toFixed(2))));
  assert.ok(cardYs.size >= 2, "kartalar ikki qatorda bo'lishi kerak");
  assert.equal(texts(p.layers).filter((t) => t.text === "→").length, 3, "3+2 taqsimotda 3 ta o'q");
});

test("3 bosqich bitta qatorda qoladi", () => {
  const p = plan({
    id: "p",
    layout: "process",
    title: "Bosqichlar",
    steps: [1, 2, 3].map((n) => ({ n: String(n), title: `B${n}`, text: "Izoh" })),
  });
  assert.equal(texts(p.layers).filter((t) => t.text === "→").length, 2);
});

// ---------------------------------------------------------------- stats

test("o'qib bo'ladigan raqamlar diagrammaga aylanadi", () => {
  const chart = plan({
    id: "s",
    layout: "stats",
    title: "Natijalar",
    stats: [
      { value: "95%", label: "O'zlashtirish" },
      { value: "72%", label: "Faollik" },
      { value: "48%", label: "Mustaqil ish" },
    ],
  });
  assert.ok(rects(chart.layers).length >= 6, "ustunlar chizilmadi");
  assert.equal(texts(chart.layers).filter((t) => t.size === 30).length, 0, "katta karta raqami qolmasligi kerak");
});

test("formula yoki matn qiymat karta ko'rinishida qoladi", () => {
  const cards = plan({
    id: "s",
    layout: "stats",
    title: "Moddalar",
    stats: [
      { value: "C6H12O6", label: "Glyukoza" },
      { value: "O2", label: "Kislorod" },
      { value: "H2O", label: "Suv" },
    ],
  });
  assert.ok(texts(cards.layers).some((t) => t.size === 30), "karta ko'rinishi kutilgan edi");
});

// ------------------------------------------------------- layout coerce

test("shablon layouti kontentni yo'qotmaydi", () => {
  const bullets: SlideModel = { id: "x", layout: "bullets", title: "T", bullets: ["Birinchi band", "Ikkinchi band"] };

  const two = coerceLayout(bullets, "twoCol");
  assert.equal(two.layout, "twoCol");
  assert.deepEqual([...(two.left ?? []), ...(two.right ?? [])], bullets.bullets);

  const proc = coerceLayout(bullets, "process");
  assert.equal(proc.layout, "process");
  assert.equal(proc.steps?.length, 2);

  assert.equal(coerceLayout(bullets, "quote").quote, "Birinchi band");
});

test("stats ga o'girish uydirma raqam yaratmaydi", () => {
  const bullets: SlideModel = { id: "x", layout: "bullets", title: "T", bullets: ["Bir", "Ikki", "Uch"] };
  const forced = coerceLayout(bullets, "stats");
  assert.equal(forced.layout, "bullets", "raqamsiz slayd stats bo'lmasligi kerak");
  assert.equal(forced.stats, undefined);

  const real: SlideModel = { id: "y", layout: "bullets", title: "T", stats: [{ value: "5", label: "a" }] };
  assert.equal(coerceLayout(real, "stats").layout, "stats");
});

// ---------------------------------------------------------------- table

test("jadval sarlavha va qatorlari bilan chiziladi", () => {
  const p = plan({
    id: "t",
    layout: "table",
    title: "Qiyos",
    table: {
      headers: ["Mezon", "A", "B"],
      rows: [
        ["Samaradorlik", "Yuqori", "O'rta"],
        ["Og'irlik", "Katta", "Kichik"],
      ],
    },
  });
  const shown = texts(p.layers).map((t) => t.text);
  for (const cell of ["Mezon", "A", "B", "Samaradorlik", "Yuqori", "Kichik"]) {
    assert.ok(shown.includes(cell), `«${cell}» chizilmadi`);
  }
  for (const l of p.layers) {
    assert.ok(l.box.x + l.box.w <= 13.34 && l.box.y + l.box.h <= 7.51, "jadval chegaradan chiqdi");
  }
});

test("jadvalga o'girish uydirma ustun yaratmaydi", () => {
  const bullets: SlideModel = { id: "x", layout: "bullets", title: "T", bullets: ["Bir", "Ikki"] };
  assert.equal(coerceLayout(bullets, "table").layout, "bullets");

  const real: SlideModel = {
    id: "y",
    layout: "bullets",
    title: "T",
    table: { headers: ["A", "B"], rows: [["1", "2"]] },
  };
  assert.equal(coerceLayout(real, "table").layout, "table");
});

test("jadval eslatmasi qatorlarni o'z ichiga oladi", async () => {
  const { slideNotes } = await import("../lib/generation/slide-layout.ts");
  const notes = slideNotes({
    id: "t",
    layout: "table",
    title: "Qiyos",
    table: { headers: ["Mezon", "A"], rows: [["Narx", "Past"]] },
  });
  assert.match(notes, /Mezon/);
  assert.match(notes, /Narx/);
});
