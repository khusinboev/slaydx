import test from "node:test";
import assert from "node:assert/strict";
import {
  INFOGRAPHIC_JUDGE_CRITERIA,
  INFOGRAPHIC_RULE_IDS,
  INFOGRAPHIC_TYPES,
  infographicDefaultTypeId,
  infographicTypeOf,
  normalizeBlockCountFor,
  normalizeInfographicType,
} from "../lib/generation/infographic/registry.ts";
import {
  ICONS,
  ICON_FALLBACK,
  INFOGRAPHIC_LIMITS,
  INFOGRAPHIC_SIZES,
  INFOGRAPHIC_TYPE_IDS,
  PALETTES,
  PALETTE_IDS,
  SIZE_MM,
  iconOf,
  infographicSizeOf,
  isInfographicTypeId,
  isKnownIcon,
  normalizeBlockCount,
  paletteOf,
  type Palette,
} from "../lib/generation/infographic/types.ts";
import { INFOGRAPHIC_PARAMS } from "../lib/generation/infographic-params.ts";

/**
 * INFOGRAFIKA REYESTRI (AUDIT-21 R0).
 *
 * `docs/research/infographic.md` §3 (7 tur, 6 palitra, ≈40 ikon,
 * parametrlar) va §4 (qoidalar, judge) shu yerda QULFLANADI. Palitra
 * kontrasti RO'YXATGA ishonib emas, WCAG 2.1 formulasi bilan HISOBLAB
 * tekshiriladi — hisobot §4 «oldindan hisoblab qulflanadi» deb aynan
 * shuni talab qiladi.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `berry` aksenti hisobotdagi #059669 ga qaytarildi — «har juftlik
 *      ≥4.5:1» testi (oq bilan 3.77, qora bilan 3.92 — ikkalasi ham past);
 *   2. `process` turining yuqori chegarasi 6 → 8 — «tur chegarasi blok
 *      sonini kesadi» testi;
 *   3. `stat` turidan `requires: ["stat"]` olib tashlandi — «statistika
 *      turida har blokda raqam» testi;
 *   4. `ICON_FALLBACK` ro'yxatda yo'q nomga o'zgartirildi — «noma'lum
 *      ikon standartga tushadi» testi;
 *   5. `INFOGRAPHIC_LIMITS.blockTextWordsMax` (40) butun plakat
 *      chegarasidan (160) katta qilindi — «blok chegarasi plakat
 *      chegarasidan kichik» testi.
 */

/* ────────────────── WCAG 2.1 nisbiy yorqinlik va kontrast ────────────────── */

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Nisbiy yorqinlik (WCAG 2.1, 1.4.3). */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Kontrast nisbati (L1 + 0.05) / (L2 + 0.05). */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** WCAG AA oddiy matn uchun (hisobot §4 `contrast`). */
const AA = 4.5;

test("WCAG formulasi to'g'ri — ma'lum qiymatlar bilan kalibrlangan", () => {
  // Mutlaq chegaralar: qora/oq — 21:1, bir xil rang — 1:1.
  assert.equal(Math.round(contrast("#000000", "#FFFFFF")), 21);
  assert.equal(Math.round(contrast("#777777", "#777777")), 1);
  // W3C misoli: #777777 oq fonda ≈ 4.48:1 — AA dan SAL past (chegarani sezadi).
  const gray = contrast("#777777", "#FFFFFF");
  assert.ok(gray > 4.4 && gray < 4.55, `#777 oq fonda ${gray.toFixed(2)}`);
  assert.ok(gray < AA, "MUTATSIYA: formula chegarani yumshatdi — #777 AA dan o'tdi");
});

