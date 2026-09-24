import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { FormValues } from "../lib/types.ts";
import { extractMeta } from "../lib/generation/meta.ts";
import { SLIDE_BLOCKS, blocksToBeats, orderedBlocks, planRoleText, plannedBlocks } from "../lib/generation/slide-blocks.ts";
import { PURPOSE_DEFAULTS, SLIDE_PURPOSES } from "../lib/generation/slide-purpose.ts";
import {
  PLAN_ITEMS_DEFAULT,
  PRO_SLIDE_DEFAULT,
  PRO_SLIDE_MAX,
  PRO_SLIDE_MIN,
  activeBlockIds,
  defaultPlanItems,
  effectivePlanItems,
  planBudget,
  planCapacity,
  resolvePlanFlags,
} from "../lib/generation/slide-params.ts";
import { SLIDE_LIMITS } from "../lib/generation/slide-limits.ts";
import { AUDIENCE_RULES } from "../lib/generation/slide-audience.ts";
import type { SlideProgressEvent } from "../lib/generation/slide-progress.ts";
import { resetBlocksForPurpose } from "../components/forms/slide-fields.tsx";
import { slideSystem } from "../lib/generation/slide-prompt/index.ts";
import { SLIDE_TEMPLATES, SLIDE_TEMPLATE_BY_ID, expandBeats, type SlideBeat } from "../lib/generation/slide-templates.ts";
import {
  buildSlideAcademicDoc,
  deckBeats,
  extractNewSlides,
  fallbackSlides,
  resolveDeckTemplate,
  stripOrdinal,
  syncAgenda,
  wantSlides,
  writeSlidesWithLlm,
} from "../lib/generation/slide-write.ts";
import { bodyRules } from "../lib/generation/slide-audience.ts";
import type { SlideLayout, SlideModel } from "../lib/generation/slide-types.ts";

/**
 * REJA = SHARTNOMA (AUDIT-25, 1/2/3/5-qarorlar).
 *
 * Jonli dekalarda reja 4 band edi, lekin BIRORTA band o'z slaydiga ega
 * emasdi (S1): tana bloklar va shablon to'ldirgichlari bilan to'lardi.
 * Bu fayl qulflaydi:
 *   1. har reja bandi ≥ 1 mazmun slaydi oladi (`plan: i`), tartibda;
 *   2. bosim ostida reja slaydlari tashlanmaydi — bloklar yon beradi;
 *   3. `planCapacity` (forma va `extractMeta`) dvigatelning haqiqiy
 *      reja slaydlari soni bilan AYNAN bir xil;
 *   4. agenda = reja slaydlari sarlavhalari (yozuvdan keyin);
 *   5. sarlavha boshidagi tartib raqami olib tashlanadi;
 *   6. skelet uydirma raqam bermaydi.
 * Hech bir test jonli LLM chaqirmaydi — `fetch` stub qilinadi.
 */

const pro = TOOL_BY_ID["pro-slide"];
const slideTool = TOOL_BY_ID.slide;

/** Reja bandining MAZMUN slaydi bo'la oladigan maketlar (`slide-blocks.ts` `PLAN_CONTENT`). */
const CONTENT = new Set<SlideLayout>(["bullets", "twoCol", "compare", "process", "table", "stats"]);

function beatsOf(v: FormValues, tool = pro) {
  const meta = extractMeta(tool, { topic: "Suv aylanishi", ...v });
  const tpl = resolveDeckTemplate(meta);
  return { meta, tpl, want: wantSlides(meta, tpl), beats: deckBeats(meta, tpl) };
}

const planIds = (beats: { plan?: number }[]) => [...new Set(beats.map((b) => b.plan).filter((p): p is number => p !== undefined))];

/** Reja qamrovi buzilishlari — bo'sh ro'yxat = hammasi joyida. */
function coverage(beats: SlideBeat[], n: number): string[] {
  const bad: string[] = [];
  const ids = planIds(beats);
  if (ids.join(",") !== Array.from({ length: n }, (_, i) => i + 1).join(",")) bad.push(`bandlar ${ids.join(",")} (kutilgan 1..${n})`);
  for (let i = 1; i <= n; i += 1) {
    const own = beats.filter((b) => b.plan === i);
    if (!own.some((b) => CONTENT.has(b.layout))) bad.push(`${i}-band: mazmun slaydi yo'q (${own.map((b) => b.layout).join(",")})`);
    for (const b of own) if (!b.role.startsWith(`REJA ${i}-band: `)) bad.push(`${i}-band roli: «${b.role}»`);
    // Bo'lim bo'lsa — darhol shu bandning mazmuni keladi.
    const at = beats.findIndex((b) => b.plan === i && b.layout === "section");
    if (at >= 0 && !(beats[at + 1]?.plan === i && CONTENT.has(beats[at + 1].layout))) bad.push(`${i}-band: bo'limdan keyin mazmun kelmadi`);
  }
  return bad;
}

// ═══════════════════════════════════════════ 1. har band — o'z slaydi, tartibda

