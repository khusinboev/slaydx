import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { layoutInfographic } from "../lib/generation/infographic/layout.ts";
import { INFOGRAPHIC_FONT, fillOf, inkOf, mix, renderInfographic } from "../lib/generation/infographic/svg.ts";
import { DRAWN_ICONS, ICON_GRID, ICON_PATHS, ICON_STROKE, iconPaths } from "../lib/generation/infographic/icons.ts";
import { ICONS, ICON_FALLBACK, PALETTES, PALETTE_BY_ID, SIZE_MM, type InfographicSpec } from "../lib/generation/infographic/types.ts";
import { figurePng, svgWidthPx, targetWidthPx } from "../lib/generation/figures/png.ts";

/**
 * INFOGRAFIKA SVG VA IKONLAR (AUDIT-21 WP-C).
 *
 * Ikki shartnoma qulflanadi:
 *   1. HAR `ICONS` nomining chizmasi bor (`scripts/gen-icons.mts`
 *      natijasi eskirmasin — `sigma` → Tabler `sum` moslamasi ham);
 *   2. SVG ranglari FAQAT palitradan keladi va o'lchov `figurePng`
 *      bilan A4 @300 dpi = 2480 px beradi (birliksiz `width` sharti).
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `icons.ts` dan `sigma` yozuvi o'chirildi — «har ikonda path bor»;
 *   2. `iconPaths` dagi `ICON_FALLBACK` shoxi olib tashlandi —
 *      «noma'lum ikon standartga tushadi»;
 *   3. `svg.ts` dagi `<svg width>` ga `mm` qo'shildi — «A4 @300 dpi =
 *      2480 px» (7027 px chiqdi);
 *   4. `inkOf("columnHeadAlt")` `onDominant` ga qaytarildi — «ustun
 *      tasmasi qulflangan juftlikdan» testi;
 *   5. `xmlEscape` chaqiruvi `textSvg` dan olib tashlandi — «sarlavhadagi
 *      `<`/`&` ekranlanadi» testi.
 */

const SPEC: InfographicSpec = {
  title: "Suv aylanishi",
  subtitle: "Quyosh energiyasi boshqaradigan jarayon",
  type: "list",
  palette: "indigo",
  size: "A4",
  language: "uz",
  blocks: Array.from({ length: 4 }, (_, i) => ({
    id: `b${i + 1}`,
    icon: ICONS[i],
    heading: `Bosqich ${i + 1}`,
    text: "Bu blok mavzuga oid aniq bir faktni bayon qiladi.",
  })),
};

/**
 * `types.ts` da WCAG bo'yicha qulflangan FON ↔ SIYOH juftliklari
 * (`Palette` izohi). `svg.ts` dagi rol jadvali faqat shulardan
 * foydalanishi kerak.
 */
const LOCKED: [keyof typeof PALETTES[number], keyof typeof PALETTES[number]][] = [
  ["surface", "text"],
  ["dominant", "onDominant"],
  ["accent", "onAccent"],
  ["surface", "accentInk"],
  ["surface", "dominant"],
];

const svgOf = (over: Partial<InfographicSpec> = {}) => {
  const spec = { ...SPEC, ...over };
  return renderInfographic(layoutInfographic(spec), PALETTE_BY_ID[spec.palette]);
};

/* ══════════════════════════ ikonlar ══════════════════════════ */

test("ikonlar: `ICONS` ning HAR nomi uchun chizma bor", () => {
  const missing = ICONS.filter((n) => !ICON_PATHS[n]?.length);
  assert.deepEqual(missing, [], `chizmasi yo'q ikonlar: ${missing.join(", ")} — \`npm run gen:icons\` yurgizing`);
  assert.equal(DRAWN_ICONS.length, ICONS.length);
  assert.ok(ICONS.length >= 40, `hisobot ≈40 ikon so'ragan, hozir ${ICONS.length}`);
});

test("ikonlar: har `d` satri 24×24 panjarada va shaffof ramka tashlangan", () => {
  assert.equal(ICON_GRID, 24);
  assert.equal(ICON_STROKE, 2);
  for (const [name, paths] of Object.entries(ICON_PATHS)) {
    for (const d of paths) {
      assert.ok(/^[Mm]/.test(d), `${name}: path «M» bilan boshlanmaydi`);
      assert.ok(!/^M0\s*0h24v24H0z$/.test(d.trim()), `${name}: shaffof ramka path i ko'chib qolgan`);
      // Tabler `.53` ko'rinishidagi (nol qismi tushirilgan) sonlarni ham yozadi.
      const nums = d.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
      for (const v of nums) assert.ok(Math.abs(Number(v)) <= 48, `${name}: ${v} — 24×24 panjaradan juda uzoq`);
    }
  }
});

