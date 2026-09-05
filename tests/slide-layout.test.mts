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

test("forma standartlaridan slayd pastki qatoriga muallif yetib boradi", async () => {
  const { profileDefaults, TOOL_BY_ID } = await import("../lib/tools.ts");
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { fallbackSlides } = await import("../lib/generation/slide-write.ts");

  /*
   * AYNAN N-7 (Sprint 14). `SlideForm` o'z qiymatlarini noldan qurar va
   * profildan hech narsa olmasdi, `StandardForm` esa olardi. Natijada
   *
   *   const footer = [meta.author, meta.university].filter(Boolean).join(" · ")
   *
   * slayd yo'lida DOIM bo'sh satr berardi: himoya taqdimotida ham muallif
   * ismi ko'rinmasdi — ko'ruvchida ham, PPTX da ham.
   *
   * Sinov formadan slaydgacha bo'lgan BUTUN zanjirni bosib o'tadi:
   * profil → forma standartlari → `extractMeta` → deck.
   */
  const profile = {
    name: "Aliyev Ali",
    author: "Aliyev Ali — 3-kurs, 301-guruh",
    university: "Toshkent davlat universiteti",
    faculty: "Fizika",
    department: "Optika",
    subject: "Fizika",
    teacher: "Karimov B.",
    city: "Samarqand",
  };

  const values = { ...profileDefaults(profile), topic: "Fotosintez", quality: "standard" };
  const meta = extractMeta(TOOL_BY_ID.slide, values as never);

  // `parseAuthorLine` kurs va guruhni ajratadi — pastki qatorda faqat ism qoladi.
  assert.equal(meta.author, "Aliyev Ali");
  assert.equal(meta.university, "Toshkent davlat universiteti");
  assert.equal(meta.city, "Samarqand", "shahar ham profildan olinishi kerak");

  const slides = fallbackSlides(meta);
  const footers = slides.map((s) => s.footer ?? "");
  assert.ok(
    footers.every((f) => f.includes("Aliyev Ali")),
    `har slaydda muallif bo'lishi kerak, chiqdi: ${JSON.stringify(footers[0])}`,
  );
  assert.ok(
    footers.every((f) => f.includes("Toshkent davlat universiteti")),
    "pastki qatorda muassasa ham bo'lishi kerak",
  );

  // Profil bo'sh bo'lsa pastki qator ham bo'sh — bu kutilgan holat,
  // «F.I.Sh» kabi o'ylab topilgan qiymat qo'yilmaydi.
  const blank = extractMeta(TOOL_BY_ID.slide, {
    ...profileDefaults({}),
    topic: "Fotosintez",
  } as never);
  assert.equal(fallbackSlides(blank)[0].footer, "");
});

test("byudjet bosqichlar orasida oldindan taqsimlanadi", async () => {
  const { slideStageBudget } = await import("../lib/generation/slide-write.ts");

  /*
   * AYNAN N-2 (Sprint 14). Ilgari bosqichlar byudjetni bo'lishmasdi:
   * matn `writeSlidesWithLlm` da qat'iy 90 s × 4 chaqiruvgacha ishlar,
   * rasm esa «qolganini» olardi —
   *
   *   const budget = deadline ? Math.max(0, deadline - Date.now() - 12_000) : 60_000;
   *
   * Matn byudjetni yeb bo'lsa bu 0 berardi va `attachSlideImages`
   * BARCHA slaydni o'tkazib yuborardi: «sifatliroq rasm» deb 6 000–8 000
   * tanga to'langan premium deck rasmsiz chiqardi, hech qanday signalsiz.
   */
  const now = 1_000_000;
  const stage = slideStageBudget(now + 296_000, now);

  // Eng muhim shart: rasmga vaqt QOLISHI kafolatlanadi.
  assert.ok(stage.imageMs > 0, "rasm bosqichi hech qachon nolga tushmasligi kerak");
  assert.ok(stage.textMs > 0, "matn bosqichi ham nolga tushmasligi kerak");
  assert.ok(stage.assemblyMs > 0, "PPTX yig'ishga zaxira qolishi kerak");

  // Yig'indi umumiy byudjetdan oshmasligi kerak — aks holda deadline buziladi.
  assert.ok(
    stage.textMs + stage.imageMs + stage.assemblyMs <= 296_000,
    "bosqichlar yig'indisi umumiy byudjetdan oshmasligi kerak",
  );

  // Matn og'irroq (usiz deck umuman yo'q), lekin hammasini olmaydi.
  assert.ok(stage.textMs > stage.imageMs, "matn ulushi kattaroq bo'lishi kerak");
  assert.ok(stage.imageMs > 60_000, `16 slaydli deka rasmiga yetarli vaqt: ${stage.imageMs}ms`);

  // Juda kichik byudjetda ham taqsimot buzilmaydi va manfiyga tushmaydi.
  for (const total of [0, 5_000, 30_000, 90_000, 600_000]) {
    const st = slideStageBudget(now + total, now);
    assert.ok(st.textMs >= 0 && st.imageMs >= 0 && st.assemblyMs >= 0, `${total}: manfiy ulush yo'q`);
    assert.ok(st.textMs + st.imageMs + st.assemblyMs <= total, `${total}: yig'indi oshmasligi kerak`);
  }

  // Byudjetsiz chaqiruv (test/dev) ham ishlaydigan taqsimot beradi.
  const noDeadline = slideStageBudget(undefined, now);
  assert.ok(noDeadline.textMs > 0 && noDeadline.imageMs > 0);
});