test("har reja bandi ≥1 mazmun slaydi oladi, tartibda — shablon × tur × uzunlik supurishi", () => {
  const fails: string[] = [];
  let cases = 0;
  for (const tpl of SLIDE_TEMPLATES.filter((t) => t.id !== "auto")) {
    for (const slidePurpose of SLIDE_PURPOSES) {
      for (const slideCount of [4, 6, 8, 10, 12, 16, 24, 30]) {
        cases += 1;
        const { meta, beats, want } = beatsOf({ slideCount, slidePurpose, slideTemplate: tpl.id });
        const tag = `${tpl.id}/${slidePurpose}/n=${slideCount}`;
        for (const f of coverage(beats, meta.planItems)) fails.push(`${tag}: ${f}`);
        if (beats.length !== want) fails.push(`${tag}: uzunlik ${beats.length} ≠ ${want}`);
        // Bandning birinchi elementi oldingi bandnikidan keyin turadi.
        const first = planIds(beats).map((i) => beats.findIndex((b) => b.plan === i));
        if (first.some((x, k) => k > 0 && x <= first[k - 1])) fails.push(`${tag}: bandlar tartibi buzildi`);
        // Blok/muqova maketlari hech qachon reja slaydi bo'lmaydi.
        for (const b of beats) if (b.plan && !CONTENT.has(b.layout) && b.layout !== "section") fails.push(`${tag}: ${b.layout} reja slaydi bo'ldi`);
        // Shablonning blok nusxasi («Maqsad …», «Uyga vazifa») reja bandi bo'lmaydi — bu bloklarning ishi.
        for (const b of beats) if (b.plan && /^(Maqsad|Uyga vazifa)/.test(planRoleText(b.role))) fails.push(`${tag}: «${b.role}»`);
        // Bo'lim ishorasi takrorlanmaydi (shablon bo'limlari tugasa — umumiy «Keyingi bo‘lim»).
        const secs = beats.filter((b) => b.plan && b.layout === "section").map((b) => planRoleText(b.role)).filter((r) => r !== "Keyingi bo‘lim");
        if (new Set(secs).size !== secs.length) fails.push(`${tag}: bo'lim roli takrorlandi — ${secs.join(" | ")}`);
      }
    }
  }
  assert.ok(cases >= 700, `supurish kichik: ${cases}`);
  assert.deepEqual(fails.slice(0, 12), [], `${fails.length} buzilish:\n  ${fails.slice(0, 12).join("\n  ")}`);
});

test("reja slaydlari prompt ketma-ketligida «REJA i-band» bilan ko'rinadi", () => {
  const { beats } = beatsOf({ slideCount: 10, planItems: 3, slideTemplate: "lecture" });
  const roles = beats.filter((b) => b.plan).map((b) => b.role);
  assert.ok(roles.some((r) => r.startsWith("REJA 1-band: ")), roles.join(" | "));
  assert.ok(roles.some((r) => r.startsWith("REJA 3-band: ")), roles.join(" | "));
  // Bo'limli shablon, joy yetadi (8 o'rin, 1 agenda, 3 band × 2) — band bo'lim bilan ochiladi.
  assert.equal(beats.filter((b) => b.layout === "section" && b.plan).length, 3, beats.map((b) => b.layout).join(","));
  assert.equal(planRoleText("REJA 2-band: Mexanizm"), "Mexanizm");
});

// ═══════════════════════════════════════════ 2. bosim ostida reja tashlanmaydi

test("bosim: 10 slayd + 7 blok + quizCount 3 + planItems 4 → 4 reja slaydi, bloklar yon beradi, uzunlik 10", () => {
  const { meta, beats, want } = beatsOf({
    slideCount: 10,
    planItems: 4,
    quizCount: 3,
    speakerNotes: false,
    slidePurpose: "open_lesson",
    blocks: "reja,maqsadlar,motivatsiya,amaliyot,test,uyga_vazifa,adabiyotlar",
  });
  const tag = beats.map((b) => b.layout).join(",");
  assert.equal(want, 10);
  assert.equal(beats.length, 10, tag);
  assert.equal(meta.planItems, 4);
  assert.deepEqual(coverage(beats, 4), [], tag);
  assert.equal(beats.filter((b) => b.plan && CONTENT.has(b.layout)).length >= 4, true, tag);
  // Reja slaydi (agenda) va kamida bitta savol qoladi.
  assert.equal(beats.filter((b) => b.layout === "agenda").length, 1, tag);
  assert.ok(beats.some((b) => b.layout === "quiz"), tag);
  // Standart bloklar yon bergan — to'rttasi ham sig'maydi.
  const givers = ["Maqsadlar", "Motivatsiya", "Amaliyot", "Uyga vazifa"].filter((r) => beats.some((b) => b.role.startsWith(r)));
  assert.ok(givers.length < 4, `yon beruvchi bloklar tashlanmadi: ${givers.join(",")}`);
});

test("bosim: meta qisilmagan bo'lsa ham (planItems 6, 4 slayd) deka uzaymaydi, reja sig'imga qisiladi", () => {
  const tpl = SLIDE_TEMPLATE_BY_ID.lecture;
  for (const want of [4, 5, 6]) {
    const meta = {
      blocks: [...SLIDE_BLOCKS.map((b) => b.id)],
      planItems: 6,
      quizCount: 5,
      agendaSlide: true,
      internetSearch: true,
      speakerNotes: false,
    };
    const out = blocksToBeats(meta, tpl, expandBeats(tpl, want), want);
    const tag = `want=${want}: ${out.map((b) => b.layout).join(",")}`;
    assert.equal(out.length, want, tag);
    const cap = planBudget({ slideCount: want, blocks: meta.blocks, quizCount: 5, agendaSlide: true }).capacity;
    assert.equal(planIds(out).length, cap, tag);
    assert.ok(out.some((b) => b.layout === "quiz"), `${tag}: bitta savol qolishi kerak edi`);
  }
});

// ═══════════════════════════════════════════ 3. planCapacity = dvigatel

test("planCapacity dvigatelning haqiqiy reja slaydlari soniga TENG (4..30 × tur × test × reja × titul)", () => {
  const fails: string[] = [];
  let cases = 0;
  for (let slideCount = PRO_SLIDE_MIN; slideCount <= PRO_SLIDE_MAX; slideCount += 1) {
    for (const slidePurpose of SLIDE_PURPOSES) {
      for (const quizCount of [0, 3, 5]) {
        for (const agendaSlide of [undefined, true, false]) {
          for (const titleSlide of [true, false]) {
            cases += 1;
            const v: FormValues = { slideCount, slidePurpose, quizCount, titleSlide, ...(agendaSlide === undefined ? {} : { agendaSlide }) };
            const cap = planCapacity(v);
            const meta = extractMeta(pro, { topic: "Suv aylanishi", ...v, planItems: 6 });
            const tpl = resolveDeckTemplate(meta);
            const tag = `${slidePurpose}/n=${slideCount}/q=${quizCount}/reja=${agendaSlide}/titul=${titleSlide}`;
            if (cap < 1) fails.push(`${tag}: sig'im ${cap} < 1`);
            // Forma tanlovi (6) sig'imga qisiladi.
            if (meta.planItems !== Math.min(6, cap)) fails.push(`${tag}: planItems ${meta.planItems} ≠ min(6, ${cap})`);
            // Qisilmagan (99) talab — dvigatel AYNAN sig'imcha band qo'yadi.
            const beats = deckBeats({ ...meta, planItems: 99 }, tpl);
            if (planIds(beats).length !== cap) fails.push(`${tag}: dvigatel ${planIds(beats).length} band, sig'im ${cap}`);
            if (beats.length !== wantSlides(meta, tpl)) fails.push(`${tag}: uzunlik ${beats.length} ≠ ${wantSlides(meta, tpl)}`);
          }
        }
      }
    }
  }
  assert.ok(cases >= 4000, `supurish kichik: ${cases}`);
  assert.deepEqual(fails.slice(0, 12), [], `${fails.length}/${cases} holat:\n  ${fails.slice(0, 12).join("\n  ")}`);
});

