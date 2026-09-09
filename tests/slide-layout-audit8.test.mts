import test from "node:test";
import assert from "node:assert/strict";
import {
  CHART_BOTTOM,
  CHART_TOP,
  SECTION_BOTTOM,
  SECTION_TOP,
  planSlide,
  type SlideLayer,
} from "../lib/generation/slide-layout.ts";
import { SLIDE_THEMES, getSlideTheme } from "../lib/generation/slide-themes.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";

/**
 * AUDIT-8 ning oxirgi to'rt bandi: N-3, N-5, N-6, N-10.
 *
 * To'rtalasi ham BITTA oilaga tegishli — «bo'sh maydon» nuqsoni: maket
 * slaydning yarmini yoki uchdan birini ishlatmasdan qoldiradi. PDF da
 * ko'rinadi, lekin chegara supurishi (hech nima chegaradan chiqmaydi)
 * ularni ushlay OLMAYDI: bo'sh maydon chegara buzilishi emas.
 *
 * Shuning uchun bu yerdagi har bir assertion O'LCHOVGA asoslangan:
 * qamrov ulushi, markazdan siljish, ikki chiziq orasidagi masofa.
 * Har biri mutatsiya bilan sinaldi — eski qiymat qaytarilsa aynan shu
 * test qizil bo'ladi (jadval `docs/AUDIT-8.md` da).
 */

const theme = getSlideTheme("atlas");
const texts = (ls: SlideLayer[]) => ls.filter((l): l is Extract<SlideLayer, { t: "text" }> => l.t === "text");
const rects = (ls: SlideLayer[]) => ls.filter((l): l is Extract<SlideLayer, { t: "rect" }> => l.t === "rect");
const r3 = (n: number) => Number(n.toFixed(3));

/** Berilgan qatlamlar to'plamining tik qamrovi (eng tepa … eng past). */
function span(boxes: { box: { y: number; h: number } }[]): { top: number; bottom: number; h: number } {
  const top = Math.min(...boxes.map((b) => b.box.y));
  const bottom = Math.max(...boxes.map((b) => b.box.y + b.box.h));
  return { top, bottom, h: bottom - top };
}

// ═══════════════════════════════════════════ N-3: diagramma qatorlari

const chartStats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ value: `${90 - i * 15}%`, label: `Ko‘rsatkich ${i + 1}` }));

const chartSlide = (n: number): SlideModel => ({
  id: "c",
  layout: "stats",
  title: "Ko‘rsatkichlar",
  stats: chartStats(n),
});

/**
 * N-3. `rowH = Math.min(1.15, …)` shifti tufayli 3 qiymatli diagramma
 * 4.95″ zonaning faqat 3.35″ ini egallardi — pastda 1.60″ bo'sh.
 *
 * Ikki o'lchov birga tekshiriladi:
 *   qamrov ≥ 60%   — auditda so'ralgan pol;
 *   pastki bo'shliq ≤ 0.35″ — SHIFTNI aynan ushlaydigan o'lchov
 *   (eski kodda 3 qiymatda 1.60″, 4 qiymatda 0.45″ edi, ya'ni ikkala
 *   holat ham qizil bo'ladi).
 */
test("N-3: diagramma qatorlari foydali balandlikni qoldiqsiz bo'lib oladi", () => {
  const usable = CHART_BOTTOM - CHART_TOP;
  for (const n of [3, 4, 5]) {
    const p = planSlide(chartSlide(n), theme, "classic", 1, 10);
    const labels = texts(p.layers).filter((t) => t.src?.f === "stats" && t.src.k === "label");
    // Test bo'sh bo'lmasin: diagramma tarmog'i haqiqatan tanlanganini tasdiqlaymiz.
    assert.equal(labels.length, n, `n=${n}: diagramma tarmog'i chizilmadi (yorliq ${labels.length})`);

    const rows = span(labels);
    const coverage = rows.h / usable;
    const gap = CHART_BOTTOM - rows.bottom;
    assert.ok(
      coverage >= 0.6,
      `n=${n}: qatorlar foydali maydonning ${(coverage * 100).toFixed(0)}% ini egalladi (kamida 60% kerak)`,
    );
    assert.ok(
      gap <= 0.35,
      `n=${n}: diagramma ostida ${r3(gap)}″ bo'sh qoldi — qator balandligida shift bor`,
    );
    assert.ok(rows.top <= CHART_TOP + 0.01, `n=${n}: qatorlar zonaning tepasidan boshlanmadi`);
  }
});

/**
 * Qator balandligi o'sganda ustun ham qalinlashishi kerak — aks holda
 * ingichka tasma baland oq qatorda «suzib» qoladi va bo'shliq faqat
 * qatorlar ORASIGA ko'chadi.
 */
