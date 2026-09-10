import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID, priceFor } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { budgetFor } from "../lib/generation/budget.ts";
import {
  PRO_SLIDE_MAX,
  PRO_SLIDE_MIN,
  PRO_SLIDE_PER_SLIDE,
  SLIDE_DEFAULT,
  SLIDE_MAX,
  SLIDE_MIN,
  SLIDE_PARAMS,
  slideParamsFor,
  slidePrice,
  splitCsv,
} from "../lib/generation/slide-params.ts";
import { AUDIENCE_RULES, audienceRules, bodyRules } from "../lib/generation/slide-audience.ts";
import { purposeDefaults } from "../lib/generation/slide-purpose.ts";
import { slideSystem } from "../lib/generation/slide-prompt/index.ts";
import { SLIDE_TEMPLATE_BY_ID, expandBeats } from "../lib/generation/slide-templates.ts";
import { slideStageBudget, wantSlides } from "../lib/generation/slide-write.ts";

/**
 * PARAMETR SHARTNOMASI — «bezak maydon yo'q» kafolati (AUDIT-9).
 *
 * WP-0a: reyestr tuzilishi, `extractMeta` klamplari va 0a allaqachon
 * ulagan parametrlarning PROMPTGA ta'siri. Maket (`planSlide` opts),
 * rasm prompti va tadqiqot zondlari WP-0b/E/D da qo'shiladi.
 */

const slide = TOOL_BY_ID.slide;
const pro = TOOL_BY_ID["pro-slide"];
const lecture = SLIDE_TEMPLATE_BY_ID.lecture;
const meta = (v: FormValues, tool = pro) => extractMeta(tool, { topic: "Suv aylanishi", ...v });
const prompt = (v: FormValues) => slideSystem(meta(v), lecture);

// ───────────────────────────────────────────── reyestr tuzilishi

test("reyestr: id lar noyob, har parametrda ta'sir va ikki xil zond bor", () => {
  const ids = new Set<string>();
  for (const p of SLIDE_PARAMS) {
    assert.ok(!ids.has(p.id), `${p.id}: takror`);
    ids.add(p.id);
    assert.ok(p.impacts.length > 0, `${p.id}: ta'sir e'lon qilinmagan — bezak maydon`);
    assert.notEqual(p.probeA, p.probeB, `${p.id}: zond qiymatlari bir xil`);
    assert.ok(p.tools.length > 0, `${p.id}: vositasiz`);
  }
  assert.ok(slideParamsFor("pro-slide").length > slideParamsFor("slide").length, "pro brifi oddiydan boy");
  // Formalar 2: paket YO'Q — ikkalasida ham slayder; rasm uslubi faqat pro'da (oddiy = bepul stock, `photo`).
  assert.ok(!SLIDE_PARAMS.some((p) => p.id === "quality"), "«Sifat / hajm» paketi olib tashlangan");
  assert.ok(slideParamsFor("slide").some((p) => p.id === "slideCount"), "oddiyda ham slayder");
  assert.ok(!slideParamsFor("slide").some((p) => p.id === "slideImageStyle"), "oddiyda rasm uslubi yo'q — stock faqat foto");
  assert.ok(slideParamsFor("pro-slide").some((p) => p.id === "slideImageStyle"), "pro'da rasm uslubi qoladi");
});

// ───────────────────────────────────────────── extractMeta klamplari

test("pro-slide: slaydlar soni slayderdan, 4–30 ga qisiladi, narx har slaydga", () => {
  assert.equal(meta({ slideCount: 17 }).targetPages, 17);
  assert.equal(meta({ slideCount: 1 }).targetPages, PRO_SLIDE_MIN);
  assert.equal(meta({ slideCount: 99 }).targetPages, PRO_SLIDE_MAX);
  assert.equal(meta({ slideCount: "abc" }).targetPages, 12, "buzuq qiymat — standart");
  // Eski `quality` qiymati endi hech narsani o'zgartirmaydi.
  assert.equal(meta({ slideCount: 8, quality: "premium_long" }).targetPages, 8);
  assert.equal(priceFor(pro, { slideCount: 17 }), 17 * PRO_SLIDE_PER_SLIDE);
  assert.equal(priceFor(pro, { slideCount: 4 }), 8000);
  assert.equal(priceFor(pro, { slideCount: 30 }), 60000);
  assert.equal(priceFor(pro, { slideCount: 99 }), 60000, "narx ham qisiladi — deka bilan ajralmasin");
});