test("planCapacity: forma qiymatlari shakli (satr, csv) va kichik deka", () => {
  // 4 slayd, reja + test: tanada 2 o'rin — agenda reja slaydiga yon beradi.
  assert.deepEqual(planBudget({ slideCount: 4, quizCount: 3 }), { capacity: 1, agenda: false });
  assert.deepEqual(planBudget({ slideCount: "4", quizCount: "3", blocks: "reja" }), { capacity: 1, agenda: false });
  assert.deepEqual(planBudget({ slideCount: 4 }), { capacity: 1, agenda: true });
  assert.deepEqual(planBudget({ slideCount: 4, titleSlide: false, quizCount: 3 }), { capacity: 1, agenda: true });
  assert.equal(planCapacity({ slideCount: 10 }), 7);
  assert.equal(planCapacity({ slideCount: 10, slidePurpose: "open_lesson" }), 6, "standart test bitta o'rin oladi");
  assert.equal(planCapacity({ slideCount: 10, slidePurpose: "open_lesson", quizCount: 0 }), 7, "aniq 0 — test yo'q");
  assert.equal(planCapacity({ slideCount: 10, agendaSlide: false }), 8);
  // Kichik deka — PLAN_ITEMS_MIN (3) dan kam ham bo'ladi.
  assert.equal(extractMeta(pro, { topic: "X", slideCount: 4, quizCount: 3 }).planItems, 1);
  // 5 slayd: titul, reja, 1 band, savol, yakun — agenda endi sig'adi.
  assert.equal(extractMeta(pro, { topic: "X", slideCount: 5, quizCount: 3 }).planItems, 1);
  assert.equal(extractMeta(pro, { topic: "X", slideCount: 5, quizCount: 3, titleSlide: false }).planItems, 2);
  assert.equal(extractMeta(pro, { topic: "X", slideCount: 20, planItems: 6 }).planItems, 6);
});

test("effectivePlanItems: forma va server AYNAN bir xil qisadi (pol 1, shift sig'im)", () => {
  assert.equal(effectivePlanItems(1, 2), 1);
  assert.equal(effectivePlanItems(5, 2), 2);
  assert.equal(effectivePlanItems("x", 9), 5, "noma'lum — standart 5");
  assert.equal(effectivePlanItems("x", 3), 3);
  assert.equal(effectivePlanItems(99, 9), 6, "shift PLAN_ITEMS_MAX");
  assert.equal(effectivePlanItems(0, 9), 1, "pol 1, PLAN_ITEMS_MIN emas");
  assert.equal(effectivePlanItems(4, 0), 1, "sig'im 0 bo'lsa ham kamida 1");
  // `extractMeta` shu funksiyadan o'tadi: 1 bandli tanlov 3 ga ko'tarilmaydi.
  for (const v of [
    { slideCount: 10, planItems: 1 },
    { slideCount: 10, planItems: 2 },
    { slideCount: 4, planItems: 6, quizCount: 3 },
    { slideCount: 12, planItems: "abc" },
    { slideCount: 30, planItems: 6, slidePurpose: "open_lesson" },
  ] as FormValues[]) {
    const m = extractMeta(pro, { topic: "X", ...v });
    assert.equal(m.planItems, effectivePlanItems(v.planItems, planCapacity(v), Number(v.slideCount)), JSON.stringify(v));
  }
});

/**
 * A3 jadvali (docs/audit-25/A3-structure.md) — ilgari NOL mazmunli
 * kataklar. Endi har birida kamida `planItems` ta reja mazmuni va
 * uzunlik aynan so'ralgan son.
 */
test("A3 oracle: ilgari 0 mazmunli kataklar endi ≥ planItems mazmun, uzunlik = slideCount", () => {
  const cells: [string, number][] = [
    ["open_lesson", 10],
    ["training", 8],
    ["open_lesson", 8],
    ["defense", 6],
    ["pitch", 4],
    ["open_lesson", 4],
    ["lesson", 6],
    ["training", 4],
  ];
  for (const [slidePurpose, slideCount] of cells) {
    const { meta, beats } = beatsOf({ slideCount, slidePurpose });
    const tag = `${slidePurpose}@${slideCount}: ${beats.map((b) => b.layout).join(",")}`;
    assert.equal(beats.length, slideCount, tag);
    const content = beats.filter((b) => b.plan && CONTENT.has(b.layout)).length;
    assert.ok(content >= meta.planItems && meta.planItems >= 1, `${tag}: ${content} mazmun, planItems ${meta.planItems}`);
  }
  // Standart uzunlikda (10) ochiq dars — moslashuvchan standart 3 band (egasi qarori), 16 da 5.
  assert.equal(beatsOf({ slideCount: 10, slidePurpose: "open_lesson" }).meta.planItems, 3);
  assert.equal(beatsOf({ slideCount: 16, slidePurpose: "open_lesson" }).meta.planItems, 5);
});

// ═══════════════════════════════════════════ A3-01 / A3-02

