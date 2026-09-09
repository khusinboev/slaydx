import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { planSlide, type SlideLayer } from "../lib/generation/slide-layout.ts";
import { getSlideTheme } from "../lib/generation/slide-themes.ts";
import { SLIDE_LAYOUTS, type SlideLayout, type SlideModel, type SlideSrc } from "../lib/generation/slide-types.ts";

/**
 * E1: `SlideLayer.src`/`srcLines` — `planSlide` matn qatlamlariga
 * "bu matn modelning qaysi maydonidan chizilgan" ko'rsatkichini qo'shadi
 * (ko'ruvchida joyida tahrirlash uchun, E3/E6). Bu test PPTX'ga TA'SIR
 * QILMAYDI — faqat qatlam metama'lumoti tekshiriladi.
 *
 * `readSlideField`ni E3 yozadi (`slide-edit.ts`) — bu yerda faqat shu
 * testga xizmat qiladigan KICHIK yordamchi (`readField`) yozilgan, u
 * modeldan src ko'rsatgan matnni "aynan qanday chizilgan" mantiqni
 * TAKRORLAYDI (`— ` prefiksi, `s.quote || s.title` zaxirasi) — aks holda
 * test o'zi ham noto'g'ri kutish yozardi.
 */

const theme = getSlideTheme("atlas");

// Spec: "6 visual" — `lab` chiqarib tashlanadi, u faqat `bullets`ning
// o'ziga xos tarmog'i (`planLabRows`) va boshqa maketlarga umuman
// ta'sir qilmaydi (`classic`dan farqi yo'q boshqa layout'larda).
const VISUALS = ["classic", "hero-split", "cards", "timeline", "magazine", "dense"] as const;

const EXCLUDED: SlideLayout[] = ["quiz", "references", "answers"]; // E2 ega

const SAMPLES: Partial<Record<SlideLayout, SlideModel>> = {
  title: {
    id: "s-title",
    layout: "title",
    kicker: "Bo'lim nomi",
    title: "Fotosintez jarayoni va uning bosqichlari",
    subtitle: "10-sinf biologiya darsi uchun tayyorlangan taqdimot",
  },
  agenda: {
    id: "s-agenda",
    layout: "agenda",
    title: "Reja",
    bullets: ["Kirish va maqsad", "Asosiy tushunchalar", "Amaliy misollar", "Xulosa va savollar"],
  },
  section: {
    id: "s-section",
    layout: "section",
    title: "Ikkinchi bo'lim: amaliyot",
    subtitle: "Nazariyadan amaliyotga o'tish",
  },
  bullets: {
    id: "s-bullets",
    layout: "bullets",
    title: "Asosiy tushunchalar",
    bullets: ["Birinchi band matni bu yerda", "Ikkinchi band ancha uzunroq bo'lishi mumkin", "Uchinchi band", "To'rtinchi va oxirgi band"],
  },
  twoCol: {
    id: "s-twoCol",
    layout: "twoCol",
    title: "Ikki tomonlama ko'rinish",
    leftTitle: "Chap ustun sarlavhasi",
    left: ["Chap band 1", "Chap band 2", "Chap band 3"],
    rightTitle: "O'ng ustun sarlavhasi",
    right: ["O'ng band 1", "O'ng band 2", "O'ng band 3"],
  },
  compare: {
    id: "s-compare",
    layout: "compare",
    title: "Qiyosiy tahlil",
    leftTitle: "Variant A",
    left: ["A xususiyat 1", "A xususiyat 2"],
    rightTitle: "Variant B",
    right: ["B xususiyat 1", "B xususiyat 2", "B xususiyat 3"],
  },
  quote: {
    id: "s-quote",
    layout: "quote",
    title: "Zaxira sarlavha (quote bo'lmasa)",
    quote: "Bilim — kuchdir, lekin uni qo'llash undan-da muhimroqdir.",
    quoteBy: "Frensis Bekon",
  },
  stats: {
    id: "s-stats",
    layout: "stats",
    title: "Natijalar diagrammada",
    stats: [
      { value: "45%", label: "Birinchi ko'rsatkich" },
      { value: "72%", label: "Ikkinchi ko'rsatkich" },
      { value: "31%", label: "Uchinchi ko'rsatkich" },
    ],
  },
  process: {
    id: "s-process",
    layout: "process",
    title: "Jarayon bosqichlari",
    steps: [
      { n: "01", title: "Birinchi bosqich", text: "Bosqich izohi bir" },
      { n: "02", title: "Ikkinchi bosqich", text: "Bosqich izohi ikki" },
      { n: "03", title: "Uchinchi bosqich", text: "Bosqich izohi uch" },
    ],
  },
  table: {
    id: "s-table",
    layout: "table",
    title: "Ma'lumotlar jadvali",
    table: {
      headers: ["Ustun A", "Ustun B", "Ustun C"],
      rows: [
        ["1-qator A", "1-qator B", "1-qator C"],
        ["2-qator A", "2-qator B", "2-qator C"],
      ],
    },
  },
  closing: {
    id: "s-closing",
    layout: "closing",
    title: "Diqqatingiz uchun rahmat",
    subtitle: "Savollar bo'lsa, marhamat",
  },
};

