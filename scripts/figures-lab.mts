/**
 * Maqola 2 (AUDIT-17) WP3 — sxemalarni ko'z bilan ko'rish laboratoriyasi.
 *
 *   scripts/heavy.sh -m 2G npx tsx scripts/figures-lab.mts [chiqish papkasi]
 *
 * 10 namuna (flow 8 tugun + decision, flow 14 tugun (chegara), flow LR,
 * process 6 qadam, tree 3 daraja, keng daraxt (osilgan barglar), PRISMA,
 * chart bar/line/pie) + AUDIT-18 WP-B: layers 7 qatlam (chegara) va 3
 * qatlam bandsiz, cycle 8 bosqich (chegara) va 4 bosqich teskari, timeline
 * 10 voqea (ikki qator) va 4 voqea, matrix o'qli va SWOT, compare ustunli va
 * `rows` bilan → SVG + PNG 300 dpi. Standart papka `/tmp/figs`.
 *
 *   scripts/heavy.sh -m 2G -t 300 npx tsx scripts/figures-lab.mts [papka] [id-filtr]
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
  /* ── AUDIT-18 WP-B: 5 yangi tur, chegaraviy holatlar ── */
  {
    id: "layers7",
    kind: "scheme",
    caption: "Raqamli egizak platformasining qatlamli arxitekturasi (7 qatlam — chegara)",
    w: 0,
    h: 0,
    spec: {
      kind: "layers",
      layers: [
        { label: "Foydalanuvchi ilovalari", items: ["Veb-panel", "Mobil ilova", "Hisobot generatori", "Bildirishnomalar"] },
        { label: "Xizmatlar (API)", items: ["Autentifikatsiya", "Buyurtmalar xizmati", "Tahlil xizmati"] },
        { label: "Raqamli egizak modeli", items: ["Fizik model", "Ma’lumotlarga asoslangan model (ML)"] },
        { label: "Ma’lumotlarni qayta ishlash", items: ["Oqim (Kafka)", "Paket (Spark)", "Saqlash (TSDB)"] },
        { label: "Aloqa qatlami", items: ["MQTT", "OPC UA", "5G / LTE"] },
        { label: "Chekka hisoblash", items: ["Shlyuz", "Oldindan filtrlash"] },
        { label: "Fizik obyektlar va datchiklar", items: ["Dastgohlar", "Datchiklar", "Ijro mexanizmlari", "Kameralar"] },
      ],
    },
  },
  {
    id: "layers3",
    kind: "scheme",
    caption: "Uch qatlamli ilova (bandsiz, o‘qsiz)",
    w: 0,
    h: 0,
    spec: { kind: "layers", arrows: false, layers: [{ label: "Taqdimot qatlami" }, { label: "Biznes mantiq qatlami" }, { label: "Ma’lumotlar qatlami" }] },
  },
  {
    id: "cycle8",
    kind: "scheme",
    caption: "Sifatni uzluksiz yaxshilash sikli (8 bosqich — chegara)",
    w: 0,
    h: 0,
    spec: {
      kind: "cycle",
      center: "Uzluksiz yaxshilash",
      steps: [
        { label: "Muammoni aniqlash" },
        { label: "Ma’lumot yig‘ish" },
        { label: "Sabablarni tahlil qilish" },
        { label: "Yechimni rejalashtirish" },
        { label: "Sinov joriy etish" },
        { label: "Natijani o‘lchash" },
        { label: "Standartlashtirish" },
        { label: "Keyingi maqsad" },
      ],
    },
  },
  {
    id: "cycle4-ccw",
    kind: "scheme",
    caption: "PDCA sikli (4 bosqich, soat yo‘nalishiga teskari)",
    w: 0,
    h: 0,
    spec: { kind: "cycle", clockwise: false, steps: [{ label: "Rejalashtirish (Plan)" }, { label: "Bajarish (Do)" }, { label: "Tekshirish (Check)" }, { label: "Tuzatish (Act)" }] },
  },
  {
    id: "timeline10",
    kind: "scheme",
    caption: "Raqamli egizak texnologiyasi evolyutsiyasi (10 voqea — ikki qator)",
    w: 0,
    h: 0,
    spec: {
      kind: "timeline",
      events: [
        { when: "2002", label: "Grieves: mahsulot hayot sikli konsepsiyasi" },
        { when: "2010", label: "NASA texnologik yo‘l xaritasi" },
        { when: "2012", label: "Aerokosmik sohada birinchi tatbiq" },
        { when: "2015", label: "Sanoat 4.0 dasturlari" },
        { when: "2017", label: "Gartner: top-10 texnologiya" },
        { when: "2018", label: "ISO 23247 ustida ish boshlandi" },
        { when: "2019", label: "Shahar miqyosidagi egizaklar" },
        { when: "2020", label: "Pandemiya: masofaviy monitoring" },
        { when: "2022", label: "Standartlashtirish (ISO 23247)" },
        { when: "2024", label: "Generativ AI bilan integratsiya" },
      ],
    },
  },
  {
    id: "timeline4",
    kind: "scheme",
    caption: "Tajriba jadvali (4 bosqich)",
    w: 0,
    h: 0,
    spec: {
      kind: "timeline",
      events: [
        { when: "1-hafta", label: "Dastlabki so‘rovnoma va kirish testi" },
        { when: "2–6-hafta", label: "Adaptiv platformada mashg‘ulotlar" },
        { when: "7-hafta", label: "Oraliq nazorat" },
        { when: "12-hafta", label: "Yakuniy test va natijalar tahlili" },
      ],
    },
  },
  {
    id: "matrix-axes",
    kind: "scheme",
    caption: "Texnologiyalarni joriy etish ustuvorligi (ta’sir × murakkablik)",
    w: 0,
    h: 0,
    spec: {
      kind: "matrix",
      xAxis: { low: "Past murakkablik", high: "Yuqori murakkablik", label: "Joriy etish murakkabligi" },
      yAxis: { low: "Past ta’sir", high: "Yuqori ta’sir", label: "Iqtisodiy ta’sir" },
      quadrants: [
        { title: "Tezkor g‘alaba", items: ["Datchiklar monitoringi", "Energiya hisobi"] },
        { title: "Strategik loyihalar", items: ["To‘liq raqamli egizak", "Bashoratli ta’mirlash tizimi", "Avtonom logistika"] },
        { title: "Ikkinchi darajali", items: ["Hisobot avtomatlashtirish"] },
        { title: "Qayta ko‘rib chiqish", items: ["Blokcheyn kuzatuvi", "AR yordamchisi"] },
      ],
    },
  },
  {
    id: "matrix-swot",
    kind: "scheme",
    caption: "SWOT tahlili (o‘qsiz)",
    w: 0,
    h: 0,
    spec: {
      kind: "matrix",
      quadrants: [
        { title: "Kuchli tomonlar", items: ["Malakali muhandislar", "Zamonaviy dastgohlar parki", "Eksport tajribasi"] },
        { title: "Zaif tomonlar", items: ["Raqamli infratuzilma yetishmasligi", "Ma’lumotlar sifatining pastligi"] },
        { title: "Imkoniyatlar", items: ["Davlat dasturlari va grantlar", "Mahalliy bozorning o‘sishi", "Xalqaro hamkorlik", "Yosh kadrlar"] },
        { title: "Tahdidlar", items: ["Import qaramligi", "Kiberxavfsizlik xatarlari"] },
      ],
    },
  },
  {
    id: "compare-cols",
    kind: "scheme",
    caption: "An’anaviy va raqamli egizakka asoslangan ta’mirlash",
    w: 0,
    h: 0,
    spec: {
      kind: "compare",
      left: { title: "An’anaviy ta’mirlash", items: ["Rejali-ogohlantiruvchi jadval", "Nosozlikdan keyin aralashuv", "Qo‘lda hisobot", "Ehtiyot qismlar zaxirasi katta", "Kutilmagan to‘xtashlar", "Tajribaga tayanish"] },
      right: { title: "Raqamli egizak asosida", items: ["Holatga qarab (condition-based)", "Bashoratli aralashuv", "Avtomatik hisobot va ogohlantirish", "Zaxira talab bo‘yicha", "To‘xtashlar rejalashtiriladi", "Ma’lumotga tayanish"] },
    },
  },
  {
    id: "compare-rows",
    kind: "scheme",
    caption: "Mezonlar bo‘yicha taqqoslash (rows bilan)",
    w: 0,
    h: 0,
    spec: {
      kind: "compare",
      rows: ["Qaror asosi", "Aralashuv vaqti", "To‘xtash xarajati", "Boshlang‘ich sarmoya", "Kadr talabi"],
      left: { title: "An’anaviy yondashuv", items: ["Jadval va tajriba", "Nosozlikdan keyin yoki muddat bo‘yicha", "Yuqori (kutilmagan)", "Past", "Mexanik, texnolog"] },
      right: { title: "Taklif etilayotgan yondashuv", items: ["Datchik ma’lumotlari va model bashorati", "Nosozlikdan oldin, rejalashtirilgan", "Past (rejalashtirilgan)", "O‘rta–yuqori (datchik, dasturiy ta’minot)", "Mexanik + ma’lumot tahlilchisi"] },
    },
  },
];

async function main() {
  const filter = process.argv[3];
  for (const f of SAMPLES) {
    if (filter && !f.id.includes(filter)) continue;
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
