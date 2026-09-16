import test from "node:test";
import assert from "node:assert/strict";
import {
  columnsFor,
  compareHeads,
  fitRows,
  infographicLabels,
  isRtl,
  layoutInfographic,
  rowsOf,
  type InfographicLayout,
} from "../lib/generation/infographic/layout.ts";
import { INFOGRAPHIC_LIMITS, INFOGRAPHIC_TYPE_IDS, SIZE_MM, type InfographicBlock, type InfographicSpec, type InfographicTypeId } from "../lib/generation/infographic/types.ts";

/**
 * INFOGRAFIKA MAKETI (AUDIT-21 WP-C) — `layoutInfographic`.
 *
 * Maket SOF va RANGSIZ: bir xil spetsifikatsiya bir xil geometriya
 * beradi, palitra esa unga TEGMAYDI (rang `svg.ts` da). Shu ikki
 * xossa va yetti turning har biri shu yerda qulflanadi.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `fitRows` dagi `growMax` olib tashlandi (kartalar butun
 *      balandlikni egallaydi) — «kartalar tabiiy balandlikda» testi;
 *   2. `fit()` dagi `clipped` doim `false` qilindi — «sig'magan matn
 *      `overflow` ga tushadi» testi;
 *   3. `rowsOf` dagi toq qator shoxi olib tashlandi — «yolg'iz oxirgi
 *      karta butun kenglikni oladi» testi;
 *   4. `scaleOf` dagi `k` qat'iy 1 qilindi — «A3 — A4 ning masshtabi» testi;
 *   5. `mirror()` chaqiruvi olib tashlandi — «RTL tilda maket aks
 *      ettiriladi» testi;
 *   6. `drawProcess` dagi `order` bo'yicha saralash olib tashlandi —
 *      «jarayon bosqichlari tartiblanadi» testi.
 */

/* ────────────────────────── namunalar ────────────────────────── */

const block = (id: string, extra: Partial<InfographicBlock> = {}): InfographicBlock => ({
  id,
  icon: "bulb",
  heading: `Sarlavha ${id}`,
  text: `${id} bloki mavzuga oid aniq bir faktni bayon qiladi va uni qisqa izohlaydi.`,
  ...extra,
});

const EXTRA: Record<InfographicTypeId, (i: number) => Partial<InfographicBlock>> = {
  list: () => ({}),
  process: (i) => ({ order: i + 1 }),
  compare: (i) => ({ side: i % 2 === 0 ? "left" : "right" }),
  stat: (i) => ({ stat: { value: `${10 + i}%`, label: "ulush" } }),
  timeline: (i) => ({ when: String(1991 + i) }),
  "cause-effect": (i) => ({ role: i % 2 === 0 ? "cause" : "effect" }),
  "map-structure": () => ({}),
};

function spec(type: InfographicTypeId, n = 4, over: Partial<InfographicSpec> = {}): InfographicSpec {
  return {
    title: "Suv aylanishi va uning bosqichlari",
    subtitle: "Quyosh — Yer",
    type,
    palette: "indigo",
    size: "A4",
    language: "uz",
    blocks: Array.from({ length: n }, (_, i) => block(`b${i + 1}`, EXTRA[type](i))),
    ...over,
  };
}

const rects = (l: InfographicLayout) => l.shapes.filter((s): s is Extract<InfographicLayout["shapes"][number], { k: "rect" }> => s.k === "rect");
const roleRects = (l: InfographicLayout, role: string) => rects(l).filter((r) => r.role === role);
const textsOf = (l: InfographicLayout, role: string) => l.texts.filter((t) => t.role === role);
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x + a.w > b.x + 0.01 && b.x + b.w > a.x + 0.01 && a.y + a.h > b.y + 0.01 && b.y + b.h > a.y + 0.01;

/* ══════════════════════════ 1. yetti tur ══════════════════════════ */

test("yetti tur: har biri chiziladi va har blok o'z qutisini oladi", () => {
  for (const type of INFOGRAPHIC_TYPE_IDS) {
    const l = layoutInfographic(spec(type, 4));
    assert.equal(l.type, type, `${type}: tur saqlanmadi`);
    assert.equal(roleRects(l, "page").length, 1, `${type}: sahifa foni yo'q`);
    assert.equal(roleRects(l, "header").length, 1, `${type}: shapka tasmasi yo'q`);
    assert.equal(l.boxes.length, 4, `${type}: 4 blokdan ${l.boxes.length} ta quti`);
    assert.deepEqual(
      l.boxes.map((b) => b.id).sort(),
      ["b1", "b2", "b3", "b4"],
      `${type}: quti id lari bloklar bilan mos emas`,
    );
    assert.ok(l.texts.some((t) => t.role === "title"), `${type}: sarlavha yo'q`);
  }
});