// `stats` ning karta zaxirasi (raqamlar oz yoki birlik har xil) alohida
// namunada — `planStatChart` VA `planStats` kartalari IKKALASI ham
// sinaladi (ikkisi ham value/label uchun boshqa kod yo'lida `src` qo'yadi).
const STATS_CARDS: SlideModel = {
  id: "s-stats-cards",
  layout: "stats",
  title: "Kartalar zaxirasi",
  stats: [
    { value: "45%", label: "Foiz ko'rsatkichi" },
    { value: "4 bosqich", label: "Boshqa birlik" },
  ],
};

function layoutsToTest(): SlideLayout[] {
  return SLIDE_LAYOUTS.filter((l) => !EXCLUDED.includes(l));
}

function textLayers(layers: SlideLayer[]) {
  return layers.filter((l): l is Extract<SlideLayer, { t: "text" }> => l.t === "text");
}

/**
 * Test uchun KICHIK yordamchi — E3 ning `readSlideField` bilan bir xil
 * g'oyani takrorlaydi, lekin mustaqil yozilgan (E3 hali yo'q).
 */
function readField(s: SlideModel, src: SlideSrc): string | undefined {
  switch (src.f) {
    case "title":
      return s.title;
    case "subtitle":
      return s.subtitle;
    case "kicker":
      return s.kicker;
    case "quote":
      // `planOverlay` zaxirasi bilan bir xil: `s.quote || s.title`.
      return s.quote || s.title;
    case "quoteBy":
      return s.quoteBy;
    case "leftTitle":
      return s.leftTitle;
    case "rightTitle":
      return s.rightTitle;
    case "imageHint":
      return s.imageHint;
    case "footer":
      // `pushFooter` `s.footer || ""` chizadi — kolontitulsiz slaydda
      // ham qatlam BOR (bo'sh matn bilan), shuning uchun zaxira `""`.
      return s.footer ?? "";
    case "bullets":
      return s.bullets?.[src.i];
    case "left":
      return s.left?.[src.i];
    case "right":
      return s.right?.[src.i];
    case "stats": {
      const st = s.stats?.[src.i];
      if (!st) return undefined;
      return src.k === "value" ? st.value : st.label;
    }
    case "steps": {
      const st = s.steps?.[src.i];
      if (!st) return undefined;
      if (src.k === "n") return st.n;
      if (src.k === "title") return st.title;
      return st.text;
    }
    case "refs": {
      const r = s.refs?.[src.i];
      if (!r) return undefined;
      return src.k === "title" ? r.title : r.source;
    }
    case "quiz": {
      const q = s.quiz?.[src.i];
      if (!q) return undefined;
      if (src.k === "q") return q.q;
      return q.options?.[src.j];
    }
    case "table": {
      const t = s.table;
      if (!t) return undefined;
      if (src.k === "header") return t.headers?.[src.c];
      return t.rows?.[src.r]?.[src.c];
    }
    default:
      return undefined;
  }
}

/** `— ` prefiksi (`quoteBy`) va `uppercase` (paint vaqtida qo'llanadi,
 * `layer.text` o'zi xom qoladi — shuning uchun bu yerda ikkalasiga ham
 * chidamli, lekin uppercase odatda kerak emas) hisobga olinadi;
 * "o'z ichiga oladi yoki teng" qoidasi bilan taqqoslanadi. */
function fieldMatchesLayerText(fieldValue: string | undefined, layerText: string, uppercase?: boolean): boolean {
  if (fieldValue === undefined) return false;
  let candidate = layerText;
  if (candidate.startsWith("— ")) candidate = candidate.slice(2);
  // `layer.text` XOM holda saqlanadi — `uppercase` faqat CHIZISH vaqtida
  // (PPTX/CSS) qo'llanadi, shuning uchun ikkala tomon BIR XILDA
  // normallashtiriladi (uppercase bo'lsa ham, bo'lmasa ham).
  const norm = (x: string) => (uppercase ? x.toUpperCase() : x);
  const want = norm(fieldValue);
  candidate = norm(candidate);
  return want === candidate || candidate.includes(want) || want.includes(candidate);
}