test("slayd byudjeti paketga qarab o'sadi", async () => {
  const { budgetFor } = await import("../lib/generation/budget.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");

  const CAP = 900_000;
  const forQuality = (quality: string) =>
    budgetFor(TOOL_BY_ID.slide, { topic: "Fotosintez", quality } as never, CAP);

  /*
   * Ilgari slayd `FIXED` da qat'iy 180 000 edi: 10 slaydli standart paket
   * ham, 16 slaydli `premium_long` ham (3 000 va 8 000 tanga) bir xil vaqt
   * olardi — ya'ni qimmatroq paketda muvaffaqiyatsizlik ehtimoli yuqoriroq
   * edi, xuddi kurs ishidagi N-3 kabi.
   */
  const standard = forQuality("standard");
  const premium = forQuality("premium");
  const long = forQuality("long");
  const premiumLong = forQuality("premium_long");

  assert.ok(standard < premium, "12 slayd 10 slayddan ko'proq vaqt olishi kerak");
  assert.ok(premium < long, "14 slayd 12 slayddan ko'proq vaqt olishi kerak");
  assert.ok(long < premiumLong, "16 slayd 14 slayddan ko'proq vaqt olishi kerak");

  /*
   * Eng uzun deka matn VA rasm bosqichlariga yetadigan vaqt olishi kerak.
   * 16 slayd ikki bo'lakda yoziladi (~40 s har biri, qayta urinish bilan),
   * so'ng 14 tagacha rasm chiziladi.
   */
  assert.ok(premiumLong >= 280_000, `premium_long byudjeti: ${premiumLong}ms`);

  // Operatorning shifti hamon oxirgi so'z.
  assert.equal(budgetFor(TOOL_BY_ID.slide, { quality: "premium_long" } as never, 200_000), 200_000);
});

test("byudjet tugagan bo'lsa slayd yozuvchisi tarmoqqa chiqmaydi", async () => {
  const { writeSlidesWithLlm } = await import("../lib/generation/slide-write.ts");
  const { resolveSlideTemplate, expandBeats } = await import("../lib/generation/slide-templates.ts");
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");

  /*
   * `deadline` `writeSlidesWithLlm` ga UMUMAN yetib bormasdi (N-2): ichida
   * qat'iy `timeoutMs: 90_000` turardi. Byudjet allaqachon tugagan bo'lsa
   * ham u yana 4 tagacha 90 soniyalik chaqiruv qilar va `buildArtifact`
   * ning butun byudjetini yeb qo'yardi.
   *
   * Tekshiruv vaqt bilan emas, CHAQIRUV SONI bilan: sekin/tez mashinada
   * ham bir xil natija beradi.
   */
  const realFetch = globalThis.fetch;
  const savedGemini = process.env.GEMINI_API_KEY;
  const savedXai = process.env.XAI_API_KEY;
  let calls = 0;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    calls += 1;
    return realFetch(...args);
  }) as typeof fetch;
  // Kalit BOR — ya'ni `llmEnabled()` to'siq emas, to'siq byudjet bo'lishi kerak.
  process.env.GEMINI_API_KEY = "test-key-not-used";
  delete process.env.XAI_API_KEY;

  try {
    const meta = extractMeta(TOOL_BY_ID.slide, {
      topic: "Fotosintez",
      quality: "premium_long",
    } as never);
    const tpl = resolveSlideTemplate(meta.slideTemplate, meta.topic, meta.extra);
    const beats = expandBeats(tpl, 16);

    const out = await writeSlidesWithLlm(meta, tpl, beats, Date.now() - 1);

    assert.equal(calls, 0, `byudjet tugaganda tarmoqqa chiqilmasligi kerak, chiqdi: ${calls} marta`);
    assert.equal(out, null, "slayd chiqmasa `null` qaytishi kerak — worker kreditni qaytaradi");
  } finally {
    globalThis.fetch = realFetch;
    if (savedGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedGemini;
    if (savedXai !== undefined) process.env.XAI_API_KEY = savedXai;
  }
});