test("oddiy slide: slayder 4–30 (standart 10), 20 tagacha 3 000, keyingi har slayd +500", () => {
  assert.equal(meta({}, slide).targetPages, SLIDE_DEFAULT, "slayder yuborilmasa standart 10");
  assert.equal(meta({ slideCount: 25 }, slide).targetPages, 25);
  assert.equal(meta({ slideCount: 1 }, slide).targetPages, SLIDE_MIN);
  assert.equal(meta({ slideCount: 99 }, slide).targetPages, SLIDE_MAX);
  // Eski paket qiymati endi e'tiborsiz — narx faqat slayderdan.
  assert.equal(meta({ quality: "premium_long" }, slide).targetPages, SLIDE_DEFAULT);
  const table: [unknown, number][] = [
    [undefined, 3000],
    [4, 3000],
    [10, 3000],
    [20, 3000],
    [21, 3500],
    [25, 5500],
    [30, 8000],
    [99, 8000],
    ["abc", 3000],
  ];
  for (const [n, want] of table) {
    assert.equal(priceFor(slide, { slideCount: n as never }), want, `${String(n)} slayd`);
    assert.equal(slidePrice(Number(n)), want);
  }
  assert.equal(priceFor(slide, { quality: "premium_long" }), 3000, "paket narxga ta'sir qilmaydi");
  // Oddiy slaydda premium yo'q, uslub doim foto (bepul stock).
  assert.equal(meta({ slideImageStyle: "chalk" }, slide).premiumVisuals, false);
  assert.equal(meta({ slideImageStyle: "chalk" }, slide).slideImageStyle, "photo", "stock faqat foto — uslub majburlanadi");
  assert.equal(meta({ slideImageStyle: "chalk" }, pro).slideImageStyle, "chalk", "pro'da uslub tanlovi qoladi");
});

test("yangi maydonlar oddiy formada ham standart qiymat bilan keladi", () => {
  const m = meta({}, slide);
  assert.equal(m.slidePurpose, "general");
  assert.deepEqual(m.blocks, ["reja"]);
  assert.equal(m.planItems, 5);
  assert.equal(m.agendaSlide, true);
  assert.equal(m.textVolume, "standart");
  assert.equal(m.quizCount, 0);
  assert.equal(m.internetSearch, false);
  assert.equal(m.speakerNotes, true);
  assert.equal(m.slideImageStyle, "photo");
  assert.equal(m.localExamples, false);
  assert.deepEqual(m.keyIdeas, []);
  assert.equal(m.logoAssetId, "");
  assert.equal(m.position, "");
});

test("keyIdeas: csv, 3 tagacha, 4-si tushib qoladi, uzuni kesiladi", () => {
  const m = meta({ keyIdeas: "birinchi, ikkinchi\nuchinchi, to‘rtinchi" });
  assert.deepEqual(m.keyIdeas, ["birinchi", "ikkinchi", "uchinchi"]);
  assert.equal(meta({ keyIdeas: "x".repeat(300) }).keyIdeas[0].length, 120);
  assert.deepEqual(splitCsv(" a ,, b ", 5, 10), ["a", "b"]);
});