test("N-3: ustun qalinligi qator balandligiga ergashadi", () => {
  const barsOf = (n: number) => {
    const p = planSlide(chartSlide(n), theme, "classic", 1, 10);
    // Ustunlar — `accent`/`accent2` bilan bo'yalgan, diagramma zonasidagi
    // gorizontal to'rtburchaklar (chrome tasmasi y=0 da qoladi).
    return rects(p.layers).filter(
      (r) =>
        (r.fill?.color === theme.accent || r.fill?.color === theme.accent2) &&
        r.box.y >= CHART_TOP &&
        r.box.h < 1.2 &&
        r.box.w > 0.5,
    );
  };
  const three = barsOf(3);
  const five = barsOf(5);
  assert.equal(three.length, 3, `3 qiymatda 3 ustun kutilgan, ${three.length} chiqdi`);
  assert.equal(five.length, 5, `5 qiymatda 5 ustun kutilgan, ${five.length} chiqdi`);
  assert.ok(
    three[0].box.h > five[0].box.h + 0.1,
    `siyrak diagrammada ustun qalinroq bo'lishi kerak (3 ta: ${r3(three[0].box.h)}″, 5 ta: ${r3(five[0].box.h)}″)`,
  );
  assert.ok(three[0].box.h <= 0.9 && five[0].box.h >= 0.34, "ustun qalinligi shift/poldan chiqib ketdi");
});

// ═════════════════════════════════ N-5 / N-6: bo'lim slaydi bo'sh emas

const sectionSlide: SlideModel = {
  id: "s",
  layout: "section",
  title: "Ikkinchi bo‘lim: amaliyot",
  subtitle: "Nazariyadan amaliyotga o‘tish va laboratoriya ishlari.",
};

/** Bo'lim matn bloki — `title` va `subtitle` src'li qatlamlarning qamrovi. */
function sectionBlock(visual: "classic" | "magazine", s: SlideModel = sectionSlide) {
  const p = planSlide(s, theme, visual, 1, 10);
  const blk = texts(p.layers).filter((t) => t.src?.f === "title" || t.src?.f === "subtitle");
  assert.ok(blk.length >= 1, `${visual}: bo'lim matn qatlami topilmadi`);
  const sp = span(blk);
  const zone = SECTION_BOTTOM - SECTION_TOP;
  return {
    plan: p,
    ...sp,
    coverage: sp.h / zone,
    centerOffset: (sp.top + sp.bottom) / 2 - (SECTION_TOP + SECTION_BOTTOM) / 2,
  };
}

/**
 * N-5. `planSection` (classic) qat'iy koordinatalarda turardi: blok
 * 2.20–4.80, markazdan 0.33″ yuqorida, pastda ~2.7″ bo'sh sahifa.
 * `section` 12 shablonda bor.
 *
 * Auditning talabi: «markaz YOKI qamrov ≥ 50%». Bu yerda MARKAZ
 * o'lchanadi, chunki qamrov ulushi bu maketda YOLG'ON o'lchov bo'lardi:
 * u QUTINI sanaydi, siyohni emas. Birinchi urinishda subtitle qutisi
 * 1.9″ qilingan edi va o'lchov 68% ko'rsatardi — PDF da esa bir qatorli
 * subtitle qutining tepasida turib, pastki yarmi baribir bo'sh edi.
 * Shuning uchun qutilar endi `inkHeight` bilan siyohga tenglashtirilgan
 * va markaz o'lchovi HAQIQATAN ko'rinadigan narsani o'lchaydi.
 *
 * «Maydonni to'ldirish» esa TIPOGRAFIKA bilan: ajratgich sarlavhasi
 * 32 pt emas, 44 pt dan boshlanadi (ikkinchi assertion).
 */
test("N-5: classic bo'lim bloki vertikal markazda", () => {
  const b = sectionBlock("classic");
  assert.ok(
    Math.abs(b.centerOffset) <= 0.15,
    `classic bo'lim bloki markazdan ${r3(b.centerOffset)}″ siljigan (ruxsat 0.15″)`,
  );
  const title = texts(b.plan.layers).find((t) => t.src?.f === "title");
  assert.ok(title && title.size >= 34, `ajratgich sarlavhasi ${title?.size} pt — maydonni to'ldirmaydi`);
  // Quti siyohga teng: bir qatorli sarlavha 1.2″ dan baland quti olmasin.
  assert.ok(title!.box.h <= 1.2, `sarlavha qutisi ${r3(title!.box.h)}″ — siyohdan katta, markaz yolg'on chiqadi`);
});

/** Subtitlesiz bo'lim ham tepaga yopishib qolmasin — markaz o'lchovi. */
test("N-5: subtitlesiz bo'lim sarlavhasi ham vertikal markazda", () => {
  const b = sectionBlock("classic", { ...sectionSlide, subtitle: undefined });
  assert.ok(
    Math.abs(b.centerOffset) <= 0.5,
    `subtitlesiz sarlavha markazdan ${r3(b.centerOffset)}″ siljigan`,
  );
});