test("A3-01: aniq quizCount 0 tur standartidagi testni ham olib tashlaydi; yuborilmagani standartda qoladi", () => {
  for (const slidePurpose of ["open_lesson", "training"]) {
    assert.ok(PURPOSE_DEFAULTS[slidePurpose as "open_lesson"].blocks.includes("test"), "test asosi yo'qoldi");
    const zero = beatsOf({ slideCount: 12, slidePurpose, quizCount: 0 });
    assert.equal(zero.meta.quizCount, 0);
    assert.equal(zero.beats.filter((b) => b.layout === "quiz" || b.layout === "answers").length, 0, `${slidePurpose}: «Testsiz» — test chiqdi`);
    assert.doesNotMatch(slideSystem(zero.meta, zero.tpl), /quiz layout/, `${slidePurpose}: prompt hamon test so'raydi`);
    const unset = beatsOf({ slideCount: 12, slidePurpose });
    assert.equal(unset.meta.quizCount, undefined);
    assert.ok(unset.beats.some((b) => b.layout === "quiz"), `${slidePurpose}: yuborilmagan son — standart test qolishi kerak`);
    const five = beatsOf({ slideCount: 16, slidePurpose, quizCount: 5 });
    assert.ok(five.beats.filter((b) => b.layout === "quiz").length >= 1);
  }
  // Bo'sh satr — «yuborilmagan».
  assert.equal(extractMeta(pro, { topic: "X", quizCount: "" }).quizCount, undefined);
  assert.deepEqual(orderedBlocks(["reja", "test"], 0).map((b) => b.id), ["reja"]);
  assert.deepEqual(orderedBlocks(["reja", "test"]).map((b) => b.id), ["reja", "test"]);
});

test("A3-02: agendaSlide true standartida reja yo'q turga reja QO'SHADI; undefined — standart; false — olib tashlaydi", () => {
  for (const slidePurpose of ["pitch", "training"]) {
    assert.ok(!PURPOSE_DEFAULTS[slidePurpose as "pitch"].blocks.includes("reja"), "asos yo'qoldi");
    const on = beatsOf({ slideCount: 12, slidePurpose, agendaSlide: true });
    assert.equal(on.beats.filter((b) => b.layout === "agenda").length, 1, `${slidePurpose}: reja o'chirg'ichi yoqiq, reja yo'q`);
    assert.equal(on.beats.length, 12);
    const def = beatsOf({ slideCount: 12, slidePurpose });
    assert.equal(def.meta.agendaSlide, undefined);
    assert.equal(def.beats.filter((b) => b.layout === "agenda").length, 0, `${slidePurpose}: standartda reja yo'q edi`);
  }
  const off = beatsOf({ slideCount: 12, slidePurpose: "lecture", agendaSlide: false });
  assert.equal(off.beats.filter((b) => b.layout === "agenda").length, 0);
  const std = beatsOf({ slideCount: 12, slidePurpose: "lecture" });
  assert.equal(std.beats.filter((b) => b.layout === "agenda").length, 1);
});

// ═══════════════════════════════════════════ 4. agenda = reja slaydlari sarlavhalari

type Reply = (url: string) => unknown;

/** `globalThis.fetch` + kalitlarni almashtiradi va oxirida TIKLAYDI (`slide-live.test.mts` naqshi). */
async function withLlm(reply: Reply, fn: () => Promise<void>) {
  const saved = { fetch: globalThis.fetch, gemini: process.env.GEMINI_API_KEY, xai: process.env.XAI_API_KEY, stream: process.env.LLM_STREAM };
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.XAI_API_KEY;
  delete process.env.LLM_STREAM;
  globalThis.fetch = (async (url: string) => reply(String(url)) as never) as unknown as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [name, v] of [["GEMINI_API_KEY", saved.gemini], ["XAI_API_KEY", saved.xai], ["LLM_STREAM", saved.stream]] as const) {
      if (v === undefined) delete process.env[name];
      else process.env[name] = v;
    }
  }
}

const jsonReply = (text: string) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });

/** Beat uchun model javobidagi slayd — sarlavha ATAYIN tartib raqami bilan. */
function rawFor(b: SlideBeat, i: number): Record<string, unknown> {
  const title = b.plan ? `${b.plan}. Band ${b.plan} ${b.layout}` : `Slayd ${i + 1}`;
  const base = { layout: b.layout, title };
  switch (b.layout) {
    case "agenda":
      return { ...base, bullets: ["Model yozgan 1", "Model yozgan 2"] };
    case "section":
    case "title":
    case "closing":
      return { ...base, subtitle: "Kirish matni" };
    case "twoCol":
    case "compare":
      return { ...base, leftTitle: "A", left: ["x", "y"], rightTitle: "B", right: ["z", "w"] };
    case "process":
      return { ...base, steps: [{ title: "Bir", text: "Matn" }, { title: "Ikki", text: "Matn" }] };
    case "stats":
      return { ...base, stats: [{ value: "2 bosqich", label: "Bosqichlar" }] };
    case "table":
      return { ...base, table: { headers: ["A", "B"], rows: [["1", "2"], ["3", "4"]] } };
    case "quote":
      return { ...base, quote: "Iqtibos" };
    case "quiz":
      return { ...base, quiz: [{ q: "Savol?", options: ["a", "b", "c", "d"], answer: 1 }] };
    default:
      return { ...base, bullets: ["Birinchi band", "Ikkinchi band"] };
  }
}