test("6 palitra: id lar hisobotdan, HEX shakli to'g'ri, ranglar takrorlanmaydi", () => {
  assert.deepEqual([...PALETTE_IDS], ["indigo", "forest", "sunset", "ocean", "berry", "slate"]);
  assert.equal(PALETTES.length, PALETTE_IDS.length);
  assert.deepEqual(PALETTES.map((p) => p.id), [...PALETTE_IDS]);
  const keys = ["dominant", "onDominant", "accent", "onAccent", "accentInk", "surface", "text"] as const;
  for (const p of PALETTES) {
    for (const k of keys) assert.match(p[k], /^#[0-9A-F]{6}$/, `${p.id}.${k}: HEX shakli buzuq — «${p[k]}»`);
    for (const lang of ["uz", "ru", "en"] as const) assert.ok(p.label[lang].length > 0, `${p.id}: ${lang} yorlig'i yo'q`);
    // Fon va dominant bir xil bo'lsa plakatda sarlavha tasmasi ko'rinmaydi.
    assert.notEqual(p.dominant, p.surface, `${p.id}: dominant va fon bir xil`);
  }
  // Palitralar bir-birining nusxasi emas (6 xil dominant).
  assert.equal(new Set(PALETTES.map((p) => p.dominant)).size, PALETTES.length, "ikki palitra bir xil dominant rangda");
  // Noma'lum/bo'sh qiymat standartga (`indigo`) tushadi.
  assert.equal(paletteOf("berry").id, "berry");
  for (const bad of ["yo'q", "", null, undefined, 7]) assert.equal(paletteOf(bad).id, "indigo", `${String(bad)}: standartga tushmadi`);
});

test("har palitrada BARCHA e'lon qilingan juftlik ≥ 4.5:1 (WCAG AA, hisoblab)", () => {
  /*
   * Juftliklar — rangning ISHI: `accent` badge FONI (ustida `onAccent`),
   * `accentInk` esa `surface` ustida CHIZILADIGAN raqam. Bitta rang
   * ikkala ishni bajara olmaydi (amber qora matn ostida 6.87, oq fonda
   * 1.97) — shuning uchun palitra ikkalasini alohida e'lon qiladi.
   */
  const pairs = (p: Palette): [string, string, string][] => [
    ["matn / fon", p.text, p.surface],
    ["sarlavha tasmasi", p.onDominant, p.dominant],
    ["badge matni", p.onAccent, p.accent],
    ["aksent siyoh / fon", p.accentInk, p.surface],
    ["blok sarlavhasi / fon", p.dominant, p.surface],
  ];
  for (const p of PALETTES) {
    for (const [name, fg, bg] of pairs(p)) {
      const ratio = contrast(fg, bg);
      assert.ok(ratio >= AA, `${p.id} — ${name}: ${fg} ustida ${bg} = ${ratio.toFixed(2)}:1 (kerak ≥ ${AA})`);
    }
  }
});

test("7 tur hisobotdan; standart — `list`; noma'lum tur standartga tushadi", () => {
  assert.deepEqual([...INFOGRAPHIC_TYPE_IDS], ["list", "process", "compare", "stat", "timeline", "cause-effect", "map-structure"]);
  assert.equal(INFOGRAPHIC_TYPES.length, 7);
  assert.deepEqual(INFOGRAPHIC_TYPES.map((t) => t.id), [...INFOGRAPHIC_TYPE_IDS]);
  assert.equal(infographicDefaultTypeId(), "list");
  assert.equal(normalizeInfographicType("timeline"), "timeline");
  for (const bad of ["yo'q-bunday", "", null, undefined]) assert.equal(normalizeInfographicType(bad), "list", `${String(bad)}: standartga tushmadi`);
  assert.ok(isInfographicTypeId("cause-effect"));
  assert.ok(!isInfographicTypeId("venn"), "hisobotda yo'q tur qabul qilindi");
  for (const t of INFOGRAPHIC_TYPES) {
    assert.ok(t.hint.length > 10, `${t.id}: forma izohi yo'q`);
    for (const lang of ["uz", "ru", "en"] as const) assert.ok(t.label[lang].length > 0, `${t.id}: ${lang} yorlig'i yo'q`);
    assert.ok(t.guidance.length >= 3, `${t.id}: kamida 3 qoida kerak`);
    for (const g of t.guidance) assert.ok(g.length > 40, `${t.id}: «${g}» juda qisqa`);
  }
});

test("blok chegaralari: umumiy 3–8 ichida, standart chegarada, tur soni kesadi", () => {
  assert.equal(INFOGRAPHIC_LIMITS.blocksMin, 3);
  assert.equal(INFOGRAPHIC_LIMITS.blocksMax, 8);
  assert.deepEqual([...INFOGRAPHIC_LIMITS.blockCounts], [3, 4, 5, 6, 8]);
  for (const t of INFOGRAPHIC_TYPES) {
    const [lo, hi] = t.limits.blocks;
    assert.ok(lo >= INFOGRAPHIC_LIMITS.blocksMin, `${t.id}: pastki chegara umumiydan past`);
    assert.ok(hi <= INFOGRAPHIC_LIMITS.blocksMax, `${t.id}: yuqori chegara umumiydan yuqori`);
    assert.ok(lo < hi, `${t.id}: chegara teskari`);
    assert.ok(t.limits.blocksDefault >= lo && t.limits.blocksDefault <= hi, `${t.id}: standart chegaradan tashqarida`);
  }
  // Umumiy normalizatsiya: chiplardan tashqarisi standartga tushadi.
  for (const n of INFOGRAPHIC_LIMITS.blockCounts) assert.equal(normalizeBlockCount(n), n);
  for (const bad of [0, 7, 9, -3, "ko'p", null]) assert.equal(normalizeBlockCount(bad), INFOGRAPHIC_LIMITS.blocksDefault, `${String(bad)}`);
  // TUR bo'yicha: `process` da 8 blok yo'q — 6 ga kesiladi.
  assert.equal(normalizeBlockCountFor("process", 8), 6, "MUTATSIYA: tur chegarasi blok sonini kesmadi");
  assert.equal(normalizeBlockCountFor("list", 8), 8);
  assert.equal(normalizeBlockCountFor("compare", 3), 4, "taqqoslashda ikki ustun uchun kamida 4 blok kerak");
  assert.equal(normalizeBlockCountFor("process", 7), infographicTypeOf("process").limits.blocksDefault, "chiplardan tashqari qiymat turning standartiga tushadi");
});

test("tur MAJBURIY maydonlari hisobot §3 «maxsus maydon» ustunidan", () => {
  const want: Record<string, string[]> = {
    list: [],
    process: ["order"],
    compare: ["side"],
    stat: ["stat"],
    timeline: ["when"],
    "cause-effect": ["role"],
    "map-structure": [],
  };
  for (const t of INFOGRAPHIC_TYPES) {
    assert.deepEqual([...t.requires], want[t.id], `${t.id}: majburiy maydonlar ro'yxati hisobotdan farq qiladi`);
  }
  // `stat` turida raqam MAJBURIY (`statPresent` qoidasi shunga tayanadi).
  assert.ok(infographicTypeOf("stat").requires.includes("stat"), "MUTATSIYA: statistika turida raqam ixtiyoriy bo'lib qoldi");
  // Ro'yxat turlarida majburiy maydon yo'q — aks holda forma tanlovi ma'nosiz bo'lardi.
  assert.equal(infographicTypeOf("list").requires.length, 0);
});

test("ikonlar: ≈40 ta, unikal slug, standart ikon ro'yxat ichida", () => {
  assert.ok(ICONS.length >= 35 && ICONS.length <= 45, `ikonlar soni ${ICONS.length} — hisobot ≈40 deydi`);
  assert.equal(new Set(ICONS).size, ICONS.length, "ikon nomi takrorlandi");
  for (const name of ICONS) assert.match(name, /^[a-z][a-z0-9-]*$/, `«${name}»: Tabler slug shakliga mos emas`);
  assert.ok(ICONS.includes(ICON_FALLBACK), "MUTATSIYA: standart ikon ro'yxatda yo'q");
  assert.ok(isKnownIcon("atom"));
  assert.ok(!isKnownIcon("rocket-launch-9000"));
  assert.equal(iconOf("atom"), "atom");
  for (const bad of ["rocket-launch-9000", "", null, undefined, 42]) assert.equal(iconOf(bad), ICON_FALLBACK, `${String(bad)}: standart ikonga tushmadi`);
});

test("plakat chegaralari: matn 160 so'z, blok 40, sarlavha 80 belgi; A4/A3 mm", () => {
  /*
   * Hisobot §4 ≤120 so'z deb tavsiya qilgan; egasi qarori bo'yicha 160
   * ga yumshatildi — 8 blokli plakatda 120 so'z blokka 12 so'zdan
   * qoldirar va hisobotning O'Z «yaxshi misol» i (25 so'zli blok) ham
   * o'tmasdi.
   */
  assert.equal(INFOGRAPHIC_LIMITS.textWordsMax, 160);
  assert.equal(INFOGRAPHIC_LIMITS.blockTextWordsMax, 40);
  assert.equal(INFOGRAPHIC_LIMITS.titleCharsMax, 80);
  assert.ok(
    INFOGRAPHIC_LIMITS.blockTextWordsMax < INFOGRAPHIC_LIMITS.textWordsMax,
    "MUTATSIYA: bitta blok butun plakatdan ko'p so'z olishi mumkin bo'lib qoldi",
  );
  assert.ok(INFOGRAPHIC_LIMITS.headingCharsMax < INFOGRAPHIC_LIMITS.titleCharsMax, "blok sarlavhasi plakat sarlavhasidan uzun bo'lmasin");
  // O'lchamlar: A4 portret, A3 — ikki baravar yuza.
  assert.deepEqual([...INFOGRAPHIC_SIZES], ["A4", "A3"]);
  assert.deepEqual(SIZE_MM.A4, { width: 210, height: 297 });
  assert.deepEqual(SIZE_MM.A3, { width: 297, height: 420 });
  for (const s of INFOGRAPHIC_SIZES) assert.ok(SIZE_MM[s].height > SIZE_MM[s].width, `${s}: portret bo'lishi kerak`);
  assert.equal(infographicSizeOf("A3"), "A3");
  for (const bad of ["A5", "", null, undefined]) assert.equal(infographicSizeOf(bad), "A4", `${String(bad)}: A4 ga tushmadi`);
  // 300 dpi da A4 kengligi 2480 px (hisobot §3).
  assert.equal(Math.round((SIZE_MM.A4.width / 25.4) * INFOGRAPHIC_LIMITS.dpi), 2480);
});

test("baholovchi: hisobot §4 dagi beshta mezon; halollik bandi har turda bor", () => {
  assert.deepEqual([...INFOGRAPHIC_JUDGE_CRITERIA], ["topicClarity", "visualLogic", "headingConciseness", "ageFit", "honestyCheck"]);
  for (const t of INFOGRAPHIC_TYPES) {
    const j = t.judge;
    assert.deepEqual([...j.criteria], [...INFOGRAPHIC_JUDGE_CRITERIA], `${t.id}: mezonlar ro'yxati farq qiladi`);
    for (const c of j.criteria) {
      assert.ok(j.describe[c] && j.describe[c].length > 30, `${t.id}/${c}: izoh yo'q`);
      assert.ok(j.labels[c] && j.labels[c].length > 0, `${t.id}/${c}: o'zbekcha yorliq yo'q`);
    }
    assert.ok(j.roleLine && j.roleLine.length > 20, `${t.id}: baholovchi roli yo'q`);
    assert.equal(j.typeNoun, "infographic type");
    assert.ok(j.typeLabel && j.typeLabel.length > 0, `${t.id}: tur nomi qavsda yo'q`);
  }
  // Tur bo'yicha o'ziga xoslik: `visualLogic` aynan turga moslashadi.
  const base = infographicTypeOf("list").judge.describe.visualLogic;
  for (const id of ["process", "compare", "timeline", "cause-effect", "map-structure", "stat"]) {
    const own = infographicTypeOf(id).judge.describe;
    assert.ok(own.visualLogic !== base || own.honestyCheck !== infographicTypeOf("list").judge.describe.honestyCheck, `${id}: turga xos izoh yo'q`);
  }
  // Statistika turida halollik izohi KUCHAYTIRILGAN (uydirma raqam — darhol 0).
  assert.notEqual(infographicTypeOf("stat").judge.describe.honestyCheck, infographicTypeOf("list").judge.describe.honestyCheck);
});

test("hisobot qoidalari: id lar unikal, hisobot §4 dagi yettita band bor", () => {
  assert.equal(new Set(INFOGRAPHIC_RULE_IDS).size, INFOGRAPHIC_RULE_IDS.length, "qoida id lari takrorlandi");
  for (const id of ["blockCount", "textLength", "titleLength", "iconKnown", "contrast", "noOverflow", "statPresent"]) {
    assert.ok(INFOGRAPHIC_RULE_IDS.includes(id), `MUTATSIYA: hisobot qoidasi «${id}» yo'qoldi`);
  }
  // WP-C qo'shgan ikki band: tur maydonlari va manba halolligi.
  assert.ok(INFOGRAPHIC_RULE_IDS.includes("typeFields"));
  assert.ok(INFOGRAPHIC_RULE_IDS.includes("sourceGrounded"));
});

test("zond reyestri: id unikal, har parametrning ta'siri va IKKI XIL qiymati bor", () => {
  const ids = INFOGRAPHIC_PARAMS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "parametr id lari takrorlandi");
  for (const p of INFOGRAPHIC_PARAMS) {
    assert.ok(p.impacts.length > 0, `${p.id}: hech narsaga ta'sir qilmaydi — «bezak maydon»`);
    assert.notDeepEqual(p.probeA, p.probeB, `MUTATSIYA: ${p.id} zondi bir xil ikki qiymatni solishtiradi`);
  }
  for (const need of ["topic", "infographicType", "blockCount", "palette", "size", "language", "extra"]) {
    assert.ok(ids.includes(need), `«${need}» maydoni reyestrda yo'q`);
  }
  // `blockCount` zondi HAR turda haqiqiy farq beradi (tur chegarasi ikkalasini bir qiymatga kesmasin).
  const bc = INFOGRAPHIC_PARAMS.find((p) => p.id === "blockCount")!;
  for (const t of INFOGRAPHIC_TYPES) {
    const a = normalizeBlockCountFor(t.id, bc.probeA);
    const b = normalizeBlockCountFor(t.id, bc.probeB);
    assert.notEqual(a, b, `MUTATSIYA: ${t.id} da blockCount zondi farq bermaydi (${a} = ${b})`);
  }
  // Narx tekis (egasi qarori 6): hech bir parametr narxga ta'sir qilmaydi.
  for (const p of INFOGRAPHIC_PARAMS) assert.ok(!(p.impacts as readonly string[]).includes("price"), `MUTATSIYA: ${p.id} narxga ta'sir qiladi`);
});