test("ikonlar: noma'lum/bo'sh nom `ICON_FALLBACK` ga tushadi", () => {
  assert.deepEqual(iconPaths("mavjud-emas-ikon"), ICON_PATHS[ICON_FALLBACK]);
  assert.deepEqual(iconPaths(undefined), ICON_PATHS[ICON_FALLBACK]);
  assert.deepEqual(iconPaths("bulb"), ICON_PATHS.bulb);
  assert.ok(ICONS.includes(ICON_FALLBACK), "standart ikon ro'yxatda bo'lishi kerak");
});

test("ikonlar: litsenziya hujjati va generator repoda saqlanadi", () => {
  const lic = readFileSync(new URL("../data/ICONS-LICENSE.md", import.meta.url), "utf8");
  assert.ok(/MIT License/.test(lic), "MIT litsenziya matni yo'q");
  assert.ok(/tabler/i.test(lic), "manba to'plam ko'rsatilmagan");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(pkg.devDependencies["@tabler/icons"], "@tabler/icons DEV bog'liqlik bo'lishi kerak");
  assert.ok(!pkg.dependencies?.["@tabler/icons"], "@tabler/icons RUNTIME bog'liqlik BO'LMASLIGI kerak");
});

/* ══════════════════════════ SVG tuzilishi ══════════════════════════ */

test("SVG: viewBox mm da, `width` BIRLIKSIZ (figurePng zichligi buzilmasin)", () => {
  const svg = svgOf();
  assert.ok(svg.startsWith("<svg "), "SVG ildizi yo'q");
  assert.ok(svg.includes(`viewBox="0 0 ${SIZE_MM.A4.width} ${SIZE_MM.A4.height}"`), "A4 viewBox mm da emas");
  assert.ok(/<svg[^>]*\swidth="210"/.test(svg), "`width` birliksiz bo'lishi kerak (mm qo'shilsa zichlik ikki marta qo'llanadi)");
  assert.equal(svgWidthPx(svg), SIZE_MM.A4.width);
  const a3 = svgOf({ size: "A3" });
  assert.ok(a3.includes(`viewBox="0 0 ${SIZE_MM.A3.width} ${SIZE_MM.A3.height}"`));
});

test("SVG: shrift ro'yxati worker konteyneridagi paketlarga tayanadi", () => {
  assert.ok(INFOGRAPHIC_FONT.startsWith("Liberation Sans"), "birinchi shrift Liberation Sans bo'lishi kerak");
  assert.ok(/Noto Sans/.test(INFOGRAPHIC_FONT), "kirill/kengaytirilgan lotin uchun Noto Sans kerak");
  assert.ok(svgOf().includes(`font-family="${INFOGRAPHIC_FONT.replace(/&/g, "&amp;")}"`));
  const df = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  // Base image endi `ARG NODE_IMAGE` orqali qulflangan (INFRA-14/DEPS-05) —
  // qattiq yozilgan "node:22-alpine" emas, `${NODE_IMAGE}` o'zgaruvchisi.
  const worker = df.slice(df.search(/^FROM \S+ AS worker$/m));
  for (const pkg of ["ttf-liberation", "font-noto"]) {
    assert.ok(worker.includes(pkg), `worker bosqichida ${pkg} yo'q — plakat matni «□□□» chiqadi`);
  }
});

test("SVG: ikon guruhi strok bilan chiziladi va masshtablanadi", () => {
  const svg = svgOf();
  const g = /<g transform="translate\([\d.\- ]+\) scale\(([\d.]+)\)" fill="none" stroke="([^"]+)" stroke-width="2"/.exec(svg);
  assert.ok(g, "ikon guruhi topilmadi");
  assert.ok(Number(g![1]) > 0 && Number(g![1]) < 1, `masshtab ${g![1]} — 24 birlik ikon 14 mm doiraga kichraytirilishi kerak`);
  assert.equal(g![2], PALETTE_BY_ID.indigo.onAccent, "ikon aksent FONI ustidagi siyoh bilan chizilishi kerak");
});

/* ══════════════════════════ ranglar ══════════════════════════ */

test("ranglar: HAR rang palitradan (yoki uning oq bilan aralashmasidan)", () => {
  for (const p of PALETTES) {
    const svg = renderInfographic(layoutInfographic({ ...SPEC, palette: p.id, source: "manba" }), p);
    const allowed = new Set<string>([p.dominant, p.onDominant, p.accent, p.onAccent, p.accentInk, p.surface, p.text, "#FFFFFF", "none"]);
    // Aralashmalar (karta tinti, chegara, ikkilamchi siyoh) — jadvaldan.
    for (const t of [0.07, 0.22, 0.35]) allowed.add(mix(p.dominant, "#FFFFFF", t));
    allowed.add(mix(p.text, "#FFFFFF", 0.35));
    allowed.add(mix(p.text, p.surface, 0.62));
    for (const m of svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)) {
      const c = m[1];
      if (c.startsWith("url(")) continue;
      assert.ok(allowed.has(c), `${p.id}: «${c}» palitradan tashqarida`);
    }
  }
});