/**
 * N-6. Rasmsiz `magazine` bo'limi: matn 2.98–5.20, tepada 1.8″ va
 * pastda 1.3″ to'q bo'shliq — «yuklanmagan sahifa» taassuroti.
 *
 * Yechim rasmli variantning NAQSHINI takrorlaydi: matn bloki pastga
 * langar tashlaydi, tepani esa dekorativ element egallaydi. Shuning
 * uchun o'lchov ham markaz emas, LANGAR: blok tugashi zona quyi
 * chegarasiga yopishgan bo'lishi kerak.
 */
test("N-6: rasmsiz magazine bloki zona quyi chegarasiga langar tashlaydi", () => {
  const b = sectionBlock("magazine");
  const gap = SECTION_BOTTOM - b.bottom;
  assert.ok(
    Math.abs(gap) <= 0.35,
    `rasmsiz magazine bloki ostida ${r3(gap)}″ bo'shliq qoldi (ruxsat 0.35″)`,
  );
  // Va u sahifaning pastki yarmida — ya'ni «o'rtada osilgan» emas.
  assert.ok(b.top > (SECTION_TOP + SECTION_BOTTOM) / 2, "matn bloki pastki yarmda turishi kerak");
});

test("N-6: rasmsiz magazine bo'limida dekorativ element bo'sh maydonni to'ldiradi", () => {
  const p = planSlide(sectionSlide, theme, "magazine", 1, 10);
  const block = sectionBlock("magazine");

  // (1) Yirik raqam — matn blokidan YUQORIDA, modelga bog'liq emas (src'siz).
  const big = texts(p.layers).filter((t) => t.size >= 60);
  assert.equal(big.length, 1, `yirik dekorativ raqam kutilgan, ${big.length} ta topildi`);
  assert.equal(big[0].src, undefined, "dekorativ raqam `src` olmasligi kerak (tahrirlanmaydi)");
  assert.ok(big[0].box.y < block.top, "dekorativ raqam matn blokidan yuqorida turishi kerak");

  // (2) Rukn chizig'i — to'la kenglikdagi ingichka ajratgich.
  const rule = rects(p.layers).find((r) => r.box.w > 10 && r.box.h <= 0.05 && r.box.y > 1 && r.box.y < block.top);
  assert.ok(rule, "raqam bilan matn orasida rukn chizig'i bo'lishi kerak");

  // Rasmli holat O'ZGARMAYDI — pastki tasma naqshi (AUDIT-8 N-7 qarori).
  const withImg = planSlide({ ...sectionSlide, image: { url: "https://example.test/a.png" } }, theme, "magazine", 1, 10);
  assert.equal(texts(withImg.layers).filter((t) => t.size >= 60).length, 0, "rasmli bo'limda dekorativ raqam keraksiz");
  assert.ok(
    rects(withImg.layers).some((r) => r.box.y > 4 && r.box.w > 13 && (r.fill?.alpha ?? 1) > 0.5),
    "rasmli bo'limda pastki tasma saqlanishi kerak",
  );
});

// ═══════════════════════════════════════════ N-10: timeline qo'sh chizig'i

const processSlide: SlideModel = {
  id: "p",
  layout: "process",
  title: "Suv aylanishining bosqichlari",
  steps: [1, 2, 3].map((n) => ({ n: `${n}`, title: `Bosqich ${n}`, text: "Qisqa izoh matni." })),
};

/**
 * Sarlavha ostidagi gorizontal aksent chiziqlari — `planHeading` niki
 * (y=1.22) va `timeline` relsi. Chrome tasmasi (y=0) va tugun nuqtalari
 * (w=0.22) bu filtrga tushmaydi.
 */
function accentRules(layers: SlideLayer[], th: ReturnType<typeof getSlideTheme>) {
  return rects(layers)
    .filter((r) => r.fill?.color === th.accent && r.box.h <= 0.12 && r.box.w >= 0.8 && r.box.y >= 1.0 && r.box.y <= 3.0)
    .map((r) => r.box.y)
    .sort((a, b) => a - b);
}

/**
 * N-10. Rels `y=1.42` da, sarlavha aksenti esa `y=1.22` da edi: bir xil
 * qalinlik (0.07), bir xil rang, orasi 0.13″ — PDF da qo'sh chiziq
 * bo'lib ko'rinardi. Talab: farq ≥ 0.3″ yoki chiziqlardan faqat bittasi.
 */
