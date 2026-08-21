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

/**
 * Rasm byudjeti deka uzunligiga ergashadi.
 *
 * Nuqson: `premium` cheklovi 10 edi va 16 slaydli premium dekada rasm
 * ko'tara oladigan slaydlar soni ham aynan 10 chiqardi — cheklov
 * chegaraga tegib turardi, ya'ni shablon mixi ozgina o'zgarsa rasm jim
 * yo'qola boshlardi.
 */
test("rasm byudjeti deka uzayganda o'sadi va sun'iy shift qo'ymaydi", async () => {
  const { imageBudget } = await import("../lib/generation/slide-images.ts");

  // Qisqa dekada eski quyi chegara saqlanadi.
  assert.equal(imageBudget(10, false), 8);
  assert.equal(imageBudget(10, true), 10);

  // Uzun dekada byudjet 0.8 zichlikka ergashadi.
  assert.equal(imageBudget(16, true), 13);
  assert.equal(imageBudget(20, true), 16);
  assert.equal(imageBudget(14, false), 12);

  // 16 slaydli premium dekada mos slot 10 ta — byudjet undan KATTA
  // bo'lishi kerak, aks holda cheklovning o'zi bog'lovchi bo'lib qoladi.
  assert.ok(imageBudget(16, true) > 10);

  // Buzuq kirish yiqilmaydi.
  assert.equal(imageBudget(0, false), 8);
  assert.equal(imageBudget(-5, true), 10);
});

/**
 * Slayd `id` lari noyob bo'lishi shart.
 *
 * Nuqson: `normalizeSlide` indeksni BO'LAK ichidan olardi, ya'ni har
 * bo'lak `s0` dan qayta boshlardi. 16 slaydli deka ikki bo'lakdan
 * yig'iladi va `s0…s7` ikki marta chiqardi. Oqibati uchta edi: React
 * ko'ruvchida 24 ta «same key» xatosi, ko'ruvchining noto'g'ri slayd
 * ko'rsatish ehtimoli, va — eng jiddiyi — `slide-images.ts` rasm
 * promptini `prompts[s.id]` bo'yicha izlagani uchun dekaning ikkinchi
 * yarmi birinchi yarmining rasmini olardi.
 */
test("bo'laklardan yig'ilgan deka id lari qayta raqamlanadi", async () => {
  const { renumberSlides } = await import("../lib/generation/slide-write.ts");

  // Ikki bo'lakdan yig'ilgan 16 slaydli deka: har bo'lak `s0` dan boshlagan.
  const chunked = Array.from({ length: 16 }, (_, i) => ({
    id: `s${i % 8}`,
    layout: "bullets" as const,
    title: `Slayd ${i + 1}`,
  }));
  const ids = chunked.map((s) => s.id);
  assert.notEqual(new Set(ids).size, ids.length, "sinov ma'lumoti takroriy bo'lishi kerak");

  const fixed = renumberSlides(chunked);
  const out = fixed.map((s) => s.id);
  assert.equal(new Set(out).size, 16, "id lar noyob bo'lishi kerak");
  assert.deepEqual(out, Array.from({ length: 16 }, (_, i) => `s${i}`));
  // Mazmun tegilmaydi — faqat id.
  assert.deepEqual(fixed.map((s) => s.title), chunked.map((s) => s.title));

  // Allaqachon to'g'ri bo'lsa yangi obyekt yaratilmaydi.
  const ok = [{ id: "s0", layout: "title" as const, title: "A" }];
  assert.equal(renumberSlides(ok)[0], ok[0]);
});

test("deka slaydlarining id lari noyob va tartibli", async () => {
  const { buildSlideAcademicDoc } = await import("../lib/generation/slide-write.ts");
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");

  // LLM kalitisiz `fallbackSlides` yo'li ishlaydi — id mantig'i o'sha.
  const saved = process.env.GEMINI_API_KEY;
  const savedX = process.env.XAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.XAI_API_KEY;
  try {
    for (const quality of ["standard", "premium_long"]) {
      const meta = extractMeta(TOOL_BY_ID["slide"], {
        topic: "Fotosintez jarayoni",
        quality,
      } as never);
      const doc = await buildSlideAcademicDoc(meta, Date.now() + 20_000);
      const ids = doc.slides!.map((s) => s.id);

      assert.equal(new Set(ids).size, ids.length, `${quality}: id lar takrorlanmasligi kerak — ${ids.join(",")}`);
      assert.deepEqual(ids, ids.map((_, i) => `s${i}`), `${quality}: id lar tartibda bo'lishi kerak`);
    }
  } finally {
    if (saved) process.env.GEMINI_API_KEY = saved;
    if (savedX) process.env.XAI_API_KEY = savedX;
  }
});