test("agenda yozuvdan keyin reja slaydlari sarlavhasidan quriladi (bo'lim afzal), raqamsiz, tartibda", async () => {
  for (const v of [
    { slideCount: 10, planItems: 3, slideTemplate: "lecture" }, // bo'limli bandlar
    { slideCount: 10, planItems: 5, slideTemplate: "lecture" }, // bo'limsiz (joy yetmaydi)
    { slideCount: 12, planItems: 4, slidePurpose: "open_lesson", quizCount: 3 },
  ] as FormValues[]) {
    const meta = extractMeta(slideTool, { topic: "Suv aylanishi", ...v });
    const tpl = resolveDeckTemplate(meta);
    const beats = deckBeats(meta, tpl);
    let out: SlideModel[] | null = null;
    await withLlm(
      () => jsonReply(JSON.stringify({ slides: beats.map(rawFor) })),
      async () => {
        out = await writeSlidesWithLlm(meta, tpl, beats, Date.now() + 120_000, {});
      },
    );
    const slides = out as SlideModel[] | null;
    assert.ok(slides, JSON.stringify(v));
    const tag = JSON.stringify(v);
    // `plan` rejadan slaydga o'tadi.
    assert.deepEqual(slides.map((s) => s.plan), beats.map((b) => b.plan), `${tag}: plan maydoni beat'dan o'tmadi`);
    const expected = Array.from({ length: meta.planItems }, (_, k) => {
      const i = k + 1;
      const head = beats.find((b) => b.plan === i && b.layout === "section") ?? beats.find((b) => b.plan === i)!;
      return `Band ${i} ${head.layout}`;
    });
    const agenda = slides.find((s) => s.layout === "agenda");
    assert.ok(agenda, tag);
    assert.deepEqual(agenda.bullets, expected, `${tag}: agenda reja slaydlariga mos emas`);
    // Hech bir sarlavha tartib raqami bilan boshlanmaydi.
    for (const s of slides) assert.doesNotMatch(s.title, /^\d+[.)]/, `${tag}: «${s.title}»`);
  }
});

test("syncAgenda: reja slaydi yo'qolgan band o'tkazib yuboriladi, reja bandsiz dekaga tegmaydi", () => {
  const rules = { bulletChars: 40 };
  const deck: SlideModel[] = [
    { id: "a", layout: "agenda", title: "Reja", bullets: ["eski"] },
    { id: "b", layout: "section", title: "I. Kirish qismi", plan: 1 },
    { id: "c", layout: "bullets", title: "Ta’rif", plan: 1 },
    { id: "d", layout: "bullets", title: "Juda uzun sarlavha bu yerda qator chegarasidan oshib ketadi albatta", plan: 3 },
  ];
  syncAgenda(deck, rules);
  assert.equal(deck[0].bullets!.length, 2, "yo'q band (2) agenda'ga tushmasin");
  assert.equal(deck[0].bullets![0], "Kirish qismi");
  assert.ok(deck[0].bullets![1].length <= 40 && deck[0].bullets![1].endsWith("…"), deck[0].bullets![1]);
  // Band ichida bo'lim mazmundan KEYIN kelsa ham (model maketni almashtirgan) — bo'lim sarlavhasi afzal.
  const swapped: SlideModel[] = [
    { id: "a", layout: "agenda", title: "Reja", bullets: [] },
    { id: "b", layout: "bullets", title: "Mazmun", plan: 1 },
    { id: "c", layout: "section", title: "Bo‘lim nomi", plan: 1 },
  ];
  syncAgenda(swapped, rules);
  assert.deepEqual(swapped[0].bullets, ["Bo‘lim nomi"]);
  const plain: SlideModel[] = [{ id: "a", layout: "agenda", title: "Reja", bullets: ["model"] }, { id: "b", layout: "bullets", title: "X" }];
  syncAgenda(plain, rules);
  assert.deepEqual(plain[0].bullets, ["model"], "eski deka (plan yo'q) — agenda o'zgarmaydi");
});

// ═══════════════════════════════════════════ 5. tartib raqami sarlavhadan olinadi

test("sarlavha boshidagi tartib raqami olib tashlanadi, raqamli so'z esa qoladi", () => {
  const cases: [string, string][] = [
    ["1. Kirish", "Kirish"],
    ["2) Asosiy qism", "Asosiy qism"],
    ["3 — Mexanizm", "Mexanizm"],
    ["04: Xulosa", "Xulosa"],
    ["IV. Tarix", "Tarix"],
    ["IX) Natija", "Natija"],
    ["3D modellash asoslari", "3D modellash asoslari"],
    ["12-maktab tarixi", "12-maktab tarixi"],
    ["2024-yil voqealari", "2024-yil voqealari"],
    ["1.2. Kichik band", "1.2. Kichik band"],
    ["Ikki bosqich", "Ikki bosqich"],
    ["1.", "1."],
    // P1 sharhi, 4-band — soxta ijobiylar (oraliq, nisbat, o'zgaruvchi, bosh harflar):
    ["18 – 20 asrlar", "18 – 20 asrlar"],
    ["3 - 4 sinflar uchun", "3 - 4 sinflar uchun"],
    ["5 – 9-sinflar", "5 – 9-sinflar"],
    ["X - noma’lum son", "X - noma’lum son"],
    ["I – shaxs olmoshi", "I – shaxs olmoshi"],
    ["V. I. Lenin", "V. I. Lenin"],
    ["10: 1 nisbat", "10: 1 nisbat"],
    ["5-sinf", "5-sinf"],
    ["II jahon urushi", "II jahon urushi"],
    ["1-mavzu: Kirish", "1-mavzu: Kirish"],
    // bo'shliqsiz tartib raqami va ichki reja prefiksi
    ["1.Kirish", "Kirish"],
    ["REJA 2-band: Ta’rif", "Ta’rif"],
    ["reja 3 - band : 2. Mexanizm", "Mexanizm"],
  ];
  for (const [inp, want] of cases) assert.equal(stripOrdinal(inp), want, inp);
  // `normalizeSlide` yo'li (jonli oqim ham shu).
  const rules = bodyRules(extractMeta(slideTool, { topic: "X" }), "lecture");
  const got = extractNewSlides(JSON.stringify({ slides: [{ layout: "bullets", title: "5. Suv aylanishi", bullets: ["a"] }] }), 0, "F", rules, { final: true });
  assert.equal(got[0].slide.title, "Suv aylanishi");
});

test("shablon rollarida qattiq tartib raqami yo'q", () => {
  for (const t of SLIDE_TEMPLATES) {
    for (const b of [...t.beats, ...t.fillers]) assert.doesNotMatch(b.role, /^\s*\d+\s*[.)]/, `${t.id}: «${b.role}»`);
  }
});