test("yetti tur: hamma shakl va matn sahifa ichida (chekkadan chiqmaydi)", () => {
  for (const type of INFOGRAPHIC_TYPE_IDS) {
    const l = layoutInfographic(spec(type, 6));
    const { w, h } = l.mm;
    for (const s of l.shapes) {
      if (s.k === "rect") {
        assert.ok(s.x >= -0.01 && s.y >= -0.01 && s.x + s.w <= w + 0.01 && s.y + s.h <= h + 0.01, `${type}: ${s.role} to'rtburchagi sahifadan chiqdi`);
      } else if (s.k === "circle") {
        assert.ok(s.cx - s.r >= -0.01 && s.cx + s.r <= w + 0.01 && s.cy - s.r >= -0.01 && s.cy + s.r <= h + 0.01, `${type}: ${s.role} doirasi sahifadan chiqdi`);
      }
    }
    for (const t of l.texts) {
      const bottom = t.y + (t.lines.length - 1) * t.lh;
      assert.ok(t.y > 0 && bottom <= h + 0.01, `${type}: «${t.lines[0]}» matni sahifadan chiqdi (${bottom} > ${h})`);
    }
  }
});

test("yetti tur: blok qutilari bir-birining ustiga tushmaydi", () => {
  for (const type of INFOGRAPHIC_TYPE_IDS) {
    const l = layoutInfographic(spec(type, 6));
    for (let i = 0; i < l.boxes.length; i++) {
      for (let j = i + 1; j < l.boxes.length; j++) {
        assert.ok(!overlaps(l.boxes[i], l.boxes[j]), `${type}: ${l.boxes[i].id} va ${l.boxes[j].id} qutilari kesishdi`);
      }
    }
  }
});

/* ══════════════════════════ 2. o'lcham ══════════════════════════ */

test("o'lcham: A4 va A3 portret mm jadvalidan, A3 — A4 ning masshtabi", () => {
  const a4 = layoutInfographic(spec("list", 4));
  const a3 = layoutInfographic(spec("list", 4, { size: "A3" }));
  assert.deepEqual(a4.mm, { w: SIZE_MM.A4.width, h: SIZE_MM.A4.height });
  assert.deepEqual(a3.mm, { w: SIZE_MM.A3.width, h: SIZE_MM.A3.height });
  const k = SIZE_MM.A3.width / SIZE_MM.A4.width;
  const t4 = textsOf(a4, "title")[0];
  const t3 = textsOf(a3, "title")[0];
  assert.ok(Math.abs(t3.size / t4.size - k) < 1e-6, `A3 sarlavha shrifti ${t3.size}, kutilgan ${t4.size * k}`);
});

test("o'lcham: noma'lum qiymat A4 ga tushadi", () => {
  const l = layoutInfographic(spec("list", 4, { size: "A2" as never }));
  assert.equal(l.size, "A4");
  assert.equal(l.mm.w, SIZE_MM.A4.width);
});

test("chekka: hech bir karta 12 mm chekkadan ichkariroqqa kirmaydi", () => {
  const l = layoutInfographic(spec("list", 5));
  const m = INFOGRAPHIC_LIMITS.marginMm;
  for (const b of l.boxes) {
    assert.ok(b.x >= m - 0.01, `${b.id}: chap chekka ${b.x} < ${m}`);
    assert.ok(b.x + b.w <= l.mm.w - m + 0.01, `${b.id}: o'ng chekka`);
    assert.ok(b.y + b.h <= l.mm.h - m + 0.01, `${b.id}: quyi chekka`);
  }
});

/* ══════════════════════════ 3. panjara ══════════════════════════ */

test("panjara: ≤3 blok — bitta ustun, 4–8 — ikkita", () => {
  assert.equal(columnsFor(3), 1);
  assert.equal(columnsFor(INFOGRAPHIC_LIMITS.oneColumnMaxBlocks), 1);
  assert.equal(columnsFor(4), 2);
  assert.equal(columnsFor(8), 2);
  const one = layoutInfographic(spec("list", 3));
  assert.equal(new Set(one.boxes.map((b) => Math.round(b.x))).size, 1, "3 blok bitta ustunda turishi kerak");
  const two = layoutInfographic(spec("list", 4));
  assert.equal(new Set(two.boxes.map((b) => Math.round(b.x))).size, 2, "4 blok ikki ustunda");
});

