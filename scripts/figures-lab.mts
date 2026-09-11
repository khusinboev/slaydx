/**
 * Maqola 2 (AUDIT-17) WP3 — sxemalarni ko'z bilan ko'rish laboratoriyasi.
 *
 *   scripts/heavy.sh -m 2G npx tsx scripts/figures-lab.mts [chiqish papkasi]
 *
 * 10 namuna (flow 8 tugun + decision, flow 14 tugun (chegara), flow LR,
 * process 6 qadam, tree 3 daraja, keng daraxt (osilgan barglar), PRISMA,
 * chart bar/line/pie) → SVG + PNG 300 dpi. Standart papka `/tmp/figs`.
 */
import fs from "node:fs";
import path from "node:path";
import type { Figure } from "../lib/generation/article/types";
import { layoutFigure } from "../lib/generation/figures/layout";
import { figureSvg } from "../lib/generation/figures/svg";
import { figurePng } from "../lib/generation/figures/png";
import { buildFigure } from "../lib/generation/figures/index";

const outDir = process.argv[2] || "/tmp/figs";
fs.mkdirSync(outDir, { recursive: true });

export const SAMPLES: Figure[] = [
  {
    id: "flow8",
    kind: "scheme",
    caption: "Adaptiv o‘qitish tizimida ma’lumotlarni qayta ishlash algoritmi",
    w: 0,
    h: 0,
    spec: {
      kind: "flow",
      direction: "TB",
      nodes: [
        { id: "s", label: "Boshlash", kind: "start" },
        { id: "in", label: "Talaba faoliyati ma’lumotlari", kind: "data" },
        { id: "pre", label: "Oldindan qayta ishlash va normallashtirish" },
        { id: "model", label: "Mashinaviy o‘rganish modeli" },
        { id: "dec", label: "Aniqlik yetarlimi?", kind: "decision" },
        { id: "tune", label: "Giperparametrlarni sozlash" },
        { id: "rec", label: "Shaxsiy tavsiyalar shakllantirish" },
        { id: "e", label: "Yakun", kind: "end" },
      ],
      edges: [
        { from: "s", to: "in" },
        { from: "in", to: "pre" },
        { from: "pre", to: "model" },
        { from: "model", to: "dec" },
        { from: "dec", to: "tune", label: "Yo‘q" },
        { from: "dec", to: "rec", label: "Ha" },
        { from: "tune", to: "rec" },
        { from: "rec", to: "e" },
        { from: "in", to: "rec", label: "to‘g‘ridan-to‘g‘ri" },
      ],
    },
  },
  {
    id: "proc6",
    kind: "scheme",
    caption: "Tadqiqot bosqichlari",
    w: 0,
    h: 0,
    spec: {
      kind: "process",
      steps: ["Muammoni aniqlash va maqsad qo‘yish", "Adabiyotlar tahlili", "Metodikani ishlab chiqish", "Ma’lumot yig‘ish (so‘rovnoma, 312 respondent)", "Statistik tahlil (SPSS, regressiya)", "Xulosa va tavsiyalar"],
    },
  },
  {
    id: "tree3",
    kind: "scheme",
    caption: "Sun’iy intellekt vositalarining ta’limdagi tasnifi",
    w: 0,
    h: 0,
    spec: {
      kind: "tree",
      root: "Ta’limda sun’iy intellekt vositalari",
      children: [
        { label: "Adaptiv o‘qitish", children: [{ label: "Intellektual repetitorlar" }, { label: "Shaxsiy traektoriya" }] },
        { label: "Baholash", children: [{ label: "Avtomatik tekshirish" }, { label: "Plagiat aniqlash" }, { label: "Tahliliy panellar" }] },
        { label: "Ma’muriy", children: [{ label: "Chat-botlar" }, { label: "Jadval tuzish" }] },
      ],
    },
  },
  {
    id: "prisma",
    kind: "scheme",
    caption: "Tadqiqotlarni tanlash jarayoni (PRISMA 2020)",
    w: 0,
    h: 0,
    spec: { kind: "prisma", identified: 1245, screened: 987, excludedScreen: 812, eligible: 175, excludedElig: 143, included: 32, sources: "Scopus, Web of Science, Google Scholar" },
  },
  {
    id: "chart-bar",
    kind: "chart",
    caption: "Tajriba va nazorat guruhlari o‘zlashtirish ko‘rsatkichlari",
    w: 0,
    h: 0,
    spec: {
      kind: "chart",
      chart: "bar",
      dataSource: "user",
      series: [
        { name: "Tajriba guruhi", values: [62.5, 71.2, 78.9, 84.3] },
        { name: "Nazorat guruhi", values: [61.8, 64.1, 66.7, 69.0] },
      ],
      categories: ["1-nazorat", "2-nazorat", "3-nazorat", "Yakuniy"],
      unit: "%",
    },
  },
  {
    id: "chart-line",
    kind: "chart",
    caption: "Oylik faollik dinamikasi",
    w: 0,
    h: 0,
    spec: {
      kind: "chart",
      chart: "line",
      dataSource: "user",
      series: [
        { name: "Platforma A", values: [120, 135, 150, 148, 171, 190] },
        { name: "Platforma B", values: [90, 95, 110, 125, 122, 140] },
        { name: "Platforma C", values: [60, 70, 65, 80, 95, 101] },
      ],
      categories: ["Yan", "Fev", "Mar", "Apr", "May", "Iyun"],
      unit: "ming foydalanuvchi",
    },
  },
  {
    id: "chart-pie",
    kind: "chart",
    caption: "Respondentlar tarkibi",
    w: 0,
    h: 0,
    spec: { kind: "chart", chart: "pie", dataSource: "user", series: [{ name: "Ulush", values: [148, 96, 44, 24] }], categories: ["Bakalavr", "Magistr", "O‘qituvchi", "Boshqa"], unit: "kishi" },
  },
  {
    id: "tree-wide",
    kind: "scheme",
    caption: "Ko‘p bargli tasnif (osilgan barglar rejimi)",
    w: 0,
    h: 0,
    spec: {
      kind: "tree",
      root: "Raqamli ta’lim vositalari tasnifi",
      children: [
        { label: "Sinxron", children: ["Video-konferensiya", "Onlayn doska", "Jonli so‘rovnoma", "Virtual laboratoriya"].map((label) => ({ label })) },
        { label: "Asinxron", children: ["O‘quv boshqaruv tizimi", "Video darslar", "Forumlar", "Elektron kutubxona"].map((label) => ({ label })) },
        { label: "Aralash", children: ["Flipped classroom", "Mikro-o‘qitish"].map((label) => ({ label })) },
      ],
    },
  },
  {
    id: "flow14",
    kind: "scheme",
    caption: "14 tugunli blok-sxema (chegara)",
    w: 0,
    h: 0,
    spec: {
      kind: "flow",
      direction: "TB",
      nodes: [
        { id: "a", label: "Boshlash", kind: "start" },
        { id: "b", label: "Talabnoma qabul qilish", kind: "data" },
        { id: "c", label: "Hujjatlarni tekshirish" },
        { id: "d", label: "To‘liqmi?", kind: "decision" },
        { id: "e", label: "Qo‘shimcha hujjat so‘rash" },
        { id: "f", label: "Ekspertiza" },
        { id: "g", label: "Moliyaviy baholash" },
        { id: "h", label: "Huquqiy baholash" },
        { id: "i", label: "Texnik baholash" },
        { id: "j", label: "Yig‘ma xulosa" },
        { id: "k", label: "Tasdiqlanadimi?", kind: "decision" },
        { id: "l", label: "Rad etish xati", kind: "data" },
        { id: "m", label: "Shartnoma tuzish" },
        { id: "n", label: "Yakun", kind: "end" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "d" },
        { from: "d", to: "e", label: "Yo‘q" },
        { from: "e", to: "f" },
        { from: "d", to: "f", label: "Ha" },
        { from: "f", to: "g" },
        { from: "f", to: "h" },
        { from: "f", to: "i" },
        { from: "g", to: "j" },
        { from: "h", to: "j" },
        { from: "i", to: "j" },
        { from: "j", to: "k" },
        { from: "k", to: "l", label: "Yo‘q" },
        { from: "k", to: "m", label: "Ha" },
        { from: "l", to: "n" },
        { from: "m", to: "n" },
      ],
    },
  },
  {
    id: "flow-lr",
    kind: "scheme",
    caption: "Tizim arxitekturasi (LR)",
    w: 0,
    h: 0,
    spec: {
      kind: "flow",
      direction: "LR",
      nodes: [
        { id: "u", label: "Foydalanuvchi", kind: "start" },
        { id: "web", label: "Veb-interfeys" },
        { id: "api", label: "API server" },
        { id: "db", label: "Ma’lumotlar bazasi", kind: "data" },
        { id: "llm", label: "LLM xizmati" },
        { id: "out", label: "Hujjat", kind: "end" },
      ],
      edges: [
        { from: "u", to: "web" },
        { from: "web", to: "api" },
        { from: "api", to: "db" },
        { from: "api", to: "llm" },
        { from: "llm", to: "out" },
        { from: "db", to: "out" },
      ],
    },
  },
];

async function main() {
  for (const f of SAMPLES) {
    const t0 = Date.now();
    const layout = layoutFigure(f.spec, { lang: "uz" });
    if (!layout) {
      console.log(`${f.id}: maket YO'Q (fallback)`);
      continue;
    }
    const svg = figureSvg(layout);
    fs.writeFileSync(path.join(outDir, `${f.id}.svg`), svg);
    const png = await figurePng(svg);
    if (!png) {
      console.log(`${f.id}: PNG xato`);
      continue;
    }
    fs.writeFileSync(path.join(outDir, `${f.id}.png`), png.png);
    const built = await buildFigure(f, { lang: "uz" });
    console.log(`${f.id}: ${layout.mm.w}×${layout.mm.h} mm, ${png.w}×${png.h} px, ${Math.round(png.png.length / 1024)} KB, ${Date.now() - t0} ms, url=${built.url ? "bor" : "yo'q"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