// Dekorativ qatlamlar: yo'nalish o'qi, ochilish tirnog'i, sahifa raqami —
// bular QAYSI layout'da bo'lmasin har doim dekorativ.
const UNIVERSAL_DECORATIVE = [/^→$/, /^“$/, /^\d+\s*\/\s*\d+$/];

/**
 * Ikki xonali indeks yorlig'i ("01", "02"...) FAQAT `agenda` va
 * `bullets` (kartalar/lab tarmog'i) da dekorativ — u yerda raqam
 * modeldan emas, shunchaki `String(i+1).padStart(2,"0")` bilan chiziladi.
 * `process` maketida esa xuddi shu ko'rinishdagi matn (`st.n`) ATAYLAB
 * modeldan olinadi va `src` OLISHI kerak — shuning uchun bu tekshiruv
 * shu ikki layout bilan chegaralanadi.
 */
const INDEX_DECORATIVE_LAYOUTS: SlideLayout[] = ["agenda", "bullets"];
const INDEX_PATTERN = /^\d{2}$/;

function isDecorativeText(layout: SlideLayout, text: string): boolean {
  const t = text.trim();
  if (UNIVERSAL_DECORATIVE.some((re) => re.test(t))) return true;
  if (INDEX_DECORATIVE_LAYOUTS.includes(layout) && INDEX_PATTERN.test(t)) return true;
  return false;
}

// ------------------------------------------------------------ 1. mos kelish

test("har src'li qatlam readField natijasiga mos keladi (SLIDE_LAYOUTS x 6 visual)", () => {
  for (const layout of layoutsToTest()) {
    const model = SAMPLES[layout];
    assert.ok(model, `namuna yo'q: ${layout}`);
    for (const visual of VISUALS) {
      const plan = planSlide(model!, theme, visual, 0, 1);
      for (const layer of textLayers(plan.layers)) {
        if (layer.src) {
          const expected = readField(model!, layer.src);
          assert.ok(
            expected !== undefined,
            `${layout}/${visual}: src ${JSON.stringify(layer.src)} modeldan topilmadi`,
          );
          assert.ok(
            fieldMatchesLayerText(expected, layer.text ?? "", layer.uppercase),
            `${layout}/${visual}: "${layer.text}" src ${JSON.stringify(layer.src)} (kutilgan: "${expected}") bilan mos kelmadi`,
          );
        }
        if (layer.srcLines) {
          const lines = layer.lines ?? [];
          assert.equal(layer.srcLines.length, lines.length, `${layout}/${visual}: srcLines.length !== lines.length`);
          layer.srcLines.forEach((src, i) => {
            const expected = readField(model!, src);
            assert.ok(expected !== undefined, `${layout}/${visual}: srcLines[${i}] modeldan topilmadi`);
            assert.ok(
              fieldMatchesLayerText(expected, lines[i], layer.uppercase),
              `${layout}/${visual}: qator ${i} ("${lines[i]}") src ${JSON.stringify(src)} bilan mos kelmadi`,
            );
          });
        }
      }
    }
  }
});

test("stats: planStatChart VA kartalar zaxirasi ikkalasi ham value/label src beradi", () => {
  for (const visual of VISUALS) {
    // Diagramma tarmog'i (3+ bir birlikli raqam).
    const chartPlan = planSlide(SAMPLES.stats!, theme, visual, 0, 1);
    const chartTexts = textLayers(chartPlan.layers).filter((l) => l.src?.f === "stats");
    assert.equal(chartTexts.length, 6, `${visual}: diagrammada 3 value + 3 label kutiladi`);
    for (const l of chartTexts) {
      const expected = readField(SAMPLES.stats!, l.src!);
      assert.ok(fieldMatchesLayerText(expected, l.text ?? ""), `${visual}: diagramma src mos kelmadi`);
    }

    // Karta zaxirasi (aralash birlik — diagrammaga tushmaydi).
    const cardsPlan = planSlide(STATS_CARDS, theme, visual, 0, 1);
    const cardTexts = textLayers(cardsPlan.layers).filter((l) => l.src?.f === "stats");
    assert.equal(cardTexts.length, 4, `${visual}: 2 karta x (value+label) = 4`);
    for (const l of cardTexts) {
      const expected = readField(STATS_CARDS, l.src!);
      assert.ok(fieldMatchesLayerText(expected, l.text ?? ""), `${visual}: karta src mos kelmadi`);
    }
  }
});

// ------------------------------------------------------------ 2. noyoblik