test("panjara: yolg'iz qolgan oxirgi karta BUTUN kenglikni oladi", () => {
  assert.deepEqual(rowsOf(5, 2), [[0, 1], [2, 3], [4]]);
  assert.deepEqual(rowsOf(3, 1), [[0], [1], [2]]);
  const l = layoutInfographic(spec("list", 5));
  const last = l.boxes[4];
  const first = l.boxes[0];
  assert.ok(last.w > first.w * 1.9, `oxirgi karta kengligi ${last.w}, juft kartaniki ${first.w}`);
});

test("panjara: bo'sh joy KARTAGA emas, oraliqqa beriladi (tabiiy balandlik)", () => {
  // Uchta qisqa blok — mavjud balandlik ehtiyojdan ancha katta.
  const r = fitRows(300, [40, 40, 40], 6);
  assert.ok(r.heights[0] <= 40 * 1.16, `karta ${r.heights[0]} mm gacha shishib ketdi (tabiiy 40)`);
  assert.ok(r.gap > 6, "qolgan joy oraliqqa berilmadi");
  assert.ok(r.top > 0, "guruh markazlashtirilmadi");
  const used = r.heights.reduce((a, b) => a + b, 0) + r.gap * 2 + r.top * 2;
  assert.ok(Math.abs(used - 300) < 0.51, `taqsimlangan balandlik ${used} ≠ 300`);
});

test("panjara: joy yetmasa qatorlar PROPORSIONAL siqiladi", () => {
  const r = fitRows(100, [60, 30, 30], 6);
  const total = r.heights.reduce((a, b) => a + b, 0) + r.gap * 2;
  assert.ok(total <= 100.01, `siqilgan jami ${total} > 100`);
  assert.ok(r.heights[0] > r.heights[1], "matni ko'p blok ko'proq joy saqlab qolishi kerak");
  assert.equal(r.top, 0, "siqilganda markazlashtirish bo'lmaydi");
});

/* ══════════════════════════ 4. matn o'rash / overflow ══════════════════════════ */

test("overflow: sig'adigan matnda bayroq yo'q", () => {
  const l = layoutInfographic(spec("list", 4));
  assert.deepEqual(l.overflow, []);
});

test("overflow: kartaga sig'magan blok `overflow` ga tushadi", () => {
  const long = "so'z ".repeat(400).trim();
  const s = spec("list", 8);
  s.blocks[0].text = long;
  const l = layoutInfographic(s);
  assert.ok(l.overflow.includes("b1"), `sig'magan blok belgilanmadi (overflow=${JSON.stringify(l.overflow)})`);
  assert.ok(!l.overflow.includes("b2"), "sig'gan blok ham belgilanib qolgan");
});

test("o'rash: tana matni karta kengligidan chiqmaydi va oxirgi qator «…» bilan kesiladi", () => {
  const s = spec("list", 8);
  s.blocks[0].text = "juda-uzun-bo'linmaydigan-so'z ".repeat(60).trim();
  const l = layoutInfographic(s);
  const box = l.boxes.find((b) => b.id === "b1")!;
  const body = l.texts.filter((t) => t.role === "body");
  assert.ok(body.length, "tana matni chizilmadi");
  const clipped = body.some((t) => t.lines[t.lines.length - 1].endsWith("…"));
  assert.ok(clipped, "kesilgan matn «…» bilan tugashi kerak");
  for (const t of body) for (const line of t.lines) assert.ok(line.length < 200, "qator o'ralmagan");
  assert.ok(box.w > 0);
});

/* ══════════════════════════ 5. turga xos ══════════════════════════ */

test("jarayon: bosqichlar `order` bo'yicha tartiblanadi va raqam badge'i chiziladi", () => {
  const s = spec("process", 4);
  s.blocks = [block("b3", { order: 3 }), block("b1", { order: 1 }), block("b4", { order: 4 }), block("b2", { order: 2 })];
  const l = layoutInfographic(s);
  const badges = textsOf(l, "badge").map((t) => t.lines[0]);
  assert.deepEqual(badges, ["1", "2", "3", "4"], "badge raqamlari tartibda emas");
  const ys = ["b1", "b2", "b3", "b4"].map((id) => l.boxes.find((b) => b.id === id)!.y);
  assert.deepEqual([...ys].sort((a, b) => a - b), ys, "kartalar `order` tartibida joylashmadi");
  assert.ok(l.shapes.some((sh) => sh.k === "line" && sh.arrow && sh.role === "flow"), "bosqichlar orasida o'q yo'q");
});