// ═══════════════════════════════════════════ 6. halol skelet

test("skelet uydirma raqam bermaydi: stats «—», process matni rol, bullets «…», agenda — reja rollari", () => {
  for (const v of [
    { slideCount: 10, slideTemplate: "report" },
    { slideCount: 12, slidePurpose: "open_lesson", quizCount: 3 },
    { slideCount: 16, slidePurpose: "defense" },
    { slideCount: 8, slidePurpose: "pitch" },
  ] as FormValues[]) {
    const { meta, tpl, beats } = beatsOf(v);
    const deck = fallbackSlides(meta, tpl, beats);
    const tag = JSON.stringify(v);
    for (const s of deck) {
      for (const st of s.stats ?? []) {
        assert.equal(st.value, "—", `${tag}: skeletda raqam «${st.value}»`);
        assert.doesNotMatch(st.value, /\d/);
      }
      if (s.layout === "process") for (const st of s.steps ?? []) assert.equal(st.text, planRoleText(beats[deck.indexOf(s)].role), tag);
      if (s.layout === "bullets") assert.deepEqual(s.bullets, ["…"], tag);
      assert.doesNotMatch(s.title, /^REJA \d+-band/, `${tag}: skelet sarlavhasida ichki prefiks`);
    }
    assert.deepEqual(deck.map((s) => s.plan), beats.map((b) => b.plan), `${tag}: skeletda plan yo'q`);
    const agenda = deck.find((s) => s.layout === "agenda");
    if (agenda) {
      assert.equal(agenda.bullets!.length, meta.planItems, tag);
      for (const x of agenda.bullets!) assert.doesNotMatch(x, /^REJA|kirish$|^Asosiy qism$/, `${tag}: «${x}»`);
    }
  }
});

// ═══════════════════════════════════════════ 7. prompt

test("prompt reja bandlari slaydlarini va raqamsiz sarlavhani aytadi", () => {
  const meta = extractMeta(pro, { topic: "Suv aylanishi", planItems: 4 });
  const p = slideSystem(meta, resolveDeckTemplate(meta));
  assert.match(p, /(^|\n)REJA BANDLARI: rejada 4 ta band bor — ketma-ketlikdagi «REJA i-band: …» slaydlari/);
  assert.match(p, /agenda bandlari AYNAN shu slaydlar sarlavhalari/);
  assert.match(p, /Sarlavha boshida TARTIB raqami bo‘lmasin/);
  assert.match(p, /«3D», «5 ta qoida» — mumkin/);
  assert.match(p, /«REJA i-band:» yozuvini sarlavhaga ko‘chirmang/);
  // Kichik dekada agenda yon bergan — prompt uni so'ramaydi.
  const tiny = extractMeta(pro, { topic: "X", slideCount: 4, quizCount: 3 });
  const pt = slideSystem(tiny, resolveDeckTemplate(tiny));
  assert.doesNotMatch(pt, /agenda: AYNAN/);
  assert.match(pt, /(^|\n)REJA BANDLARI: rejada 1 ta band/);
});

// ═══════════════════════════════════════════ P1 sharhi (AUDIT-25-P1.md) va P4 N1

/** `SlideComposer.initialValues()` ning HAQIQIY shakli — forma nima yuborsa, shu. */
function formShape(p: string, isPro = true): FormValues {
  return {
    topic: "Suv aylanishi",
    language: "uz",
    slideAudience: "auto",
    slidePurpose: p,
    blocks: resetBlocksForPurpose(p),
    planItems: PLAN_ITEMS_DEFAULT,
    slideCount: isPro ? PRO_SLIDE_DEFAULT : 10,
    textVolume: "standart",
    quizCount: 0,
    titleSlide: true,
    agendaSlide: true,
    internetSearch: false,
    speakerNotes: true,
    slideTemplate: "auto",
  };
}

const idsOf = (csv: FormValues[string]) => String(csv ?? "").split(",").filter(Boolean);

test("1-band: pro formasi shaklida «Test» va «Reja» chiplari dekani O'ZGARTIRADI (quizCount 0 / agendaSlide true doim yuborilsa ham)", () => {
  for (const p of SLIDE_PURPOSES) {
    const base = formShape(p);
    const ids = idsOf(base.blocks);
    const withTest = [...new Set([...ids, "test"])].join(",");
    const noTest = ids.filter((x) => x !== "test").join(",");
    assert.ok(beatsOf({ ...base, blocks: withTest }).beats.some((b) => b.layout === "quiz"), `${p}: «Test» chipi belgilangan — test yo'q`);
    assert.ok(!beatsOf({ ...base, blocks: noTest }).beats.some((b) => b.layout === "quiz"), `${p}: «Test» chipi olingan — test chiqdi`);
    const withReja = [...new Set(["reja", ...ids])].join(",");
    const noReja = ids.filter((x) => x !== "reja").join(",");
    assert.ok(beatsOf({ ...base, blocks: withReja }).beats.some((b) => b.layout === "agenda"), `${p}: «Reja» chipi belgilangan — agenda yo'q`);
    assert.ok(!beatsOf({ ...base, blocks: noReja }).beats.some((b) => b.layout === "agenda"), `${p}: «Reja» chipi olingan — agenda chiqdi`);
    // «Reja slaydi» o'chirg'ichi (false) baribir agenda slaydini o'chiradi.
    assert.ok(!beatsOf({ ...base, blocks: withReja, agendaSlide: false }).beats.some((b) => b.layout === "agenda"), `${p}: agendaSlide false`);
  }
});