test("bir slayd ichida src ko'rsatkichlari takrorlanmaydi", () => {
  for (const layout of layoutsToTest()) {
    const model = SAMPLES[layout];
    for (const visual of VISUALS) {
      const plan = planSlide(model!, theme, visual, 0, 1);
      const fingerprints: string[] = [];
      for (const layer of textLayers(plan.layers)) {
        if (layer.src) fingerprints.push(JSON.stringify(layer.src));
        if (layer.srcLines) fingerprints.push(...layer.srcLines.map((s) => JSON.stringify(s)));
      }
      assert.equal(
        new Set(fingerprints).size,
        fingerprints.length,
        `${layout}/${visual}: takrorlangan src ko'rsatkichi bor: ${JSON.stringify(fingerprints)}`,
      );
    }
  }
});

// ------------------------------------------------------------ 3. dekorativ

test("dekorativ qatlamlar (→, “, sahifa raqami, 2-xonali indeks) src'siz qoladi", () => {
  let sawDecorative = 0;
  for (const layout of layoutsToTest()) {
    const model = SAMPLES[layout];
    for (const visual of VISUALS) {
      const plan = planSlide(model!, theme, visual, 0, 1);
      for (const layer of textLayers(plan.layers)) {
        const text = layer.text ?? "";
        if (text && isDecorativeText(layout, text)) {
          sawDecorative += 1;
          assert.equal(layer.src, undefined, `${layout}/${visual}: dekorativ "${text}" src bilan chizildi`);
          assert.equal(layer.srcLines, undefined, `${layout}/${visual}: dekorativ "${text}" srcLines bilan chizildi`);
        }
      }
    }
  }
  // Namunalarimiz sahifa raqami (pushFooter) va process/agenda/table
  // indekslarini albatta ishlab chiqaradi — nol bo'lsa naqsh o'zi ishlamagan.
  assert.ok(sawDecorative > 0, "dekorativ qatlam umuman topilmadi — naqsh sinovdan chetda qoldi");
});

/*
 * AUDIT-10 (kolontitul tahriri): `pushFooter` MATNI endi `src` OLADI —
 * foydalanuvchi kolontitul ustiga ikki bosib uni o'zgartiradi
 * (`{op:"footer"}` butun dekaga yoziladi). Sahifa RAQAMI esa modelda
 * yo'q (`index+1 / total`) va `src`siz qoladi: unga bosilganda
 * tahrirlanadigan maydon bo'lmasdi.
 *
 * MUTATSIYA: `pushFooter` dagi `src: { f: "footer" }` olib tashlansa —
 * birinchi assertion qizil; sahifa raqamiga `src` qo'shilsa — ikkinchisi.
 */
test("pushFooter: matn `footer` src oladi, sahifa raqami src'siz qoladi", () => {
  for (const layout of layoutsToTest()) {
    const model = { ...SAMPLES[layout]!, footer: "Fan nomi · Sinf" };
    for (const visual of VISUALS) {
      const plan = planSlide(model, theme, visual, 2, 12);
      const pageNo = textLayers(plan.layers).find((l) => /^\d+\s*\/\s*\d+$/.test((l.text ?? "").trim()));
      assert.ok(pageNo, `${layout}/${visual}: sahifa raqami topilmadi`);
      assert.equal(pageNo!.src, undefined);
      const footerText = textLayers(plan.layers).find((l) => l.text === "Fan nomi · Sinf");
      assert.ok(footerText, `${layout}/${visual}: kolontitul qatlami topilmadi`);
      assert.deepEqual(footerText!.src, { f: "footer" }, `${layout}/${visual}: kolontitul tahrirlanadigan bo'lishi kerak`);
    }
  }
});

// ------------------------------------------------------------ 4. PPTX aynan

test("PPTX o'zgarmagan — render-pptx paintLayer src/srcLines'ni o'qimaydi", () => {
  // Statik manba tekshiruvi: `paintLayer` (render-pptx.ts) `src`/`srcLines`
  // maydonlariga UMUMAN tegmasligi kerak — bu «ko'rdim = oldim»
  // qoidasining o'zi: ko'ruvchi va PPTX BIR XIL `planSlide` natijasidan
  // chiziladi, lekin PPTX rendereri yangi maydonni bilishi SHART EMAS.
  // Mutatsiya: `paintLayer` ichiga `if (layer.src) {...}` qo'shilsa —
  // shu tekshiruv qizil bo'ladi.
  const here = fileURLToPath(new URL(".", import.meta.url));
  const source = readFileSync(`${here}/../lib/generation/render-pptx.ts`, "utf8");
  assert.ok(!source.includes("layer.src"), "paintLayer layer.src'ni o'qiy boshlagan — 'ko'rdim = oldim' xavf ostida");
  assert.ok(!source.includes("layer.srcLines"), "paintLayer layer.srcLines'ni o'qiy boshlagan");
});