test("taqqoslash: ikki ustun, sarlavha tasmasi ost sarlavhadan ajratiladi", () => {
  assert.deepEqual(compareHeads("Fotosintez — Hujayra nafas olishi"), ["Fotosintez", "Hujayra nafas olishi"]);
  assert.deepEqual(compareHeads("Kunduz / Tun"), ["Kunduz", "Tun"]);
  assert.equal(compareHeads("Oddiy ost sarlavha"), null);
  assert.equal(compareHeads(undefined), null);

  const l = layoutInfographic(spec("compare", 6, { subtitle: "Chap tomon — O'ng tomon" }));
  const heads = textsOf(l, "columnHead").concat(textsOf(l, "columnHeadAlt"));
  assert.deepEqual(heads.map((t) => t.lines[0]).sort(), ["Chap tomon", "O'ng tomon"]);
  // `twoColumns` avval CHAP ustunni, keyin o'ngni chizadi — qutilar
  // shu tartibda to'planadi (bloklar ro'yxati tartibida emas).
  const left = l.boxes.slice(0, 3).map((b) => Math.round(b.x));
  const right = l.boxes.slice(3).map((b) => Math.round(b.x));
  assert.equal(new Set(left).size, 1, "chap ustun bitta x da turishi kerak");
  assert.equal(new Set(right).size, 1, "o'ng ustun bitta x da");
  assert.ok(right[0] > left[0], "o'ng ustun chapdan o'ngda");
});

test("taqqoslash: ajratuvchisiz ost sarlavhada ustun tasmasi CHIZILMAYDI", () => {
  const l = layoutInfographic(spec("compare", 4, { subtitle: "Oddiy izoh" }));
  assert.equal(textsOf(l, "columnHead").length, 0);
  assert.equal(textsOf(l, "columnHeadAlt").length, 0);
});

test("statistika: katta raqam aksent shriftida, yorliq va sarlavha bilan", () => {
  const l = layoutInfographic(spec("stat", 4));
  const stats = textsOf(l, "stat");
  assert.equal(stats.length, 4, "har blokda raqam bo'lishi kerak");
  assert.deepEqual(stats.map((t) => t.lines[0]), ["10%", "11%", "12%", "13%"]);
  const body = textsOf(l, "body")[0];
  assert.ok(stats[0].size > body.size * 2, `raqam shrifti ${stats[0].size}, tana ${body.size} — yetarli katta emas`);
  assert.equal(textsOf(l, "statLabel").length, 4, "raqam yorliqlari yo'q");
});

test("statistika: uzun raqam bitta qatorda qoladi (shrift kichrayadi), juda uzuni `overflow`", () => {
  const s = spec("stat", 4);
  s.blocks[0].stat = { value: "1 234 567 890 123 456 789 012 345 678 901", label: "juda uzun" };
  const l = layoutInfographic(s);
  const big = textsOf(l, "stat")[0];
  assert.equal(big.lines.length, 1, "raqam ikki qatorga bo'lindi");
  assert.ok(big.size < textsOf(l, "stat")[1].size, "sig'may qolgan raqam shrifti kichraymadi");
  assert.ok(l.overflow.includes("b1"), "60 % dan past tushgan raqam `overflow` ga tushishi kerak");
});

test("xronologiya: vertikal chiziq, nuqtalar va sana yorliqlari", () => {
  const l = layoutInfographic(spec("timeline", 5));
  assert.equal(l.shapes.filter((s) => s.k === "circle" && s.role === "dot").length, 5, "har blokka nuqta");
  assert.ok(l.shapes.some((s) => s.k === "line" && s.role === "rail"), "vertikal chiziq yo'q");
  assert.deepEqual(textsOf(l, "when").map((t) => t.lines[0]), ["1991", "1992", "1993", "1994", "1995"]);
  // Sana CHAPDA, karta o'ngda.
  const when = textsOf(l, "when")[0];
  assert.equal(when.anchor, "end");
  assert.ok(when.x < l.boxes[0].x, "sana karta chetidan chapda turishi kerak");
});

test("sabab-natija: ikki guruh, tarjima qilingan ustun nomlari va markaziy o'q", () => {
  const uz = layoutInfographic(spec("cause-effect", 4));
  const heads = textsOf(uz, "columnHead").concat(textsOf(uz, "columnHeadAlt")).map((t) => t.lines[0]);
  assert.deepEqual(heads, ["Sabablar", "Natijalar"]);
  assert.ok(uz.shapes.some((s) => s.k === "line" && s.role === "flow" && s.arrow), "markaziy o'q yo'q");

  const ru = layoutInfographic(spec("cause-effect", 4, { language: "ru" }));
  assert.deepEqual(ru.texts.filter((t) => t.role === "columnHead" || t.role === "columnHeadAlt").map((t) => t.lines[0]), ["Причины", "Следствия"]);
  // Noma'lum til — INGLIZCHA, o'zbekcha emas.
  assert.equal(infographicLabels("de").cause, "Causes");
  assert.equal(infographicLabels("uz").source, "Manba:");
});