test("P4 N1: oddiy «Slayd» ham `blocks` yuboradi — u tanlov emas, «Testsiz»/«Reja slaydi» ishlaydi", () => {
  // Oddiy slayd + ochiq dars + aniq 0 + bloklar yuborilgan → test YO'Q.
  const plain = extractMeta(slideTool, formShape("open_lesson", false));
  assert.equal(plain.quizCount, 0);
  assert.ok(!deckBeats(plain, resolveDeckTemplate(plain)).some((b) => b.layout === "quiz"), "oddiy slaydda «Testsiz» e'tiborsiz qoldi");
  // Oddiy slayd + pitch + agendaSlide true → reja qo'shiladi.
  const pitch = extractMeta(slideTool, formShape("pitch", false));
  assert.ok(deckBeats(pitch, resolveDeckTemplate(pitch)).some((b) => b.layout === "agenda"), "oddiy slaydda «Reja slaydi» e'tiborsiz qoldi");
  // Pro + «reja,test» + aniq 0 → test QOLADI (chip ustun), son — standart.
  const chip = extractMeta(pro, { topic: "X", blocks: "reja,test", quizCount: 0 });
  assert.equal(chip.quizCount, undefined);
  assert.ok(deckBeats(chip, resolveDeckTemplate(chip)).some((b) => b.layout === "quiz"));
  // Forma sig'imi `tool` ga bog'liq: oddiy slaydda «Testsiz» testni o'chiradi (+1 o'rin), pro'da chip ustun.
  const shape = formShape("open_lesson", false);
  assert.equal(planCapacity({ ...shape, tool: "slide" }), 7, "oddiy: 8 − reja");
  assert.equal(planCapacity({ ...shape, tool: "pro-slide" }), 6, "pro: 8 − reja − savol");
  // Forma sig'imi dvigatel bilan bir xil — `tool` bilan.
  for (const [tool, p] of [[slideTool, "open_lesson"], [pro, "open_lesson"], [slideTool, "pitch"], [pro, "training"]] as const) {
    const v = formShape(p, tool === pro);
    const m = extractMeta(tool, v);
    assert.equal(m.planItems, effectivePlanItems(v.planItems, planCapacity({ ...v, tool: tool.id }), Number(v.slideCount)), `${tool.id}/${p}`);
    const beats = deckBeats(m, resolveDeckTemplate(m));
    assert.equal(planIds(beats).length, m.planItems, `${tool.id}/${p}: forma sig'imi ≠ dvigatel`);
  }
  assert.deepEqual(resolvePlanFlags(true, ["reja", "test"], 0, true), { quizCount: undefined, agendaSlide: undefined });
  assert.deepEqual(resolvePlanFlags(true, ["reja"], 0, false), { quizCount: 0, agendaSlide: false });
  assert.deepEqual(resolvePlanFlags(false, ["reja", "test"], 0, true), { quizCount: 0, agendaSlide: true });
  assert.deepEqual([...activeBlockIds(["reja", "test"], 0, true, true)].sort(), ["adabiyotlar", "reja"]);
});

/** Beat'dan blok id (prompt ⇔ beat supurishi uchun). */
function blockIdsInBeats(beats: SlideBeat[]): Set<string> {
  const out = new Set<string>();
  for (const b of beats) {
    if (b.layout === "agenda") out.add("reja");
    else if (b.layout === "quiz") out.add("test");
    else if (b.layout === "references") out.add("adabiyotlar");
    else if (b.layout === "stats" && b.chart) out.add("diagramma");
    else for (const blk of SLIDE_BLOCKS) if (!b.plan && b.role === blk.role({ planItems: 1, quizCount: 3 })) out.add(blk.id);
  }
  return out;
}

test("2-band: prompt qatorlari ⇔ dekadagi beat (references, diagramma, quiz, TUZILMA) — plannedBlocks yagona manba", () => {
  const fails: string[] = [];
  let cases = 0;
  const sets = ["", "reja", "reja,maqsadlar,motivatsiya,amaliyot,test,jadval,diagramma", "diagramma,adabiyotlar", ...SLIDE_BLOCKS.map((b) => b.id)];
  for (const slidePurpose of ["general", "open_lesson", "defense", "pitch"]) {
    for (const blocks of sets) {
      for (const slideCount of [4, 6, 8, 12, 20]) {
        for (const internetSearch of [false, true]) {
          for (const quizCount of [undefined, 0, 3]) {
            cases += 1;
            const v: FormValues = { slideCount, slidePurpose, blocks, internetSearch, planItems: 3, ...(quizCount === undefined ? {} : { quizCount }) };
            const { meta, tpl, beats } = beatsOf(v);
            const p = slideSystem(meta, tpl);
            const present = blockIdsInBeats(beats);
            const tag = `${slidePurpose}/[${blocks}]/n=${slideCount}/net=${internetSearch}/q=${quizCount}`;
            if (/references layout/.test(p) !== present.has("adabiyotlar")) fails.push(`${tag}: references qatori ⇎ beat`);
            if (/stats \(diagramma\)/.test(p) !== present.has("diagramma")) fails.push(`${tag}: diagramma qatori ⇎ beat`);
            if (/quiz layout/.test(p) !== present.has("test")) fails.push(`${tag}: quiz qatori ⇎ beat`);
            const line = /TUZILMA BLOKLARI \(rejada shu tartibda\): ([^.]*)\./.exec(p)?.[1] ?? "";
            const listed = line ? line.split(", ").sort().join(",") : "";
            if (listed !== [...present].sort().join(",")) fails.push(`${tag}: TUZILMA «${line}» ≠ beats {${[...present].join(",")}}`);
            const planned = plannedBlocks(meta, beats.length - 2);
            if (planned.kept.slice().sort().join(",") !== listed) fails.push(`${tag}: plannedBlocks ≠ TUZILMA`);
          }
        }
      }
    }
  }
  assert.ok(cases >= 800, `supurish kichik: ${cases}`);
  assert.deepEqual(fails.slice(0, 10), [], `${fails.length}/${cases}:\n  ${fails.slice(0, 10).join("\n  ")}`);
  // Sharhdagi misol: 6 slayd, qo'lda 7 blok + internet — yon beruvchi TURDAGI bloklar
  // `diagramma`/`adabiyotlar` dan OLDIN tashlanadi (4 o'rin: reja, 3 band... → 1 blok o'rni).
  const { meta, beats } = beatsOf({ slideCount: 8, slidePurpose: "general", blocks: "reja,maqsadlar,motivatsiya,amaliyot,test,jadval,diagramma", internetSearch: true, planItems: 2 });
  const kept = plannedBlocks(meta, beats.length - 2).kept;
  assert.deepEqual(kept, ["reja", "diagramma", "test", "adabiyotlar"], `${beats.map((b) => b.layout).join(",")}`);
});