test("blocks: yuborilmasa taqdimot turi standarti, yuborilsa oq ro'yxat, bo'sh satr — hech narsa", () => {
  assert.deepEqual(meta({ slidePurpose: "open_lesson" }).blocks, purposeDefaults("open_lesson").blocks);
  assert.deepEqual(meta({ slidePurpose: "lesson", blocks: "reja,test,xato_blok,adabiyotlar" }).blocks, ["reja", "test", "adabiyotlar"]);
  assert.deepEqual(meta({ slidePurpose: "lesson", blocks: "" }).blocks, [], "ataylab hammasi o'chirilgan");
  assert.equal(meta({ slidePurpose: "hech-qachon" }).slidePurpose, "general");
});

test("quizCount faqat ruxsat etilgan sonlarga tushadi; logo id regex bilan", () => {
  assert.equal(meta({ quizCount: 7 }).quizCount, 5);
  assert.equal(meta({ quizCount: 11 }).quizCount, 10);
  assert.equal(meta({ quizCount: 2 }).quizCount, 0);
  assert.equal(meta({ quizCount: 3 }).quizCount, 3);
  assert.equal(meta({ logoAssetId: "0123456789ABCDEF01234567" }).logoAssetId, "0123456789abcdef01234567");
  assert.equal(meta({ logoAssetId: "../etc/passwd" }).logoAssetId, "");
  assert.equal(meta({ planItems: 9 }).planItems, 6);
  assert.equal(meta({ planItems: 1 }).planItems, 3);
  assert.equal(meta({ textVolume: "juda-kop" }).textVolume, "standart");
  assert.equal(meta({ slideImageStyle: "oil" }).slideImageStyle, "photo");
});

// ───────────────────────────────────────────── auditoriya 14

test("14 auditoriya: eski id lar aliasga, auto shablondan, Slide Law poli saqlanadi", () => {
  assert.equal(Object.keys(AUDIENCE_RULES).length, 14);
  assert.equal(audienceRules("school", "lecture"), AUDIENCE_RULES.school_5_7);
  assert.equal(audienceRules("defense", "lecture"), AUDIENCE_RULES.students_master);
  assert.equal(audienceRules("auto", "lesson"), AUDIENCE_RULES.school_5_7);
  assert.equal(audienceRules("auto", "pitch"), AUDIENCE_RULES.management);
  assert.equal(audienceRules(undefined, "lecture"), AUDIENCE_RULES.students_bachelor);
  for (const [id, r] of Object.entries(AUDIENCE_RULES)) {
    assert.ok(r.minPt >= 15, `${id}: pol 15 pt dan past`);
    if (id.startsWith("school_")) assert.ok(r.minPt >= 18, `${id}: maktabda pol 18+`);
    assert.ok(r.note.length > 20 && r.label.length > 2, `${id}: prompt qatori/yorliq bo'sh`);
  }
});

test("textVolume band soni va uzunligini o'zgartiradi, shrift POLINI emas", () => {
  const q = bodyRules(meta({ textVolume: "qisqa" }), "lecture");
  const s = bodyRules(meta({ textVolume: "standart" }), "lecture");
  const k = bodyRules(meta({ textVolume: "kop" }), "lecture");
  assert.ok(q.bulletChars < s.bulletChars && s.bulletChars < k.bulletChars);
  assert.ok(q.maxBullets <= s.maxBullets && s.maxBullets <= k.maxBullets);
  // Slide Law: matn hajmi shriftga TEGMAYDI — `fitLines` o'zi oraliqda siqadi.
  assert.equal(q.minPt, s.minPt);
  assert.equal(k.minPt, s.minPt);
  assert.equal(k.bodyPt, s.bodyPt);
});

// ───────────────────────────────────────────── prompt differensiali (0a ulagan parametrlar)

test("speakerNotes=false promptdan notes talabini olib tashlaydi", () => {
  const on = prompt({ speakerNotes: true });
  const off = prompt({ speakerNotes: false });
  assert.match(on, /Har slaydda notes/);
  assert.match(off, /notes YOZMANG/);
  assert.doesNotMatch(off, /Har slaydda notes/);
});