test("N-10: timeline relsi sarlavha chizig'i bilan qo'sh chiziq bermaydi", () => {
  for (const t of SLIDE_THEMES) {
    const th = getSlideTheme(t.id);
    const ys = accentRules(planSlide(processSlide, th, "timeline", 1, 10).layers, th);
    assert.ok(ys.length >= 1, `${t.id}: sarlavha aksent chizig'i yo'qolgan`);
    for (let i = 1; i < ys.length; i++) {
      assert.ok(
        ys[i] - ys[i - 1] >= 0.3,
        `${t.id}: ikki aksent chizig'i orasi ${r3(ys[i] - ys[i - 1])}″ — qo'sh chiziq bo'lib ko'rinadi`,
      );
    }
  }
});

/** Rels shunchaki surilmadi — u kartalar bilan BOG'LANGAN vaqt o'qi bo'ldi. */
test("N-10: timeline relsi kartalar ustida tugun nuqtalari bilan chiziladi", () => {
  const tl = planSlide(processSlide, theme, "timeline", 1, 10);
  const plain = planSlide(processSlide, theme, "classic", 1, 10);
  const nodes = rects(tl.layers).filter(
    (r) => r.fill?.color === theme.accent && Math.abs(r.box.w - r.box.h) < 0.01 && r.box.w < 0.3 && r.box.y > 1.5,
  );
  assert.equal(nodes.length, 3, `har bosqichga bitta tugun kutilgan, ${nodes.length} ta chiqdi`);
  // Tugunlar kartalar markazida.
  const cards = rects(tl.layers).filter((r) => r.fill?.color === theme.surface && r.box.h > 3);
  assert.equal(cards.length, 3, "uchta karta kutilgan");
  cards.forEach((c, i) => {
    const cx = c.box.x + c.box.w / 2;
    assert.ok(
      Math.abs(nodes[i].box.x + nodes[i].box.w / 2 - cx) < 0.02,
      `tugun ${i} kartaning markazida emas`,
    );
    assert.ok(nodes[i].box.y + nodes[i].box.h < c.box.y, `tugun ${i} karta ustida turishi kerak`);
  });
  assert.notEqual(JSON.stringify(tl), JSON.stringify(plain), "timeline classic bilan bir xil chiqmoqda");
});

// ═════════════════════════════════════════ chegara: 15 tema × to'rt band

test("AUDIT-8 to'rt bandining maketlari 15 temada chegara ichida qoladi", () => {
  const long = "Juda uzun sarlavha va izoh matni bo‘lib, u qutiga sig‘masligi mumkin. ".repeat(2);
  const samples: [string, SlideModel][] = [
    ["chart3", chartSlide(3)],
    ["chart5", chartSlide(5)],
    ["section", sectionSlide],
    ["section-uzun", { ...sectionSlide, title: long, subtitle: long }],
    ["section-subtitlesiz", { ...sectionSlide, subtitle: undefined }],
    ["process", processSlide],
    ["process-6", { ...processSlide, steps: [1, 2, 3, 4, 5, 6].map((n) => ({ n: `${n}`, title: `B${n}`, text: "Izoh." })) }],
    ["process-1", { ...processSlide, steps: [{ n: "1", title: "Yagona", text: "Izoh." }] }],
  ];
  for (const t of SLIDE_THEMES) {
    const th = getSlideTheme(t.id);
    for (const visual of ["classic", "cards", "dense", "timeline", "magazine", "hero-split"] as const) {
      for (const [tag, s] of samples) {
        for (const l of planSlide(s, th, visual, 1, 10).layers) {
          const label = `${t.id}/${visual}/${tag}`;
          assert.ok(l.box.x >= -0.01 && l.box.y >= -0.01, `${label}: manfiy koordinata`);
          assert.ok(l.box.w >= 0 && l.box.h >= 0, `${label}: manfiy o'lcham`);
          assert.ok(l.box.x + l.box.w <= 13.34, `${label}: kenglikdan chiqdi`);
          assert.ok(l.box.y + l.box.h <= 7.51, `${label}: balandlikdan chiqdi (${r3(l.box.y + l.box.h)})`);
        }
      }
    }
  }
});

/** Shrift poli: yangi qutilar matnni o'qib bo'lmaydigan darajaga tushirmasin. */
test("AUDIT-8 to'rt bandida shrift poli saqlanadi", () => {
  const long = "Juda uzun sarlavha va izoh matni bo‘lib, u qutiga sig‘masligi mumkin. ".repeat(2);
  for (const visual of ["classic", "magazine"] as const) {
    for (const l of texts(planSlide({ ...sectionSlide, title: long, subtitle: long }, theme, visual, 1, 10).layers)) {
      if (l.src) assert.ok(l.size >= 11, `${visual}: bo'lim matni ${l.size} pt ga tushdi`);
    }
  }
  for (const l of texts(planSlide(chartSlide(5), theme, "dense", 1, 10).layers)) {
    if (l.src) assert.ok(l.size >= 11, `diagramma matni ${l.size} pt ga tushdi`);
  }
});