test("ranglar: shapka tasmasi va sarlavha QULFLANGAN juftlikdan", () => {
  const p = PALETTE_BY_ID.ocean;
  const svg = renderInfographic(layoutInfographic({ ...SPEC, palette: "ocean" }), p);
  assert.ok(new RegExp(`<rect [^>]*fill="${p.dominant}"`).test(svg), "shapka `dominant` bilan to'ldirilmagan");
  assert.ok(new RegExp(`<text [^>]*fill="${p.onDominant}"`).test(svg), "sarlavha `onDominant` bilan yozilmagan");
});

test("ranglar: HAR rol qulflangan JUFTLIKKA bog'langan (fon ↔ siyoh)", () => {
  /*
   * Rol→rang jadvali TO'G'RIDAN-TO'G'RI tekshiriladi, chiqqan SVG dan
   * emas: `onAccent` ba'zi palitrada `text` bilan bir xil HEX (forest
   * #1F2933), shuning uchun «SVG da shu rang bor» sinovi noto'g'ri
   * siyohni ham o'tkazib yuborardi (mutatsiya s4 yashil qolgan edi).
   */
  for (const p of PALETTES) {
    const pairs: [string, string, string][] = [
      ["header", fillOf("header", p)!, inkOf("title", p)],
      ["header", fillOf("header", p)!, inkOf("subtitle", p)],
      ["columnHead", fillOf("columnHead", p)!, inkOf("columnHead", p)],
      ["columnHeadAlt", fillOf("columnHeadAlt", p)!, inkOf("columnHeadAlt", p)],
      ["badge", fillOf("badge", p)!, inkOf("badge", p)],
      ["root", fillOf("root", p)!, inkOf("root", p)],
    ];
    for (const [role, bg, ink] of pairs) {
      const locked = LOCKED.find(([b, i]) => p[b] === bg && p[i] === ink);
      assert.ok(locked, `${p.id}/${role}: ${bg} + ${ink} — \`types.ts\` da qulflangan juftlik emas`);
    }
    assert.equal(inkOf("columnHeadAlt", p), p.onAccent, `${p.id}: aksent tasmasidagi matn \`onAccent\` bo'lishi kerak`);
    assert.equal(inkOf("stat", p), p.accentInk, `${p.id}: \`surface\` ustida yozilgan raqam \`accentInk\` bo'lishi kerak`);
  }
});

test("ranglar: palitra almashsa SVG o'zgaradi, bir xil palitrada — aynan bir xil", () => {
  assert.notEqual(svgOf(), svgOf({ palette: "berry" }));
  assert.equal(svgOf(), svgOf());
});

/* ══════════════════════════ xavfsizlik ══════════════════════════ */

test("xavfsizlik: model bergan matndagi `<`/`&` ekranlanadi", () => {
  const svg = svgOf({ title: `A < B & "C"`, subtitle: "<script>x</script>" });
  assert.ok(!svg.includes("<script>"), "xom teg SVG ga tushdi");
  assert.ok(svg.includes("&lt;") && svg.includes("&amp;"), "belgilar ekranlanmagan");
});

/* ══════════════════════════ PNG ══════════════════════════ */

test("PNG: A4 @300 dpi = 2480×3507 px, A3 = 3508×4960 px", async () => {
  assert.equal(targetWidthPx(SIZE_MM.A4.width, 300), 2480);
  const a4 = await figurePng(svgOf(), { widthMm: SIZE_MM.A4.width, dpi: 300 });
  assert.ok(a4, "sharp PNG bermadi");
  assert.equal(a4!.w, 2480);
  assert.ok(Math.abs(a4!.h - 3508) <= 2, `A4 balandligi ${a4!.h}, kutilgan ≈3508`);
  assert.ok(a4!.png.length > 10_000, "PNG juda kichik — chizilmagan bo'lishi mumkin");

  const a3 = await figurePng(svgOf({ size: "A3" }), { widthMm: SIZE_MM.A3.width, dpi: 300 });
  assert.ok(a3, "A3 PNG bermadi");
  assert.equal(a3!.w, targetWidthPx(SIZE_MM.A3.width, 300));
  assert.ok(a3!.w > a4!.w, "A3 A4 dan kattaroq chiqishi kerak");
});