test("textVolume, slideAudience, planItems, extra promptdagi sonlar/qatorlarni o'zgartiradi", () => {
  assert.notEqual(prompt({ textVolume: "qisqa" }), prompt({ textVolume: "kop" }), "textVolume promptni o'zgartirmadi");
  const a = prompt({ slideAudience: "school_1_4" });
  const b = prompt({ slideAudience: "students_master" });
  assert.notEqual(a, b);
  assert.match(a, /boshlang‘ich sinf/);
  assert.match(b, /magistrant/);
  assert.match(prompt({ planItems: 3 }), /agenda'da 3–3|agenda'da 2–3/);
  assert.match(prompt({ planItems: 6 }), /agenda'da 5–6/);
  assert.match(prompt({ extra: "ko‘proq diagramma" }), /Qo‘shimcha talab: ko‘proq diagramma/);
  // Ikki nuqta bilan: `base.ts` da «Qo‘shimcha talabni kicker qilmang» qatori ham bor.
  assert.doesNotMatch(prompt({ extra: "" }), /Qo‘shimcha talab: /);
});

// ───────────────────────────────────────────── slayd soni, byudjet

test("30 slayd dvigatelga to'liq yetadi — 20 chegarasi yo'q", () => {
  const m = meta({ slideCount: 30 });
  assert.equal(wantSlides(m, lecture), 30);
  assert.equal(expandBeats(lecture, wantSlides(m, lecture)).length, 30);
  assert.equal(expandBeats(lecture, wantSlides(meta({ slideCount: 4 }), lecture)).length, Math.max(4, lecture.beats.length) >= 10 ? 10 : 4);
});

test("byudjet: pro 30 slaydga yetadi, tadqiqot ulushi faqat so'ralganda", () => {
  assert.ok(budgetFor(pro, { slideCount: 30 }, 10_000_000) >= 540_000);
  assert.ok(budgetFor(pro, { slideCount: 30 }, 10_000_000) > budgetFor(pro, { slideCount: 4 }, 10_000_000));
  const now = 1_000_000;
  const plain = slideStageBudget(now + 300_000, now);
  const withResearch = slideStageBudget(now + 300_000, now, { research: true });
  assert.equal(plain.researchMs, 0);
  assert.ok(withResearch.researchMs > 0 && withResearch.researchMs <= 30_000);
  assert.ok(withResearch.textMs < plain.textMs, "tadqiqot matndan ulush oladi");
  assert.ok(withResearch.imageMs > 0, "rasm nolga tushmaydi");
});

// ═══════════════════════════════════════════ DIFFERENSIAL ZOND — «bezak yo'q» kafolati

import { SLIDE_LAYOUTS, type SlideModel } from "../lib/generation/slide-types.ts";
import { blocksToBeats } from "../lib/generation/slide-blocks.ts";
import { deckFooter } from "../lib/generation/slide-identity.ts";
import { runSlideResearch } from "../lib/generation/slide-research.ts";
import { composeSlideImagePrompt } from "../lib/generation/slide-image-prompts.ts";
import { planSlide } from "../lib/generation/slide-layout.ts";
import { getSlideTheme } from "../lib/generation/slide-themes.ts";
import { fallbackSlides, resolveDeckTemplate } from "../lib/generation/slide-write.ts";
import type { SlideParamImpact } from "../lib/generation/slide-params.ts";
import type { CustomTemplate } from "../lib/generation/pptx-template.ts";

/**
 * Hali ulanmagan ta'sirlar — ish paketlari bo'yicha. Har paket tugagach
 * o'z qatorini O'CHIRADI; ro'yxat o'sishi mumkin emas (pastdagi test).
 *   BO'SH — barcha paketlar ulandi (A, B, D, E, H). Bu ro'yxatga yangi
 *   qator qo'shish = «bezak parametr» ni rasman tan olish; pastdagi
 *   test uni taqiqlaydi.
 */
const PENDING: Record<string, SlideParamImpact[]> = {};

/** «O'z shablonim» zondi — minimal profil (muqova + mazmun layoutlari). */
const STUB_TEMPLATE: CustomTemplate = {
  assetId: "0123456789abcdef01234567",
  name: "namuna.pptx",
  profile: {
    size: { w: 13.333, h: 7.5 },
    colors: { dk1: "#111111", lt1: "#FFFFFF", accent1: "#C9A227" },
    fonts: { major: "Georgia", minor: "Verdana" },
    masterPath: "ppt/slideMasters/slideMaster1.xml",
    themePath: "ppt/theme/theme1.xml",
    layouts: [
      { path: "ppt/slideLayouts/slideLayout1.xml", name: "Muqova", kind: "cover", placeholders: [{ type: "ctrTitle", idx: null, name: "t", box: { x: 1, y: 2.5, w: 11.3, h: 1.5 } }, { type: "subTitle", idx: 1, name: "s", box: { x: 1, y: 4.2, w: 11.3, h: 1 } }] },
      { path: "ppt/slideLayouts/slideLayout2.xml", name: "Mazmun", kind: "content", placeholders: [{ type: "title", idx: null, name: "t", box: { x: 0.7, y: 0.5, w: 11.9, h: 1 } }, { type: "body", idx: 1, name: "b", box: { x: 0.7, y: 1.7, w: 11.9, h: 4.9 } }] },
    ],
    roles: { cover: "ppt/slideLayouts/slideLayout1.xml", content: "ppt/slideLayouts/slideLayout2.xml" },
  },
  previews: {},
};

/** Har layout uchun boy namuna — qisqa matnda ba'zi ta'sirlar ko'rinmaydi. */
function sample(layout: string, footer: string): SlideModel {
  return {
    id: "s", layout, title: "Suv aylanishining bosqichlari va ahamiyati", kicker: "Geografiya", footer,
    subtitle: "Bug‘lanish, kondensatsiya va yog‘in bosqichlari, ularda ishtirok etadigan energiya manbalari ko‘rib chiqiladi.",
    bullets: [
      "Quyosh energiyasi okean yuzasidagi suvni bug‘lantiradi va bug‘ ko‘tariladi.",
      "Yuqori qatlamda sovigan bug‘ mayda tomchilarga aylanib bulut hosil qiladi.",
      "Og‘irlashgan tomchilar yog‘in sifatida yer yuzasiga qaytadi.",
      "Yer osti suvlari daryo va ko‘llarni to‘ldiradi, aylanish yopiladi.",
      "Inson faoliyati aylanishning tezligi va sifatiga ta’sir qiladi.",
      "Iqlim o‘zgarishi yog‘in taqsimotini o‘zgartiradi.",
    ],
    leftTitle: "Bug‘lanish", left: ["Okean yuzasidan", "Energiya: quyosh"], rightTitle: "Kondensatsiya", right: ["Atmosferada", "Natija: bulut"],
    quote: "Suv — sayyoradagi eng ko‘p aylanadigan modda.", quoteBy: "Gidrologiya",
    stats: [{ value: "97.5%", label: "Okeanlar" }, { value: "2.5%", label: "Chuchuk" }, { value: "0.3%", label: "Daryolar" }],
    steps: [{ n: "1", title: "Bug‘lanish", text: "Quyosh suvni isitadi" }, { n: "2", title: "Yog‘in", text: "Tomchilar tushadi" }],
    table: { headers: ["Bosqich", "Joyi"], rows: [["Bug‘lanish", "Okean"], ["Yog‘in", "Quruqlik"], ["Oqim", "Daryo"]] },
    quiz: [{ q: "Bug‘lanish qayerda?", options: ["Okean", "Bulut", "Daryo", "Muz"], answer: 0 }],
    refs: [{ title: "president.uz", source: "https://president.uz" }],
  } as SlideModel;
}

type Probe = Record<SlideParamImpact, string>;

function probe(values: FormValues, tool = pro): Probe {
  const m = extractMeta(tool, { topic: "Suv aylanishi", ...values });
  const tpl = resolveDeckTemplate(m);
  const want = wantSlides(m, tpl);
  const beats = blocksToBeats(m, tpl, expandBeats(tpl, want), want);
  const theme = getSlideTheme(m.slideTheme ?? "atlas");
  const bodyType = bodyRules(m, tpl.id);
  // Haqiqiy oqimda worker `logoAssetId` ni data URL ga aylantiradi; zond uchun mavjudligi yetarli.
  const logo = m.logoAssetId ? "data:image/png;base64,iVBORw0KGgo=" : undefined;
  // Xuddi shunday: worker `templateAssetId` ni `template_uploads` dan o'qiydi; zond uchun mavjudligi yetarli.
  const custom = m.templateAssetId ? STUB_TEMPLATE : undefined;
  const footer = deckFooter(m);
  return {
    prompt: slideSystem(m, tpl),
    beats: JSON.stringify(fallbackSlides(m, tpl, beats).map((s) => s.layout)),
    layout: JSON.stringify(
      SLIDE_LAYOUTS.map((l) => planSlide(sample(l, footer), theme, tpl.visual, 1, 10, m.slideAudience, tpl.id, { bodyType, logo, custom })),
    ),
    price: String(priceFor(tool, { topic: "x", ...values })),
    // Rasm prompti — deterministik zaxira yo'li (`writeSlideImagePrompts` LLM siz shunga tushadi).
    images: composeSlideImagePrompt(m.topic, sample("title", footer), { width: 1024, height: 576 }, m),
    research: "",
  };
}

test("differensial zond: reyestrdagi HAR parametr e'lon qilingan ta'sirini beradi", () => {
  const failures: string[] = [];
  for (const p of SLIDE_PARAMS) {
    const tool = p.tools.includes("pro-slide") ? pro : slide;
    const base = p.probeWith ?? {};
    const a = probe({ ...base, [p.id]: p.probeA }, tool);
    const b = probe({ ...base, [p.id]: p.probeB }, tool);
    for (const impact of p.impacts) {
      if (impact === "research") continue; // async — pastdagi alohida zond
      if (PENDING[p.id]?.includes(impact)) continue;
      if (a[impact] === b[impact]) failures.push(`${p.id} → ${impact}`);
    }
  }
  assert.deepEqual(failures, [], `bezak parametrlar (A va B bir xil chiqdi):\n  ${failures.join("\n  ")}`);
});

/**
 * `research` ta'siri — tarmoq chaqiruvi izi. `runSlideResearch` async,
 * shuning uchun alohida zond: fetch stub qilinadi, A va B qiymatda
 * chaqiruvlar izi (soni, `google_search` bor-yo'qligi, JSON rejimi)
 * farq qilishi shart. Kalitsiz muhitda ham ishlaydi (stub kalit qo'yadi).
 */
async function researchProbe(values: FormValues, tool = pro): Promise<string> {
  const m = extractMeta(tool, { topic: "Suv aylanishi", ...values });
  const realFetch = globalThis.fetch;
  const savedGemini = process.env.GEMINI_API_KEY;
  const savedXai = process.env.XAI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.XAI_API_KEY;
  const trace: string[] = [];
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    const body = String(init?.body ?? "");
    trace.push(`${String(url).replace(/key=[^&]+/, "key=…")} search=${body.includes("google_search")} json=${body.includes("responseMimeType")}`);
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "Fakt 1.\nFakt 2." }] } }] }),
    } as never;
  }) as typeof fetch;
  try {
    await runSlideResearch(m, Date.now() + 60_000);
  } finally {
    globalThis.fetch = realFetch;
    if (savedGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedGemini;
    if (savedXai === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = savedXai;
  }
  return JSON.stringify(trace);
}

test("differensial zond (research): internet qidiruvi parametrlari tarmoq izini o'zgartiradi", async () => {
  const failures: string[] = [];
  for (const p of SLIDE_PARAMS) {
    if (!p.impacts.includes("research") || PENDING[p.id]?.includes("research")) continue;
    const tool = p.tools.includes("pro-slide") ? pro : slide;
    const base = p.probeWith ?? {};
    const a = await researchProbe({ ...base, [p.id]: p.probeA }, tool);
    const b = await researchProbe({ ...base, [p.id]: p.probeB }, tool);
    if (a === b) failures.push(`${p.id} → research (${a})`);
  }
  assert.deepEqual(failures, [], `bezak parametrlar (tarmoq izi bir xil):\n  ${failures.join("\n  ")}`);
});

test("internetSearch: off → tarmoqqa chiqmaydi; on → aynan 1 ta google_search, JSON rejimisiz", async () => {
  assert.equal(await researchProbe({ internetSearch: false }), "[]");
  const on = JSON.parse(await researchProbe({ internetSearch: true })) as string[];
  assert.equal(on.length, 1);
  assert.match(on[0], /search=true json=false/);
});

test("PENDING ro'yxati o'smaydi — faqat A/B/D/E/H paketlariga tegishli", () => {
  const allowed = new Set<string>([]);
  for (const id of Object.keys(PENDING)) assert.ok(allowed.has(id), `${id}: PENDING ga yangi id qo'shilgan — ta'sirni ulang, kutishga qo'ymang`);
  for (const id of Object.keys(PENDING)) assert.ok(SLIDE_PARAMS.some((p) => p.id === id), `${id}: reyestrda yo'q`);
});

test("logo: har layoutda qatlam qo'shiladi, contain, hech bir MATN qatlami bilan kesishmaydi", () => {
  const theme = getSlideTheme("atlas");
  const bodyType = bodyRules({ slideAudience: "auto", textVolume: "standart", planItems: 5 }, "lecture");
  const LOGO = { x: 12.15, y: 0.18, w: 0.9, h: 0.45 };
  const hits = (a: { x: number; y: number; w: number; h: number }, b: typeof LOGO) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  for (const layout of SLIDE_LAYOUTS) {
    for (const visual of ["classic", "cards", "dense", "timeline", "magazine", "hero-split"] as const) {
      const s = sample(layout, "Muallif · Lavozim · TDPU");
      const without = planSlide(s, theme, visual, 1, 10, "auto", "lecture", { bodyType });
      const withLogo = planSlide(s, theme, visual, 1, 10, "auto", "lecture", { bodyType, logo: "data:image/png;base64,AA" });
      const logoLayer = withLogo.layers.find((l) => l.t === "image" && l.url === "data:image/png;base64,AA");
      assert.ok(logoLayer && logoLayer.t === "image" && logoLayer.fit === "contain", `${layout}/${visual}: logo qatlami yo'q yoki contain emas`);
      assert.ok(withLogo.layers.length > without.layers.length, `${layout}/${visual}: logo qatlam qo'shmadi`);
      for (const l of withLogo.layers) {
        if (l.t !== "text") continue;
        const txt = (l.text ?? l.lines?.join(" ") ?? "").trim();
        if (!txt) continue;
        assert.ok(!hits(l.box, LOGO), `${layout}/${visual}: matn «${txt.slice(0, 30)}» logo bilan kesishadi (${JSON.stringify(l.box)})`);
      }
      assert.ok(LOGO.x + LOGO.w <= 13.334 && LOGO.y >= 0, "logo qutisi slayd ichida");
    }
  }
});

test("speakerNotes=false — slideNotes bo'sh, deck standarti yopiq", async () => {
  const { slideNotes } = await import("../lib/generation/slide-layout.ts");
  const s = sample("bullets", "F");
  assert.equal(slideNotes(s, false), "");
  assert.ok(slideNotes(s, true).length > 0);
  assert.ok(slideNotes(s).length > 0, "bayroq berilmasa eski xatti-harakat");
});