const STRUCTURAL = new Set([...SLIDE_TEMPLATE_BY_ID.lesson.beats, ...SLIDE_TEMPLATE_BY_ID.lesson.fillers].filter((b) => b.structural).map((b) => b.role));

test("3-band: «Dars» shablonida reja bandi pedagogik tuzilma roli bo'lmaydi, bandlar baribir to'ladi", () => {
  assert.equal(STRUCTURAL.size, 8, `tuzilma rollari: ${[...STRUCTURAL].join(" | ")}`);
  for (const slidePurpose of ["lesson", "open_lesson", "training"]) {
    for (const slideCount of [6, 10, 12, 16, 24, 30]) {
      for (const planItems of [3, 6]) {
        const { meta, beats } = beatsOf({ slideCount, slidePurpose, planItems, slideTemplate: "lesson" });
        const tag = `${slidePurpose}/n=${slideCount}/p=${planItems}: ${beats.filter((b) => b.plan).map((b) => b.role).join(" | ")}`;
        assert.deepEqual(coverage(beats, meta.planItems), [], tag);
        for (const b of beats) if (b.plan) assert.ok(!STRUCTURAL.has(planRoleText(b.role)), `tuzilma roli reja bandida — ${tag}`);
        // Umumiy (shablonniki emas) «stats» reja bandi bo'lmaydi.
        for (const b of beats) if (b.plan && b.layout === "stats") assert.ok(!/Eslab qolinadigan ko‘rsatkich/.test(b.role), tag);
      }
    }
  }
  // Tuzilma beat'lari qo'shimcha o'ringa hamon yaraydi (katta dekada paydo bo'ladi).
  const big = beatsOf({ slideCount: 30, slidePurpose: "lesson", planItems: 3, slideTemplate: "lesson" }).beats;
  assert.ok(big.some((b) => !b.plan && STRUCTURAL.has(b.role)), big.map((b) => b.role).join(" | "));
});

test("5-band: skelet (`plan` hodisasi) rollarida ichki prefiks yo'q; sarlavha chegarasi reja qatoriga sig'adi", async () => {
  const meta = extractMeta(slideTool, { topic: "Suv aylanishi", slideCount: 8 });
  const tpl = resolveDeckTemplate(meta);
  const beats = deckBeats(meta, tpl);
  const events: SlideProgressEvent[] = [];
  await withLlm(
    () => jsonReply(JSON.stringify({ slides: beats.map(rawFor) })),
    async () => {
      await buildSlideAcademicDoc(meta, Date.now() + 120_000, { onProgress: (e) => events.push(e) }).catch(() => undefined);
    },
  );
  const plan = events.find((e) => e.type === "plan") as Extract<SlideProgressEvent, { type: "plan" }> | undefined;
  assert.ok(plan, "plan hodisasi yo'q");
  assert.ok(plan.roles.every((r) => !/^REJA \d+-band/.test(r)), plan.roles.join(" | "));
  assert.ok(plan.roles.includes(planRoleText(beats.find((b) => b.plan)!.role)));
  // 5c: sarlavha (80) auditoriyalarning eng tor reja qatoriga sig'adi — `syncAgenda` kesmasin.
  const minChars = Math.min(...Object.values(AUDIENCE_RULES).map((r) => r.bulletChars));
  assert.ok(SLIDE_LIMITS.title <= minChars, `title ${SLIDE_LIMITS.title} > bulletChars ${minChars}`);
  // «qisqa» hajmda qator torroq — kesish SO'Z chegarasida.
  const long = "Fotosintezning yorug‘lik va qorong‘ilik bosqichlari hamda ularning ahamiyati";
  const deck: SlideModel[] = [
    { id: "a", layout: "agenda", title: "Reja", bullets: [] },
    { id: "b", layout: "bullets", title: long, plan: 1 },
  ];
  // 36 — chegara «qorong‘ilik» so'zining O'RTASIGA tushadi.
  syncAgenda(deck, { bulletChars: 36 });
  const item = deck[0].bullets![0];
  const body = item.slice(0, -1);
  assert.ok(item.endsWith("…") && item.length <= 36, item);
  assert.ok(long.startsWith(body) && long[body.length] === " ", `so'z o'rtasidan kesildi: «${item}»`);
});

test("7-band: moslashuvchan standart reja bandlari soni (egasi qarori)", () => {
  assert.deepEqual([4, 8, 10, 12, 16, 18, 24, 30].map(defaultPlanItems), [3, 3, 3, 4, 5, 6, 6, 6]);
  assert.equal(effectivePlanItems(undefined, 9, 12), 4);
  assert.equal(effectivePlanItems("", 9, 16), 5);
  assert.equal(effectivePlanItems(undefined, 9), PLAN_ITEMS_DEFAULT, "slayd soni noma'lum — 5");
  assert.equal(effectivePlanItems(6, 9, 10), 6, "aniq tanlov ustun");
  // Ochiq dars @10, band soni yuborilmagan: 3 band VA maqsadlar+motivatsiya+amaliyot+savol joyida, uzunlik 10.
  for (const tool of [slideTool, pro]) {
    const { meta, beats } = beatsOf({ slideCount: 10, slidePurpose: "open_lesson" }, tool);
    const tag = `${tool.id}: ${beats.map((b) => b.layout).join(",")}`;
    assert.equal(beats.length, 10, tag);
    assert.equal(meta.planItems, 3, tag);
    assert.equal(planIds(beats).length, 3, tag);
    for (const role of ["Maqsadlar", "Motivatsiya", "Amaliyot"]) assert.ok(beats.some((b) => b.role.startsWith(role)), `${role} yo'q — ${tag}`);
    assert.ok(beats.some((b) => b.layout === "quiz"), `savol yo'q — ${tag}`);
  }
});