test("tuzilma: ildizda sarlavha, `parent` bloklari ota kartasi ostida", () => {
  const s = spec("map-structure", 3);
  s.blocks.push(block("k1", { parent: "b1" }), block("k2", { parent: "b1" }));
  const l = layoutInfographic(s);
  assert.equal(textsOf(l, "root")[0].lines[0].slice(0, 8), "Suv ayla", "ildiz qutisida plakat sarlavhasi turishi kerak");
  const parent = l.boxes.find((b) => b.id === "b1")!;
  for (const kid of ["k1", "k2"]) {
    const box = l.boxes.find((b) => b.id === kid)!;
    assert.ok(box.y >= parent.y + parent.h - 0.01, `${kid} ota kartasining OSTIDA turishi kerak`);
    assert.ok(box.x >= parent.x, `${kid} ota ustunida qolishi kerak`);
  }
  assert.ok(l.shapes.some((sh) => sh.k === "line" && sh.role === "connector"), "daraxt bog'lovchisi yo'q");
});

/* ══════════════════════════ 6. til / RTL ══════════════════════════ */

test("manba qatori: faqat `source` bo'lganda va TARJIMA qilingan prefiks bilan", () => {
  assert.equal(textsOf(layoutInfographic(spec("list", 4)), "source").length, 0, "manbasiz plakatda pastki qator bo'lmasin");
  const uz = layoutInfographic(spec("list", 4, { source: "6-sinf darsligi" }));
  assert.equal(textsOf(uz, "source")[0].lines[0], "Manba: 6-sinf darsligi");
  const ru = layoutInfographic(spec("list", 4, { source: "6-sinf darsligi", language: "ru" }));
  assert.equal(ru.texts.find((t) => t.role === "source")!.lines[0], "Источник: 6-sinf darsligi");
});

test("RTL: arabcha plakat ko'zguda aks etadi, lotin tillari tegilmaydi", () => {
  assert.ok(isRtl("ar"));
  assert.ok(!isRtl("uz"));
  const ltr = layoutInfographic(spec("timeline", 4));
  const rtl = layoutInfographic(spec("timeline", 4, { language: "ar" }));
  assert.equal(ltr.rtl, false);
  assert.equal(rtl.rtl, true);
  const a = ltr.boxes[0];
  const b = rtl.boxes[0];
  assert.ok(Math.abs(b.x - (ltr.mm.w - a.x - a.w)) < 1e-6, `RTL da karta ko'zguda emas: ${b.x} vs ${ltr.mm.w - a.x - a.w}`);
  const whenLtr = ltr.texts.find((t) => t.role === "when")!;
  const whenRtl = rtl.texts.find((t) => t.role === "when")!;
  assert.equal(whenLtr.anchor, "end");
  assert.equal(whenRtl.anchor, "start", "RTL da matn tekislanishi almashishi kerak");
});

/* ══════════════════════════ 7. soflik ══════════════════════════ */

test("soflik: bir xil spetsifikatsiya — bit-ma-bit bir xil maket", () => {
  const s = spec("stat", 6, { source: "manba" });
  assert.deepEqual(layoutInfographic(s), layoutInfographic(structuredClone(s)));
});

test("maket RANGNI bilmaydi: palitra o'zgarsa geometriya o'zgarmaydi", () => {
  const a = layoutInfographic(spec("compare", 6));
  const b = layoutInfographic(spec("compare", 6, { palette: "sunset" }));
  assert.deepEqual(a, b, "palitra maketga ta'sir qildi — rang faqat `svg.ts` da bo'lishi kerak");
  assert.ok(!JSON.stringify(a).includes("#"), "maketda HEX rang qolib ketgan");
});

test("chegara: `blocksMax` dan ortiq blok kesiladi", () => {
  const l = layoutInfographic(spec("list", INFOGRAPHIC_LIMITS.blocksMax + 4));
  assert.equal(l.boxes.length, INFOGRAPHIC_LIMITS.blocksMax);
});

test("bo'sh bloklar ro'yxati: plakat baribir chiziladi (shapka + fon)", () => {
  const l = layoutInfographic(spec("list", 0));
  assert.equal(l.boxes.length, 0);
  assert.equal(roleRects(l, "header").length, 1);
  assert.ok(textsOf(l, "title").length);
});
